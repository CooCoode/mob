import { useSyncExternalStore } from "react";
import { supports } from "../api/client.ts";
import type { Health } from "../api/types.ts";
import { authFetch } from "./auth.ts";
import { buttonName, HeldInput, normalizePoint, wheelPixels, type InputMessage } from "./liveInput.ts";
import { streamWsUrl, webCodecsAvailable, WsPlayer } from "./wsVideo.ts";

// The live desktop over WebRTC (mobd docs/desktop-streaming.md): one non-trickle POST /stream with
// the offer, a receive-only H.264 track, the `control` data channel for stats and `ended`, and the
// `input` (reliable) and `pointer` (unreliable, latest wins) channels for control mode. Where UDP
// cannot pass, the same session continues over the WebSocket fallback (wsVideo.ts).

export const UPDATE_MOBD = "Update mobd on the office Mac to use the live desktop";

export type Quality = "auto" | "high" | "low";

/** mobd's profiles (internal/stream/stream.go), for the quality pickers. */
export const QUALITIES: { value: Quality; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Starts at 720p and follows the connection, up to 1080p at 30 fps and 6 Mbps" },
  { value: "high", label: "High", hint: "Starts sharp at 3 Mbps, then follows the connection, up to 1080p at 30 fps and 6 Mbps" },
  { value: "low", label: "Low", hint: "For slow or metered links: up to 720p at 15 fps and 1 Mbps" },
];

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

export type Network = "LAN" | "Tailscale" | "Internet" | "relay";

/** Where the peer's address lives: Tailscale (100.64.0.0/10, fd7a:115c:a1e0::/48), a private LAN, or beyond. */
export function networkOf(address: string, candidateType?: string): Network {
  if (candidateType === "relay") return "relay";
  const a = address.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = a.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (v4) {
    const [x, y] = [Number(v4[1]), Number(v4[2])];
    if (x === 100 && y >= 64 && y < 128) return "Tailscale";
    if (x === 10 || x === 127 || (x === 172 && y >= 16 && y < 32) || (x === 192 && y === 168) || (x === 169 && y === 254)) return "LAN";
    return "Internet";
  }
  if (a.startsWith("fd7a:115c:a1e0:")) return "Tailscale";
  if (/^(fe8|fe9|fea|feb|fc|fd)/.test(a) || a === "::1") return "LAN";
  return "Internet";
}

export interface StatsSample {
  at: number;
  bytes: number;
  frames: number;
}

export type Transport = "WebRTC" | "WebSocket";

export interface Readout {
  transport: Transport;
  /** Video received, kilobytes per second. */
  kBps: number;
  /** Frames decoded per second. */
  fps: number;
  network?: Network;
  rttMs?: number;
}

type Stat = { type: string; id: string; [k: string]: unknown };

/** Candidate addresses in an SDP, keyed "protocol:port": WebKit leaves addresses out of getStats(). */
export function candidateAddresses(sdp: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of sdp.matchAll(/^a=candidate:\S+ \d+ (\S+) \d+ (\S+) (\d+) typ/gm)) out.set(`${m[1].toLowerCase()}:${m[3]}`, m[2]);
  return out;
}

/** One getStats() report against the previous sample: what the viewer actually receives. */
export function readStats(report: Iterable<Stat>, prev: StatsSample | null, now: number, remoteAddresses?: Map<string, string>): { sample: StatsSample; readout: Readout } {
  const stats = [...report];
  const byId = new Map(stats.map((s) => [s.id, s]));
  const video = stats.find((s) => s.type === "inbound-rtp" && (s.kind ?? s.mediaType) === "video");
  const sample = { at: now, bytes: Number(video?.bytesReceived ?? 0), frames: Number(video?.framesDecoded ?? 0) };
  const seconds = prev ? (now - prev.at) / 1000 : 0;
  const readout: Readout = {
    transport: "WebRTC",
    kBps: seconds > 0 ? Math.max(0, Math.round((sample.bytes - prev!.bytes) / 1000 / seconds)) : 0,
    fps: seconds > 0 ? Math.max(0, Math.round((sample.frames - prev!.frames) / seconds)) : 0,
  };
  // The pair in use: the transport names it; WebKit may only mark it nominated and succeeded.
  const transport = stats.find((s) => s.type === "transport" && s.selectedCandidatePairId);
  const pair = (transport && byId.get(String(transport.selectedCandidatePairId)))
    ?? stats.find((s) => s.type === "candidate-pair" && (s.selected || (s.nominated && s.state === "succeeded")));
  if (pair) {
    const remote = byId.get(String(pair.remoteCandidateId));
    const local = byId.get(String(pair.localCandidateId));
    const address = String(remote?.address ?? remote?.ip
      ?? remoteAddresses?.get(`${String(remote?.protocol ?? "udp").toLowerCase()}:${String(remote?.port)}`) ?? "");
    const relayed = remote?.candidateType === "relay" || local?.candidateType === "relay";
    if (address || relayed) readout.network = networkOf(address, relayed ? "relay" : undefined);
    if (typeof pair.currentRoundTripTime === "number") readout.rttMs = Math.round(pair.currentRoundTripTime * 1000);
  }
  return { sample, readout };
}

/** "1408×792 · 30 fps · 380 kB/s · WebRTC · LAN": what the viewer receives, once a second. */
export function readoutText(width: number, height: number, r: Readout | null): string {
  const parts = [`${width}×${height}`];
  if (r) parts.push(`${r.fps} fps`, `${r.kBps} kB/s`, r.transport);
  if (r?.network) parts.push(r.network);
  return parts.join(" · ");
}

/** Signal bars (1-3) like other remote desktop tools: loss reported by mobd, round-trip time measured here. */
export function signalBars(loss: number, rttMs?: number): 1 | 2 | 3 {
  const rtt = rttMs ?? 0;
  if (loss > 0.1 || rtt > 400) return 1;
  if (loss > 0.02 || rtt > 150) return 2;
  return 3;
}

export type LiveStatus = "idle" | "connecting" | "connected" | "error";

export interface StreamState {
  status: LiveStatus;
  detail: string;
  /** Encoded size of the picture. */
  width: number;
  height: number;
  /** What carries the picture once connected: a <video> for WebRTC, a <canvas> for the WebSocket. */
  transport: Transport | null;
  /** Mouse and keyboard on the picture reach the office Mac only while true. */
  control: boolean;
  /** mobd's encoder target. */
  kbps: number;
  /** Fraction of packets mobd's viewer reports lost, 0..1. */
  loss: number;
  /** Measured once a second while connected. */
  readout: Readout | null;
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

/** Where the picture goes; both stay mounted, the panel shows the one in use. */
export interface Surfaces {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
}

const CONNECT_TIMEOUT = 15_000;
/** WebRTC's head start: usually under a second on the LAN or a tailnet, but a slow or relayed
 * tailnet path can take a few seconds, and losing it to the WebSocket costs quality. */
export const WEBRTC_GRACE = 5_000;
const IDLE: StreamState = { status: "idle", detail: "", width: 0, height: 0, transport: null, control: false, kbps: 0, loss: 0, readout: null };

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

// Owns the single live session; the elements are moved, never remounted, between layouts.
// One POST /stream opens it with a WebRTC offer and also returns a WebSocket ticket. WebRTC gets
// WEBRTC_GRACE to connect; if it has not (or fails sooner), the peer connection is closed and the
// same session continues over the WebSocket. mobd keeps whichever transport connects first.
class StreamController {
  state: StreamState = IDLE;
  private listeners = new Set<() => void>();
  private attempt = 0;
  private pc: RTCPeerConnection | null = null;
  private ws: WsPlayer | null = null;
  private surfaces: Surfaces | null = null;
  /** The element taking input: the video, or the canvas after falling back. */
  private surface: HTMLElement | null = null;
  private session: { base: string; id: string } | null = null;
  private input: RTCDataChannel | null = null;
  private pointer: RTCDataChannel | null = null;
  private held = new HeldInput();
  private detachInput: (() => void) | null = null;
  private statsTimer: ReturnType<typeof setInterval> | undefined;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private update(patch: Partial<StreamState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  async connect(surfaces: Surfaces, target: StreamTarget): Promise<void> {
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
    const ms = () => Math.round(performance.now() - started);
    this.update({ ...IDLE, status: "connecting", detail: "Connecting…" });
    const { video, canvas } = surfaces;
    this.surfaces = surfaces;
    const pc = new RTCPeerConnection();
    this.pc = pc;
    let transport: Transport | null = null;
    let fallback: (() => void) | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    let lastRtt: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const fail = (detail: string) => {
      if (attempt !== this.attempt) return;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      this.attempt++; // later events from this connection are ignored
      this.teardown();
      this.update({ ...IDLE, status: "error", detail });
    };
    timer = setTimeout(() => fail("The live view did not start. Is the office Mac reachable from here?"), CONNECT_TIMEOUT);
    const picture = (width: number, height: number) => {
      if (attempt !== this.attempt) return;
      if (this.state.status === "connecting") {
        clearTimeout(timer);
        console.info(`live: first picture over ${transport} after ${ms()} ms`);
        this.update({ status: "connected", detail: "", transport });
        if (transport === "WebRTC") this.watchStats(pc, attempt);
        if (target.control) this.setControl(true);
      }
      if (width !== this.state.width || height !== this.state.height) this.update({ width, height });
    };
    const control = (data: unknown) => {
      if (attempt !== this.attempt) return;
      const m = parseControl(data);
      if (m?.t === "stats") {
        lastRtt = m.rttMs || undefined;
        this.update({ kbps: m.kbps, loss: m.loss ?? 0 });
      } else if (m?.t === "ended") fail(m.message);
      else if (m?.t === "error") console.warn(`live: ${m.about}: ${m.message}`);
    };

    pc.addEventListener("connectionstatechange", () => {
      if (attempt !== this.attempt || this.pc !== pc) return;
      switch (pc.connectionState) {
        case "connected":
          if (transport) return;
          transport = "WebRTC";
          clearTimeout(graceTimer);
          console.info(`live: WebRTC connected after ${ms()} ms`);
          break;
        case "failed":
          if (transport === "WebRTC") fail("The live view connection was lost");
          else if (fallback) fallback(); // no UDP path: don't wait out the head start
          else fail("The office Mac could not be reached over WebRTC");
          break;
        case "closed":
          if (transport === "WebRTC") {
            this.teardown();
            this.update({ ...IDLE, detail: "Disconnected" });
          }
      }
    });
    pc.addEventListener("track", (e) => {
      if (attempt !== this.attempt) return;
      video.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      void video.play().catch(() => {});
    });
    const onVideo = () => picture(video.videoWidth, video.videoHeight);
    video.onloadeddata = onVideo;
    video.onresize = onVideo;
    try {
      pc.addTransceiver("video", { direction: "recvonly" });
      const controlChannel = pc.createDataChannel("control");
      this.input = pc.createDataChannel("input");
      this.pointer = pc.createDataChannel("pointer", { ordered: false, maxRetransmits: 0 });
      this.surface = video;
      this.detachInput = this.attachInput(video, () => [video.videoWidth, video.videoHeight]);
      controlChannel.onmessage = (e) => control(e.data);
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
      console.info(`live: answered in ${ms()} ms, ${answer.width}×${answer.height}`);
      if (answer.wsTicket && webCodecsAvailable()) {
        const ticket = answer.wsTicket;
        fallback = () => {
          if (attempt !== this.attempt || transport) return;
          transport = "WebSocket";
          clearTimeout(graceTimer);
          console.info(`live: no WebRTC after ${ms()} ms, using the WebSocket`);
          // mobd keeps the session for the WebSocket once our peer connection is gone.
          this.dropWebRTC();
          this.surface = canvas;
          this.detachInput = this.attachInput(canvas, () => [canvas.width, canvas.height]);
          this.ws = new WsPlayer(streamWsUrl(target.base, answer.session, ticket), canvas, {
            control,
            frame: picture,
            close: (code, reason, opened) => {
              if (attempt !== this.attempt) return;
              if (!opened) fail("The office Mac could not be reached over WebRTC or the WebSocket fallback");
              else if (code === 1000) {
                this.teardown();
                this.update({ ...IDLE, detail: reason || "Disconnected" });
              } else fail("The live view connection was lost");
            },
          });
          this.watchWsStats(this.ws, attempt, () => lastRtt);
        };
        graceTimer = setTimeout(fallback, WEBRTC_GRACE);
      }
      if (!answer.answer) {
        if (fallback) fallback();
        else throw new Error("mobd answered without WebRTC; update mobd on the office Mac");
        return;
      }
      await pc.setRemoteDescription({ type: "answer", sdp: answer.answer });
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  }

  private send(kind: "input" | "pointer", messages: InputMessage[]) {
    if (this.ws) {
      for (const m of messages) this.ws.send(m);
      return;
    }
    const channel = kind === "input" ? this.input : this.pointer;
    if (channel?.readyState !== "open") return;
    for (const m of messages) channel.send(JSON.stringify(m));
  }

  private release() {
    this.send("input", this.held.releaseAll());
  }

  // Events on the picture become input while control is on; otherwise they are left alone, so
  // double-click still expands or collapses the view and keys reach the app.
  private attachInput(el: HTMLElement, size: () => [number, number]): () => void {
    const at = (e: MouseEvent) => normalizePoint(e.clientX, e.clientY, el.getBoundingClientRect(), ...size());
    let pending: { x: number; y: number } | null = null;
    let frame = 0;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn, opts);
      return () => el.removeEventListener(type, fn, opts);
    };
    const off = [
      on("pointerdown", (e) => {
        const button = buttonName(e.button);
        const p = at(e);
        if (!this.state.control || !button || !p?.inside) return;
        e.preventDefault();
        el.focus({ preventScroll: true });
        try {
          el.setPointerCapture(e.pointerId); // drags keep reporting outside the picture
        } catch {
          // no active pointer (synthetic events): the click still goes through
        }
        this.send("input", this.held.buttonDown(button, p.x, p.y));
      }),
      on("pointerup", (e) => {
        const button = buttonName(e.button);
        const p = at(e);
        if (!button || !p || !this.held.holding(button)) return;
        e.preventDefault();
        this.send("input", this.held.buttonUp(button, p.x, p.y));
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
            if (pending) this.send("pointer", [{ t: "move", ...pending }]);
            pending = null;
          });
        }
      }),
      on("wheel", (e) => {
        const p = at(e);
        if (!this.state.control || !p?.inside) return;
        e.preventDefault();
        this.send("input", [{ t: "scroll", x: p.x, y: p.y, ...wheelPixels(e, el.clientHeight) }]);
      }, { passive: false }),
      on("contextmenu", (e) => this.state.control && e.preventDefault()),
      on("keydown", (e) => {
        if (!this.state.control) return;
        // Keys belong to the office Mac, including Esc and the app's own shortcuts.
        e.preventDefault();
        e.stopPropagation();
        if (e.isComposing || e.key === "Process") return;
        if (!e.code || e.code === "Unidentified") {
          if ([...e.key].length === 1) this.send("input", [{ t: "text", text: e.key }]);
          return;
        }
        this.send("input", this.held.keyDown(e.code));
      }),
      on("keyup", (e) => {
        if (!this.state.control) return;
        e.preventDefault();
        e.stopPropagation();
        this.send("input", this.held.keyUp(e.code));
      }),
      // Composed text (accents, input methods) arrives whole; the keys that built it were not sent.
      on("compositionend", (e) => this.state.control && e.data && this.send("input", [{ t: "text", text: e.data }])),
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

  private watchStats(pc: RTCPeerConnection, attempt: number) {
    clearInterval(this.statsTimer);
    let prev: StatsSample | null = null;
    const addresses = candidateAddresses(pc.remoteDescription?.sdp ?? "");
    this.statsTimer = setInterval(() => {
      void pc.getStats().then((report) => {
        if (attempt !== this.attempt) return;
        const { sample, readout } = readStats(report.values() as Iterable<Stat>, prev, performance.now(), addresses);
        if (prev) this.update({ readout });
        prev = sample;
      }).catch(() => {});
    }, 1000);
  }

  /** The WebSocket's readout: bytes and frames counted by the player, round-trip time from mobd. */
  private watchWsStats(ws: WsPlayer, attempt: number, rtt: () => number | undefined) {
    clearInterval(this.statsTimer);
    let prev = { at: performance.now(), bytes: 0, frames: 0 };
    this.statsTimer = setInterval(() => {
      if (attempt !== this.attempt) return;
      const now = { at: performance.now(), bytes: ws.bytes, frames: ws.frames };
      const seconds = (now.at - prev.at) / 1000;
      this.update({ readout: {
        transport: "WebSocket",
        kBps: Math.round((now.bytes - prev.bytes) / 1000 / seconds),
        fps: Math.round((now.frames - prev.frames) / seconds),
        rttMs: rtt(),
      } });
      prev = now;
    }, 1000);
  }

  /** Closes the peer connection and its channels, leaving the session to the WebSocket. */
  private dropWebRTC() {
    this.detachInput?.();
    this.detachInput = null;
    this.input = null;
    this.pointer = null;
    const pc = this.pc;
    this.pc = null;
    pc?.close();
    const video = this.surfaces?.video;
    if (video) {
      video.onloadeddata = null;
      video.onresize = null;
      video.srcObject = null;
    }
  }

  private teardown() {
    clearInterval(this.statsTimer);
    this.release();
    this.detachInput?.();
    this.detachInput = null;
    this.input = null;
    this.pointer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    const session = this.session;
    this.session = null;
    if (session) closeSession(session.base, session.id);
    this.dropWebRTC();
    this.surface = null;
  }

  disconnect(): void {
    this.attempt++;
    this.teardown();
    if (this.state.status !== "idle") this.update({ ...IDLE, detail: "Disconnected" });
  }

  /** Switches between watching and controlling; only possible while connected. */
  setControl(on: boolean): void {
    const control = on && this.state.status === "connected" && (!!this.input || !!this.ws);
    if (!control) this.release();
    if (control) this.surface?.focus({ preventScroll: true });
    else if (this.surface && document.activeElement === this.surface) this.surface.blur();
    if (control !== this.state.control) this.update({ control });
  }
}

export const stream = new StreamController();

export function useStream(): StreamState {
  return useSyncExternalStore(stream.subscribe, () => stream.state);
}
