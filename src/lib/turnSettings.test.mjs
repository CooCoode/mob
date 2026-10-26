import test from "node:test";
import assert from "node:assert/strict";
import { menuModels, shownChoice, turnChoice } from "./turnSettings.ts";

const efforts = ["low", "medium", "high"];

test("an open chat shows and keeps its conversation's settings; a new chat its draft", () => {
  const session = { model: "gpt-5.4", effort: "high" };
  assert.deepEqual(shownChoice({ settings: true, session, draft: { model: "x" } }), { model: "gpt-5.4", effort: "high" });
  assert.deepEqual(shownChoice({ settings: true, session: { }, draft: { model: "x" } }), { model: "", effort: "" }, "conversation follows the defaults");
  assert.deepEqual(shownChoice({ settings: true, session: null, draft: { effort: "low" } }), { model: "", effort: "low" });
  // Older mobd: no conversation settings, the device's choice applies.
  assert.deepEqual(shownChoice({ settings: false, session, draft: { model: "o4" } }), { model: "o4", effort: "" });
});

test("only a new chat's draft is sent, or every turn's choice to an older mobd", () => {
  const shown = { model: "opus", effort: "high" };
  assert.deepEqual(turnChoice({ settings: true, newChat: false, shown, efforts }), {});
  assert.deepEqual(turnChoice({ settings: true, newChat: true, shown, efforts }), { model: "opus", effort: "high" });
  assert.deepEqual(turnChoice({ settings: true, newChat: true, shown: { model: "", effort: "" }, efforts }), { model: undefined, effort: undefined });
  assert.deepEqual(turnChoice({ settings: false, newChat: false, shown: { model: "", effort: "max" }, efforts }), { model: undefined, effort: undefined });
});

test("a model in use stays in the menu after it leaves the list", () => {
  assert.deepEqual(menuModels(["a", "b"], "c"), ["a", "b", "c"]);
  assert.deepEqual(menuModels(["a", "b"], "a"), ["a", "b"]);
  assert.deepEqual(menuModels(["a"], ""), ["a"]);
});

test("settings edits drop empty values so the fallback applies", async () => {
  const { withAgent, addModel, newlyUnguarded } = await import("./turnSettings.ts");
  let s = { rev: 3 };
  s = withAgent(s, "codex", { models: ["gpt-6-astra"], defaultEffort: "high" });
  assert.deepEqual(s, { rev: 3, agents: { codex: { models: ["gpt-6-astra"], defaultEffort: "high" } } });
  s = withAgent(s, "codex", { defaultEffort: "", models: [] });
  assert.deepEqual(s, { rev: 3, agents: {} });
  assert.deepEqual(addModel(["a"], " b "), ["a", "b"]);
  assert.deepEqual(addModel(["a"], "a"), ["a"]);
  assert.match(addModel([], "has space"), /no spaces/);
  const before = { codex: { permissions: "approve" }, claude: { permissions: "bypass" } };
  assert.deepEqual(newlyUnguarded(before, { rev: 1, agents: { codex: { permissions: "bypass" } } }, { codex: "approve", claude: "bypass" }), ["codex"]);
  // Clearing the app setting falls back to config: unguarded only if config bypasses.
  assert.deepEqual(newlyUnguarded(before, { rev: 1 }, { codex: "bypass", claude: "bypass" }), ["codex"]);
  assert.deepEqual(newlyUnguarded(before, { rev: 1 }, { codex: "approve", claude: "bypass" }), []);
});
