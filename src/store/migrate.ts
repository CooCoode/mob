// Persisted-state migrations for "mob.app"; pure so node tests can run them.

import { withAddresses } from "../lib/machines.ts";

interface StoredMachine {
  id: string;
  needsPairing?: boolean;
}

export function migrateApp(state: unknown, version: number): unknown {
  const s = (state ?? {}) as { machines?: StoredMachine[]; previewOpen?: boolean; turnPrefs?: unknown };
  // v6 drops the per-device model and effort: mobd's machine and conversation settings replace them.
  if (version < 6) delete s.turnPrefs;
  // v4 hides the desktop panel until the user opens it; it used to be open by default.
  if (version < 4) s.previewOpen = false;
  if (!Array.isArray(s.machines)) return s;
  // v3: machines from before pairing have no credential yet.
  if (version < 3) s.machines = s.machines.map((m) => ({ ...m, needsPairing: true }));
  // v7 gives each machine a list of addresses (each paired on its own) and a chosen route.
  if (version < 7) s.machines = s.machines.map((m) => withAddresses(m as unknown as Record<string, unknown> & { id: string }) as unknown as StoredMachine);
  return s;
}
