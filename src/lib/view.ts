// Sizes asked of mobd: what the view shows in device pixels, so neither snapshots nor the live
// stream carry pixels the screen cannot display.

/** Device pixels for a CSS length, rounded up to a multiple of 64 so small resizes reuse the size. */
export function devicePixels(css: number, dpr: number): number {
  const px = Math.ceil((css * (dpr || 1)) / 64) * 64;
  return Math.min(Math.max(px, 64), 8192);
}
