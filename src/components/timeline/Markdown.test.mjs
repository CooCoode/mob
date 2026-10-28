import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

// Load the actual TSX through the app's Vite config, then click its rendered DOM.
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost:1420" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "NodeFilter", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "HTMLInputElement"]) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { mockIPC, clearMocks } = await import("@tauri-apps/api/mocks");
const { Markdown } = await vite.ssrLoadModule("/src/components/timeline/Markdown.tsx");
let root, calls, clipboard;

const apple = "https://developer.apple.com/documentation/Xcode/running-your-app-on-simulated-or-physical-devices";
const log = "/Users/m4003/dev/github/xrdavies/build-results/mob-ios-build-check.log";

async function render(text, handler = () => undefined, desktop = true) {
  calls = [];
  clipboard = [];
  globalThis.isTauri = desktop;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => clipboard.push(text) } });
  mockIPC((command, args) => { calls.push({ command, args }); return handler(command, args); });
  root = createRoot(document.getElementById("root"));
  await act(async () => root.render(createElement(Markdown, { text })));
}
async function click(el) {
  assert.ok(el, "click target exists");
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  await act(async () => el.dispatchEvent(event));
  return event;
}
const button = (label) => [...document.querySelectorAll("button")].find((el) => el.textContent === label);
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
  clearMocks();
  delete globalThis.isTauri;
});
// Node isolates test files in separate processes. Keep window alive for React's deferred
// cleanup (including the existing code-copy timer) until that process exits.
after(async () => { await vite.close(); dom.window.close(); });

test("issue 2: clicking the Apple link dispatches the full URL to the system browser", async () => {
  await render(`[Apple 真机运行说明](${apple})`);
  const event = await click(document.querySelector("a"));
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(calls, [{ command: "plugin:opener|open_url", args: { url: apple, with: undefined } }]);
});

for (const href of [log, `tauri://localhost${log}`, `file://${log}`]) {
  test(`issue 2: file link opens device-aware actions: ${href.split(":")[0]}`, async () => {
    await render(`[构建日志](${href})`);
    assert.equal((await click(document.querySelector("a"))).defaultPrevented, true);
    const dialog = document.querySelector('[role="dialog"]');
    assert.ok(dialog);
    assert.match(dialog.textContent, /device running Mob/);
    assert.match(dialog.textContent, /mob-ios-build-check.log/);
    assert.deepEqual(calls, []);
    await click(button("Open on this device"));
    await click(button("Show in file manager"));
    await click(button("Copy path"));
    assert.deepEqual(calls, [
      { command: "open_local_path", args: { path: log, reveal: false } },
      { command: "open_local_path", args: { path: log, reveal: true } },
    ]);
    assert.deepEqual(clipboard, [log]);
  });
}

test("browser failure is visible instead of an unhandled rejection", async () => {
  await render(`[Apple](${apple})`, () => { throw Error("No default browser"); });
  await click(document.querySelector("a"));
  assert.match(document.querySelector('[role="alert"]').textContent, /No default browser/);
});

test("missing or inaccessible local file stays in the dialog with an error and copy action", async () => {
  await render(`[Log](${log})`, () => { throw Error("File not found on this device"); });
  await click(document.querySelector("a"));
  await click(button("Open on this device"));
  assert.match(document.querySelector('[role="alert"]').textContent, /File not found/);
  assert.match(document.querySelector('[role="dialog"]').textContent, /office machine/);
  await click(button("Copy path"));
  assert.deepEqual(clipboard, [log]);
});

test("browser mode keeps normal web navigation and offers copying local paths", async () => {
  await render(`[Apple](${apple}) [Log](${log})`, undefined, false);
  const [web, file] = document.querySelectorAll("a");
  assert.equal(web.getAttribute("href"), apple);
  assert.equal(web.target, "_blank");
  // Observe the event without letting jsdom perform unsupported window navigation.
  let prevented;
  document.addEventListener("click", (e) => { prevented = e.defaultPrevented; e.preventDefault(); }, { once: true });
  await click(web);
  assert.equal(prevented, false);
  await click(file);
  assert.match(document.querySelector('[role="dialog"]').textContent, /desktop app/);
  assert.equal(button("Open on this device"), undefined);
  await click(button("Copy path"));
  assert.deepEqual(clipboard, [log]);
  assert.deepEqual(calls, []);
});

test("untrusted protocols and relative paths show an explanation without native calls", async () => {
  for (const href of ["javascript:alert(1)", "tauri://evil/Users/secret", "file://server/share/log", "docs/build.log"]) {
    await render(`[Link](${href})`);
    await click(document.querySelector("a"));
    assert.ok(document.querySelector('[role="dialog"]'));
    assert.equal(button("Open on this device"), undefined);
    assert.deepEqual(calls, []);
    await act(async () => root.unmount());
    root = undefined;
    clearMocks();
  }
});

test("anchors keep native fragment navigation; code blocks and copy still work", async () => {
  await render('[Section](#section)\n\n```unknown\nsample\n```');
  const link = document.querySelector("a");
  let prevented;
  document.addEventListener("click", (e) => { prevented = e.defaultPrevented; e.preventDefault(); }, { once: true });
  await click(link);
  assert.equal(prevented, false);
  assert.notEqual(link.target, "_blank");
  await click(button("Copy"));
  assert.deepEqual(clipboard, ["sample"]);
  assert.deepEqual(calls, []);
});

test("encoded file names and source locations reach native actions as a clean path", async () => {
  await render("[Log](/tmp/%E4%B8%AD%E6%96%87%20%2520.log:12:4)");
  await click(document.querySelector("a"));
  assert.match(document.querySelector('[role="dialog"]').textContent, /中文 %20.log:12:4/);
  await click(button("Open on this device"));
  assert.deepEqual(calls, [{ command: "open_local_path", args: { path: "/tmp/中文 %20.log", reveal: false } }]);
});

test("copy failures and native permission errors remain visible", async () => {
  await render(`[Log](${log})`, () => { throw Error("Permission denied on this device"); });
  await click(document.querySelector("a"));
  await click(button("Show in file manager"));
  assert.match(document.querySelector('[role="alert"]').textContent, /Permission denied/);
  navigator.clipboard.writeText = async () => { throw Error("Clipboard unavailable"); };
  await click(button("Copy path"));
  assert.match(document.querySelector('[role="alert"]').textContent, /Clipboard unavailable/);
});

test("custom link handling does not enable unsafe image sources", async () => {
  await render("![Image](javascript:alert(1)) [Bad](javascript:alert(1))");
  assert.equal(document.querySelector("img"), null);
  assert.equal(document.querySelector("a").getAttribute("href"), "#mob-file-link");
  await click(document.querySelector("a"));
  assert.match(document.querySelector('[role="dialog"]').textContent, /not supported/);
  assert.deepEqual(calls, []);
});
