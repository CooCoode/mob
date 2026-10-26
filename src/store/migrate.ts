// Persisted-state migrations for "mob.app"; pure so node tests can run them.

import { withAddresses } from "../lib/machines.ts";

interface StoredMachine {
  id: string;
  vncPassword?: string;
  vncUsername?: string;
  vncWsUrl?: string;
  needsPairing?: boolean;
}

/** Keychain account of the Desktop sign-in password, removed with VNC in v5. */
export const vncPasswordAccount = (machineId: string) => `${machineId}.vncPassword`;

/**
 * Takes passwords out of machine records. They wait in legacySecrets, which stays persisted
 * until the keychain write succeeds, so a failed or interrupted write cannot lose them.
 */
export function extractSecrets<M extends StoredMachine>(machines: M[], legacySecrets: Record<string, string> = {}): {
  machines: (Omit<M, "vncPassword"> & { id: string })[];
  legacySecrets: Record<string, string>;
} {
  const secrets = { ...legacySecrets };
  const stripped = machines.map((machine) => {
    const { vncPassword, ...m } = machine;
    if (vncPassword) secrets[`${machine.id}.vncPassword`] = vncPassword;
    return m;
  });
  return { machines: stripped, legacySecrets: secrets };
}

export function migrateApp(state: unknown, version: number): unknown {
  const s = (state ?? {}) as { machines?: StoredMachine[]; legacySecrets?: Record<string, string>; previewOpen?: boolean; turnPrefs?: unknown };
  // v6 drops the per-device model and effort: mobd's machine and conversation settings replace them.
  if (version < 6) delete s.turnPrefs;
  // v4 hides the desktop panel until the user opens it; it used to be open by default.
  if (version < 4) s.previewOpen = false;
  if (!Array.isArray(s.machines)) return s;
  // v2 drops the custom VNC WebSocket URL: the live view always goes through mobd.
  if (version < 2) s.machines = s.machines.map(({ vncWsUrl: _, ...m }) => m);
  // v3 moves passwords to the keychain; machines from before pairing have no credential yet.
  if (version < 3) {
    const { machines, legacySecrets } = extractSecrets(s.machines, s.legacySecrets);
    s.machines = machines.map((m) => ({ ...m, needsPairing: true }));
    s.legacySecrets = legacySecrets;
  }
  // v5 removes VNC: no Desktop sign-in user, and a password still waiting for the keychain is dropped
  // (the keychain copies are deleted at load, see loadMachineSecrets).
  if (version < 5) {
    s.machines = s.machines.map(({ vncUsername: _, ...m }) => m);
    s.legacySecrets = Object.fromEntries(Object.entries(s.legacySecrets ?? {}).filter(([k]) => !k.endsWith(".vncPassword")));
  }
  // v7 gives each machine a list of addresses (each paired on its own) and a chosen route.
  if (version < 7) s.machines = s.machines.map((m) => withAddresses(m as unknown as Record<string, unknown> & { id: string }) as unknown as StoredMachine);
  return s;
}
