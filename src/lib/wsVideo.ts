// The live desktop over mobd's WebSocket fallback (mobd docs/desktop-streaming.md, "WebSocket
// fallback"), for networks where WebRTC's UDP cannot pass (Tailscale Funnel, HTTPS gateways).
// Binary messages from mobd are video:
//
//	byte 0     1 (H.264 access unit, Annex B)
//	bytes 1-8  capture time in microseconds, big endian
//	byte 9     flags: bit 0 keyframe
//	bytes 10-  access unit
//
// Text messages use the data-channel JSON schema both ways; every video message is acknowledged
// with {"t":"ack","pts":N}, which is how mobd measures the link. Decoding uses WebCodecs into a
// canvas; where the webview has none (WebKitGTK on Linux) the frames are remuxed to fragmented MP4
// and played by a <video> through Media Source Extensions.

import { fragment, initSegment, parameterSets, TIMESCALE } from "./fmp4.ts";

export interface VideoMessage {
  /** Capture time, microseconds. */
  pts: number;
  key: boolean;
  data: Uint8Array;
}

/** A binary message from mobd; null for anything that is not a video access unit. */
export function parseVideoMessage(buf: ArrayBuffer): VideoMessage | null {
  if (buf.byteLength < 11) return null;
  const view = new DataView(buf);
  if (view.getUint8(0) !== 1) return null;
  return { pts: Number(view.getBigUint64(1)), key: (view.getUint8(9) & 1) !== 0, data: new Uint8Array(buf, 10) };
}

/** The NAL units of an Annex B access unit, without start codes. */
export function nalUnits(data: Uint8Array): Uint8Array[] {
  const starts: { at: number; len: number }[] = [];
  for (let i = 0; i + 2 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0) {
      if (data[i + 2] === 1) starts.push({ at: i, len: 3 });
      else if (data[i + 2] === 0 && data[i + 3] === 1) starts.push({ at: i, len: 4 });
      else continue;
      i += starts[starts.length - 1].len - 1;
    }
  }
  return starts.map((s, n) => data.subarray(s.at + s.len, n + 1 < starts.length ? starts[n + 1].at : data.length));
}

/** The WebCodecs codec string ("avc1.42e01f") from a keyframe's SPS; null without one. */
export function avcCodec(data: Uint8Array): string | null {
  const sps = nalUnits(data).find((n) => (n[0] & 0x1f) === 7 && n.length >= 4);
  if (!sps) return null;
  return "avc1." + [sps[1], sps[2], sps[3]].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** GET /stream/ws for a mobd base URL; the ticket stands in for the header webviews cannot set. */
export function streamWsUrl(base: string, session: string, ticket: string): string {
  const url = new URL(`${base.replace(/\/+$/, "")}/stream/ws`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("session", session);
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

export function webCodecsAvailable(): boolean {
  return typeof VideoDecoder !== "undefined" && typeof EncodedVideoChunk !== "undefined";
}

/** How this webview can show the WebSocket's H.264, or null if it cannot. */
export type WsDecoder = "webcodecs" | "mse";

export function wsDecoder(): WsDecoder | null {
  if (webCodecsAvailable()) return "webcodecs";
  if (typeof MediaSource !== "undefined" && MediaSource.isTypeSupported('video/mp4; codecs="avc1.42e01f"')) return "mse";
  return null;
}

interface PlayerEvents {
  /** A control message (stats, ended, error, cursor). */
  control: (data: string) => void;
  /** A frame was drawn at this size. */
  frame: (width: number, height: number) => void;
  /** The socket closed; `opened` tells a refused connection from a lost one. */
  close: (code: number, reason: string, opened: boolean) => void;
}

const KEY_REQUEST_EVERY = 1000;
/** With MSE, ask for a keyframe after this long without one, so played frames can be dropped. */
const KEY_EVERY_S = 30;
const MAX_DECODE_QUEUE = 8;

/** One WebSocket session, drawn into the canvas (WebCodecs) or played by the video (MSE). */
export class WsPlayer {
  private ws: WebSocket;
  private canvas: HTMLCanvasElement;
  private on: PlayerEvents;
  private mse: MsePlayer | null = null;
  private videoEl: HTMLVideoElement;
  private decoder: VideoDecoder | null = null;
  private codec = "";
  private needKey = true;
  private lastKeyRequest = 0;
  private opened = false;
  private closed = false;
  /** Totals for the readout. */
  bytes = 0;
  frames = 0;

  constructor(url: string, surfaces: { canvas: HTMLCanvasElement; video: HTMLVideoElement }, on: PlayerEvents, decoder: WsDecoder) {
    this.canvas = surfaces.canvas;
    this.videoEl = surfaces.video;
    this.on = on;
    if (decoder === "mse") this.startMse();
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => (this.opened = true);
    this.ws.onmessage = (e) => {
      if (typeof e.data === "string") this.on.control(e.data);
      else this.video(e.data as ArrayBuffer);
    };
    this.ws.onclose = (e) => {
      if (this.closed) return;
      this.closed = true;
      this.stopDecoder();
      this.mse?.close();
      this.on.close(e.code, e.reason, this.opened);
    };
  }

  send(message: object): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  close(): void {
    this.closed = true;
    this.stopDecoder();
    this.mse?.close();
    this.ws.close(1000);
  }

  private video(buf: ArrayBuffer) {
    const m = parseVideoMessage(buf);
    if (!m) return;
    this.send({ t: "ack", pts: m.pts }); // on receipt: mobd times the link from these
    this.bytes += buf.byteLength;
    if (this.needKey && !m.key) {
      this.askKey();
      return;
    }
    if (this.mse) {
      if (!m.key && this.mse.backlog > MAX_DECODE_QUEUE) {
        this.needKey = true;
        this.askKey();
        return;
      }
      if (this.mse.push(m)) this.needKey = false;
      else this.askKey();
      if (this.mse.keyDue) this.askKey();
      return;
    }
    // A decoder falling behind would show an ever older picture: skip to the next keyframe.
    if (!m.key && this.decoder && this.decoder.decodeQueueSize > MAX_DECODE_QUEUE) {
      this.needKey = true;
      this.askKey();
      return;
    }
    if (m.key) {
      const codec = avcCodec(m.data);
      if (codec && (codec !== this.codec || !this.decoder)) this.startDecoder(codec);
      if (!this.decoder) return;
      this.needKey = false;
    }
    try {
      this.decoder?.decode(new EncodedVideoChunk({ type: m.key ? "key" : "delta", timestamp: m.pts, data: m.data }));
    } catch {
      this.restart();
    }
  }

  private startDecoder(codec: string) {
    this.stopDecoder();
    this.codec = codec;
    const ctx = this.canvas.getContext("2d");
    this.decoder = new VideoDecoder({
      output: (frame) => {
        if (this.closed || !ctx) {
          frame.close();
          return;
        }
        const w = frame.displayWidth;
        const h = frame.displayHeight;
        if (this.canvas.width !== w || this.canvas.height !== h) {
          this.canvas.width = w;
          this.canvas.height = h;
        }
        ctx.drawImage(frame, 0, 0, w, h);
        frame.close();
        this.frames++;
        this.on.frame(w, h);
      },
      error: () => this.restart(),
    });
    // No description: the access units stay Annex B, with SPS and PPS on every keyframe.
    this.decoder.configure({ codec, optimizeForLatency: true });
  }

  private startMse() {
    this.mse = new MsePlayer(this.videoEl, (w, h) => {
      this.frames++;
      this.on.frame(w, h);
    }, () => this.restart());
  }

  private stopDecoder() {
    const d = this.decoder;
    this.decoder = null;
    if (d && d.state !== "closed") d.close();
  }

  /** After a decode error: a fresh decoder from the next keyframe. */
  private restart() {
    if (this.mse && !this.closed) {
      this.mse.close();
      this.startMse();
    }
    this.stopDecoder();
    this.codec = "";
    this.needKey = true;
    this.askKey();
  }

  private askKey() {
    const now = performance.now();
    if (now - this.lastKeyRequest < KEY_REQUEST_EVERY) return;
    this.lastKeyRequest = now;
    this.send({ t: "keyframe" });
  }
}

/**
 * Plays access units through Media Source Extensions: one fragment per frame on a contiguous
 * timeline (an idle desktop sends nothing, and gaps would stall playback), kept at the live edge.
 */
export class MsePlayer {
  private video: HTMLVideoElement;
  private onFrame: (width: number, height: number) => void;
  private onError: () => void;
  private source = new MediaSource();
  private url: string;
  private buffer: SourceBuffer | null = null;
  private queue: (Uint8Array<ArrayBuffer> | [number, number])[] = [];
  private params = "";
  private codec = "";
  private size = { width: 0, height: 0 };
  private sequence = 0;
  private time = 0;
  private lastPts = -1;
  /** Timeline positions (seconds) of appended keyframes: the only safe places to trim. */
  private keys: number[] = [];
  private shown = false;
  private closed = false;
  private onLoaded = () => {
    this.shown = true;
    this.onFrame(this.size.width, this.size.height);
  };

  constructor(video: HTMLVideoElement, onFrame: (width: number, height: number) => void, onError: () => void) {
    this.video = video;
    this.onFrame = onFrame;
    this.onError = onError;
    this.url = URL.createObjectURL(this.source);
    video.srcObject = null;
    video.src = this.url;
    video.addEventListener("loadeddata", this.onLoaded);
  }

  /** A keyframe would let old frames go: without one the buffer only grows (mobd sends them on request). */
  get keyDue(): boolean {
    const last = this.keys[this.keys.length - 1];
    return last !== undefined && this.time / TIMESCALE - last > KEY_EVERY_S;
  }

  /** Fragments waiting to be appended. */
  get backlog(): number {
    return this.queue.length;
  }

  /** Queues a frame; false while waiting for a keyframe with parameter sets. */
  push(m: VideoMessage): boolean {
    if (this.closed) return false;
    if (m.key) {
      const ps = parameterSets(m.data);
      if (!ps) return false;
      const key = [...ps.sps, 0, ...ps.pps].join(",");
      if (key !== this.params) {
        // A new size (resize, quality ladder) or the first keyframe: a new init segment.
        let init;
        try {
          init = initSegment(ps.sps, ps.pps);
        } catch {
          return false;
        }
        this.params = key;
        this.size = { width: init.info.width, height: init.info.height };
        if (!this.ready(init.codec)) return false;
        this.queue.push(init.data);
      }
    } else if (!this.params) return false;
    const duration = this.lastPts < 0 ? TIMESCALE / 30 : Math.min(Math.max(m.pts - this.lastPts, 1000), TIMESCALE / 10);
    this.lastPts = m.pts;
    if (m.key) this.keys.push(this.time / TIMESCALE);
    this.queue.push(fragment(++this.sequence, this.time, duration, m.key, m.data));
    this.time += duration;
    this.pump();
    if (this.shown) this.onFrame(this.size.width, this.size.height);
    return true;
  }

  /** The SourceBuffer for this codec; null until the MediaSource has opened. */
  private ready(codec: string): boolean {
    const type = `video/mp4; codecs="${codec}"`;
    if (this.buffer) {
      if (codec !== this.codec) {
        if (!this.buffer.changeType) return false;
        this.buffer.changeType(type);
        this.codec = codec;
      }
      return true;
    }
    if (this.source.readyState !== "open") {
      this.params = ""; // retried with the next keyframe
      return false;
    }
    try {
      this.buffer = this.source.addSourceBuffer(type);
    } catch {
      this.params = "";
      return false;
    }
    this.codec = codec;
    this.buffer.mode = "segments";
    this.buffer.addEventListener("updateend", () => this.pump());
    this.buffer.addEventListener("error", () => this.onError());
    return true;
  }

  private pump() {
    const b = this.buffer;
    if (!b || b.updating || this.closed) return;
    const next = this.queue.shift();
    try {
      if (next instanceof Uint8Array) b.appendBuffer(next);
      else if (next) b.remove(next[0], next[1]);
      else this.followLive(b);
    } catch {
      this.onError();
    }
  }

  /** Plays the newest frame: jumps forward when behind and drops what has been shown. */
  private followLive(b: SourceBuffer) {
    const r = b.buffered;
    if (!r.length) return;
    const start = r.start(0);
    const end = r.end(r.length - 1);
    const v = this.video;
    if (end - v.currentTime > 0.3 || v.currentTime < start) v.currentTime = Math.max(start, end - 0.05);
    if (v.paused) void v.play().catch(() => {});
    // remove() also drops the frames that depend on removed ones, so trim only up to a keyframe.
    const key = this.keys.filter((k) => k <= v.currentTime - 1).pop();
    if (key !== undefined && key - start > 10) {
      this.keys = this.keys.filter((k) => k >= key);
      this.queue.push([start, key]);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.queue = [];
    this.video.removeEventListener("loadeddata", this.onLoaded);
    this.video.removeAttribute("src");
    this.video.load();
    URL.revokeObjectURL(this.url);
  }
}
