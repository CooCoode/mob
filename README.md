# MOB

Intranet-deployable remote office agent: an AI agent runs on an **office Mac**, while a **home Mac** and **iPhone** act as a task dispatcher and view-only monitor.

MOB is a private alternative shape to cloud desktop agents (e.g. Manus, Grok Bot). The desktop stays in the office; clients do not host the agent runtime.

## Current status

**Design docs only.** No application runtime is shipped in this repository yet. Architecture, ADRs, and roadmap live under [`docs/`](docs/).

## Relationship to svnc

Screen viewing uses the VNC protocol. The human-facing viewer is the sibling project **[svnc](https://github.com/xrdavies/svnc)** (Simple VNC, MIT, npm package `svnc`). Human sessions connect in **viewOnly** mode.

MOB owns task dispatch, the office runner, and the client shell that embeds svnc. Actuation (opening apps, clicking UI) prefers local computer-use MCP on the office Mac and stays separate from the human viewOnly VNC session.

## High-level architecture

```mermaid
flowchart LR
  subgraph clients [Home Mac / iPhone]
    D[Task dispatcher]
    M[View-only monitor]
  end

  subgraph control [Control plane]
    API[Task API]
  end

  subgraph office [Office Mac]
    R[Runner - Codex first]
    A[Actuation - local MCP]
    V[VNC server]
  end

  D --> API
  API --> R
  R --> A
  M -->|svnc viewOnly| V
  A -.->|fallback optional| V
```

| Layer | Role |
| --- | --- |
| Client | Chat / dispatch tasks; embed or open svnc as monitor |
| Control plane | Thin task API owned by MOB |
| Office runner | Starts with **Codex**; Claude / Grok pluggable later |
| Actuation | Prefer GhostDesk / ControlMCP (local MCP); svnc Automation as fallback |
| View | VNC + svnc; later protocols behind a `DesktopView` abstraction |

## Docs

- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Security notes](docs/security.md)
- ADRs:
  - [0001 — Screen view: VNC + svnc](docs/adr/0001-screen-view-vnc-svnc.md)
  - [0002 — Orchestration: thin custom stack](docs/adr/0002-orchestration-thin-custom.md)
  - [0003 — Actuation: local MCP](docs/adr/0003-actuation-local-mcp.md)
  - [0004 — Runner: Codex first](docs/adr/0004-runner-codex-first.md)

## License

[MIT](LICENSE)
