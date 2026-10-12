# Roadmap

Phased delivery. Do not skip the separation of **view** (human) and **actuation** (agent).

## Phase 1 — Prove the loop

- Office Mac: **Go** `mobd` control plane + **Codex** runner with **mob-mcp** (local computer-use MCP); see [implementation-phase1.md](implementation-phase1.md)
- Office Mac: VNC server for the desktop
- Human monitor: **svnc** in viewOnly (separate window / browser is fine)
- Minimal task dispatch via the thin MOB Go API (`POST /tasks`, status, SSE) to start work on the office machine

**Auth:** Phase 1 optional shared secret (`MOBD_SHARED_SECRET`) stays **deferred / unset**. Do not block the loop on intranet auth; rely on intranet/VPN bind. Auth moves to Phase 2 with the App.

**Remaining (non-auth):** Codex path hardening on office Mac via `mobd`, richer `/health` readiness hints, CORS/config for home clients, optional static `web/` dispatch page. Detail: [client-phase2-lite.md](client-phase2-lite.md) (Phase 1 leftover table) and [implementation-phase1.md](implementation-phase1.md).

**Exit criteria:** From home, dispatch a Codex task that drives the office Mac UI, and watch the desktop live over VNC via svnc without sending human input.

## Phase 2 — Productize the client

- Integrate the svnc viewer into MOB clients (home Mac first, then iPhone) — see **[client-phase2-lite.md](client-phase2-lite.md)** (recommended stack: **Tauri 2 + Vite/TS**)
- Unified UX: chat / task list + embedded live desktop (`viewOnly`)
- **Intranet auth and basic audit log land with the App** (not as a Phase 1 gate). Wire tokens/session to `mobd` when the home client exists.

**Exit criteria:** One MOB client surface for dispatch + monitor on home Mac; iPhone usable for the same core flow.

## Phase 3 — View protocol flexibility and optional human input

- Optional `DesktopView` implementation: WebRTC / ScreenCaptureKit (or similar) for lower-latency self-hosted streaming
- Optional human input channel for remote mouse/keyboard — **default off**; most sessions remain watch-only because the agent already actuates
- Human approval gates for sensitive actions

**Exit criteria:** Clients can switch view backends without rewriting task/actuation paths; human control remains an explicit, rare escape hatch.
