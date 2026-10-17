/** Tunables for early voice dispatch. Confidence may be missing on some macOS builds. */
export const VOICE_DEFAULTS = {
  /** Fallback silence window when the native silence event is late (ms). */
  silenceMs: 1100,
  minChars: 4,
  /** Treat partials at or above this as safe to early-dispatch when the utterance looks complete. */
  earlyMinConfidence: 0.75,
  /** When Apple does not expose segment confidence, use this for non-final partials. */
  fallbackPartialConfidence: 0.55,
  /** Normalized edit-distance / max(len) above which final vs provisional is a material drift. */
  materialDiffRatio: 0.22,
  /** Pointer held at least this long is hold-to-talk (ms); shorter is click-toggle. */
  holdMs: 280,
};

export function normalizeVoiceText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[。．.！!？?]+$/g, "")
    .toLowerCase();
}

/** Cheap complete-utterance heuristic: terminal punctuation or short imperative. */
export function looksComplete(text: string, minChars = VOICE_DEFAULTS.minChars): boolean {
  const t = text.trim();
  if (t.length < minChars) return false;
  if (/[。！？.!?]$/.test(t)) return true;
  // Chinese / English command openings that already form a usable prompt.
  if (
    /^(打开|关闭|帮我|请|运行|执行|去|把|将|查一下|搜索|打开一下|create|open|run|please|can you|could you)\b/i.test(
      t,
    ) &&
    t.length >= 8 &&
    !/[，,、；;]\s*$/.test(t)
  ) {
    return true;
  }
  // Multi-word phrase without a trailing comma often means the user paused mid-thought finished.
  if (t.split(/\s+/).length >= 5 && !/[，,、]$/.test(t)) return true;
  return false;
}

export function shouldEarlyDispatch(
  text: string,
  confidence: number | undefined,
  opts: { minConfidence?: number; minChars?: number } = {},
): boolean {
  const minConf = opts.minConfidence ?? VOICE_DEFAULTS.earlyMinConfidence;
  const conf = confidence ?? VOICE_DEFAULTS.fallbackPartialConfidence;
  if (!looksComplete(text, opts.minChars)) return false;
  return conf >= minConf || /[。！？.!?]$/.test(text.trim());
}

/** Levenshtein distance; fine for short voice prompts. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!;
  }
  return prev[b.length]!;
}

export function isMaterialDiff(
  provisional: string,
  finalText: string,
  ratio = VOICE_DEFAULTS.materialDiffRatio,
): boolean {
  const a = normalizeVoiceText(provisional);
  const b = normalizeVoiceText(finalText);
  if (a === b) return false;
  const denom = Math.max(a.length, b.length, 1);
  return editDistance(a, b) / denom > ratio;
}
