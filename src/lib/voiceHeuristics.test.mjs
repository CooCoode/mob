import test from "node:test";
import assert from "node:assert/strict";
import {
  looksComplete,
  shouldEarlyDispatch,
  isMaterialDiff,
  normalizeVoiceText,
} from "./voiceHeuristics.ts";

test("looksComplete requires substance and boundary cues", () => {
  assert.equal(looksComplete("hi"), false);
  assert.equal(looksComplete("打开 Safari。"), true);
  assert.equal(looksComplete("Open Safari and find flights"), true);
  assert.equal(looksComplete("帮我"), false);
});

test("shouldEarlyDispatch respects confidence and punctuation", () => {
  assert.equal(shouldEarlyDispatch("打开 Safari", 0.4), false);
  assert.equal(shouldEarlyDispatch("打开 Safari。", 0.4), true);
  assert.equal(shouldEarlyDispatch("Open Safari and find flights to Tokyo", 0.8), true);
});

test("isMaterialDiff ignores trivial punctuation drift", () => {
  assert.equal(isMaterialDiff("打开 Safari", "打开 Safari。"), false);
  assert.equal(isMaterialDiff("打开 Safari", "关闭 Chrome 并重启"), true);
  assert.equal(normalizeVoiceText("  Hello   World。 "), "hello world");
});
