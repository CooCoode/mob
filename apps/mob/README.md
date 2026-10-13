# apps/mob

Home Mac **mob** client: dispatch tasks to the office agent, follow what it does step by step, and watch the office desktop — task API from office **`mobd`** (v3) + embedded **[svnc](https://github.com/xrdavies/svnc)**.

Design: [docs/apps-mob-ui.md](../../docs/apps-mob-ui.md) · Stack decision: [ADR 0009](../../docs/adr/0009-app-frontend-react.md) · API: [docs/mobd-v3.md](../../docs/mobd-v3.md)

## Stack

- **Tauri 2** shell (`src-tauri/`): overlay title bar, sidebar vibrancy
- **React 19 + TypeScript 7 + Vite 8**, **Tailwind CSS v4**, shadcn/ui-style components on **Radix** (`src/components/ui`), **lucide** icons
- **TanStack Query** (health, queue, archived sessions) and **Zustand** (machines, layout, preferences — persisted in localStorage)
- `react-markdown` + GFM, **shiki** (core + JS regex engine, curated languages) for code blocks
- **[@xrdavies/svnc](https://www.npmjs.com/package/@xrdavies/svnc)** for the live view

```text
src/
  api/          mobd v3 types and fetch helpers
  lib/chat.ts   conversation lifecycle (framework-free, tested)
  lib/timeline.ts  messages + activities → timeline items (tested)
  lib/vnc.ts    single svnc connection controller
  hooks/        React bindings: chat, health/queue, global /events stream
  store/        app (persisted), composer, log
  components/   sidebar, timeline, composer, preview, settings, ui primitives
```

## Prerequisites (macOS)

1. [Xcode Command Line Tools](https://developer.apple.com/xcode/) / full Xcode
2. [Rust](https://rustup.rs/) stable (`rustup default stable`)
3. Node.js 24+ (npm) — tests run TypeScript directly through Node's type stripping
4. Office side reachable on LAN/VPN: `mobd` (API v3) with Screen Sharing turned on. mobd relays the live view, so no websockify is needed ([ADR 0010](../../docs/adr/0010-vnc-relay-in-mobd.md))

## Configure

```bash
cd apps/mob
cp .env.example .env
# edit MOBD_URL
```

Env values prefill the first **machine**. A machine only needs its **mobd URL**: the live view uses mobd's relay at `<mobd URL>/vnc`. Manage machines (name, mobd URL, macOS user name and password, optional custom VNC WebSocket URL) in **Settings → Machines**, where **Test connection** shows the office readiness checks. Settings from the v1 client are migrated on first start.

| Variable | Meaning |
| --- | --- |
| `MOBD_URL` | Office `mobd` base URL, e.g. `http://192.168.50.86:8080` |
| `VNC_WS_URL` | Optional custom VNC WebSocket. Empty = mobd's relay at `<MOBD_URL>/vnc` |

## Install & run

```bash
cd apps/mob
npm install
npm run dev          # browser prototype at http://localhost:1420
npm run tauri dev    # desktop App (recommended on Mac)
npm run tauri build  # production bundle
```

Checks: `npm test` (conversation lifecycle, reconnect recovery, timeline grouping), `npm run typecheck`, `npm run build`.

## Using the App

- **Sidebar:** conversations of the selected machine, live via mobd's `/events` (running spinner, queue position, failed dot). Right-click or `⋯` to rename (or double-click), pin, archive, delete. Archived conversations are in the collapsible group.
- **Timeline:** your prompts, the agent's replies (markdown), and its steps — screenshots, clicks, typing, shell commands, plans — as expandable cards; three or more consecutive steps fold into a group. Each turn ends with duration, tokens and model; failed turns offer **Retry**. Queued turns show their place in the desktop queue.
- **Composer:** ↵ send, ⇧↵ newline. Attach images (button, paste or drag-and-drop), pick model and reasoning effort (remembered per machine; offered per runner, e.g. `MOBD_CODEX_MODELS` on the office Mac). The send button becomes **Stop** while the agent works.
- **Live view (right):** svnc connection (⏻) or, when not connected, a refreshing `/screen` snapshot. Clicks by the agent flash at their position. Double-click or ⤢ for full screen, `Esc` to return. Below: the desktop queue and the current turn's steps.
- **Title bar:** machine status chip opens the readiness checks (Codex, actuation, Accessibility, Screen Recording, VNC).
- **Shortcuts:** ⌘K command palette · ⌘N new chat · ⌘B sidebar · ⌘⇧B live view · ⌘, settings · ⌘1–9 switch conversation.
- **View / Control:** the thumbnail is always view-only. To drive the office Mac yourself, click **Control** (opens full screen) or use the **View | Control** switch in full screen; your mouse, keyboard and scroll then go to the Mac, and `Esc` goes to the Mac too — switch back to **View** to use `Esc` for leaving. Leaving full screen always returns to View. Control needs a live VNC connection (not the snapshot fallback); switching does not reconnect. To control the logged-in desktop, set the office Mac's **macOS user name** and its account password on the machine: svnc then signs in like Apple's Screen Sharing (ARD, needs `@xrdavies/svnc` ≥ 0.2.0). With only a VNC password, macOS shows its login window and ignores the sign-in there.
- **Auth:** deferred (intranet/VPN only).

Older office daemons (API v2) still work for chat; activities, queue, uploads, model/effort and session management appear once mobd reports API v3 on `/health`.

### CORS note

The UI uses browser `fetch` / `EventSource` against `MOBD_URL`. `mobd` allows `http://localhost:1420`, `http://127.0.0.1:1420`, `tauri://localhost`, and `http://tauri.localhost` by default. For another home-client origin, set `MOBD_CORS_ORIGINS` in the office machine's `scripts/.env` to a comma-separated allowlist (replaces the defaults). Use the origin shown in the error, without a trailing slash; `localhost:1420` here refers to the client UI, even when the office API is on another machine.

After updating office Go code, restart `mobd`; the service script rebuilds `bin/mobd` when Go sources are newer:

```bash
# Office machine, repo root
./scripts/mobd.sh restart
curl -i -H 'Origin: http://localhost:1420' http://127.0.0.1:8080/health
```

The response should include `Access-Control-Allow-Origin: http://localhost:1420`. Then retry Health in the home app; no client rebuild is needed for this server fix.

### Live view troubleshooting

If `@xrdavies/svnc` fails to load or the WebSocket is unreachable, the live view shows the error and falls back to `/screen` snapshots; task dispatch still works. Re-run `npm install` if the package is missing.

## Out of scope

iPhone, auth.
