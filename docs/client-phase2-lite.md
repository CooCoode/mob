# Phase 2 lite — home Mac client (embed svnc)

**Status:** plan only (docs first). Full UI ships in a later coding turn.  
**Decision (user):** intranet auth is **deferred** until this App work; Phase 1 `MOBD_SHARED_SECRET` stays optional and unset for now.

## Goals

Home Mac first: one small surface that is **remote control + monitor**.

- **Dispatch:** call office `mobd` task API (`POST /tasks`, list/get, SSE, cancel).
- **Monitor:** embed **[svnc](https://github.com/xrdavies/svnc)** with **`viewOnly: true`** (no human mouse/keyboard).
- **Not in MVP:** iPhone, auth/login, human remote input, WebRTC, multi-runner.

## Phase 1 remaining on `mobd` (besides auth)

Skim of current `cmd/mobd` + `internal/` vs [implementation-phase1.md](implementation-phase1.md): scaffold already has task CRUD, cancel, SSE, `/health`, env config, Codex spawn + mob-mcp `-c` injection, and safe fail if Codex is missing.

**Still to finish before calling Phase 1 “done” (auth explicitly out):**

| Area | What’s left |
| --- | --- |
| **Codex path hardening** | Office end-to-end: `POST /tasks` → real `codex exec` + `mob-mcp` drives UI; verify MCP `-c` / args on real Codex CLI; clearer failure messages; optional concurrency limit (one running task); tune sandbox / workdir docs from office findings |
| **Health** | Keep `/health`; extend readiness hints (Codex on `PATH`, `mob-mcp` binary exists) without blocking listen |
| **Config** | Document / optionally add file-based config later; ensure `MOBD_VNC_VIEW_URL` is set for clients; **CORS** (or same-origin static) so a home browser/App can call `mobd` on LAN/VPN |
| **Optional static dispatch page** | `web/` or served by `mobd`: prompt + status + link/embed placeholder — useful before the native shell; skip if lite App lands first |
| **Auth** | **Deferred** — do not block on `MOBD_SHARED_SECRET`; add with App (Phase 2) |

Exit criteria for Phase 1 remain: from home, dispatch a Codex UI task and watch viewOnly VNC (svnc or Screen Sharing for smoke).

## Stack options (home Mac)

| Option | Pros | Cons |
| --- | --- | --- |
| **Tauri 2 + Vite/TypeScript** | Real Mac app; small footprint; webview runs `svnc` npm package as-is; same UI can later wrap iOS or stay web | Rust toolchain on build machine |
| Electron + Vite/TS | Familiar Node packaging | Heavy binary; more update/security surface |
| Swift + WKWebView | Native feel | Awkward npm/`svnc` bundling; two stacks for web+API glue |
| Browser-only Vite shell | Fastest prototype | Not an “App”; windowing/deeplinks weaker |

### Recommendation: **Tauri 2 + Vite / TypeScript**

**One stack for the lite App.** Rationale:

1. **svnc is already a browser library** — the MVP screen is HTML/Canvas + `SVNCClient.connect(..., { viewOnly: true })`; Tauri’s webview is the natural host.
2. **Task API is plain HTTP/SSE** — fetch from the frontend to `MOBD_URL`; no need for Electron’s Node in the renderer.
3. **Mac-first App** without Electron weight; iPhone can reuse the web UI later (Tauri mobile or a thin WKWebView shell) without rewriting monitor logic.
4. Electron only if we hit a hard Tauri/webview gap; Swift-only wastes the svnc investment.

Prototype shortcut (optional, same frontend): run the Vite app in Chrome against LAN `mobd` before wrapping Tauri.

## MVP screens

Single window, two panes (or stacked on small height):

1. **Task pane**
   - Prompt textarea
   - Submit → `POST ${MOBD_URL}/tasks` with `{ "prompt": "..." }`
   - Show task id / status; subscribe to `GET .../tasks/:id/events` (SSE) for logs
   - Cancel button → `POST .../tasks/:id/cancel`
   - Optional: recent task list from `GET /tasks`
2. **Live view pane**
   - Canvas/container for svnc
   - Connect with **`viewOnly: true`** to `VNC_WS_URL` (WebSocket after websockify/WSS)
   - Disconnect / reconnect; never enable human input in MVP
   - If `GET /health` returns `vncViewUrl`, may open/document that URL; primary embed still uses `VNC_WS_URL` for the RFB WebSocket

No chat history persistence required for MVP; in-memory UI state is enough.

## Environment variables (client)

| Variable | Meaning | Example |
| --- | --- | --- |
| `MOBD_URL` | Base URL of office `mobd` task API | `http://192.168.50.86:8080` |
| `VNC_WS_URL` | WebSocket URL for svnc (after websockify / WSS proxy) | `ws://192.168.50.86:6080/` or `wss://…` |

Notes:

- Office side may also set `MOBD_VNC_VIEW_URL` (human-facing page URL). The lite App should prefer explicit `VNC_WS_URL` for the embedded RFB connection.
- VNC password, if any, stays in client local config / OS keychain later — not in the repo.
- Until App auth lands, bind `mobd` to intranet/VPN only ([security.md](security.md)).

## Proposed repo layout (next coding turn)

```text
apps/
  home-lite/           # Tauri 2 + Vite/TS MVP (home Mac)
    src/               # UI: task pane + svnc viewOnly
    src-tauri/         # Tauri shell
    README.md
```

Stub folder may exist with a pointer README only until implementation starts.

## Out of scope for lite MVP

- Intranet auth / tokens (follow-on in Phase 2 with App)
- iPhone client
- Human remote keyboard/mouse
- Shipping websockify inside the App (office still runs VNC + bridge)
- Replacing VNC with WebRTC (`DesktopView` later)

## References

- [svnc](https://github.com/xrdavies/svnc) — `SVNCClient`, `viewOnly`, examples/lite
- [vnc-svnc-setup.md](vnc-svnc-setup.md)
- [cmd/mobd/README.md](../cmd/mobd/README.md)
- [roadmap.md](roadmap.md)
- [implementation-phase1.md](implementation-phase1.md)
