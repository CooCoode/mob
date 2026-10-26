import test from "node:test";
import assert from "node:assert/strict";
import { addModel, agentStateLabel, menuModels, newlyUnguarded, shownChoice, withAgent } from "./turnSettings.ts";

test("an open chat shows its conversation's settings; a new chat its draft", () => {
  assert.deepEqual(shownChoice({ model: "gpt-5.4", effort: "high" }, { model: "x" }), { model: "gpt-5.4", effort: "high" });
  assert.deepEqual(shownChoice({}, { model: "x" }), { model: "", effort: "" }, "a conversation without settings follows the defaults");
  assert.deepEqual(shownChoice(null, { effort: "low" }), { model: "", effort: "low" });
});

test("a model in use stays in the menu after it leaves the list", () => {
  assert.deepEqual(menuModels(["a", "b"], "c"), ["a", "b", "c"]);
  assert.deepEqual(menuModels(["a", "b"], "a"), ["a", "b"]);
  assert.deepEqual(menuModels(["a"], ""), ["a"]);
});

test("settings edits, model names, and turning approval off needs a confirmation", () => {
  const agent = { models: [], defaultModel: "", defaultEffort: "", permissions: "approve" };
  const s = { rev: 3, defaultAgent: "codex", agents: { codex: agent, claude: { ...agent, permissions: "bypass" } } };
  const next = withAgent(s, "codex", { models: ["gpt-6-astra"], defaultEffort: "high" });
  assert.deepEqual(next.agents.codex, { ...agent, models: ["gpt-6-astra"], defaultEffort: "high" });
  assert.equal(s.agents.codex.defaultEffort, "", "the original is not changed");
  assert.deepEqual(addModel(["a"], " b "), ["a", "b"]);
  assert.deepEqual(addModel(["a"], "a"), ["a"]);
  assert.match(addModel([], "has space"), /no spaces/);
  assert.deepEqual(newlyUnguarded(s, withAgent(s, "codex", { permissions: "bypass" })), ["codex"]);
  assert.deepEqual(newlyUnguarded(s, next), []);
});

test("agents that are not ready are named plainly", () => {
  assert.equal(agentStateLabel("missing"), "Not installed");
  assert.equal(agentStateLabel("disabled"), "Installed, not enabled");
  assert.equal(agentStateLabel("error"), "Not working");
});
