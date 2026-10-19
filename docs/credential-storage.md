# Credential storage

**Scope:** how the mob desktop app stores the device pairing token after `mobd link`.
**Status:** implemented (system keyring preferred; automatic encrypted-file fallback).

## Preferred path

After a successful pair, the device credential is written through the [`keyring`](https://crates.io/crates/keyring) crate:

| OS | Backend |
| --- | --- |
| macOS | Keychain (`apple-native`) |
| Windows | Credential Manager (`windows-native`) |
| Linux | Kernel keyring + Secret Service persistence (`linux-native-sync-persistent`) — GNOME Keyring, KWallet, KeepassXC, etc. via `org.freedesktop.secrets` |

This is the right default on full desktop installs: credentials follow the OS login, can be ACL’d by the platform, and survive app reinstalls of the binary without leaving a custom file behind.

## Automatic file fallback

Secret Service is a **Freedesktop** interface, not Ubuntu-specific, but many environments do not provide it:

- headless / minimal Linux images (CI, containers, some cloud desktops)
- installs without GNOME Keyring / KWallet / another Secret Service provider
- broken or locked D-Bus session

When `keyring` returns a **platform failure** or **no storage access** error (the same class as `Platform secure storage failure: … org.freedesktop.secrets was not provided`), mob **automatically** falls back — no Settings toggle:

1. Creates `credentials/` under the user config directory (`dirs::config_dir()` → e.g. `~/.config/mob/credentials` on Linux).
2. Generates a 32-byte master key in `master.key` (Unix mode `0600`; directory `0700`).
3. Stores an AES-256-GCM encrypted JSON map in `store.enc` (also `0600`). Account names are hashed before use as map keys so paths never embed raw ids.

Subsequent reads try the system keyring first when it still looks available; if the keyring reports “no entry”, the file store is checked as well (so a credential written during an earlier fallback session is still found). When the keyring works again for a **write**, the file copy of that account is removed so there is a single source of truth.

The Log tab records a one-line note the first time the file backend is active; Settings → Machines shows the same when the process has selected the file store. Override the directory for tests with `MOB_CREDENTIALS_DIR`.

## Why not “file only”?

A pure file backend is the most portable across distros, but it is weaker than the OS keychain: any process running as the same user can read `master.key` and decrypt `store.enc`. Keeping Secret Service / Keychain / Credential Manager first preserves the stronger path where it exists; the file store is the compatibility escape hatch for headless and multi-distro installs without a desktop secrets daemon.

## Threat model (file fallback)

| Threat | Mitigation / residual risk |
| --- | --- |
| Other users on the machine | Unix `0600` / `0700` on key and store; not encrypted for cross-user secrecy beyond filesystem permissions. |
| Same-user malware / other same-uid processes | **Not** protected — they can read the master key. Same class of risk as many app-local secret files. Prefer the system keyring when available. |
| Disk theft / cold storage | Master key sits next to ciphertext; this is obfuscation + integrity (AES-GCM), not a passphrase-derived KDF. Unlock-at-login OS keychains are stronger here. |
| Accidental plaintext in git / logs | Tokens are never written to the React persist layer; invite material must not be committed. The encrypted blob must not contain plaintext UTF-8 of the secret (covered by unit tests). |

## Related

- Pairing UX and hard rules: [ui.md](ui.md)
- Product overview auth bullet: [README.md](../README.md)
