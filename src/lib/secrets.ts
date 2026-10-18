import { invoke, isTauri } from "@tauri-apps/api/core";

// Credentials live in the system keychain; this cache allows synchronous reads for request headers.
// Outside Tauri (browser dev, tests) secrets stay in memory only and are gone after a reload.
const cache = new Map<string, string>();

export const tokenAccount = (machineId: string) => `${machineId}.token`;

export function getSecret(account: string): string | undefined {
  return cache.get(account);
}

/** Reads the given accounts into the cache; returns the accounts that could not be read. */
export async function loadSecrets(accounts: string[]): Promise<string[]> {
  if (!isTauri()) return [];
  const failed: string[] = [];
  await Promise.all(accounts.map(async (account) => {
    try {
      const value = await invoke<string | null>("secret_get", { account });
      if (value) cache.set(account, value);
      else cache.delete(account);
    } catch {
      failed.push(account);
    }
  }));
  return failed;
}

/** Stores a secret; an empty value deletes it. The cache updates before the keychain write. */
export async function setSecret(account: string, value: string): Promise<void> {
  if (!value) return deleteSecret(account);
  cache.set(account, value);
  if (isTauri()) await invoke("secret_set", { account, value });
}

export async function deleteSecret(account: string): Promise<void> {
  cache.delete(account);
  if (isTauri()) await invoke("secret_delete", { account });
}
