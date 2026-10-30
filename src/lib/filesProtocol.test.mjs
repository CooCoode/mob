import test from "node:test";
import assert from "node:assert/strict";
import { tusURL, checkFileRange } from "./filesProtocol.ts";

test("upload locations cannot escape the paired machine or upload route", () => {
  const base = "https://office.example";
  const path = "/file-uploads/" + "a".repeat(32);
  assert.equal(tusURL(base, path), base + path);
  assert.equal(tusURL(base, base + "/file-uploads/", true), base + "/file-uploads/");
  for (const value of ["https://attacker.example" + path, "/settings", path + "?token=x", path + "/../other", "http://office.example" + path]) {
    assert.throws(() => tusURL(base, value));
  }
});

test("download continuation requires an exact byte range and unchanged version", () => {
  checkFileRange(206, "bytes 4-7/8", '"version"', '"version"', 4, 7, 8);
  for (const [status, range, etag] of [[200, null, '"version"'], [206, "bytes 0-7/8", '"version"'], [206, "bytes 4-7/8", '"changed"'], [412, null, null]]) {
    assert.throws(() => checkFileRange(status, range, etag, '"version"', 4, 7, 8));
  }
});
