import test from "node:test";
import assert from "node:assert/strict";
import { avcCodec, nalUnits, parseVideoMessage, streamWsUrl } from "./wsVideo.ts";

const sps = [0x67, 0x42, 0xe0, 0x1f, 0xab];
const pps = [0x68, 0xce, 0x3c, 0x80];
const keyframe = new Uint8Array([0, 0, 0, 1, 0x09, 0xf0, 0, 0, 0, 1, ...sps, 0, 0, 0, 1, ...pps, 0, 0, 1, 0x65, 0x88, 0x84]);

test("video messages carry the capture time, key flag and access unit", () => {
  const buf = new ArrayBuffer(10 + keyframe.length);
  const view = new DataView(buf);
  view.setUint8(0, 1);
  view.setBigUint64(1, 1792294424594123n);
  view.setUint8(9, 1);
  new Uint8Array(buf, 10).set(keyframe);
  const m = parseVideoMessage(buf);
  assert.equal(m.pts, 1792294424594123);
  assert.equal(m.key, true);
  assert.deepEqual([...m.data], [...keyframe]);
  view.setUint8(0, 2); // a cursor image, not video
  assert.equal(parseVideoMessage(buf), null);
  assert.equal(parseVideoMessage(new ArrayBuffer(10)), null);
});

test("Annex B splits on 3- and 4-byte start codes; the codec comes from the SPS", () => {
  const units = nalUnits(keyframe).map((n) => [...n]);
  assert.deepEqual(units, [[0x09, 0xf0], sps, pps, [0x65, 0x88, 0x84]]);
  assert.equal(avcCodec(keyframe), "avc1.42e01f");
  assert.equal(avcCodec(new Uint8Array([0, 0, 0, 1, 0x41, 0x9a])), null); // a delta frame has no SPS
});

test("the WebSocket URL follows the base's scheme and carries session and ticket", () => {
  assert.equal(streamWsUrl("http://192.168.50.86:8080/", "S1", "T/+"), "ws://192.168.50.86:8080/stream/ws?session=S1&ticket=T%2F%2B");
  assert.equal(streamWsUrl("https://office.ts.net", "S", "T"), "wss://office.ts.net/stream/ws?session=S&ticket=T");
});
