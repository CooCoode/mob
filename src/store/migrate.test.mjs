import test from "node:test";
import assert from "node:assert/strict";
import { migrateApp } from "./migrate.ts";

test("v2 → v7 keeps machines and sessions and requires pairing", () => {
  const v2 = {
    machines: [
      { id: "a", name: "Office", mobdUrl: "http://office:8080" },
      { id: "b", name: "Lab", mobdUrl: "https://lab" },
    ],
    activeMachineId: "a",
    savedSessions: { a: "s1" },
    theme: "dark",
  };
  const s = migrateApp(structuredClone(v2), 2);
  assert.deepEqual(s.machines, [
    { id: "a", name: "Office", addresses: [{ id: "a", url: "http://office:8080", needsPairing: true }] },
    { id: "b", name: "Lab", addresses: [{ id: "b", url: "https://lab", needsPairing: true }] },
  ]);
  assert.deepEqual(s.savedSessions, { a: "s1" });
  assert.equal(s.activeMachineId, "a");
});

test("v3 → v4 closes the desktop panel", () => {
  const v3 = { machines: [{ id: "a", name: "O", mobdUrl: "http://o", needsPairing: false }], previewOpen: true };
  assert.deepEqual(migrateApp(structuredClone(v3), 3), {
    machines: [{ id: "a", name: "O", addresses: [{ id: "a", url: "http://o" }] }], previewOpen: false,
  });
});

test("v6 → v7 keeps paired machines working: one address with the machine's ID (its token account)", () => {
  const v6 = {
    machines: [{ id: "a", name: "O", mobdUrl: "http://o.local:8080", serverId: "S", clientId: "C", needsPairing: false, liveQuality: "low" }],
    previewOpen: true,
  };
  assert.deepEqual(migrateApp(structuredClone(v6), 6), {
    machines: [{ id: "a", name: "O", serverId: "S", liveQuality: "low", addresses: [{ id: "a", url: "http://o.local:8080", clientId: "C" }] }],
    previewOpen: true,
  });
});

test("v7 state is unchanged", () => {
  const v7 = { machines: [{ id: "a", name: "O", addresses: [{ id: "a", url: "http://o" }, { id: "b", url: "https://o.ts.net" }], route: "b" }] };
  assert.deepEqual(migrateApp(structuredClone(v7), 7), v7);
});

test("v5 → v6 drops the per-device model and effort choices", () => {
  const out = migrateApp({ machines: [{ id: "a" }], turnPrefs: { "a/codex": { model: "o4" } } }, 5);
  assert.equal("turnPrefs" in out, false);
  assert.deepEqual(out.machines, [{ id: "a", name: "", addresses: [{ id: "a", url: "", needsPairing: true }] }]);
});
