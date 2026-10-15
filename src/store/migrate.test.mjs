import test from "node:test";
import assert from "node:assert/strict";
import { migrateApp } from "./migrate.ts";

test("v2 → v3 keeps machines and sessions, stashes passwords, and requires pairing", () => {
  const v2 = {
    machines: [
      { id: "a", name: "Office", mobdUrl: "http://office:8080", vncUsername: "me", vncPassword: "pw" },
      { id: "b", name: "Lab", mobdUrl: "https://lab" },
    ],
    activeMachineId: "a",
    savedSessions: { a: "s1" },
    theme: "dark",
  };
  const s = migrateApp(structuredClone(v2), 2);
  assert.deepEqual(s.machines, [
    { id: "a", name: "Office", mobdUrl: "http://office:8080", vncUsername: "me", needsPairing: true },
    { id: "b", name: "Lab", mobdUrl: "https://lab", needsPairing: true },
  ]);
  assert.deepEqual(s.legacySecrets, { "a.vncPassword": "pw" });
  assert.deepEqual(s.savedSessions, { a: "s1" });
  assert.equal(s.activeMachineId, "a");
  assert.equal(JSON.stringify(s).includes("\"vncPassword\""), false);
});

test("v1 also drops the custom VNC URL", () => {
  const s = migrateApp({ machines: [{ id: "a", name: "O", mobdUrl: "http://o", vncWsUrl: "ws://x" }] }, 1);
  assert.deepEqual(s.machines, [{ id: "a", name: "O", mobdUrl: "http://o", needsPairing: true }]);
});

test("v3 state is unchanged", () => {
  const v3 = { machines: [{ id: "a", name: "O", mobdUrl: "http://o", needsPairing: false }], legacySecrets: {} };
  assert.deepEqual(migrateApp(structuredClone(v3), 3), v3);
});
