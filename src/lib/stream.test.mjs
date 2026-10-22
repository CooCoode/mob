import test from "node:test";
import assert from "node:assert/strict";
import { configureAuth } from "./auth.ts";
import { rateText, candidateAddresses, networkOf, openSession, parseControl, readoutText, readStats, signalBars, UPDATE_MOBD } from "./stream.ts";

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

test("networkOf tells Tailscale, LAN, internet and relayed paths apart", () => {
  const cases = {
    "100.64.31.36": "Tailscale", "100.127.0.1": "Tailscale", "100.128.0.1": "Internet",
    "192.168.50.86": "LAN", "10.0.0.2": "LAN", "172.20.1.1": "LAN", "172.32.0.1": "Internet",
    "fd7a:115c:a1e0::1": "Tailscale", "[fd7a:115c:a1e0:ab12::5]": "Tailscale", "fe80::1": "LAN", "fd00::1": "LAN",
    "203.0.113.9": "Internet", "2001:db8::1": "Internet",
  };
  for (const [address, want] of Object.entries(cases)) assert.equal(networkOf(address), want, address);
  assert.equal(networkOf("192.168.1.2", "relay"), "relay");
});

test("readStats measures received kB/s and fps from the selected pair", () => {
  const report = (bytes, frames) => [
    { type: "inbound-rtp", id: "v", kind: "video", bytesReceived: bytes, framesDecoded: frames },
    { type: "transport", id: "t", selectedCandidatePairId: "p" },
    { type: "candidate-pair", id: "old", remoteCandidateId: "r0", nominated: true, state: "failed" },
    { type: "candidate-pair", id: "p", localCandidateId: "l", remoteCandidateId: "r", currentRoundTripTime: 0.012 },
    { type: "local-candidate", id: "l", candidateType: "host" },
    { type: "remote-candidate", id: "r", address: "100.64.31.36", candidateType: "host" },
  ];
  const first = readStats(report(1000, 10), null, 0);
  assert.deepEqual(first.readout, { transport: "WebRTC", kBps: 0, fps: 0, network: "Tailscale", rttMs: 12 });
  const next = readStats(report(401000, 40), first.sample, 1000);
  assert.deepEqual(next.readout, { transport: "WebRTC", kBps: 400, fps: 30, network: "Tailscale", rttMs: 12 });
  // WebKit without a transport entry: the nominated, succeeded pair is the one in use.
  const webkit = readStats([
    { type: "candidate-pair", id: "p", remoteCandidateId: "r", localCandidateId: "l", nominated: true, state: "succeeded" },
    { type: "remote-candidate", id: "r", address: "192.168.50.86" },
    { type: "local-candidate", id: "l", candidateType: "relay" },
  ], null, 0);
  assert.equal(webkit.readout.network, "relay");
});

test("readoutText summarises the picture", () => {
  assert.equal(readoutText(1408, 792, null), "1408×792");
  assert.equal(readoutText(1408, 792, { transport: "WebRTC", kBps: 380, fps: 30, network: "LAN" }), "1408×792 · 30 fps · 380 kB/s · WebRTC · LAN");
  assert.equal(readoutText(1280, 720, { transport: "WebSocket", kBps: 25, fps: 12 }), "1280×720 · 12 fps · 25 kB/s · WebSocket");
  assert.equal(readoutText(1408, 792, { transport: "WebRTC", kBps: 0, fps: 0, network: "LAN" }), "1408×792 · Idle · WebRTC · LAN");
  assert.equal(rateText({ transport: "WebRTC", kBps: 0, fps: 0 }), "Idle");
  assert.equal(rateText({ transport: "WebRTC", kBps: 0, fps: 4 }), "Idle");
  assert.equal(rateText({ transport: "WebRTC", kBps: 380, fps: 30 }), "380 kB/s");
});

test("WebKit's address-less stats are matched to the answer's candidates by port", () => {
  const sdp = "v=0\r\na=candidate:1 1 udp 2130706431 192.168.50.86 55190 typ host\r\na=candidate:2 1 udp 2130706431 100.64.31.36 65336 typ host\r\n";
  const addresses = candidateAddresses(sdp);
  assert.equal(addresses.get("udp:65336"), "100.64.31.36");
  const { readout } = readStats([
    { type: "transport", id: "t", selectedCandidatePairId: "p" },
    { type: "candidate-pair", id: "p", remoteCandidateId: "r", localCandidateId: "l" },
    { type: "remote-candidate", id: "r", candidateType: "host", protocol: "udp", port: 65336 },
  ], null, 0, addresses);
  assert.equal(readout.network, "Tailscale");
});

test("signalBars drops a bar for some loss or delay and two for heavy", () => {
  assert.equal(signalBars(0, 12), 3);
  assert.equal(signalBars(0), 3);
  assert.equal(signalBars(0.05, 12), 2);
  assert.equal(signalBars(0, 200), 2);
  assert.equal(signalBars(0.2, 12), 1);
  assert.equal(signalBars(0, 600), 1);
});
