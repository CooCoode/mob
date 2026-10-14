import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
// Node runs the erasable TypeScript module directly (type stripping).
import { Chat } from "./chat.ts";

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function detail(id, status = "running", eventId = 3) {
  return {
    session: { id, title: id, status, activeTaskId: status === "running" ? `${id}-turn` : undefined,
      messages: [{ id: `${id}-turn:user`, taskId: `${id}-turn`, role: "user", content: `prompt ${id}` }] },
    tasks: [{ id: `${id}-turn`, sessionId: id, prompt: `prompt ${id}`, status, eventId, runner: "codex" }],
  };
}

function reply(data, text = "回复", itemId = "reply") {
  data.session.messages.push({ id: `${data.tasks.at(-1).id}:${itemId}`, taskId: data.tasks.at(-1).id, role: "assistant", content: text });
  return data;
}

function harness(t, handler) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    const result = await handler(url, init);
    return new Response(JSON.stringify(result.body ?? result), { status: result.statusCode ?? 200 });
  });
  const sources = [];
  class Source {
    listeners = new Map();
    closed = false;
    constructor(url) { this.url = url; sources.push(this); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    close() { this.closed = true; }
    emit(type, data) { this.listeners.get(type)?.({ data: JSON.stringify({ type, timestamp: "now", ...data }) }); }
  }
  const previous = globalThis.EventSource;
  globalThis.EventSource = Source;
  t.after(() => { globalThis.EventSource = previous; });
  const chat = new Chat(() => {}, () => {});
  t.after(() => chat.newChat());
  return { chat, sources, calls };
}

async function settle() {
  await setImmediate();
  await setImmediate();
}

test("restores history, deduplicates replies, and continues the same session", async (t) => {
  let server = reply(detail("one", "succeeded"));
  const { chat, calls, sources } = harness(t, (url, init) => {
    if (url.endsWith("/sessions")) return { sessions: [server.session] };
    if (init?.method === "POST") {
      const task = { id: "next-turn", sessionId: "one", prompt: "follow up", status: "queued", eventId: 1, runner: "codex" };
      server.tasks.push(task);
      server.session.status = "queued";
      server.session.messages.push({ id: `${task.id}:user`, taskId: task.id, role: "user", content: task.prompt });
      return task;
    }
    return server;
  });
  await chat.setMachine("office", "http://office", "one");
  assert.equal(chat.session.messages[1].content, "回复");
  assert.equal(chat.canSend, true);
  assert.equal(await chat.submit("follow up"), true);
  const posted = calls.find((c) => c.init?.method === "POST");
  assert.deepEqual(JSON.parse(posted.init.body), { prompt: "follow up", sessionId: "one" });
  assert.match(sources.at(-1).url, /after=1$/);
  await settle();
  const source = sources.at(-1);
  source.emit("log", { id: 2, message: "[stdout] debug output" });
  source.emit("message", { id: 3, messageId: "item", message: "second reply" });
  source.emit("message", { id: 3, messageId: "item", message: "second reply" });
  assert.equal(chat.session.messages.filter((m) => m.content === "second reply").length, 1);
  assert.equal(chat.session.messages.some((m) => m.content.includes("debug output")), false);
  assert.equal(chat.canSend, false);
  server = structuredClone(server);
  server.tasks.at(-1).status = "succeeded";
  server.tasks.at(-1).eventId = 4;
  reply(server, "second reply", "item");
  source.emit("status", { id: 4, status: "succeeded" });
  assert.equal(chat.canSend, true);
  assert.equal(chat.sessions[0].status, "succeeded");
  await settle();
  assert.equal(chat.sessions.length, 1);
  assert.equal(chat.tasks.length, 2);
  assert.equal(chat.session.messages.length, 4);
});

test("blocks double Enter and stays busy after the POST finishes", async (t) => {
  const post = deferred();
  const server = detail("new", "queued", 1);
  const { chat, calls } = harness(t, (url, init) => {
    if (url.endsWith("/sessions")) return { sessions: [] };
    if (init?.method === "POST") return post.promise;
    return server;
  });
  await chat.setMachine("office", "http://office", null);
  const first = chat.submit("hello");
  assert.equal(await chat.submit("hello again"), false);
  assert.equal(calls.filter((c) => c.init?.method === "POST").length, 1);
  post.resolve(server.tasks[0]);
  assert.equal(await first, true);
  assert.equal(chat.sessions[0].id, "new");
  assert.equal(chat.busy, true);
  assert.equal(chat.canSend, false);
});

test("a late session fetch cannot replace a newer selection", async (t) => {
  const old = deferred();
  const { chat } = harness(t, (url) => {
    if (url.endsWith("/sessions")) return { sessions: [detail("a").session, detail("b").session] };
    if (url.endsWith("/a")) return old.promise;
    return reply(detail("b", "succeeded"), "reply B");
  });
  await chat.setMachine("office", "http://office", null);
  const a = chat.open("a");
  await chat.open("b");
  old.resolve(detail("a"));
  await a;
  assert.equal(chat.sessionId, "b");
  assert.equal(chat.session.messages.at(-1).content, "reply B");
});

test("switching machines ignores queued events from the previous machine", async (t) => {
  const { chat, sources } = harness(t, (url) => {
    const id = url.includes("office-a") ? "a" : "b";
    return url.endsWith("/sessions") ? { sessions: [detail(id).session] } : detail(id);
  });
  await chat.setMachine("a", "http://office-a");
  const old = sources[0];
  await chat.setMachine("b", "http://office-b");
  old.emit("message", { id: 100, messageId: "wrong", message: "wrong machine" });
  assert.equal(old.closed, true);
  assert.equal(chat.machineId, "b");
  assert.equal(chat.session.messages.some((m) => m.content === "wrong machine"), false);
});

test("disconnect recovery restores a missed reply and terminal status", async (t) => {
  let server = detail("one");
  const { chat, sources } = harness(t, (url) => url.endsWith("/sessions") ? { sessions: [server.session] } : server);
  await chat.setMachine("office", "http://office");
  const es = sources[0];
  server = reply(detail("one", "succeeded", 8), "missed final reply");
  es.onerror();
  assert.equal(es.closed, false, "leave native reconnect enabled until snapshot recovery succeeds");
  await settle();
  assert.equal(chat.session.messages.at(-1).content, "missed final reply");
  assert.equal(chat.canSend, true);
  assert.equal(es.closed, true);
});

test("restart recovery accepts the durable terminal snapshot after volatile log IDs disappear", async (t) => {
  let server = detail("one");
  const { chat, sources } = harness(t, (url) => url.endsWith("/sessions") ? { sessions: [server.session] } : server);
  await chat.setMachine("office", "http://office");
  sources[0].emit("log", { id: 100, message: "volatile log" });
  server = detail("one", "failed", 5);
  server.tasks[0].error = "interrupted by mobd restart";
  sources[0].onerror();
  await settle();
  assert.equal(chat.currentTask.status, "failed");
  assert.equal(chat.currentTask.error, "interrupted by mobd restart");
  assert.equal(chat.canSend, true);
});

test("a snapshot cannot erase a newer reply, and events update replacement task snapshots", async (t) => {
  let pending = null;
  let server = detail("one");
  const { chat, sources } = harness(t, (url) => {
    if (url.endsWith("/sessions")) return { sessions: [server.session] };
    return pending ? pending.promise : server;
  });
  await chat.setMachine("office", "http://office");
  const es = sources[0];
  pending = deferred();
  es.onerror();
  es.emit("message", { id: 4, messageId: "reply", message: "newer reply" });
  pending.resolve(detail("one", "running", 3));
  await settle();
  assert.equal(chat.session.messages.at(-1).content, "newer reply");
  pending = null;
  server = reply(detail("one", "running", 5), "newer reply");
  es.onerror();
  await settle();
  assert.equal(chat.currentTask.eventId, 5);
  server = reply(detail("one", "succeeded", 6), "newer reply");
  es.emit("status", { id: 6, status: "succeeded" });
  assert.equal(chat.currentTask.status, "succeeded");
  assert.equal(chat.canSend, true);
});

test("cancel waits for the terminal event before allowing another turn", async (t) => {
  let server = detail("one");
  const { chat, sources } = harness(t, (url, init) => {
    if (init?.method === "POST") return server.tasks[0];
    return url.endsWith("/sessions") ? { sessions: [server.session] } : server;
  });
  await chat.setMachine("office", "http://office");
  await chat.cancel();
  assert.equal(chat.cancelling, true);
  assert.equal(chat.canSend, false);
  server = detail("one", "cancelled", 4);
  sources[0].emit("status", { id: 4, status: "cancelled" });
  assert.equal(chat.cancelling, false);
  assert.equal(chat.canSend, true);
});

test("a POST completed after a machine switch cannot change the new conversation", async (t) => {
  const post = deferred();
  const { chat } = harness(t, (url, init) => {
    if (init?.method === "POST") return post.promise;
    return url.endsWith("/sessions") ? { sessions: [] } : detail("old");
  });
  await chat.setMachine("a", "http://a", null);
  const sending = chat.submit("old prompt");
  await chat.setMachine("b", "http://b", null);
  post.resolve(detail("old", "queued", 1).tasks[0]);
  assert.equal(await sending, false);
  assert.equal(chat.machineId, "b");
  assert.equal(chat.sessionId, null);
  assert.equal(chat.tasks.length, 0);
  assert.equal(chat.canSend, true);
});

test("an old backend blocks sends with an upgrade message", async (t) => {
  const { chat, calls } = harness(t, () => ({ statusCode: 404, body: { error: "not found" } }));
  await chat.setMachine("office", "http://office");
  assert.match(chat.error, /Update office mobd/);
  assert.equal(await chat.submit("hello"), false);
  assert.equal(calls.some((c) => c.init?.method === "POST"), false);
});

test("a named runner error is not treated as a transport reconnect", async (t) => {
  const server = detail("one");
  const { chat, sources, calls } = harness(t, (url) => url.endsWith("/sessions") ? { sessions: [server.session] } : server);
  await chat.setMachine("office", "http://office");
  const before = calls.length;
  sources[0].emit("error", { id: 4, message: "save conversation: disk full" });
  sources[0].onerror({ data: "named event" });
  await settle();
  assert.match(chat.error, /disk full/);
  assert.equal(calls.length, before);
});
