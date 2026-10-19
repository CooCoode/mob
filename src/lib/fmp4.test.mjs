import test from "node:test";
import assert from "node:assert/strict";
import { fragment, initSegment, lengthPrefixed, parameterSets, parseSps, TIMESCALE } from "./fmp4.ts";

// Parameter sets from x264 (1278×718 constrained baseline, 640×360 high); the files muxed from
// them were checked with ffprobe and GStreamer's qtdemux + avdec_h264 (all frames decoded).
const hex = (s) => Uint8Array.from(s.match(/../g).map((b) => parseInt(b, 16)));
const BASE_SPS = hex("6742c01fd9005005beab0110000003001000000303c0f1832480");
const BASE_PPS = hex("68cb83cb20");
const HIGH_SPS = hex("6764001eacb201405ff2e022000003000200000300781e2c5c90");

const boxes = (data) => {
  const out = [];
  for (let at = 0; at < data.length;) {
    const size = new DataView(data.buffer, data.byteOffset + at).getUint32(0);
    out.push(String.fromCharCode(...data.subarray(at + 4, at + 8)));
    assert.ok(size >= 8);
    at += size;
  }
  return out;
};

test("SPS: profile, level and the size after cropping", () => {
  assert.deepEqual(parseSps(BASE_SPS), { profile: 0x42, compat: 0xc0, level: 0x1f, width: 1278, height: 718 });
  assert.deepEqual(parseSps(HIGH_SPS), { profile: 0x64, compat: 0x00, level: 0x1e, width: 640, height: 360 });
});

test("init segment is ftyp + moov with the MSE codec string", () => {
  const init = initSegment(BASE_SPS, BASE_PPS);
  assert.equal(init.codec, "avc1.42c01f");
  assert.deepEqual(boxes(init.data), ["ftyp", "moov"]);
});

test("a frame becomes moof + mdat with length-prefixed slices and no parameter sets", () => {
  const sc = [0, 0, 0, 1];
  const au = Uint8Array.from([...sc, 9, 0xf0, ...sc, ...BASE_SPS, ...sc, ...BASE_PPS, 0, 0, 1, 0x65, 1, 2, 3]);
  assert.deepEqual(parameterSets(au), { sps: BASE_SPS, pps: BASE_PPS });
  assert.deepEqual([...lengthPrefixed(au)], [0, 0, 0, 4, 0x65, 1, 2, 3]);
  const f = fragment(7, 2 * TIMESCALE, TIMESCALE / 30, true, au);
  assert.deepEqual(boxes(f), ["moof", "mdat"]);
  // trun's data offset points just past mdat's header.
  const moofSize = new DataView(f.buffer).getUint32(0);
  assert.deepEqual([...f.subarray(moofSize + 8)], [0, 0, 0, 4, 0x65, 1, 2, 3]);
});
