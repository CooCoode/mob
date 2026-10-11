# Roadmap

Phased delivery. Do not skip the separation of **view** (human) and **actuation** (agent).

## Phase 1 — Prove the loop

- Office Mac: **Codex** runner with local computer-use MCP
- Office Mac: VNC server for the desktop
- Human monitor: **svnc** in viewOnly (separate window / browser is fine)
- Minimal task dispatch (thin MOB control plane or equivalent CLI/API) to start work on the office machine

**Exit criteria:** From home, dispatch a Codex task that drives the office Mac UI, and watch the desktop live over VNC via svnc without sending human input.

## Phase 2 — Productize the client

- Integrate the svnc viewer into MOB clients (home Mac + iPhone)
- Unified UX: chat / task list + embedded live desktop
- Harden task API (auth on intranet, basic audit log)

**Exit criteria:** One MOB client surface for dispatch + monitor on home Mac; iPhone usable for the same core flow.

## Phase 3 — View protocol flexibility and optional human input

- Optional `DesktopView` implementation: WebRTC / ScreenCaptureKit (or similar) for lower-latency self-hosted streaming
- Optional human input channel for remote mouse/keyboard — **default off**; most sessions remain watch-only because the agent already actuates
- Human approval gates for sensitive actions

**Exit criteria:** Clients can switch view backends without rewriting task/actuation paths; human control remains an explicit, rare escape hatch.
