# ADR 0009: Home App frontend — React + Tailwind + shadcn/ui

## Status

Accepted

## Context

`mob` (Tauri 2 + Vite/TS) started as a lite scaffold: about 850 lines of imperative DOM code in `main.ts`, about 900 lines of hand-written CSS, and one tested logic module (`chat.ts`). It proved the loop, but:

- every visual change touches DOM-building code and global CSS, so polish does not build up;
- there are no components, design tokens, icons, markdown rendering or motion;
- the next features (activity timeline cards, model/effort pickers, attachments, session context menus, setup checklist, command palette) are each a component with local state, which is where vanilla DOM code gets expensive.

The UI should look like a modern agent client (Grok, ChatGPT desktop, Manus) and feel native on macOS.

## Decision

| Concern | Choice |
| --- | --- |
| View library | **React 19** + TypeScript, Vite (already in place) |
| Styling | **Tailwind CSS v4**, CSS variables as design tokens, light and dark |
| Components | **shadcn/ui** (copied-in Radix primitives): Dialog, DropdownMenu, ContextMenu, Tooltip, Tabs, ScrollArea, Command (⌘K), Sonner toasts |
| Icons | **lucide-react** |
| Markdown | `react-markdown` + `remark-gfm`; code highlighting with `shiki` |
| Server state | **TanStack Query** for REST snapshots; a small SSE layer pushes into the query cache |
| UI state | **Zustand** (selected machine/session, layout, preview mode) |
| Domain logic | Keep `chat.ts` as framework-free, unit-tested logic (turn lifecycle, dedup, recovery). React calls into it. |
| API types | Typed client in `src/api/` mirroring [mobd-v3.md](https://github.com/xrdavies/mobd/blob/main/docs/mobd-v3.md); generated from OpenAPI once the spec exists |
| Native chrome | Tauri `titleBarStyle: "Overlay"` + `hiddenTitle`, macOS sidebar vibrancy via `window-vibrancy` |
| svnc | Unchanged: `@xrdavies/svnc` mounted inside a React component that owns the RFB lifecycle |

## Consequences

- Migrate in two steps. First port to React with the same look and behaviour (a reviewable diff, existing tests keep passing). Then apply the new design from [ui.md](../ui.md).
- The bundle grows (React + Radix + markdown/shiki, roughly 300–500 KB gzipped). That is acceptable for a desktop Tauri app; shiki languages are loaded lazily.
- shadcn components live in the repo (`src/components/ui`) and are owned and edited locally, not imported as a versioned dependency.
- The iPhone client can reuse the same React code through a Tauri mobile target or a PWA. That choice is deferred.
