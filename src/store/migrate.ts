// Persisted-state migrations for "mob.app"; pure so node tests can run them.

interface StoredMachine {
  id: string;
  vncPassword?: string;
  vncWsUrl?: string;
  needsPairing?: boolean;
}

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
  const s = (state ?? {}) as { machines?: StoredMachine[]; legacySecrets?: Record<string, string>; previewOpen?: boolean };
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
  return s;
}
