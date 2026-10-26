import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { imeGuard } from "./ime.ts";

const enter = { isComposing: false, keyCode: 13 };

test("WebKit: the Enter that commits Pinyin arrives after compositionend and is not a send", async () => {
  const ime = imeGuard();
  ime.start();
  assert.equal(ime.owns({ isComposing: true, keyCode: 229 }), true, "typing pinyin");
  ime.end();
  assert.equal(ime.owns(enter), true, "the committing Enter, dispatched right after compositionend");
  await setImmediate();
  assert.equal(ime.owns(enter), false, "a later Enter sends");
});

test("Chrome: the committing Enter carries isComposing; keyCode 229 also counts", () => {
  const ime = imeGuard();
  assert.equal(ime.owns({ isComposing: true, keyCode: 13 }), true);
  assert.equal(ime.owns({ isComposing: false, keyCode: 229 }), true);
  assert.equal(ime.owns(enter), false);
});

test("a new composition right after one ends stays guarded", async () => {
  const ime = imeGuard();
  ime.start();
  ime.end();
  ime.start();
  await setImmediate();
  assert.equal(ime.owns(enter), true);
});
