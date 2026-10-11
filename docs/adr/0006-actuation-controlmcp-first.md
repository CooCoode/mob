# ADR 0006: Actuation — ControlMCP first

## Status

Accepted

## Context

[ADR 0003](0003-actuation-local-mcp.md) prefers local computer-use MCP on the office Mac over driving the UI only through the human VNC session. Concrete MCP options under discussion include [ControlMCP](https://github.com/nix18/ControlMCP) and GhostDesk.

MOB needs the agent to operate **real applications on the office Mac desktop** (not a cloud VM). Phase 1 should pick one default to reduce install and runner-config surface area.

- **ControlMCP** focuses on controlling the current machine (screenshot, window/input tooling, related skills) without requiring a Docker virtual-desktop path.
- **GhostDesk** offers local binary control and also a Docker/virtual-desktop style path; useful later, but more product surface than needed to prove the loop.

## Decision

- Use **ControlMCP** as the **Phase 1 default** local actuation MCP on the office Mac.
- Keep GhostDesk (and other MCP servers) as **optional, config-selected** alternatives later — runner config should not hard-code forever to a single binary name.
- Do not change ADR 0003: human viewOnly VNC stays separate; svnc Automation remains fallback, not the Phase 1 default.

## Consequences

- Office install checklist and `mobd` config examples point at ControlMCP first.
- Codex runner injects ControlMCP into the MCP configuration passed to Codex.
- Switching MCP later is a configuration and adapter concern, not a client protocol change.
