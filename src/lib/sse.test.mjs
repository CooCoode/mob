import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { EventStream, SSEParser } from "./sse.ts";

function parse(...chunks) {
  const events = [];
  const parser = new SSEParser((ev) => events.push(ev));
  for (const c of chunks) parser.push(c);
  return { events, parser };
}

test("parser: named events, multi-line data, comments and ids", () => {
  const { events, parser } = parse(": keepalive\n\nevent: status\nid: 7\ndata: {\"a\":\ndata:1}\n\ndata: plain\n\n");
  assert.deepEqual(events, [
    { type: "status", data: "{\"a\":\n1}", lastEventId: "7" },
    { type: "message", data: "plain", lastEventId: "7" },
  ]);
  assert.equal(parser.lastEventId, "7");
});

test("parser: CRLF and CR line endings split across chunks", () => {
  const { events, parser } = parse("event: a\r", "\ndata: one\r\n\r", "\ndata: two\r\r");
  // A final CR may still be half of CRLF: the event dispatches once the next character arrives.
  assert.equal(events.length, 1);
  parser.push(": next\n");
  assert.deepEqual(events.map((e) => [e.type, e.data]), [["a", "one"], ["message", "two"]]);
});

test("parser: incomplete event waits; empty data is not dispatched; retry is read", () => {
  const { events, parser } = parse("event: x\n\nretry: 2500\ndata: partial");
  assert.equal(events.length, 0);
  assert.equal(parser.retry, 2500);
  parser.push("\n\n");
  assert.equal(events[0].data, "partial");
});

function streamBody(text, keepOpen = false) {
  return new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      if (!keepOpen) c.close();
    },
  });
}

const sse = (text, keepOpen) =>
  new Response(streamBody(text, keepOpen), { status: 200, headers: { "Content-Type": "text/event-stream" } });

test("reconnects with Last-Event-ID and the current headers", async () => {
  const requests = [];
  let n = 0;
  const fetch = async (url, init) => {
    requests.push({ url, headers: init.headers });
    return ++n === 1 ? sse("id: 5\nevent: tick\ndata: a\n\n") : sse("", true);
  };
  const got = [];
  const es = new EventStream("http://office/events", { fetch, retry: 1, headers: () => ({ Authorization: `Bearer t${n}` }) });
  es.addEventListener("tick", (ev) => got.push(ev.data));
  let errors = 0;
  es.onerror = () => errors++;
  await sleep(30);
  es.close();
  assert.deepEqual(got, ["a"]);
  assert.equal(errors, 1);
  assert.ok(requests.length >= 2);
  assert.equal(requests[0].headers.get("Last-Event-ID"), null);
  assert.equal(requests[1].headers.get("Last-Event-ID"), "5");
  assert.equal(requests[1].headers.get("Authorization"), "Bearer t1");
  assert.equal(requests[1].headers.get("Accept"), "text/event-stream");
});

test("resumeParam puts the last ID in the query instead of a header", async () => {
  const urls = [];
  let n = 0;
  const fetch = async (url, init) => {
    urls.push([url, init.headers.get("Last-Event-ID")]);
    return ++n === 1 ? sse("id: 9\ndata: x\n\n") : sse("", true);
  };
  const es = new EventStream("http://office/tasks/t/events?after=3", { fetch, retry: 1, resumeParam: "after" });
  await sleep(30);
  es.close();
  assert.deepEqual(urls[0], ["http://office/tasks/t/events?after=3", null]);
  assert.deepEqual(urls[1], ["http://office/tasks/t/events?after=9", null]);
});

test("401 stops for good and reports unauthorized", async () => {
  let calls = 0, unauthorized = 0, errors = 0;
  const fetch = async () => {
    calls++;
    return new Response("{}", { status: 401 });
  };
  const es = new EventStream("http://office/events", { fetch, retry: 1, onUnauthorized: () => unauthorized++ });
  es.onerror = () => errors++;
  await sleep(30);
  assert.equal(calls, 1);
  assert.equal(unauthorized, 1);
  assert.equal(errors, 0);
  assert.equal(es.readyState, 2);
});

test("close aborts the pending reconnect", async () => {
  let calls = 0;
  const fetch = async () => {
    calls++;
    throw new TypeError("network down");
  };
  const es = new EventStream("http://office/events", { fetch, retry: 50 });
  await sleep(10);
  es.close();
  await sleep(80);
  assert.equal(calls, 1);
});
