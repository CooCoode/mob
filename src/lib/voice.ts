import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type VoiceEventKind = "partial" | "final" | "silence" | "error";

export interface VoicePayload {
  text: string;
  confidence: number;
}

export interface VoiceErrorPayload {
  message: string;
}

export interface VoiceHandlers {
  onPartial?: (p: VoicePayload) => void;
  onFinal?: (p: VoicePayload) => void;
  onSilence?: () => void;
  onError?: (message: string) => void;
}

export async function voiceSupported(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>("voice_supported");
  } catch {
    return false;
  }
}

export async function voiceStart(): Promise<void> {
  await invoke("voice_start");
}

export async function voiceStop(): Promise<void> {
  await invoke("voice_stop");
}

/** Subscribe to native voice events; returns an unsubscribe that also stops recognition. */
export async function subscribeVoice(handlers: VoiceHandlers): Promise<UnlistenFn> {
  const unsubs: UnlistenFn[] = [];
  unsubs.push(
    await listen<VoicePayload>("voice-partial", (e) => handlers.onPartial?.(e.payload)),
  );
  unsubs.push(
    await listen<VoicePayload>("voice-final", (e) => handlers.onFinal?.(e.payload)),
  );
  unsubs.push(
    await listen("voice-silence", () => handlers.onSilence?.()),
  );
  unsubs.push(
    await listen<VoiceErrorPayload>("voice-error", (e) => handlers.onError?.(e.payload.message)),
  );
  return () => {
    for (const u of unsubs) u();
  };
}
