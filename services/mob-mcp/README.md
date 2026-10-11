# mob-mcp

In-repo **stdio MCP** server for office Mac desktop actuation (screenshots, clicks, typing, keys, window list / open app).

**Status:** planned — implementation not started. Design authority:

- [docs/research-computer-use.md](../../docs/research-computer-use.md)
- [docs/adr/0007-actuation-mob-mcp.md](../../docs/adr/0007-actuation-mob-mcp.md)

## Phase 1 MVP tools

| Tool | Purpose |
| --- | --- |
| `screenshot` | Capture primary display; return image + scale metadata |
| `click` | Click at coordinates |
| `type_text` | Type Unicode text |
| `key` | Key press with modifiers |
| `list_windows` | Visible windows (app, title, bounds, pid) |
| `open_app` | Launch application by name or bundle id |

## Runtime

- Language (MVP): Python 3.11+
- Transport: MCP over **stdio** (Codex / `mobd` spawn)
- Permissions: macOS **Accessibility** + **Screen Recording**

Do not depend on [nix18/ControlMCP](https://github.com/nix18/ControlMCP) (see research).
