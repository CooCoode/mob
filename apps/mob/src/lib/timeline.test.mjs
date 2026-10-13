import test from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, latestClick, screenGeometry } from "./timeline.ts";

const at = (s) => `2026-10-13T10:00:${String(s).padStart(2, "0")}Z`;
const task = (id, status, extra = {}) => ({ id, sessionId: "s", eventId: 1, prompt: `prompt ${id}`, status, runner: "codex", ...extra });
const msg = (taskId, role, s, id = role) => ({ id: `${taskId}:${id}`, taskId, role, content: `${role} ${s}`, createdAt: at(s) });
const act = (taskId, n, s, extra = {}) => ({ id: `${taskId}:item_${n}`, taskId, kind: "tool", status: "completed", title: `step ${n}`, startedAt: at(s), updatedAt: at(s), ...extra });

test("orders replies and steps by time and groups long runs", () => {
  const items = buildTimeline(
    [task("t1", "succeeded")],
    [msg("t1", "user", 0), msg("t1", "assistant", 2, "a1"), msg("t1", "assistant", 9, "a2")],
    [act("t1", 1, 1), act("t1", 2, 3), act("t1", 3, 4), act("t1", 4, 5)],
  );
  assert.deepEqual(items.map((i) => i.type), ["user", "steps", "assistant", "group", "assistant", "footer"]);
  assert.equal(items[3].activities.length, 3);
});

test("short runs stay individual and notices are deduplicated", () => {
  const notice = { kind: "notice", status: "failed", text: "ignoring config" };
  const items = buildTimeline(
    [task("t1", "succeeded")],
    [msg("t1", "user", 0)],
    [act("t1", 0, 1, notice), act("t1", 1, 1, notice), act("t1", 2, 2)],
  );
  assert.deepEqual(items.map((i) => i.type), ["user", "steps", "footer"]);
  assert.equal(items[1].activities.length, 2);
});

test("queued and running turns end with a status item", () => {
  const items = buildTimeline(
    [task("t1", "succeeded"), task("t2", "running"), task("t3", "queued", { queuePosition: 2 })],
    [msg("t1", "user", 0), msg("t2", "user", 1), msg("t3", "user", 2)],
    [act("t2", 1, 3, { status: "running", title: "Typing" })],
  );
  const types = items.map((i) => i.type);
  assert.deepEqual(types, ["user", "footer", "user", "steps", "working", "user", "queued"]);
  assert.equal(items[4].latest.title, "Typing");
  assert.equal(items[6].task.queuePosition, 2);
});

test("falls back to the task prompt when the user message is missing", () => {
  const items = buildTimeline([task("t1", "failed", { createdAt: at(0) })], [], []);
  assert.equal(items[0].type, "user");
  assert.equal(items[0].message.content, "prompt t1");
});

test("extracts click points and screenshot geometry", () => {
  const acts = [
    act("t", 1, 1, { tool: "screenshot", text: '{"point_width":1512,"point_height":982}' }),
    act("t", 2, 2, { tool: "click", arguments: { x: 412, y: 230 } }),
    act("t", 3, 3, { tool: "click", status: "running", arguments: { x: 1, y: 1 } }),
  ];
  assert.deepEqual(screenGeometry(acts), { pointWidth: 1512, pointHeight: 982 });
  assert.deepEqual(latestClick(acts), { id: "t:item_2", x: 412, y: 230 });
  assert.equal(latestClick([]), null);
});
