// Fragmented MP4 for Media Source Extensions: the WebSocket's H.264 access units (Annex B) become
// an init segment and one fragment per frame. Used where the webview has no WebCodecs (WebKitGTK on
// Linux), so the video element (GStreamer there) decodes. Free of the DOM so node --test can run it.

import { nalUnits } from "./wsVideo.ts";

/** Microseconds, like mobd's capture times. */
export const TIMESCALE = 1_000_000;

export interface Sps {
  profile: number;
  compat: number;
  level: number;
  width: number;
  height: number;
}

/** Reads Exp-Golomb coded fields from an SPS with emulation prevention bytes removed. */
class Bits {
  private bit = 0;
  private data: Uint8Array;
  constructor(data: Uint8Array) {
    this.data = data;
  }
  u(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.data[this.bit >> 3];
      if (byte === undefined) throw Error("SPS too short");
      v = v * 2 + ((byte >> (7 - (this.bit & 7))) & 1);
      this.bit++;
    }
    return v;
  }
  ue(): number {
    let zeros = 0;
    while (this.u(1) === 0) if (++zeros > 31) throw Error("bad Exp-Golomb code");
    return 2 ** zeros - 1 + this.u(zeros);
  }
  se(): number {
    const v = this.ue();
    return v & 1 ? (v + 1) / 2 : -v / 2;
  }
}

function unescape(nal: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < nal.length; i++) {
    if (i >= 2 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue;
    out.push(nal[i]);
  }
  return Uint8Array.from(out);
}

const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

/** Profile, level and the cropped picture size from an SPS NAL unit (header byte included). */
export function parseSps(nal: Uint8Array): Sps {
  const b = new Bits(unescape(nal.subarray(1)));
  const profile = b.u(8);
  const compat = b.u(8);
  const level = b.u(8);
  b.ue(); // seq_parameter_set_id
  let chroma = 1;
  if (HIGH_PROFILES.has(profile)) {
    chroma = b.ue();
    if (chroma === 3) b.u(1);
    b.ue(); // bit depths
    b.ue();
    b.u(1);
    if (b.u(1)) {
      for (let i = 0; i < (chroma === 3 ? 12 : 8); i++) {
        if (!b.u(1)) continue;
        let last = 8;
        let next = 8;
        for (let j = 0; j < (i < 6 ? 16 : 64) && next !== 0; j++) {
          next = (last + b.se() + 256) % 256;
          if (next !== 0) last = next;
        }
      }
    }
  }
  b.ue(); // log2_max_frame_num_minus4
  const poc = b.ue();
  if (poc === 0) b.ue();
  else if (poc === 1) {
    b.u(1);
    b.se();
    b.se();
    const n = b.ue();
    for (let i = 0; i < n; i++) b.se();
  }
  b.ue(); // max_num_ref_frames
  b.u(1);
  const mbWidth = b.ue() + 1;
  const mapHeight = b.ue() + 1;
  const frameMbsOnly = b.u(1);
  if (!frameMbsOnly) b.u(1);
  b.u(1);
  let [left, right, top, bottom] = [0, 0, 0, 0];
  if (b.u(1)) [left, right, top, bottom] = [b.ue(), b.ue(), b.ue(), b.ue()];
  const subW = chroma === 1 || chroma === 2 ? 2 : 1;
  const subH = chroma === 1 ? 2 : 1;
  const cropX = chroma === 0 ? 1 : subW;
  const cropY = (chroma === 0 ? 1 : subH) * (2 - frameMbsOnly);
  return {
    profile, compat, level,
    width: mbWidth * 16 - cropX * (left + right),
    height: (2 - frameMbsOnly) * mapHeight * 16 - cropY * (top + bottom),
  };
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u16 = (v: number) => [(v >>> 8) & 255, v & 255];
const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const u64 = (v: number) => [...u32(Math.floor(v / 2 ** 32)), ...u32(v >>> 0)];
type Bytes = ArrayLike<number>;

function box(type: string, ...parts: Bytes[]): Uint8Array<ArrayBuffer> {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  out.set([...u32(size), ...ascii(type)]);
  let at = 8;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
const full = (type: string, version: number, flags: number, ...parts: Bytes[]) => box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);
const MATRIX = [...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];
const zeros = (n: number) => new Array<number>(n).fill(0);

/** The parameter sets of a keyframe, or null without both. */
export function parameterSets(data: Uint8Array): { sps: Uint8Array; pps: Uint8Array } | null {
  const nals = nalUnits(data);
  const sps = nals.find((n) => (n[0] & 0x1f) === 7);
  const pps = nals.find((n) => (n[0] & 0x1f) === 8);
  return sps && pps ? { sps, pps } : null;
}

/** ftyp + moov for one H.264 track; the MSE codec string is `avc1.` + profile, compat, level. */
export function initSegment(sps: Uint8Array, pps: Uint8Array): { data: Uint8Array<ArrayBuffer>; info: Sps; codec: string } {
  const info = parseSps(sps);
  const avcC = box("avcC", [1, info.profile, info.compat, info.level, 0xff, 0xe1, ...u16(sps.length)], sps, [1, ...u16(pps.length)], pps);
  const avc1 = box("avc1", zeros(6), u16(1), zeros(16), u16(info.width), u16(info.height), u32(0x480000), u32(0x480000),
    u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff), avcC);
  const stbl = box("stbl", full("stsd", 0, 0, u32(1), avc1), full("stts", 0, 0, u32(0)), full("stsc", 0, 0, u32(0)),
    full("stsz", 0, 0, u32(0), u32(0)), full("stco", 0, 0, u32(0)));
  const minf = box("minf", full("vmhd", 0, 1, zeros(8)), box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1))), stbl);
  const mdia = box("mdia",
    full("mdhd", 0, 0, u32(0), u32(0), u32(TIMESCALE), u32(0), u16(0x55c4), u16(0)),
    full("hdlr", 0, 0, u32(0), ascii("vide"), zeros(12), [...ascii("mob"), 0]),
    minf);
  const tkhd = full("tkhd", 0, 3, u32(0), u32(0), u32(1), u32(0), u32(0), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX,
    u32(info.width * 0x10000), u32(info.height * 0x10000));
  const mvhd = full("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(0), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2));
  const mvex = box("mvex", full("trex", 0, 0, u32(1), u32(1), u32(0), u32(0), u32(0)));
  const ftyp = box("ftyp", ascii("isom"), u32(0x200), ascii("isom"), ascii("iso6"), ascii("avc1"), ascii("mp41"));
  const moov = box("moov", mvhd, box("trak", tkhd, mdia), mvex);
  const data = new Uint8Array(ftyp.length + moov.length);
  data.set(ftyp);
  data.set(moov, ftyp.length);
  const hex = (v: number) => v.toString(16).padStart(2, "0");
  return { data, info, codec: `avc1.${hex(info.profile)}${hex(info.compat)}${hex(info.level)}` };
}

/** Annex B to 4-byte length prefixes, dropping parameter sets (they are in the init segment) and AUDs. */
export function lengthPrefixed(data: Uint8Array): Uint8Array {
  const nals = nalUnits(data).filter((n) => n.length && ![7, 8, 9].includes(n[0] & 0x1f));
  const out = new Uint8Array(nals.reduce((n, nal) => n + 4 + nal.length, 0));
  let at = 0;
  for (const nal of nals) {
    out.set(u32(nal.length), at);
    out.set(nal, at + 4);
    at += 4 + nal.length;
  }
  return out;
}

/** moof + mdat holding one frame decoded at `time` for `duration` (both in TIMESCALE units). */
export function fragment(sequence: number, time: number, duration: number, key: boolean, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const sample = lengthPrefixed(data);
  const flags = key ? 0x02000000 : 0x01010000; // depends on nothing / on others and not a sync sample
  const moofFor = (offset: number) => box("moof",
    full("mfhd", 0, 0, u32(sequence)),
    box("traf",
      full("tfhd", 0, 0x020000, u32(1)), // default-base-is-moof
      full("tfdt", 1, 0, u64(time)),
      full("trun", 0, 0x000701, u32(1), u32(offset), u32(duration), u32(sample.length), u32(flags))));
  const size = moofFor(0).length;
  const moof = moofFor(size + 8);
  const mdat = box("mdat", sample);
  const out = new Uint8Array(moof.length + mdat.length);
  out.set(moof);
  out.set(mdat, moof.length);
  return out;
}
