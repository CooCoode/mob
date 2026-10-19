import { invoke, isTauri } from "@tauri-apps/api/core";
import { log } from "@/store/log";

// Credentials live in the system keychain (or encrypted file fallback); this cache allows
// synchronous reads for request headers. Outside Tauri (browser dev, tests) secrets stay in
// memory only and are gone after a reload.
const cache = new Map<string, string>();

let notedFileBackend = false;

export type SecretStorageInfo = {
  backend: "keyring" | "file" | string;
  path?: string | null;
};

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
  await noteSecretBackend();
  return failed;
}

/** Stores a secret; an empty value deletes it. The cache updates before the keychain write. */
export async function setSecret(account: string, value: string): Promise<void> {
  if (!value) return deleteSecret(account);
  cache.set(account, value);
  if (isTauri()) {
    await invoke<string>("secret_set", { account, value });
    await noteSecretBackend();
  }
}

export async function deleteSecret(account: string): Promise<void> {
  cache.delete(account);
  if (isTauri()) await invoke("secret_delete", { account });
}

/** One-line Log note the first time credentials land in the encrypted file fallback. */
export async function noteSecretBackend(): Promise<SecretStorageInfo | null> {
  if (!isTauri()) return null;
  try {
    const info = await invoke<SecretStorageInfo>("secret_storage_info");
    if (info.backend === "file" && !notedFileBackend) {
      notedFileBackend = true;
      const where = info.path ? ` at ${info.path}` : "";
      log(`credentials: system keyring unavailable; using encrypted local file${where}`, "info");
    }
    return info;
  } catch {
    return null;
  }
}

export async function getSecretStorageInfo(): Promise<SecretStorageInfo | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<SecretStorageInfo>("secret_storage_info");
  } catch {
    return null;
  }
}
