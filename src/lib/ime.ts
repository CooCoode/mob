/** The parts of a keydown event that tell whether an input method (Pinyin, Kana…) owns the key. */
export interface ImeKey {
  isComposing?: boolean;
  keyCode?: number;
}

/**
 * Tells whether Enter (or Escape) belongs to an input method rather than the app. Chrome reports
 * the Enter that commits a composition with isComposing; WebKit (Tauri's WKWebView on macOS) ends
 * the composition first and sends that Enter with isComposing false, keyCode 229 at most. So the
 * composition counts as active until the events queued with compositionend have run.
 */
export function imeGuard() {
  let composing = false;
  let ended: ReturnType<typeof setTimeout> | undefined;
  return {
    start(): void {
      clearTimeout(ended);
      composing = true;
    },
    end(): void {
      clearTimeout(ended);
      ended = setTimeout(() => { composing = false; }, 0);
    },
    owns(e: ImeKey): boolean {
      return composing || !!e.isComposing || e.keyCode === 229;
    },
  };
}
