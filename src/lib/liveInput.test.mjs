import test from "node:test";
import assert from "node:assert/strict";
import { buttonName, HeldInput, normalizePoint, remoteCode, wheelPixels } from "./liveInput.ts";

test("points are normalized to the picture inside letterbox bars", () => {
  const box = { left: 100, top: 50, width: 1000, height: 1000 }; // 16:9 picture: bars above and below
  assert.deepEqual(normalizePoint(100, 550, box, 1280, 720), { x: 0, y: 0.5, inside: true });
  assert.deepEqual(normalizePoint(1100, 550 + 281.25, box, 1280, 720), { x: 1, y: 1, inside: true });
  assert.deepEqual(normalizePoint(600, 60, box, 1280, 720), { x: 0.5, y: 0, inside: false });
  assert.equal(normalizePoint(600, 60, box, 0, 0), null);
});

test("buttons and wheel deltas use mobd's names and pixels", () => {
  assert.deepEqual([0, 1, 2, 3].map(buttonName), ["left", "middle", "right", null]);
  assert.deepEqual(wheelPixels({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 800), { dx: 0, dy: 48 });
  assert.deepEqual(wheelPixels({ deltaX: -2, deltaY: 1, deltaMode: 0 }, 800), { dx: -2, dy: 1 });
  assert.deepEqual(wheelPixels({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 800), { dx: 0, dy: 800 });
});

test("releasing Command also releases keys pressed with it (macOS sends no key-up for them)", () => {
  const h = new HeldInput();
  h.keyDown("MetaLeft");
  h.keyDown("ShiftLeft");
  h.keyDown("KeyC");
  assert.deepEqual(h.keyUp("MetaLeft"), [{ t: "key", code: "KeyC", down: false }, { t: "key", code: "MetaLeft", down: false }]);
  assert.deepEqual(h.keyUp("KeyC"), []); // already released
  assert.deepEqual(h.keyUp("ShiftLeft"), [{ t: "key", code: "ShiftLeft", down: false }]);
});

test("releaseAll lets go of keys, then modifiers, then buttons at the last position", () => {
  const h = new HeldInput();
  h.keyDown("ControlLeft");
  h.keyDown("KeyA");
  h.buttonDown("left", 0.2, 0.3);
  h.point(0.4, 0.5);
  assert.ok(h.dragging);
  assert.deepEqual(h.releaseAll(), [
    { t: "key", code: "KeyA", down: false },
    { t: "key", code: "ControlLeft", down: false },
    { t: "button", x: 0.4, y: 0.5, button: "left", down: false },
  ]);
  assert.deepEqual(h.releaseAll(), []);
  assert.deepEqual(h.buttonUp("left", 0, 0), []);
});

test("Ctrl acts as Command from Windows and Linux; keys pass through from a Mac", () => {
  for (const code of ["ControlLeft", "MetaLeft", "KeyC", "ShiftLeft"]) assert.equal(remoteCode(code, true), code);
  assert.equal(remoteCode("ControlLeft", false), "MetaLeft");
  assert.equal(remoteCode("ControlRight", false), "MetaRight");
  assert.equal(remoteCode("MetaLeft", false), "ControlLeft");
  assert.equal(remoteCode("KeyC", false), "KeyC");
  // Ctrl+C from Windows: Command down, C down, then Command up releases C (macOS sends no C up).
  const h = new HeldInput();
  h.keyDown(remoteCode("ControlLeft", false));
  h.keyDown(remoteCode("KeyC", false));
  assert.deepEqual(h.keyUp(remoteCode("ControlLeft", false)), [
    { t: "key", code: "KeyC", down: false },
    { t: "key", code: "MetaLeft", down: false },
  ]);
  assert.deepEqual(h.keyUp("KeyC"), []);
});
