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
