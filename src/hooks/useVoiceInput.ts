import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Chat } from "@/lib/chat";
import { terminal } from "@/lib/chat";
import {
  VOICE_DEFAULTS,
  isMaterialDiff,
  shouldEarlyDispatch,
} from "@/lib/voiceHeuristics";
import { subscribeVoice, voiceStart, voiceStop, voiceSupported } from "@/lib/voice";
import { useComposer } from "@/store/composer";
import { log } from "@/store/log";

export type VoicePhase = "unsupported" | "idle" | "listening" | "error";

interface Provisional {
  text: string;
  taskId: string;
}

/**
 * Wires macOS streaming STT into the composer and optionally early-dispatches to mobd.
 * Click toggles listening; press-and-hold talks until release.
 */
export function useVoiceInput(chat: Chat) {
  const setText = useComposer((s) => s.setText);
  const [phase, setPhase] = useState<VoicePhase>("unsupported");
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef("");
  const confidence = useRef<number | undefined>(undefined);
  const provisional = useRef<Provisional | null>(null);
  const listening = useRef(false);
  const holdTimer = useRef<number | null>(null);
  const holdMode = useRef(false);
  const silenceFallback = useRef<number | null>(null);
  const dispatching = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void voiceSupported().then((ok) => {
      if (cancelled) return;
      setSupported(ok);
      setPhase(ok ? "idle" : "unsupported");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const clearSilenceFallback = () => {
    if (silenceFallback.current != null) {
      window.clearTimeout(silenceFallback.current);
      silenceFallback.current = null;
    }
  };

  const waitUntilIdle = async (timeoutMs = 15000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const t = chat.currentTask;
      if (!t || terminal(t.status)) return true;
      await new Promise((r) => setTimeout(r, 120));
    }
    return false;
  };

  const tryEarlyOrFinal = useCallback(
    async (text: string, conf: number | undefined, source: "silence" | "final" | "stop") => {
      const prompt = text.trim();
      if (!prompt || dispatching.current) return;

      const prov = provisional.current;
      if (source === "final" && prov) {
        if (isMaterialDiff(prov.text, prompt)) {
          log(`voice: final differs from provisional; cancel ${prov.taskId}`);
          dispatching.current = true;
          try {
            await chat.cancel();
            await waitUntilIdle();
            provisional.current = null;
            if (chat.canSend) {
              const ok = await chat.submit(prompt);
              if (ok) {
                provisional.current = {
                  text: prompt,
                  taskId: chat.currentTask?.id ?? "",
                };
                setText("");
              }
            }
          } finally {
            dispatching.current = false;
          }
        } else {
          log("voice: final matches provisional; keep task");
          provisional.current = null;
        }
        return;
      }

      if (prov) return; // already early-dispatched this utterance

      const early =
        source === "final" ||
        shouldEarlyDispatch(prompt, conf) ||
        (source === "stop" && prompt.length >= VOICE_DEFAULTS.minChars);

      if (!early) return;
      if (!chat.canSend) return;

      dispatching.current = true;
      try {
        log(`voice: ${source} dispatch «${prompt.slice(0, 80)}» conf=${conf ?? "n/a"}`);
        const ok = await chat.submit(prompt);
        if (ok) {
          provisional.current = {
            text: prompt,
            taskId: chat.currentTask?.id ?? "",
          };
          setText("");
          // final already committed — clear provisional marker after submit
          if (source === "final" || source === "stop") provisional.current = null;
        }
      } finally {
        dispatching.current = false;
      }
    },
    [chat, setText],
  );

  const armSilenceFallback = useCallback(() => {
    clearSilenceFallback();
    silenceFallback.current = window.setTimeout(() => {
      void tryEarlyOrFinal(latest.current, confidence.current, "silence");
    }, VOICE_DEFAULTS.silenceMs);
  }, [tryEarlyOrFinal]);

  const stopListening = useCallback(
    async (opts: { flush?: boolean } = {}) => {
      clearSilenceFallback();
      if (!listening.current) return;
      listening.current = false;
      try {
        await voiceStop();
      } catch (err) {
        log(`voice stop failed: ${String(err)}`);
      }
      setPhase("idle");
      if (opts.flush !== false) {
        await tryEarlyOrFinal(latest.current, confidence.current, "stop");
      }
    },
    [tryEarlyOrFinal],
  );

  const startListening = useCallback(async () => {
    if (listening.current || phase === "unsupported") return;
    setError("");
    latest.current = "";
    confidence.current = undefined;
    provisional.current = null;
    try {
      await voiceStart();
      listening.current = true;
      setPhase("listening");
      log("voice: listening");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setPhase("error");
      log(`voice start failed: ${message}`);
    }
  }, [phase]);

  useEffect(() => {
    if (!supported) return;
    let unlisten: (() => void) | undefined;
    let alive = true;
    void subscribeVoice({
      onPartial: (p) => {
        if (!alive || !listening.current) return;
        latest.current = p.text;
        confidence.current = p.confidence;
        if (!provisional.current) setText(p.text);
        else if (isMaterialDiff(provisional.current.text, p.text)) {
          // User kept talking after an early send — cancel and resume drafting.
          void (async () => {
            log("voice: partial drifted after provisional; cancelling");
            await chat.cancel();
            provisional.current = null;
            setText(p.text);
          })();
        }
        armSilenceFallback();
        if (shouldEarlyDispatch(p.text, p.confidence)) {
          // Do not fire immediately; wait for silence so we do not cut off mid-phrase.
          // Silence native event / fallback timer will call tryEarlyOrFinal.
        }
      },
      onFinal: (p) => {
        if (!alive) return;
        latest.current = p.text;
        confidence.current = p.confidence;
        clearSilenceFallback();
        if (!provisional.current) setText(p.text);
        void tryEarlyOrFinal(p.text, p.confidence, "final");
      },
      onSilence: () => {
        if (!alive || !listening.current) return;
        void tryEarlyOrFinal(latest.current, confidence.current, "silence");
      },
      onError: (message) => {
        if (!alive) return;
        setError(message);
        setPhase("error");
        log(`voice error: ${message}`);
        listening.current = false;
        clearSilenceFallback();
      },
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      alive = false;
      unlisten?.();
      clearSilenceFallback();
      if (listening.current) void voiceStop().catch(() => undefined);
      listening.current = false;
    };
  }, [supported, setText, armSilenceFallback, tryEarlyOrFinal, chat]);

  const onMicPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!supported || phase === "unsupported") return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      holdMode.current = false;
      if (holdTimer.current != null) window.clearTimeout(holdTimer.current);
      holdTimer.current = window.setTimeout(() => {
        holdMode.current = true;
        if (!listening.current) void startListening();
      }, VOICE_DEFAULTS.holdMs);
    },
    [supported, phase, startListening],
  );

  const onMicPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      if (!supported) return;
      e.preventDefault();
      if (holdTimer.current != null) {
        window.clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
      if (holdMode.current) {
        holdMode.current = false;
        void stopListening({ flush: true });
        return;
      }
      // Click toggle
      if (listening.current) void stopListening({ flush: true });
      else void startListening();
    },
    [supported, startListening, stopListening],
  );

  const onMicPointerCancel = useCallback(() => {
    if (holdTimer.current != null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (holdMode.current && listening.current) {
      holdMode.current = false;
      void stopListening({ flush: true });
    }
  }, [stopListening]);

  return {
    supported,
    phase,
    error,
    listening: phase === "listening",
    onMicPointerDown,
    onMicPointerUp,
    onMicPointerCancel,
  };
}
