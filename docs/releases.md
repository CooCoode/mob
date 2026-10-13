# Releases (macOS Apple Silicon only)

`.github/workflows/release.yml` builds on `macos-15` for arm64. Intel macOS,
Linux and Windows are not distributed. The supported macOS minimum is 13.0.
Local builds use `make app-bundle`; CI embeds the stable `vMAJOR.MINOR.PATCH`
tag version via a Tauri config override. Keep the app identifier
`com.xrdavies.mob` stable across releases. Development package versions can
remain at their current version; published binaries take their version from tags.

## GitHub Actions setup

Create a GitHub environment named **release** (Settings → Environments).
Allow it on version tags and trusted manual workflow runs. Configure these secrets:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64 of a **Developer ID Application** certificate AND private key exported as password-protected `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | The `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | Full identity, e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | Apple account email for notarization |
| `APPLE_PASSWORD` | Apple **app-specific password**, not the account login password |
| `APPLE_TEAM_ID` | Apple Developer team ID |

Export the signing identity from Keychain Access, then encode it locally:

```bash
openssl base64 -A -in /path/to/DeveloperID.p12 -out /tmp/apple-certificate.txt
security find-identity -v -p codesigning
```

Keep these credentials out of Git. CI uses a temporary keychain, signs with
Hardened Runtime, notarizes via Apple, validates the stapled ticket and removes
the keychain. No unsigned fallback is published when credentials are missing.

Enable Actions for this repository and permit the release job's `contents: write`.
`GITHUB_TOKEN` is provided automatically; a personal access token is not needed.
Workflow dependencies use lockfiles (`npm ci`, Cargo `--locked`). Builds do not
copy developer `.env` files; users configure office addresses in App Settings.

## Publish

```bash
git tag v0.4.0
git push origin v0.4.0
```

You may also manually run **Release macOS arm64** with an existing stable tag.
All jobs build the same resolved commit. Only after all jobs succeed does the
workflow create/update a draft GitHub Release with downloads and `SHA256SUMS`.
Check the downloads on a separate Mac, edit the release notes, then publish the
draft as the latest stable release. Reruns may replace draft assets; published
releases cannot be overwritten by this workflow. Use a new version tag for fixes.

The App is distributed as `mob_<version>_darwin_arm64.dmg`. Users drag `mob.app`
into Applications. Signing/notarization needs an Apple Developer membership and
working Apple credentials; local unsigned compilation does not validate that chain.

## Tauri updater setup

Apple code signing and updater signing are independent. Generate one long-lived
updater key pair locally, keep an offline backup, and reuse it for every release:

```bash
mkdir -p ~/.tauri
npm --prefix apps/mob run tauri -- signer generate -w ~/.tauri/mob.key
```

Choose a strong password when prompted. Configure the **release** environment:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `TAURI_SIGNING_PRIVATE_KEY` | Full contents of `~/.tauri/mob.key` (not its path) |
| Secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password chosen when generating the key |
| Variable | `TAURI_UPDATER_PUBLIC_KEY` | Full contents of `~/.tauri/mob.key.pub` (not its path) |

The workflow merges the public key, version, HTTPS endpoint and
`createUpdaterArtifacts: true` into a temporary Tauri config. Developer builds
need no signing key and have no update feed configured. Do not replace the key
pair between releases: installed clients trust the old public key. Store signing
keys independently of the Apple certificate; rotating one does not rotate the other.

For this repository the endpoint is:

```
https://github.com/xrdavies/mob/releases/latest/download/latest.json
```

No separate update server is needed. The release must be publicly downloadable;
do not embed a GitHub token in the App. Forks automatically use their own
`GITHUB_REPOSITORY` endpoint. Every latest release must include the App update
assets, even when only mobd changed. Marking a mobd-only release as latest would
break the feed. Drafts are not visible to the updater until published.

CI generates `latest.json` with version, release date and the `darwin-aarch64`
platform entry. The entry contains the **contents** of the generated `.sig` and
the version-specific HTTPS URL to `mob_<version>_darwin_arm64.app.tar.gz`.
The `.dmg` is the manual install download; the `.app.tar.gz` is the updater payload.
Both the archive and its `.sig` are attached to the same release.

The release App checks once on launch. Settings → About provides a manual retry,
current version and error details. Available updates show a banner; installation
requires confirmation and restarts the App. A running/submitting visible turn
blocks installation. Copy unsent drafts/attachments before confirming. A failed
download/signature check never restarts the App. If installation succeeds but
restart fails, the user is told to quit and reopen. Browser development skips checks.

Before announcing auto-update support, install signed version A from a DMG, publish
higher version B, and verify check → download → signature verification → installation
→ restart on a separate Mac, including a failed/offline check and manual retry.
Apple signing checks alone do not test Tauri's updater signature or this flow.

## mobd download and installation

The same workflow builds **darwin/arm64 with CGO enabled** on macOS, using the Go
version in `go.mod` and the system Apple frameworks. It tests the code, injects
the tag version into `mobd --version`, signs the Mach-O with Developer ID and
Hardened Runtime, submits a ZIP to Apple's notary service, requires `Accepted`,
and packages the unchanged signed executable into
`mobd_<version>_darwin_arm64.tar.gz` with LICENSE and CLI documentation.
The same Apple secrets are used for both products. A bare command-line executable
cannot have a notarization ticket stapled to it; Gatekeeper may need network access
to retrieve its ticket. No quarantine-removal workaround is part of installation.

Users download the archive and `SHA256SUMS` from the same release. For example,
from the directory containing both downloaded files (substitute your version):

```bash
# Verify this exact asset against its release checksum.
awk '$2 == "./mobd_0.4.0_darwin_arm64.tar.gz" {print}' SHA256SUMS > mobd.sha256
test -s mobd.sha256 && shasum -a 256 -c mobd.sha256
# Continue only when the checksum check succeeds.
mkdir -p mobd-download
tar -xzf mobd_0.4.0_darwin_arm64.tar.gz -C mobd-download
codesign --verify --strict --verbose=2 mobd-download/mobd
mkdir -p ~/.local/bin
# On upgrades first stop the old service: ~/.local/bin/mobd stop
install -m 755 mobd-download/mobd ~/.local/bin/mobd
~/.local/bin/mobd --version
~/.local/bin/mobd init       # first install only; existing configs are preserved
~/.local/bin/mobd start
```

Add `~/.local/bin` to your shell's PATH if desired. Edit `~/.mobd/config.json` for
LAN listening, workdir and Codex path before starting. Go/Rust/Node are not needed
on the end user's Mac. Codex CLI, its login, Accessibility/Screen Recording grants
and macOS Screen Sharing remain runtime prerequisites. Configure those under the
same user that runs the LaunchAgent; do not install it as a root service.

An upgrade replaces only the executable after stopping the service. Keep
`~/.mobd/config.json` and the existing conversation snapshot/artifacts. Start again
with `--login` if desired. No self-updater or shell installer is included for mobd;
all runtime operations live in the CLI, as requested.

## First release checklist

- [ ] Create the `release` GitHub environment and six Apple secrets above.
- [ ] Add the two Tauri signing secrets and `TAURI_UPDATER_PUBLIC_KEY` variable.
- [ ] Confirm releases/assets are public and Actions may upload release assets.
- [ ] Push a new stable `vMAJOR.MINOR.PATCH` tag (for example `v0.4.0`).
- [ ] Confirm both macOS jobs pass signing/notarization checks.
- [ ] Inspect the draft: DMG, App updater archive, `.sig`, `latest.json`, mobd tarball, `SHA256SUMS`.
- [ ] Install both on a separate Apple Silicon Mac; verify CLI startup, permissions, Settings connection and live view.
- [ ] Publish the draft as the latest stable release.
- [ ] On the next version, verify an actual App update from the previous signed release.
