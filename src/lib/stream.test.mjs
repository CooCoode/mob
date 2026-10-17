import test from "node:test";
import assert from "node:assert/strict";
import { configureAuth } from "./auth.ts";
import { openSession, parseControl, UPDATE_MOBD } from "./stream.ts";

function mockFetch(t, status, body) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}

test("openSession posts the offer and view with the credential", async (t) => {
  configureAuth({ token: () => "T" });
  t.after(() => configureAuth({ token: () => undefined }));
  const calls = mockFetch(t, 201, { session: "S", answer: "v=0", width: 1280, height: 720 });
  const answer = await openSession("http://office", { offer: "o", maxWidth: 704, maxHeight: 448, quality: "auto" });
  assert.equal(answer.session, "S");
  assert.equal(calls[0].url, "http://office/stream");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.get("Authorization"), "Bearer T");
  assert.deepEqual(JSON.parse(calls[0].init.body), { offer: "o", maxWidth: 704, maxHeight: 448, quality: "auto" });
});

test("openSession explains old mobd builds and mobd's own errors", async (t) => {
  mockFetch(t, 404, {});
  await assert.rejects(openSession("http://office", { maxWidth: 1, maxHeight: 1, quality: "auto" }), { message: UPDATE_MOBD });
  t.mock.restoreAll();
  mockFetch(t, 503, { error: "the office computer is locked" });
  await assert.rejects(openSession("http://office", { maxWidth: 1, maxHeight: 1, quality: "auto" }), /locked/);
  t.mock.restoreAll();
  mockFetch(t, 201, { answer: "v=0" });
  await assert.rejects(openSession("http://office", { maxWidth: 1, maxHeight: 1, quality: "auto" }), /Invalid/);
});

test("parseControl reads mobd's control messages and ignores the rest", () => {
  assert.deepEqual(parseControl('{"t":"stats","kbps":1200,"width":1280,"height":720,"fps":30,"loss":0.01,"rttMs":12}'),
    { t: "stats", kbps: 1200, width: 1280, height: 720, fps: 30, loss: 0.01, rttMs: 12 });
  assert.deepEqual(parseControl('{"t":"ended","message":"display asleep"}'), { t: "ended", message: "display asleep" });
  assert.match(parseControl('{"t":"ended"}').message, /ended/);
  assert.deepEqual(parseControl('{"t":"cursor","x":0.5,"y":0.25}'), { t: "cursor", x: 0.5, y: 0.25 });
  assert.equal(parseControl("not json"), null);
  assert.equal(parseControl('{"t":"something-new"}'), null);
  assert.equal(parseControl(new ArrayBuffer(4)), null);
  assert.equal(parseControl("null"), null);
});
