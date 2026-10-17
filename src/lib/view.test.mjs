import test from "node:test";
import assert from "node:assert/strict";
import { devicePixels } from "./view.ts";

test("device pixels round up to 64 and stay within mobd's limits", () => {
  assert.equal(devicePixels(334, 2), 704);
  assert.equal(devicePixels(320, 2), 640);
  assert.equal(devicePixels(1440, 1), 1472);
  assert.equal(devicePixels(0, 2), 64);
  assert.equal(devicePixels(400, 0), 448); // unknown ratio counts as 1
  assert.equal(devicePixels(10000, 2), 8192);
});
