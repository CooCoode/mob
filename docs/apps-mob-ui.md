# apps/mob — UI design (v2)

**Product:** the home Mac **mob** App: dispatch tasks to the office agent, watch what it does, and monitor the office desktop.
**Stack:** Tauri 2 + React 19 + Tailwind v4 + shadcn/ui ([ADR 0009](adr/0009-app-frontend-react.md)), embedding [svnc](https://github.com/xrdavies/svnc).
**Backend:** [mobd v3](mobd-v3.md). Each v2 feature below names the API it depends on.
**Status:** implemented in `apps/mob` 0.2.0 (2026-10-13). Remaining gaps are listed under "Migration plan".

---

## Design principles

1. **The agent's work is the content.** The center column is a timeline of what the agent *did* (screenshots, clicks, typing, commands, plans), with its replies in between. Debug logs never appear in the timeline.
2. **Calm, native, dense.** It should feel like a macOS app: inset traffic lights, a translucent sidebar, system font, 13–14 px UI text, restrained color. Accent color is used only for primary actions and running state.
3. **The desktop is always visible.** The live view is never more than one glance (thumbnail) or one double-click (fullscreen) away.
4. **State is explicit.** Every session row, task and machine shows whether it is queued, running, done, failed or offline, in the same visual language everywhere.
5. **Keyboard first.** ⌘K palette, ⌘N new chat, ⌘↵ send, Esc to close or collapse, ⌘1–9 to switch sessions.

## Hard rules (unchanged from v1)

- Three-column shell: sessions · timeline · preview. Connection settings live only in Settings.
- Human VNC input is opt-in per use: the thumbnail is always **view only**; only the full-size view has a **View | Control** switch, which starts on View and resets to View when full screen closes. The svnc session connects input-capable with `inputMode: "script"` (human events ignored) and switches to `"human"` for control, so no reconnect is needed.
- No auth UI until mobd has auth.
- Machines are first-class; each has its own `mobd` URL, VNC WebSocket URL and optional VNC password.

---

## Layout

```text
┌─●●●──────────────────────────────────────────────────────────────────────────────────┐
│      ⌕ Search  ⌘K           Office-A ● ready · queue 1          ◐  ⚙                 │  title bar (overlay)
├──────────────┬──────────────────────────────────────────┬────────────────────────────┤
│ ▾ Office-A ● │  Open Safari and find flights to Tokyo   │  LIVE ● viewOnly    ⤢  ⏻   │
│   ★ Weekly…  │  ───────────────────────────────────────  │ ┌────────────────────────┐ │
│   ◉ Flights  │  You · 2m                                │ │                        │ │
│     Expense… │  ┌──────────────────────────────────┐    │ │   office desktop       │ │
│     Report…  │  │ Open Safari and find flights …    │    │ │   (svnc thumbnail)     │ │
│ ▸ Office-B ○ │  └──────────────────────────────────┘    │ │        ⊕ last click    │ │
│              │  ▸ ✓ Opened Safari            open_app   │ └────────────────────────┘ │
│              │  ▸ ✓ Screenshot  [▢ thumb]    0.8s       │  1920×1080 · 24 fps        │
│              │  ▸ ✓ Click (412, 230)                    │                            │
│              │  ▸ ◌ Typing "Tokyo"…                     │  QUEUE                     │
│              │                                          │  ▸ Expense report  #1      │
│              │  mob · Codex                             │                            │
│              │  I found three options. The cheapest …   │  STEPS (this turn)         │
│              │  | Airline | Price |                     │  ✓ open_app                │
│              │                                          │  ✓ screenshot              │
│              │ ┌──────────────────────────────────────┐ │  ◌ type_text               │
│              │ │ Ask mob to do something…             │ │                            │
│ ＋ New chat   │ │ 📎  gpt-5.5 ▾  effort: high ▾   ⏎ ■ │ │                            │
│ ⚙ Settings   │ └──────────────────────────────────────┘ │                            │
└──────────────┴──────────────────────────────────────────┴────────────────────────────┘
```

| Region | Width | Contents |
| --- | --- | --- |
| Title bar | 44 px | Traffic lights (overlay), search / ⌘K, active machine status, theme toggle, settings |
| Sidebar | 248 px (resizable 200–360, collapsible ⌘B) | Machines → sessions tree, New chat, Settings |
| Timeline | flexible, content max 760 px centered | Session title, messages + activity cards, composer |
| Preview | 360 px (resizable 280–560, collapsible ⌘⇧B) | Live view, queue, steps of the current turn |

Responsive: below 1100 px the preview collapses to a floating thumbnail at the bottom right of the timeline. Below 800 px the sidebar becomes a drawer.

**Fullscreen preview:** double-click the live view (or ⤢) → the svnc canvas fills the window, with a slim top bar (`Live · viewOnly · Office-A · Esc to exit`) and a bottom-left overlay showing the current step ("Typing 'Tokyo'…"). Esc or double-click returns. The svnc connection is reused, not reconnected.

---

## Components

### Sidebar

- **Machine group:** name, status dot (green ready / amber degraded checks / grey offline), chevron. Hovering shows a `⋯` menu: Edit, Reconnect, Remove.
- **Session row:** title (one line, truncated), relative time ("2m"), state indicator: ◉ spinning ring while running, numbered badge while queued, red dot after failure. Pinned sessions show ★ and sort first.
  - Right click / `⋯`: Rename (inline edit), Pin/Unpin, Archive, Delete (confirm dialog). API: `PATCH`/`DELETE /sessions/{id}`.
  - "Archived" lives in a collapsible group at the bottom of each machine (`GET /sessions?archived=true`).
- Live updates come from `GET /events` (`session`, `session.deleted`, `task`). No polling.

### Timeline

Built by merging `messages` and `activities` from `GET /sessions/{id}`, sorted by time, then extended live from `/tasks/{id}/events`.

| Item | Design |
| --- | --- |
| **User message** | Right-aligned bubble, `bg-muted`, max 80% width, attachments as 64 px thumbnails above the text |
| **Assistant message** | No bubble. Avatar + "mob · Codex" label, markdown body (GFM tables, code blocks with shiki + copy button), hover actions: Copy, Retry turn |
| **Activity card** | Compact row: status icon (spinner / ✓ / ✕), icon per kind, title (`Click (412, 230)`), right-aligned meta (tool name, duration). Click to expand |
| ↳ `tool` | Expanded: arguments as a key/value list, text output in a mono block (collapsed after 12 lines), screenshot artifacts as a zoomable image (click → lightbox) |
| ↳ `command` | `$ command` in mono, output, exit code badge |
| ↳ `reasoning` | Muted italic "Thinking", collapsed by default, summary text when expanded |
| ↳ `plan` | Checklist with progress "2 / 5" |
| ↳ `file_change` | List of paths with added/modified/deleted badges |
| ↳ `notice` | Amber inline notice (Codex config warnings, etc.) |
| **Activity group** | Three or more consecutive activities fold into "▸ 7 steps · 42 s" with the latest step visible. Expanding shows all |
| **Turn footer** | After a finished turn: status pill (only when failed/cancelled), duration, tokens (`usage`), model. A failed turn shows the error message and a Retry button |
| **Queued turn** | Ghost card "Waiting for the desktop · #2 in queue", with a Cancel link |

Scrolling: stick to the bottom while the user is at the bottom. Otherwise show a "↓ New activity" pill.
Empty session: centered greeting + 4 example prompt cards ("Open Safari and …", "Summarize unread Mail", …).

### Composer

- Auto-growing textarea (1–10 rows), placeholder "Ask mob to do something on Office-A…".
- Toolbar: 📎 attach images (picker, drag-and-drop, paste) → `POST /uploads`; **model** dropdown (`health.models`, plus "Default"); **effort** dropdown (`health.efforts`); send ⏎ / stop ■ (stop = `POST /tasks/{id}/cancel`).
- ↵ sends, ⇧↵ adds a newline, IME composition is respected. Send is disabled while the session has a non-terminal turn. The input is kept so the user can edit the next prompt.
- Model and effort are remembered per machine.

### Preview panel

- **Live view:** svnc canvas, aspect-fit, rounded 10 px, header with `LIVE ●` (green connected / grey idle / red error), `viewOnly` badge, expand ⤢, connect/disconnect ⏻. Shows desktop size and fps.
- **Snapshot fallback:** when VNC is disconnected or not configured, show `GET /screen?maxWidth=720` refreshed every 5 s while a turn runs (otherwise on demand), labelled "Snapshot · 12:04:31".
- **Click marker:** when a `click` activity completes, an animated ring is drawn at its point coordinates over the live view, scaled from desktop points to canvas size.
- **Queue:** `GET /queue` + `queue` events. Each queued task shows its session title and position. Click to jump to it.
- **Steps:** a compact list of the current turn's activities, synced with the timeline. Click to scroll the timeline to that card.

### Title bar & ⌘K

- Machine status chip: `Office-A ● ready`. Click opens a popover listing `health.checks` with ✓/✕ and fix hints ("Grant Accessibility to Terminal in System Settings → Privacy").
- ⌘K command palette: switch session, new chat, switch machine, toggle theme, connect/disconnect live view, open settings, search session titles.

### Settings (dialog, 720×560)

| Tab | Contents |
| --- | --- |
| Machines | List + form (name, mobd URL, VNC WS URL, VNC password), **Test connection** runs `/health` and shows the checks list |
| Appearance | Theme (system / light / dark), density (comfortable / compact), font size |
| Log | Raw SSE/debug viewer (filter, pause, clear, copy). Monospace |
| About | App version, mobd `apiVersion`, links |

### First run / setup

With no machines: a centered card "Connect your office Mac" with a URL field. Test runs `/health` and shows the checks list. Save creates the machine. Failed checks link to [office-smoke-checklist.md](office-smoke-checklist.md) steps.

---

## Visual language

**Tokens** (CSS variables, light / dark):

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--background` | `#ffffff` | `#0b0c0f` | Window |
| `--sidebar` | `rgba(246,246,248,.8)` | `rgba(20,21,26,.72)` | Translucent sidebar (vibrancy) |
| `--panel` | `#f7f7f9` | `#121318` | Preview panel, cards |
| `--muted` | `#f1f1f4` | `#1a1c22` | User bubble, inputs |
| `--border` | `#e6e6ea` | `#24262e` | Hairlines (1 px) |
| `--foreground` | `#111216` | `#ececf1` | Text |
| `--muted-foreground` | `#6b6f7b` | `#8a8f9c` | Meta text |
| `--accent` | `#4f46e5` | `#8b85ff` | Primary action, running |
| `--success` / `--warning` / `--danger` | `#16a34a` / `#d97706` / `#dc2626` | `#22c55e` / `#f59e0b` / `#f87171` | Status |

- **Type:** system UI (`-apple-system`, SF Pro). 13 px UI, 14.5 px message body, line height 1.55. Mono: SF Mono / JetBrains Mono 12.5 px.
- **Radius:** 6 px controls, 10 px cards, 14 px composer and bubbles.
- **Spacing:** 4 px grid. Timeline items 12 px apart; activity rows 4 px apart within a group.
- **Motion:** 120–180 ms ease-out for expand/collapse and hover. Running status uses a spinning ring (no pulsing backgrounds). Respect `prefers-reduced-motion`.
- **Status language (everywhere):** queued = grey numbered badge, running = accent spinning ring, succeeded = no badge (silence is success), failed = red ✕, cancelled = grey ⊘.
- **Icons (lucide):** `MousePointerClick` click, `Keyboard` type/key, `Camera` screenshot, `AppWindow` open_app/list_windows, `TerminalSquare` command, `Brain` reasoning, `ListChecks` plan, `FileDiff` file changes, `Globe` web search, `TriangleAlert` notice.

---

## Code structure (target)

```text
apps/mob/src/
  main.tsx                 React root, providers (Query, Theme, Tooltip)
  api/                     mobd client: types (mirror mobd-v3.md), fetchers, SSE helpers
  store/                   Zustand: machines, selection, layout, preferences
  lib/chat.ts              Framework-free turn lifecycle / dedup / recovery (moved from src/chat.ts, tests kept)
  lib/timeline.ts          Merge messages + activities, grouping rules (unit-tested)
  components/ui/           shadcn primitives
  components/sidebar/      MachineGroup, SessionRow, SessionMenu
  components/timeline/     Timeline, UserMessage, AssistantMessage, ActivityCard(+kinds), ActivityGroup, TurnFooter
  components/composer/     Composer, AttachmentTray, ModelPicker, EffortPicker
  components/preview/      LiveView (svnc lifecycle), SnapshotView, ClickMarker, QueueList, StepList
  components/settings/     SettingsDialog + tabs
  components/command/      CommandPalette
```

## Migration plan

Steps 1 and 2 were merged: porting the old CSS to React only to replace it immediately was wasted work, so the React rebuild shipped the v2 design directly.

1. ✅ **Port + restyle:** React + Tailwind + shadcn primitives; tokens, typography, light/dark, sidebar rows and states; `chat.ts` tests kept (now under Node type stripping).
2. ✅ **Native chrome:** Tauri overlay title bar, inset traffic lights, sidebar vibrancy.
3. ✅ **Timeline v2:** markdown, activity cards and groups, turn footer.
4. ✅ **Live data:** global `/events`, queue panel, session menus (rename/pin/archive/delete).
5. ✅ **Composer v2:** attachments, model/effort pickers.
6. ✅ **Preview v2:** snapshot fallback, click marker, steps list, fullscreen overlay.
7. ✅ **Polish:** ⌘K, first-run card, health popover, empty states, keyboard shortcuts.

Not yet done: resizable columns, responsive drawer/floating-thumbnail layouts below 1100 px, density and font-size settings, the click marker over the live VNC canvas has only been verified against snapshots (unit-tested geometry), and the iPhone layout.

Update this doc when the IA changes.

## References

- [mobd-v3.md](mobd-v3.md) · [ADR 0009](adr/0009-app-frontend-react.md) · [client-phase2-lite.md](client-phase2-lite.md) · [vnc-svnc-setup.md](vnc-svnc-setup.md) · [apps/mob/README.md](../apps/mob/README.md)
