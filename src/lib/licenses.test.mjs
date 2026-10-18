import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));

test("the licence list covers every runtime dependency (run npm run licenses after changing them)", () => {
  const list = read("../licenses.json");
  const names = new Set(list.filter((p) => p.source === "npm").map((p) => p.name));
  for (const dep of Object.keys(read("../../package.json").dependencies)) assert.ok(names.has(dep), `${dep} missing from src/licenses.json`);
  for (const crate of ["tauri", "tauri-plugin-updater", "tauri-plugin-process", "serde", "serde_json"]) {
    assert.ok(list.some((p) => p.source === "crate" && p.name === crate), `crate ${crate} missing`);
  }
  for (const p of list) assert.ok(p.license && p.url && p.version, `${p.name} lacks licence, version or link`);
});
