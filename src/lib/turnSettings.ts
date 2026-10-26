// Which model and effort the message box shows and sends (mobd docs/mobd-v3.md, "Machine and
// conversation settings"). "" means the default: the machine's for a new chat, the
// conversation's otherwise.

export interface TurnChoice {
  model: string;
  effort: string;
}

/**
 * What the menus show. With mobd settings an open chat shows its conversation's values; a new
 * chat (or an older mobd) shows the draft picked on this device.
 */
export function shownChoice(opts: {
  settings: boolean;
  session?: { model?: string; effort?: string } | null;
  draft?: { model?: string; effort?: string };
}): TurnChoice {
  if (opts.settings && opts.session) return { model: opts.session.model ?? "", effort: opts.session.effort ?? "" };
  return { model: opts.draft?.model ?? "", effort: opts.draft?.effort ?? "" };
}

/** The models offered: the agent's list, plus a value in use that is no longer listed. */
export function menuModels(models: string[], current: string): string[] {
  return current && !models.includes(current) ? [...models, current] : models;
}

/**
 * What a turn sends. mobd fills a new chat from the machine defaults and a later turn from its
 * conversation, so only a draft choice is sent; an older mobd gets the choice on every turn.
 */
export function turnChoice(opts: { settings: boolean; newChat: boolean; shown: TurnChoice; efforts: string[] }): { model?: string; effort?: string } {
  if (opts.settings && !opts.newChat) return {};
  return {
    model: opts.shown.model || undefined,
    effort: opts.shown.effort && opts.efforts.includes(opts.shown.effort) ? opts.shown.effort : undefined,
  };
}

export interface AgentEdit {
  models?: string[];
  defaultModel?: string;
  defaultEffort?: string;
  permissions?: "bypass" | "approve";
}

export interface SettingsEdit {
  rev: number;
  defaultAgent?: string;
  agents?: Record<string, AgentEdit>;
}

/** Applies a change to one agent; empty values mean "not set here", so the fallback applies. */
export function withAgent(s: SettingsEdit, name: string, patch: Partial<Record<keyof AgentEdit, unknown>>): SettingsEdit {
  const next: Record<string, unknown> = { ...s.agents?.[name], ...patch };
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete next[k];
  }
  const agents = { ...s.agents, [name]: next as AgentEdit };
  if (Object.keys(next).length === 0) delete agents[name];
  return { ...s, agents };
}

/** Adds a typed model ID once, trimmed; "" when it is not a valid name. */
export function addModel(models: string[], raw: string): string[] | string {
  const m = raw.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(m)) return "Model names use letters, digits and . _ : / - (no spaces).";
  return models.includes(m) ? models : [...models, m];
}

/** Agents a save would let run without asking that ask today (they need a confirmation). */
export function newlyUnguarded(before: Record<string, { permissions: string }>, after: SettingsEdit, configured: Record<string, string>): string[] {
  return Object.keys(before).filter((name) => {
    const next = after.agents?.[name]?.permissions ?? configured[name];
    return before[name].permissions === "approve" && next === "bypass";
  });
}

/** Where a value comes from, for the settings page. */
export function fromLabel(from: string): string {
  return { app: "set in Mob", config: "from mobd config", agent: "from the agent's own config", builtin: "agent's built-in default" }[from] ?? from;
}
