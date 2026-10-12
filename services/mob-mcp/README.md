# mob-mcp

In-repo **stdio MCP** server for office Mac desktop actuation (screenshots, clicks, typing, keys, window list / open app).

**Status:** Phase 1 MVP (v0.1.0). Design authority:

- [docs/research-computer-use.md](../../docs/research-computer-use.md)
- [docs/adr/0007-actuation-mob-mcp.md](../../docs/adr/0007-actuation-mob-mcp.md)

MIT licensed. **Do not** depend on [nix18/ControlMCP](https://github.com/nix18/ControlMCP) or GhostDesk.

## Phase 1 MVP tools

| Tool | Purpose |
| --- | --- |
| `screenshot` | Capture primary display; PNG + scale / geometry metadata |
| `click` | Click at **point** coordinates (`x`, `y`, `button`, `count`) |
| `type_text` | Type Unicode text (pasteboard + Cmd+V when possible) |
| `key` | Key / chord (`return`, `tab`, `cmd+c`, …) |
| `list_windows` | Visible windows (app, title, bounds, pid) as JSON |
| `open_app` | Launch by app name or bundle id |

## Requirements

- **macOS** office machine (Linux/Windows hosts get a clear unsupported-platform error)
- Python **3.10+**
- System Settings → Privacy & Security:
  - **Accessibility** — terminal / Codex / whatever launches `mob-mcp`
  - **Screen Recording** — same host (for `screenshot`)

Optional: [cliclick](https://github.com/BlueM/cliclick) on `PATH` as a click fallback if Quartz is unavailable.

## Install (office Mac)

From the repo root (or this directory):

```bash
cd services/mob-mcp
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
# or: pip install -e ".[dev]"  # includes pytest
```

With [uv](https://github.com/astral-sh/uv):

```bash
cd services/mob-mcp
uv venv && source .venv/bin/activate
uv pip install -e .
```

Entry points after install:

- `mob-mcp`
- `python -m mob_mcp`

Both speak **MCP over stdio** (do not print logs to stdout).

## Codex MCP config

Point Codex at the installed console script (absolute paths recommended):

```json
{
  "mcpServers": {
    "mob-mcp": {
      "command": "/absolute/path/to/mob/services/mob-mcp/.venv/bin/mob-mcp",
      "args": []
    }
  }
}
```

Or via module:

```json
{
  "mcpServers": {
    "mob-mcp": {
      "command": "/absolute/path/to/mob/services/mob-mcp/.venv/bin/python",
      "args": ["-m", "mob_mcp"]
    }
  }
}
```

Illustrative Codex `config.toml` (path names vary by Codex version):

```toml
[mcp_servers.mob-mcp]
command = "/absolute/path/to/mob/services/mob-mcp/.venv/bin/mob-mcp"
args = []
```

Restart Codex / reload MCP after editing. Then smoke: ask Codex to `open_app` Safari (or TextEdit) and confirm the real desktop UI changes.

## Coordinate space

`screenshot` metadata includes `scale_factor`, `point_width` / `point_height`, and `pixel_*` sizes. **`click(x, y)` uses points** (logical pixels), not raw Retina device pixels.

## Tests

GUI-free tests run on any OS:

```bash
cd services/mob-mcp
source .venv/bin/activate
pip install -e ".[dev]"
pytest
```

Actuation against a live desktop must be run on the office Mac (see [office-smoke-checklist.md](../../docs/office-smoke-checklist.md)).

## Runtime

- Language: Python 3.10+
- SDK: official [`mcp`](https://github.com/modelcontextprotocol/python-sdk) (`FastMCP`, stdio)
- Transport: MCP over **stdio** (Codex / future `mobd` spawn)
- macOS deps (darwin only): Pillow, PyObjC Cocoa + Quartz

## Layout

```text
services/mob-mcp/
  pyproject.toml
  README.md
  src/mob_mcp/
    server.py          # FastMCP tools
    platform_util.py
    tools/
      screenshot.py
      input.py
      windows.py
  tests/
```
