// The computer mob runs on. macOS gets ⌘ and the window chrome it was designed with; Windows and
// Linux get Ctrl and native decorations.

export const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

/** The shortcut modifier as shown in hints: "⌘" on macOS, "Ctrl" elsewhere. */
export const MOD = isMac ? "⌘" : "Ctrl";

/** A shortcut hint, e.g. shortcut("B") → "⌘B" or "Ctrl+B"; shortcut("B", true) adds Shift. */
export function shortcut(key: string, shift = false): string {
  return isMac ? `${shift ? "⇧" : ""}⌘${key}` : `Ctrl+${shift ? "Shift+" : ""}${key}`;
}
