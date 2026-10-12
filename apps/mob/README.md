# apps/mob

Home Mac **mob** client: Grok-like shell (sessions · chat · thumbnail preview) — task dispatch to office **`mobd`** + embedded **[svnc](https://github.com/xrdavies/svnc)**. Human input is temporarily enabled for testing (`viewOnly: false`); restore viewOnly when testing ends.

Plan: [docs/client-phase2-lite.md](../../docs/client-phase2-lite.md) · UI: [docs/apps-mob-ui.md](../../docs/apps-mob-ui.md)

## Stack

- **Tauri 2** shell (`src-tauri/`)
- **Vite + TypeScript** UI (`src/`)
- **svnc** from GitHub (`github:xrdavies/svnc`) — not on the public npm registry yet; `postinstall` builds `dist/`

## Prerequisites (macOS)

1. [Xcode Command Line Tools](https://developer.apple.com/xcode/) / full Xcode
2. [Rust](https://rustup.rs/) stable (`rustup default stable`)
3. Node.js 18+ (npm)
4. Office side reachable on LAN/VPN: `mobd` + VNC WebSocket (websockify). See [docs/vnc-svnc-setup.md](../../docs/vnc-svnc-setup.md)

## Configure

```bash
cd apps/mob
cp .env.example .env
# edit MOBD_URL and VNC_WS_URL
```

Env values prefill a default **machine**. Manage machines (name, `MOBD_URL`, `VNC_WS_URL`, optional password) in **Settings**; persisted in localStorage.

| Variable | Meaning |
| --- | --- |
| `MOBD_URL` | Office `mobd` base URL, e.g. `http://192.168.50.86:8080` |
| `VNC_WS_URL` | WebSocket for svnc, e.g. `ws://192.168.50.86:6080/` |

## Install & run

```bash
cd apps/mob
npm install
```

**Browser prototype** (no Rust / Tauri window):

```bash
npm run dev
# open http://localhost:1420
```

**Desktop App** (recommended on Mac):

```bash
npm run tauri dev
```

Production build:

```bash
npm run tauri build
```

## MVP behavior

- **Left:** sessions / agents grouped by remote machine (localStorage)
- **Center:** chat-style dispatch — `POST /tasks`, cancel, SSE (`GET /tasks/:id/events`)
- **Right:** interactive thumbnail; Expand → App-fullscreen preview; Exit preview returns to the thumbnail
- **Settings:** add/edit machines (`MOBD_URL`, `VNC_WS_URL`, …)
- **Live view:** `SVNCClient.connect(..., { viewOnly: false })` temporarily enables mouse and keyboard input for testing. Click the desktop to type; while it is focused, Escape is sent to the remote machine.
- **Auth:** deferred (intranet/VPN only)

### CORS note

The UI uses browser `fetch` / `EventSource` against `MOBD_URL`. If the browser blocks cross-origin calls, enable CORS on `mobd` (Phase 1 follow-up) or run on the same origin. Tauri webview has the same CORS rules for `fetch`.

### svnc stub

If `postinstall` cannot build svnc, the view pane shows a stub message; task dispatch still works. Re-run `npm install` or build `node_modules/svnc` with `npx tsc -p tsconfig.json` inside that package.

## Out of scope (MVP)

iPhone, auth, permanent human remote input, shipping websockify inside the App.
