# Office Mac manual smoke checklist

Do this **on the office Mac** (and home viewer for step 3) **before** `mobd` exists. Goal: prove Codex + in-repo **`mob-mcp`** can actuate the real desktop, and that humans can watch over VNC via [svnc](https://github.com/xrdavies/svnc) in **viewOnly**.

See [research-computer-use.md](research-computer-use.md) and [ADR 0007](adr/0007-actuation-mob-mcp.md). Codex on the office machine can perform parts of this checklist (install commands, config edits, self-checks). Prefer intranet or VPN; do not expose raw VNC to the public internet ([security](security.md)).

**Out of scope here:** shipping third-party desktop MCPs as product defaults, human remote keyboard/mouse, and `mobd` / the MOB task API.

**Do not** install [nix18/ControlMCP](https://github.com/nix18/ControlMCP) (GPL-3.0; abandoned for MOB’s purposes — [ADR 0006](adr/0006-actuation-controlmcp-first.md) superseded).

## 1. mob-mcp — build, permissions, verify actuation

1. On the office Mac, check out this repo and run **`services/mob-mcp`** once that package exists (stdio MCP under MOB MIT). Until the package lands, you may temporarily spike Codex against an MIT third-party such as [CursorTouch/MacOS-MCP](https://github.com/CursorTouch/MacOS-MCP) **only** to validate Accessibility / Screen Recording — not a product dependency.
2. System Settings → Privacy & Security:
   - Grant **Accessibility** to the MCP host (terminal / binary that launches the server).
   - Grant **Screen Recording** (needed for screenshots / UI observation).
3. Run a smoke check (screenshot + a harmless click or window focus) and confirm the **real** desktop UI changes—not only a text reply.

If Accessibility or Screen Recording is missing, stop and fix permissions before continuing.

## 2. Codex CLI — auth and wire mob-mcp

1. Install the Codex CLI on the office Mac and authenticate (login / API credentials as required by current Codex docs).
2. Add `mob-mcp` to Codex’s MCP configuration (`command` / `args` pointing at `services/mob-mcp`). Restart Codex or reload MCP so the server is listed as available.
3. **Smoke prompt (must drive real UI):** ask Codex to do something observable on the desktop via tools, for example open Safari (or another installed app) and navigate to a known URL, or open TextEdit and type a short unique string.

**Pass:** you see the office UI change accordingly (app opens, URL loads, text appears).  
**Fail:** Codex only describes steps in chat without MCP tool use, or tools error on permissions—fix MCP config and macOS privacy grants, then retry.

`mobd` is **not** required for this step; spawn Codex manually.

## 3. VNC + websockify/WSS + home svnc (viewOnly)

1. On the office Mac, enable a VNC-capable desktop server: **System Settings → General → Sharing → Screen Sharing**, or another VNC server you prefer. Note host, port, and credentials.
2. Bridge VNC to a browser-reachable WebSocket with **websockify** (or equivalent). Prefer **WSS** (TLS) when the path leaves a trusted LAN; keep the service on intranet/VPN ([svnc](https://github.com/xrdavies/svnc) deployment notes).
3. From the **home** Mac (or any machine on the VPN), open [svnc](https://github.com/xrdavies/svnc) against that endpoint with **`viewOnly: true`**.

**Pass:** the office desktop is visible in near real time.  
**Pass (input):** mouse and keyboard from the viewer do **not** control the office Mac.

## 4. Acceptance

| Check | Criterion |
| --- | --- |
| **A — Actuation** | Codex + mob-mcp (or documented temporary MIT spike) changes the office Mac UI (step 2). |
| **B — View-only monitor** | Home svnc shows that desktop; human input is disabled (step 3). |

Both A and B must pass. After that, Phase 1 coding can attach `mobd` to the same `mob-mcp` + VNC path ([implementation-phase1.md](implementation-phase1.md)).

## Notes

- Run install and actuation steps on the **office Mac**; use home only for the svnc viewer (and later task dispatch).
- Prefer **intranet / VPN**; see [security.md](security.md) for exposure rules.
- Third-party MCPs (including GhostDesk) are **not** required for this checklist; see research + ADR 0007.
- **`mobd` is not required yet**—this checklist is the manual vertical slice before the Go control plane.

## References

- [Computer-use research](research-computer-use.md)
- [Phase 1 implementation plan](implementation-phase1.md)
- [Architecture](architecture.md)
- [ADR 0001 — Screen view: VNC + svnc](adr/0001-screen-view-vnc-svnc.md)
- [ADR 0004 — Runner: Codex first](adr/0004-runner-codex-first.md)
- [ADR 0007 — Actuation: in-repo mob-mcp](adr/0007-actuation-mob-mcp.md)
- [svnc](https://github.com/xrdavies/svnc)
