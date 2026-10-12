# apps/mob

Home Mac **mob** client: Grok-like shell (sessions · chat · thumbnail preview) — task dispatch to office **`mobd`** + embedded **[svnc](https://github.com/xrdavies/svnc)**. Human input is temporarily enabled for testing (`viewOnly: false`); restore viewOnly when testing ends.

Plan: [docs/client-phase2-lite.md](../../docs/client-phase2-lite.md) · UI: [docs/apps-mob-ui.md](../../docs/apps-mob-ui.md)

## Stack

- **Tauri 2** shell (`src-tauri/`)
- **Vite + TypeScript** UI (`src/`)
- **[@xrdavies/svnc](https://www.npmjs.com/package/@xrdavies/svnc)** `^0.1.0` (npm; ships with `dist/`)

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

- **Left:** real conversations from each office mobd, grouped by machine; New chat starts a conversation on the first send. The last selection per machine is remembered locally.
- **Center:** complete user/assistant history from `GET /sessions/:id`; sends reuse `sessionId`, replies arrive as structured SSE messages, and Cancel stops the current turn. Send stays disabled while the turn runs.
- **Right:** interactive thumbnail; Expand → App-fullscreen preview; Exit preview returns to the thumbnail
- **Settings:** add/edit machines (`MOBD_URL`, `VNC_WS_URL`, …)
- **Live view:** `SVNCClient.connect(..., { viewOnly: false })` temporarily enables mouse and keyboard input for testing. Click the desktop to type; while it is focused, Escape is sent to the remote machine.
- **Auth:** deferred (intranet/VPN only)

Requires the matching office mobd (`/health` API version 2). Update/restart the daemon before testing this client; older versions show an upgrade message. History lives in `MOBD_STATE_PATH` on the office host, not in browser storage. Switching conversations, reopening the client and reconnecting restore that history. See [mobd's session API and persistence](../../cmd/mobd/README.md#conversations-and-runner-lifecycle).

Checks: `npm test` covers conversation lifecycle, stale requests, duplicate sends and reconnect recovery; `npm run build` checks TypeScript and the production bundle.

### CORS note

The UI uses browser `fetch` / `EventSource` against `MOBD_URL`. `mobd` allows `http://localhost:1420`, `http://127.0.0.1:1420`, `tauri://localhost`, and `http://tauri.localhost` by default. For another home-client origin, set `MOBD_CORS_ORIGINS` in the office machine's `scripts/.env` to a comma-separated allowlist (replaces the defaults). Use the origin shown in the error, without a trailing slash; `localhost:1420` here refers to the client UI, even when the office API is on another machine.

After updating office Go code, restart `mobd`; the service script rebuilds `bin/mobd` when Go sources are newer:

```bash
# Office machine, repo root
./scripts/mobd.sh restart
curl -i -H 'Origin: http://localhost:1420' http://127.0.0.1:8080/health
```

The response should include `Access-Control-Allow-Origin: http://localhost:1420`. Then retry Health in the home app; no client rebuild is needed for this server fix.

### svnc stub

If `@xrdavies/svnc` fails to load, the view pane shows a stub message; task dispatch still works. Re-run `npm install` (registry package includes `dist/`).

## Out of scope (MVP)

iPhone, auth, permanent human remote input, shipping websockify inside the App.
