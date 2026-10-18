// Input for the live desktop (mobd docs/desktop-streaming.md, "Data channels"): browser events
// become small JSON messages with coordinates normalized to the display (0,0 top left, 1,1 bottom
// right). Kept free of the DOM and app imports so it can be tested with node --test.

export type InputMessage =
  | { t: "move"; x: number; y: number }
  | { t: "button"; x: number; y: number; button: Button; down: boolean }
  | { t: "key"; code: string; down: boolean }
  | { t: "text"; text: string }
  | { t: "scroll"; x: number; y: number; dx: number; dy: number };

export type Button = "left" | "middle" | "right";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A point in an object-fit: contain picture of videoWidth × videoHeight inside `box`, normalized
 * and clamped to the picture; `inside` is false over the letterbox bars.
 */
export function normalizePoint(clientX: number, clientY: number, box: Box, videoWidth: number, videoHeight: number) {
  if (!videoWidth || !videoHeight || !box.width || !box.height) return null;
  const scale = Math.min(box.width / videoWidth, box.height / videoHeight);
  const w = videoWidth * scale;
  const h = videoHeight * scale;
  const x = (clientX - box.left - (box.width - w) / 2) / w;
  const y = (clientY - box.top - (box.height - h) / 2) / h;
  const clamp = (v: number) => Math.min(Math.max(v, 0), 1);
  return { x: clamp(x), y: clamp(y), inside: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
}

export function buttonName(button: number): Button | null {
  return button === 0 ? "left" : button === 1 ? "middle" : button === 2 ? "right" : null;
}

/** WheelEvent deltas in pixels, as mobd expects (positive = down/right). */
export function wheelPixels(e: { deltaX: number; deltaY: number; deltaMode: number }, pageHeight: number) {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? pageHeight : 1;
  return { dx: e.deltaX * unit, dy: e.deltaY * unit };
}

const MODIFIERS = new Set(["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight", "CapsLock", "Fn"]);

/**
 * Keys and buttons held on the office Mac, so they can all be released: when control ends, the
 * window loses focus (Cmd-Tab away never delivers the key-up), and when Command goes up, because
 * macOS sends no key-up for keys pressed while Command is held (Cmd-C would leave C down).
 */
export class HeldInput {
  private keys = new Set<string>();
  private buttons = new Set<Button>();
  private last = { x: 0.5, y: 0.5 };

  point(x: number, y: number): void {
    this.last = { x, y };
  }

  keyDown(code: string): InputMessage[] {
    this.keys.add(code);
    return [{ t: "key", code, down: true }];
  }

  keyUp(code: string): InputMessage[] {
    const out: InputMessage[] = [];
    if (code === "MetaLeft" || code === "MetaRight") {
      for (const k of this.keys) {
        if (!MODIFIERS.has(k)) {
          this.keys.delete(k);
          out.push({ t: "key", code: k, down: false });
        }
      }
    }
    if (this.keys.delete(code)) out.push({ t: "key", code, down: false });
    return out;
  }

  buttonDown(button: Button, x: number, y: number): InputMessage[] {
    this.point(x, y);
    this.buttons.add(button);
    return [{ t: "button", x, y, button, down: true }];
  }

  buttonUp(button: Button, x: number, y: number): InputMessage[] {
    this.point(x, y);
    return this.buttons.delete(button) ? [{ t: "button", x, y, button, down: false }] : [];
  }

  holding(button: Button): boolean {
    return this.buttons.has(button);
  }

  get dragging(): boolean {
    return this.buttons.size > 0;
  }

  /** Releases everything: other keys first, then modifiers, then buttons at the last position. */
  releaseAll(): InputMessage[] {
    const keys = [...this.keys].sort((a, b) => Number(MODIFIERS.has(a)) - Number(MODIFIERS.has(b)));
    const out: InputMessage[] = keys.map((code) => ({ t: "key", code, down: false }));
    for (const button of this.buttons) out.push({ t: "button", ...this.last, button, down: false });
    this.keys.clear();
    this.buttons.clear();
    return out;
  }
}
