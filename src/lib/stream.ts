import { useSyncExternalStore } from "react";
import { supports } from "../api/client.ts";
import type { Health } from "../api/types.ts";
import { authFetch } from "./auth.ts";
import { buttonName, HeldInput, normalizePoint, wheelPixels, type InputMessage } from "./liveInput.ts";

// The live desktop over WebRTC (mobd docs/desktop-streaming.md): one non-trickle POST /stream with
// the offer, a receive-only H.264 track, the `control` data channel for stats and `ended`, and the
// `input` (reliable) and `pointer` (unreliable, latest wins) channels for control mode.

export const UPDATE_MOBD = "Update mobd on the office Mac to use the live desktop";

export type Quality = "auto" | "high" | "low";

export interface StreamRequest {
  offer?: string;
  maxWidth: number;
  maxHeight: number;
  quality: Quality;
}

export interface StreamAnswer {
  session: string;
  answer?: string;
  wsTicket?: string;
  width: number;
  height: number;
}

/** POST /stream; errors carry mobd's message (a locked screen, missing Screen Recording). */
export async function openSession(base: string, req: StreamRequest): Promise<StreamAnswer> {
  const res = await authFetch(base, `${base}/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (res.status === 404 || res.status === 405) throw new Error(UPDATE_MOBD);
  const data = (await res.json().catch(() => ({}))) as Partial<StreamAnswer> & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  if (typeof data.session !== "string" || !data.session) throw new Error("Invalid live desktop answer from mobd.");
  return data as StreamAnswer;
}

/** DELETE /stream/{id}; best effort, the session also ends when the peer goes away. */
export function closeSession(base: string, session: string): void {
  void authFetch(base, `${base}/stream/${encodeURIComponent(session)}`, { method: "DELETE" }).catch(() => {});
}

export type ControlMessage =
  | { t: "stats"; kbps: number; width: number; height: number; fps: number; loss?: number; rttMs?: number }
  | { t: "ended"; message: string }
  | { t: "error"; about?: string; message: string }
  | { t: "cursor"; x: number; y: number };

/** Parses a message from mobd's control channel; unknown or malformed messages are null. */
export function parseControl(data: unknown): ControlMessage | null {
  if (typeof data !== "string") return null;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(data);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object") return null;
  const num = (k: string) => (typeof m[k] === "number" ? (m[k] as number) : 0);
  const str = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : "");
  switch (m.t) {
    case "stats":
      return { t: "stats", kbps: num("kbps"), width: num("width"), height: num("height"), fps: num("fps"), loss: num("loss"), rttMs: num("rttMs") };
    case "ended":
      return { t: "ended", message: str("message") || "The office Mac ended the live view" };
    case "error":
      return { t: "error", about: str("about"), message: str("message") };
    case "cursor":
      return { t: "cursor", x: num("x"), y: num("y") };
  }
  return null;
}

export type LiveStatus = "idle" | "connecting" | "connected" | "error";

export interface StreamState {
  status: LiveStatus;
  detail: string;
  /** Encoded size of the picture. */
  width: number;
  height: number;
  /** Mouse and keyboard on the video reach the office Mac only while true. */
  control: boolean;
  kbps: number;
  fps: number;
}

export interface StreamTarget {
  base: string;
  health?: Health;
  /** The view in device pixels. */
  maxWidth: number;
  maxHeight: number;
  quality?: Quality;
  /** Take control as soon as the picture arrives (reconnecting at a new size keeps control). */
  control?: boolean;
}

const CONNECT_TIMEOUT = 15_000;
const IDLE: StreamState = { status: "idle", detail: "", width: 0, height: 0, control: false, kbps: 0, fps: 0 };

/** Resolves when ICE gathering completes, or after `ms`: host candidates take a few milliseconds. */
function gathered(pc: RTCPeerConnection, ms: number): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

// Owns the single live session; the video element is moved, never remounted, between layouts.
class StreamController {
  state: StreamState = IDLE;
  private listeners = new Set<() => void>();
  private attempt = 0;
  private pc: RTCPeerConnection | null = null;
  private video: HTMLVideoElement | null = null;
  private session: { base: string; id: string } | null = null;
  private input: RTCDataChannel | null = null;
  private pointer: RTCDataChannel | null = null;
  private held = new HeldInput();
  private detachInput: (() => void) | null = null;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private update(patch: Partial<StreamState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  async connect(video: HTMLVideoElement, target: StreamTarget): Promise<void> {
    if (!target.base) {
      this.update({ status: "error", detail: "Pair this machine in Settings" });
      return;
    }
    if (target.health && !supports(target.health, "stream")) {
      this.update({ status: "error", detail: UPDATE_MOBD });
      return;
    }
    this.disconnect();
    const attempt = ++this.attempt;
    const started = performance.now();
    this.update({ ...IDLE, status: "connecting", detail: "Connecting…" });
    const pc = new RTCPeerConnection();
    this.pc = pc;
    this.video = video;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const fail = (detail: string) => {
      if (attempt !== this.attempt) return;
      clearTimeout(timer);
      this.attempt++; // later events from this connection are ignored
      this.teardown();
      this.update({ ...IDLE, status: "error", detail });
    };
    timer = setTimeout(() => fail("The live view did not start. Is the office Mac reachable from here?"), CONNECT_TIMEOUT);
    pc.addEventListener("connectionstatechange", () => {
      if (attempt !== this.attempt) return;
      if (pc.connectionState === "failed") fail("The live view connection was lost");
      if (pc.connectionState === "closed") {
        this.teardown();
        this.update({ ...IDLE, detail: "Disconnected" });
      }
    });
    pc.addEventListener("track", (e) => {
      if (attempt !== this.attempt) return;
      video.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      void video.play().catch(() => {});
    });
    const onFrame = () => {
      if (attempt !== this.attempt) return;
      if (this.state.status === "connecting") {
        clearTimeout(timer);
        console.info(`live: first picture after ${Math.round(performance.now() - started)} ms`);
        this.update({ status: "connected", detail: "" });
        if (target.control) this.setControl(true);
      }
      this.update({ width: video.videoWidth, height: video.videoHeight });
    };
    video.onloadeddata = onFrame;
    video.onresize = onFrame;
    try {
      pc.addTransceiver("video", { direction: "recvonly" });
      const control = pc.createDataChannel("control");
      this.input = pc.createDataChannel("input");
      this.pointer = pc.createDataChannel("pointer", { ordered: false, maxRetransmits: 0 });
      this.detachInput = this.attachInput(video);
      control.onmessage = (e) => {
        if (attempt !== this.attempt) return;
        const m = parseControl(e.data);
        if (m?.t === "stats") this.update({ kbps: m.kbps, fps: m.fps });
        else if (m?.t === "ended") fail(m.message);
        else if (m?.t === "error") console.warn(`live: ${m.about}: ${m.message}`);
      };
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc, 2000);
      if (attempt !== this.attempt) return;
      const answer = await openSession(target.base, {
        offer: pc.localDescription?.sdp ?? "",
        maxWidth: target.maxWidth,
        maxHeight: target.maxHeight,
        quality: target.quality ?? "auto",
      });
      if (attempt !== this.attempt) {
        closeSession(target.base, answer.session);
        return;
      }
      this.session = { base: target.base, id: answer.session };
      console.info(`live: answered in ${Math.round(performance.now() - started)} ms, ${answer.width}×${answer.height}`);
      if (!answer.answer) throw new Error("mobd answered without WebRTC; update mobd on the office Mac");
      await pc.setRemoteDescription({ type: "answer", sdp: answer.answer });
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  }

  private send(channel: RTCDataChannel | null, messages: InputMessage[]) {
    if (channel?.readyState !== "open") return;
    for (const m of messages) channel.send(JSON.stringify(m));
  }

  private release() {
    this.send(this.input, this.held.releaseAll());
  }

  // Events on the video become input while control is on; otherwise they are left alone, so
  // double-click still toggles full screen and keys reach the app.
  private attachInput(video: HTMLVideoElement): () => void {
    const at = (e: MouseEvent) => normalizePoint(e.clientX, e.clientY, video.getBoundingClientRect(), video.videoWidth, video.videoHeight);
    let pending: { x: number; y: number } | null = null;
    let frame = 0;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      video.addEventListener(type, fn, opts);
      return () => video.removeEventListener(type, fn, opts);
    };
    const off = [
      on("pointerdown", (e) => {
        const button = buttonName(e.button);
        const p = at(e);
        if (!this.state.control || !button || !p?.inside) return;
        e.preventDefault();
        video.focus({ preventScroll: true });
        try {
          video.setPointerCapture(e.pointerId); // drags keep reporting outside the video
        } catch {
          // no active pointer (synthetic events): the click still goes through
        }
        this.send(this.input, this.held.buttonDown(button, p.x, p.y));
      }),
      on("pointerup", (e) => {
        const button = buttonName(e.button);
        const p = at(e);
        if (!button || !p || !this.held.holding(button)) return;
        e.preventDefault();
        this.send(this.input, this.held.buttonUp(button, p.x, p.y));
      }),
      on("pointermove", (e) => {
        const p = at(e);
        if (!this.state.control || !p || (!p.inside && !this.held.dragging)) return;
        this.held.point(p.x, p.y);
        // One move per animation frame; mobd only needs the latest position.
        pending = { x: p.x, y: p.y };
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            if (pending) this.send(this.pointer, [{ t: "move", ...pending }]);
            pending = null;
          });
        }
      }),
      on("wheel", (e) => {
        const p = at(e);
        if (!this.state.control || !p?.inside) return;
        e.preventDefault();
        this.send(this.input, [{ t: "scroll", x: p.x, y: p.y, ...wheelPixels(e, video.clientHeight) }]);
      }, { passive: false }),
      on("contextmenu", (e) => this.state.control && e.preventDefault()),
      on("keydown", (e) => {
        if (!this.state.control) return;
        // Keys belong to the office Mac, including Esc and the app's own shortcuts.
        e.preventDefault();
        e.stopPropagation();
        if (e.isComposing || e.key === "Process") return;
        if (!e.code || e.code === "Unidentified") {
          if ([...e.key].length === 1) this.send(this.input, [{ t: "text", text: e.key }]);
          return;
        }
        this.send(this.input, this.held.keyDown(e.code));
      }),
      on("keyup", (e) => {
        if (!this.state.control) return;
        e.preventDefault();
        e.stopPropagation();
        this.send(this.input, this.held.keyUp(e.code));
      }),
      // Composed text (accents, input methods) arrives whole; the keys that built it were not sent.
      on("compositionend", (e) => this.state.control && e.data && this.send(this.input, [{ t: "text", text: e.data }])),
      on("blur", () => this.release()),
    ];
    const onWindowBlur = () => this.release();
    window.addEventListener("blur", onWindowBlur);
    return () => {
      for (const f of off) f();
      window.removeEventListener("blur", onWindowBlur);
      cancelAnimationFrame(frame);
    };
  }

  private teardown() {
    this.detachInput?.();
    this.detachInput = null;
    this.release();
    this.input = null;
    this.pointer = null;
    const pc = this.pc;
    const session = this.session;
    this.pc = null;
    this.session = null;
    if (session) closeSession(session.base, session.id);
    pc?.close();
    if (this.video) {
      this.video.onloadeddata = null;
      this.video.onresize = null;
      this.video.srcObject = null;
    }
  }

  disconnect(): void {
    this.attempt++;
    this.teardown();
    if (this.state.status !== "idle") this.update({ ...IDLE, detail: "Disconnected" });
  }

  /** Switches between watching and controlling; only possible while connected. */
  setControl(on: boolean): void {
    const control = on && this.state.status === "connected" && !!this.input;
    if (!control) this.release();
    if (control) this.video?.focus({ preventScroll: true });
    else if (this.video && document.activeElement === this.video) this.video.blur();
    if (control !== this.state.control) this.update({ control });
  }
}

export const stream = new StreamController();

export function useStream(): StreamState {
  return useSyncExternalStore(stream.subscribe, () => stream.state);
}
