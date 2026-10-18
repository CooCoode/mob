import test from "node:test";
import assert from "node:assert/strict";
import { migrateApp } from "./migrate.ts";

test("v2 → v5 keeps machines and sessions, drops Desktop sign-in, and requires pairing", () => {
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
    { id: "a", name: "Office", mobdUrl: "http://office:8080", needsPairing: true },
    { id: "b", name: "Lab", mobdUrl: "https://lab", needsPairing: true },
  ]);
  // VNC is gone (v5): the password is not moved to the keychain at all.
  assert.deepEqual(s.legacySecrets, {});
  assert.deepEqual(s.savedSessions, { a: "s1" });
  assert.equal(s.activeMachineId, "a");
  assert.equal(JSON.stringify(s).includes("\"vncPassword\""), false);
});

test("v1 also drops the custom VNC URL", () => {
  const s = migrateApp({ machines: [{ id: "a", name: "O", mobdUrl: "http://o", vncWsUrl: "ws://x" }] }, 1);
  assert.deepEqual(s.machines, [{ id: "a", name: "O", mobdUrl: "http://o", needsPairing: true }]);
});

test("v3 → v4 only closes the desktop panel", () => {
  const v3 = { machines: [{ id: "a", name: "O", mobdUrl: "http://o", needsPairing: false }], legacySecrets: {}, previewOpen: true };
  assert.deepEqual(migrateApp(structuredClone(v3), 3), { ...v3, previewOpen: false });
});

test("v4 → v5 drops the Desktop sign-in user and a pending VNC password, keeps the rest", () => {
  const v4 = {
    machines: [{ id: "a", name: "O", mobdUrl: "http://o", vncUsername: "me", liveQuality: "low", needsPairing: false }],
    legacySecrets: { "a.vncPassword": "pw", "b.token": "t" },
    previewOpen: true,
  };
  assert.deepEqual(migrateApp(structuredClone(v4), 4), {
    machines: [{ id: "a", name: "O", mobdUrl: "http://o", liveQuality: "low", needsPairing: false }],
    legacySecrets: { "b.token": "t" },
    previewOpen: true,
  });
});

test("v5 state is unchanged, including an open panel", () => {
  const v5 = { machines: [{ id: "a", name: "O", mobdUrl: "http://o" }], legacySecrets: {}, previewOpen: true };
  assert.deepEqual(migrateApp(structuredClone(v5), 5), v5);
});
