// Which model and effort the message box shows and sends, and edits to settings.json (mobd
// docs/mobd-v3.md, "Settings"). "" means the default from settings.json.

export interface TurnChoice {
  model: string;
  effort: string;
}

/** What the menus show: an open chat its conversation's values, a new chat this device's draft. */
export function shownChoice(session: { model?: string; effort?: string } | null | undefined, draft?: { model?: string; effort?: string }): TurnChoice {
  const from = session ?? draft;
  return { model: from?.model ?? "", effort: from?.effort ?? "" };
}

/** The models offered: the agent's list, plus a value in use that is no longer listed. */
export function menuModels(models: string[], current: string): string[] {
  return current && !models.includes(current) ? [...models, current] : models;
}

export interface AgentEdit {
  models: string[];
  defaultModel: string;
  defaultEffort: string;
  permissions: "bypass" | "approve";
}

export interface SettingsEdit {
  rev: number;
  defaultAgent: string;
  agents: Record<string, AgentEdit>;
}

/** Applies a change to one agent's settings. */
export function withAgent(s: SettingsEdit, name: string, patch: Partial<AgentEdit>): SettingsEdit {
  return { ...s, agents: { ...s.agents, [name]: { ...s.agents[name], ...patch } } };
}

/** Adds a typed model ID once, trimmed; an error message when it is not a model name. */
export function addModel(models: string[], raw: string): string[] | string {
  const m = raw.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(m)) return "Model names use letters, digits and . _ : / - (no spaces).";
  return models.includes(m) ? models : [...models, m];
}

/** Agents a save would let run without asking that ask today (they need a confirmation). */
export function newlyUnguarded(before: SettingsEdit, after: SettingsEdit): string[] {
  return Object.keys(before.agents).filter((n) => before.agents[n].permissions === "approve" && after.agents[n]?.permissions === "bypass");
}

/** What to tell the user about an agent that is not ready on the machine. */
export function agentStateLabel(state: string): string {
  return { disabled: "Installed, not enabled", missing: "Not installed", error: "Not working" }[state] ?? state;
}
