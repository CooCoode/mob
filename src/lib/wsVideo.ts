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
// with {"t":"ack","pts":N}, which is how mobd measures the link. Decoding uses WebCodecs.

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

interface PlayerEvents {
  /** A control message (stats, ended, error, cursor). */
  control: (data: string) => void;
  /** A frame was drawn at this size. */
  frame: (width: number, height: number) => void;
  /** The socket closed; `opened` tells a refused connection from a lost one. */
  close: (code: number, reason: string, opened: boolean) => void;
}

const KEY_REQUEST_EVERY = 1000;
const MAX_DECODE_QUEUE = 8;

/** One WebSocket session drawn into a canvas. */
export class WsPlayer {
  private ws: WebSocket;
  private canvas: HTMLCanvasElement;
  private on: PlayerEvents;
  private decoder: VideoDecoder | null = null;
  private codec = "";
  private needKey = true;
  private lastKeyRequest = 0;
  private opened = false;
  private closed = false;
  /** Totals for the readout. */
  bytes = 0;
  frames = 0;

  constructor(url: string, canvas: HTMLCanvasElement, on: PlayerEvents) {
    this.canvas = canvas;
    this.on = on;
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
      this.on.close(e.code, e.reason, this.opened);
    };
  }

  send(message: object): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  close(): void {
    this.closed = true;
    this.stopDecoder();
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

  private stopDecoder() {
    const d = this.decoder;
    this.decoder = null;
    if (d && d.state !== "closed") d.close();
  }

  /** After a decode error: a fresh decoder from the next keyframe. */
  private restart() {
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
