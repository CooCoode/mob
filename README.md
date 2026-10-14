# mob desktop

<img src="public/logo.svg" alt="mob Screen Buddy" width="112" />

This repository contains only the macOS desktop app. The office daemon is developed
and released independently in [xrdavies/mobd](https://github.com/xrdavies/mobd).
iOS, Android and the product website live in separate repositories.

Home Mac **mob** client: dispatch tasks to the office agent, follow what it does step by step, and watch the office desktop — task API from office **`mobd`** (v3) + embedded **[svnc](https://github.com/xrdavies/svnc)**.

Design: [docs/ui.md](docs/ui.md) · Stack decision: [ADR 0009](docs/adr/0009-app-frontend-react.md) · API: [docs/mobd-v3.md](https://github.com/xrdavies/mobd/blob/main/docs/mobd-v3.md)

Logo: **Screen Buddy** — editable SVG sources, app icons and regeneration commands are in the [brand guide](docs/brand/README.md).

Distribution: signed DMGs and Tauri updates use the public R2 download domain,
independently of the private source repository. See the [release setup](docs/releases.md).
Once configured, run `make release VERSION=v0.4.0` from a clean `main` matching
`origin/main` to create and push a tag. CI builds a draft Release; test its DMG,
then publish the stable Release on GitHub to distribute it through R2.

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
4. Office side reachable on LAN/VPN: `mobd` (API v3) with Screen Sharing turned on. mobd relays the live view ([VNC setup](https://github.com/xrdavies/mobd/blob/main/docs/vnc-svnc-setup.md))

## Configure

```bash
cp .env.example .env
# edit MOBD_URL
```

Env values prefill the first **machine**. A machine only needs its **mobd URL**: the live view uses mobd's relay at `<mobd URL>/vnc`. Manage machines (name, mobd URL, macOS user name and password) in **Settings → Machines**, where **Test connection** shows the office readiness checks. Settings from the v1 client are migrated on first start.

| Variable | Meaning |
| --- | --- |
| `MOBD_URL` | Office `mobd` base URL, e.g. `http://192.168.50.86:8080` |

## Install & run

```bash
npm ci
npm run dev          # browser prototype at http://localhost:1420
npm run tauri dev    # desktop App (recommended on Mac)
npm run tauri build -- --target aarch64-apple-darwin  # production bundle
```

Checks: `npm test` (conversation lifecycle, reconnect recovery, timeline grouping), `npm run typecheck`, `npm run build`.

## Using the App

- **Sidebar:** conversations of the selected machine, live via mobd's `/events` (running spinner, queue position, failed dot). Right-click or `⋯` to rename (or double-click), pin, archive, delete. Archived conversations are in the collapsible group.
- **Timeline:** your prompts, the agent's replies (markdown), and its steps — screenshots, clicks, typing, shell commands, plans — as expandable cards; three or more consecutive steps fold into a group. Each turn ends with duration, tokens and model; failed turns offer **Retry**. Queued turns show their place in the desktop queue.
- **Questions from the agent:** when the agent needs a decision (`ask_user`) or wants approval before a risky action (`request_approval`), a card appears in the timeline with the options, a text box, or **Approve / Deny** with an optional note. The conversation shows a **?** badge in the sidebar, the window title shows the count, and a toast appears (Settings → Appearance can enable system notifications). The turn keeps the desktop while it waits; unanswered questions time out on the office Mac (`MOBD_QUESTION_TIMEOUT`, default 30 min) and unanswered approvals count as denied.
- **Agent:** a new chat can use any agent the office Mac has (Codex, Claude Code); pick it in the composer. A conversation keeps its agent; start a new chat to switch. Model and effort are remembered per agent, and Claude turns show their cost.
- **While the agent works:** with Codex (app-server mode) you can type in the composer and press ↵ to add to what it is doing, e.g. "also check the spam folder"; your message appears in the timeline and the agent picks it up in the same turn. **Stop** interrupts the turn. Replies stream in as they are written.
- **Composer:** ↵ send, ⇧↵ newline. Attach images (button, paste or drag-and-drop), pick model and reasoning effort (remembered per machine; offered per runner, e.g. `MOBD_CODEX_MODELS` on the office Mac). The send button becomes **Stop** while the agent works.
- **Live view (right):** svnc connection (⏻) or, when not connected, a refreshing `/screen` snapshot. Clicks by the agent flash at their position. Double-click or ⤢ for full screen, `Esc` to return. Below: the desktop queue and the current turn's steps.
- **Title bar:** machine status chip opens the readiness checks (Codex, actuation, Accessibility, Screen Recording, VNC).
- **Shortcuts:** ⌘K command palette · ⌘N new chat · ⌘B sidebar · ⌘⇧B live view · ⌘, settings · ⌘1–9 switch conversation.
- **View / Control:** the thumbnail is always view-only. To drive the office Mac yourself, click **Control** (opens full screen) or use the **View | Control** switch in full screen; your mouse, keyboard and scroll then go to the Mac, and `Esc` goes to the Mac too — switch back to **View** to use `Esc` for leaving. Leaving full screen always returns to View. Control needs a live VNC connection (not the snapshot fallback); switching does not reconnect. To control the logged-in desktop, set the office Mac's **macOS user name** and its account password on the machine: svnc then signs in like Apple's Screen Sharing (ARD, needs `@xrdavies/svnc` ≥ 0.2.0). With only a VNC password, macOS shows its login window and ignores the sign-in there.
- **Auth:** deferred (intranet/VPN only).

Older office daemons (API v2) still work for chat; activities, queue, uploads, model/effort and session management appear once mobd reports API v3 on `/health`.

### CORS note

The UI uses browser `fetch` / `EventSource` against `MOBD_URL`. `mobd` allows `http://localhost:1420`, `http://127.0.0.1:1420`, `tauri://localhost`, and `http://tauri.localhost` by default. For another home-client origin, set `corsOrigins` in the office machine's `~/.mobd/config.json` to an array of allowed origins (replaces the defaults). Use the origin shown in the error, without a trailing slash; `localhost:1420` here refers to the client UI, even when the office API is on another machine.

After updating the office daemon, restart the installed `mobd`. Developers can use
`make restart` from their separate `mobd` checkout:

```bash
# Office machine
mobd restart
curl -i -H 'Origin: http://localhost:1420' http://127.0.0.1:8080/health
```

The response should include `Access-Control-Allow-Origin: http://localhost:1420`. Then retry Health in the home app; no client rebuild is needed for this server fix.

### Live view troubleshooting

If `@xrdavies/svnc` fails to load or the WebSocket is unreachable, the live view shows the error and falls back to `/screen` snapshots; task dispatch still works. Re-run `npm install` if the package is missing.

## Repository layout and commands

```text
src/            React frontend, API client and tests
src-tauri/      Rust shell, macOS bundle configuration and icons
public/         Browser assets
.github/        Desktop signing, Tauri updater and R2 publication
docs/          UI design, branding, release and migration guides
```

Run commands from this repository root: `make install`, `make dev`, `make desktop`,
`make test`, `make build`, `make bundle`, `make check`, `make release VERSION=vX.Y.Z`.
No Go toolchain or sibling checkout is required to build the desktop app; a running
office daemon is required to dispatch tasks. See [repository split notes](docs/repository-split.md)
for old command mappings and independent release configuration.

## License

[MIT](LICENSE)
