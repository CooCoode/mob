import test from "node:test";
import assert from "node:assert/strict";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { useUpdates } from "./updates.ts";

globalThis.window = { crypto: globalThis.crypto };
globalThis.isTauri = true;
const metadata = { rid: 1, version: "0.4.0", currentVersion: "0.3.0", rawJson: {} };
function reset(t, handler) {
  useUpdates.setState(useUpdates.getInitialState());
  mockIPC(handler);
  t.after(clearMocks);
}

test("simultaneous checks share one request; release the previous resource", async (t) => {
  let checks = 0, closes = 0;
  reset(t, async (command) => {
    if (command === "plugin:app|version") return "0.3.0";
    if (command === "plugin:updater|check") { checks++; return metadata; }
    if (command === "plugin:resources|close") closes++;
  });
  await Promise.all([useUpdates.getState().check(), useUpdates.getState().check()]);
  assert.equal(checks, 1);
  assert.equal(useUpdates.getState().phase, "available");
  await useUpdates.getState().check();
  assert.equal(closes, 1);
});

test("signature or download failure never restarts the app", async (t) => {
  let restarts = 0;
  reset(t, async (command) => {
    if (command === "plugin:app|version") return "0.3.0";
    if (command === "plugin:updater|check") return metadata;
    if (command === "plugin:updater|download_and_install") throw Error("invalid signature");
    if (command === "plugin:process|restart") restarts++;
  });
  await useUpdates.getState().check();
  await useUpdates.getState().install();
  assert.equal(useUpdates.getState().phase, "error");
  assert.match(useUpdates.getState().error, /invalid signature/);
  assert.equal(restarts, 0);
});

test("install is not repeated; failed restart asks the user to reopen", async (t) => {
  let installs = 0;
  reset(t, async (command) => {
    if (command === "plugin:app|version") return "0.3.0";
    if (command === "plugin:updater|check") return metadata;
    if (command === "plugin:updater|download_and_install") installs++;
    if (command === "plugin:process|restart") throw Error("restart failed");
  });
  await useUpdates.getState().check();
  await Promise.all([useUpdates.getState().install(), useUpdates.getState().install()]);
  assert.equal(installs, 1);
  assert.equal(useUpdates.getState().phase, "installed");
  assert.match(useUpdates.getState().error, /Quit and reopen/);
});

test("offline check can be retried; null response means up to date", async (t) => {
  let offline = true;
  reset(t, async (command) => {
    if (command === "plugin:app|version") return "0.3.0";
    if (command === "plugin:updater|check") { if (offline) throw Error("offline"); return null; }
  });
  await useUpdates.getState().check();
  assert.equal(useUpdates.getState().phase, "error");
  offline = false;
  await useUpdates.getState().check();
  assert.equal(useUpdates.getState().phase, "current");
});
