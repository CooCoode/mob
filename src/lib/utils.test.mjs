import test from "node:test";
import assert from "node:assert/strict";
import { defaultLabel } from "./utils.ts";

test("the default choice names the agent's default when mobd reports it", () => {
  assert.equal(defaultLabel("effort", "xhigh"), "Default (xhigh)");
  assert.equal(defaultLabel("model", "gpt-6-astra"), "Default (gpt-6-astra)");
  assert.equal(defaultLabel("effort"), "Default effort");
});
