# mobd

Office control plane: HTTP task API + Codex runner. The same binary is the desktop actuation MCP server (`mobd mcp`, [ADR 0008](../../docs/adr/0008-actuation-in-mobd.md)); Codex launches it for each task.

See [docs/implementation-phase1.md](../../docs/implementation-phase1.md).

## Build and run (office Mac)

```bash
cd /path/to/mob
go build -o bin/mobd ./cmd/mobd

export MOBD_LISTEN=":8080"
export MOBD_CODEX_BIN="codex"   # or absolute path
export MOBD_CODEX_WORKDIR="$HOME"   # or a dedicated workspace
# optional:
# export MOBD_MOB_MCP_COMMAND="/path/to/external-mcp"   # default: this binary with args ["mcp"]
# export MOBD_MOB_MCP_ARGS='[]'
# export MOBD_SHARED_SECRET="intranet-token"
# export MOBD_VNC_VIEW_URL="https://office.example/svnc/"
# export MOBD_STATE_PATH="/absolute/path/to/mob-state.json"
# export MOBD_CORS_ORIGINS="http://localhost:1420,https://home.example"

./bin/mobd
```

### Desktop actuation (`mobd mcp`)

`mobd mcp` is a stdio MCP server named `mob-mcp` with the tools `screenshot`, `click`, `type_text`, `key`, `list_windows` and `open_app` (coordinates in points; screenshot returns a PNG plus geometry metadata). It is built with cgo against CoreGraphics, so build on macOS with the Xcode command line tools; other platforms compile stub tools that return a "macOS only" error.

Grant **Accessibility** (click/key/type) and **Screen Recording** (screenshot, window titles) to the app that launches `mobd` — Terminal/iTerm when started from a shell, or `mobd` itself under launchd. `GET /health` reports both under `checks`. To use it from another MCP client:

```json
{ "mcpServers": { "mob-mcp": { "command": "/absolute/path/to/bin/mobd", "args": ["mcp"] } } }
```

If `codex` is not on `PATH`, creating a task still works: the runner logs a clear error and marks the task **failed** (safe stub — mobd does not crash).

## curl examples

```bash
# health
curl -s localhost:8080/health | jq .

# first turn: creates a conversation and returns its sessionId
curl -s -X POST localhost:8080/tasks \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Use mob-mcp to open Safari"}' | jq .

# follow-up: reuse the returned sessionId (never use Codex --last)
curl -s -X POST localhost:8080/tasks \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"SESSION_ID","prompt":"Now open example.com in that window"}' | jq .

# list conversations, then read the full user/assistant transcript and turns
curl -s localhost:8080/sessions | jq .
curl -s localhost:8080/sessions/SESSION_ID | jq .

# list (filters: sessionId, status, limit 1-500)
curl -s 'localhost:8080/tasks?status=running' | jq .

# get one (replace ID)
curl -s localhost:8080/tasks/TASK_ID | jq .

# SSE events
curl -N localhost:8080/tasks/TASK_ID/events

# resume delivery after event 12 (Last-Event-ID takes precedence over ?after=)
curl -N -H 'Last-Event-ID: 12' localhost:8080/tasks/TASK_ID/events

# cancel
curl -s -X POST localhost:8080/tasks/TASK_ID/cancel | jq .
```

v3 additions ([design](../../docs/mobd-v3.md)):

```bash
# per-turn model / reasoning effort / image attachments
curl -s -X POST localhost:8080/uploads -F file=@shot.png | jq .      # → {id, url, …}
curl -s -X POST localhost:8080/tasks -H 'Content-Type: application/json' \
  -d '{"prompt":"What is in this image?","effort":"high","attachments":["UPLOAD_ID"]}' | jq .

# desktop queue (one running task by default)
curl -s localhost:8080/queue | jq .

# session admin
curl -s -X PATCH localhost:8080/sessions/SESSION_ID -d '{"title":"Weekly report","pinned":true}' | jq .
curl -s -X PATCH localhost:8080/sessions/SESSION_ID -d '{"archived":true}' | jq .
curl -s 'localhost:8080/sessions?archived=all' | jq .
curl -s -X DELETE localhost:8080/sessions/SESSION_ID -o /dev/null -w '%{http_code}\n'   # 204, 409 while active

# timeline: messages + activities (tool calls, commands, plans…) + task usage
curl -s localhost:8080/sessions/SESSION_ID | jq '.activities'

# live view: WebSocket relay to Screen Sharing (ADR 0010)
# ws://localhost:8080/vnc   ← svnc / the App connect here

# global live stream (session / session.deleted / task / queue / reset)
curl -N localhost:8080/events

# desktop snapshot without VNC; tool screenshots and uploads
curl -s 'localhost:8080/screen?maxWidth=720' -o screen.jpg
curl -s localhost:8080/artifacts/ARTIFACT_ID -o artifact.png
```

With shared secret:

```bash
curl -s -X POST localhost:8080/tasks \
  -H "Authorization: Bearer $MOBD_SHARED_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"…"}'
```

## Env reference

| Variable | Default | Meaning |
| --- | --- | --- |
| `MOBD_LISTEN` | `:8080` | HTTP bind |
| `MOBD_CODEX_BIN` | `codex` | Codex CLI |
| `MOBD_CODEX_WORKDIR` | process cwd | Codex working directory |
| `MOBD_MOB_MCP_COMMAND` | this `mobd` binary | MCP server command for Codex `-c` injection; empty = built-in `mobd mcp` |
| `MOBD_MOB_MCP_ARGS` | `["mcp"]` when built-in, else `[]` | JSON array of args (external command only) |
| `MOBD_SHARED_SECRET` | empty | Optional auth for POST create/cancel — **deferred** until Phase 2 App; leave unset |
| `MOBD_VNC_VIEW_URL` | empty | Returned on tasks / health for svnc viewOnly |
| `MOBD_STATE_PATH` | user config directory + `mob/state.json` | Private conversation snapshot; on macOS: `~/Library/Application Support/mob/state.json` |
| `MOBD_MAX_RUNNING` | `1` | Tasks running at once across all sessions; others wait in the FIFO desktop queue |
| `MOBD_DATA_DIR` | directory of `MOBD_STATE_PATH` | Root of `artifacts/` (tool screenshots, uploads) |
| `MOBD_QUESTION_TIMEOUT` | `30m` | How long a turn waits for your answer to the agent's question or approval request |
| `MOBD_RUNNERS` | `codex,claude` | Enabled runners |
| `MOBD_CODEX_MODE` | `app-server` | `app-server` (approvals, steering, streaming) or `exec` |
| `MOBD_CODEX_PERMISSIONS` | `bypass` | `approve` makes Codex ask you before commands and file edits |
| `MOBD_CLAUDE_BIN` / `MOBD_CLAUDE_WORKDIR` / `MOBD_CLAUDE_MODELS` | `claude` / Codex's work dir / `opus,sonnet,haiku` | Claude Code runner |
| `MOBD_CLAUDE_PERMISSIONS` | `bypass` | `approve` makes Claude ask you before shell commands and other prompted actions |
| `MOBD_CLAUDE_SETTING_SOURCES` | `project` | Claude settings loaded; `all` includes your personal `~/.claude` |
| `MOBD_DEFAULT_RUNNER` | `codex` | Runner for new conversations ([runners](../../docs/runners.md)) |
| `MOBD_CODEX_MODELS` | empty | Comma-separated Codex model IDs for the App picker (`MOBD_MODELS` is still read for backward compatibility) |
| `MOBD_VNC_ADDR` | `127.0.0.1:5900` | VNC server (macOS Screen Sharing) relayed by `GET /vnc` and checked by `/health` |

## Conversations and runner lifecycle

Update the office **mobd** together with the client. `/health` advertises `apiVersion: 3` with `features`, `runners` (each with models, efforts and readiness), the default runner's `models`/`efforts`, and readiness `checks`; v2 clients keep working because v3 only adds fields and routes. Old in-memory tasks cannot be recovered after upgrading/restarting.

- Every new turn starts `queued`. A FIFO dispatcher runs at most `MOBD_MAX_RUNNING` turns at once so agents never fight over the desktop; queued tasks report `queuePosition`, and cancelling one finishes it without starting Codex. Queued turns are marked failed on restart, like running ones.
- Codex `mcp_tool_call`, `command_execution`, `reasoning`, `todo_list`, `file_change`, `web_search` and `error` items become persisted **activities** (upserted by item ID, text capped at 16 KiB); tool screenshots are saved as artifacts. `turn.completed` usage is stored on the task.
- `POST /tasks` without `sessionId` creates a conversation and its first turn atomically. With `sessionId`, it continues that conversation; an active turn returns **409**, without adding a user message.
- The first turn uses `codex exec --json`; following turns use `codex exec … resume <resumeId> -`. Each conversation is pinned to the runner that started it ([runners](../../docs/runners.md)). Prompts travel through stdin. Completed `agent_message` items become assistant messages; stderr/tool output stays in debug logs. Replies appear when Codex completes a message item, rather than token by token.
- Conversation IDs, runner resume IDs, messages and task states are written atomically before acknowledgement/delivery. The file has mode **0600**. Keep it and Codex's own session directory on the office host. Run one mobd writer per state path; this snapshot store is intended for a single office daemon.
- On restart, interrupted turns become **failed** and are never rerun automatically. Completed messages and resume IDs remain available for continuation.
- Cancel returns **202** and keeps the conversation busy until the process stops and output readers finish. SIGINT/SIGTERM also cancels active turns before shutdown.
- Use a service supervisor that cleans up child processes after a hard daemon crash/SIGKILL; otherwise stop any orphaned Codex process before resuming its conversation. Snapshot recovery marks the interrupted turn failed, but cannot stop a process left by a dead daemon.
- SSE events have monotonic per-task `id` fields. `Last-Event-ID` / `?after=` resume in-process replay without duplicating messages. Raw logs are memory-only and capped at 2000 lines per task; after a daemon restart, `GET /sessions/:id` is the authoritative transcript and task snapshot.

The runner follows the session/turn separation and structured message recovery used by [Paseo](https://github.com/getpaseo/paseo/blob/main/packages/server/src/server/agent/providers/codex-app-server-agent.ts) and [Orca](https://github.com/stablyai/orca/blob/main/src/main/codex/codex-app-server-session.ts). MOB keeps the existing CLI runner; app-server RPC is a later option for token deltas or interactive approvals. CLI event and resume behavior follows the [Codex non-interactive documentation](https://developers.openai.com/codex/noninteractive/).
| `MOBD_CORS_ORIGINS` | `http://localhost:1420,http://127.0.0.1:1420,tauri://localhost,http://tauri.localhost` | Comma-separated exact origins; a nonempty value replaces the defaults |

CORS covers API responses and SSE, plus `OPTIONS` preflight for `GET`/`POST` with `Content-Type`, `Authorization`, or `X-Mob-Token`. Use the client's origin (scheme, host, and port, without a trailing slash), not the office API address. CORS does not replace authentication or LAN/VPN access controls.
