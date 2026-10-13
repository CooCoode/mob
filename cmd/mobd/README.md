# mobd

Phase 1 office control plane: HTTP task API + Codex runner that injects in-repo **mob-mcp**.

See [docs/implementation-phase1.md](../../docs/implementation-phase1.md).

## Build and run (office Mac)

```bash
cd /path/to/mob
go build -o bin/mobd ./cmd/mobd

export MOBD_LISTEN=":8080"
export MOBD_CODEX_BIN="codex"   # or absolute path
export MOBD_CODEX_WORKDIR="$HOME"   # or a dedicated workspace
export MOBD_MOB_MCP_COMMAND="/absolute/path/to/mob/services/mob-mcp/.venv/bin/mob-mcp"
# optional:
# export MOBD_MOB_MCP_ARGS='[]'
# export MOBD_SHARED_SECRET="intranet-token"
# export MOBD_VNC_VIEW_URL="https://office.example/svnc/"
# export MOBD_STATE_PATH="/absolute/path/to/mob-state.json"

./bin/mobd
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

# list
curl -s localhost:8080/tasks | jq .

# get one (replace ID)
curl -s localhost:8080/tasks/TASK_ID | jq .

# SSE events
curl -N localhost:8080/tasks/TASK_ID/events

# resume delivery after event 12 (Last-Event-ID takes precedence over ?after=)
curl -N -H 'Last-Event-ID: 12' localhost:8080/tasks/TASK_ID/events

# cancel
curl -s -X POST localhost:8080/tasks/TASK_ID/cancel | jq .
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
| `MOBD_MOB_MCP_COMMAND` | `mob-mcp` | MCP server command for Codex `-c` injection |
| `MOBD_MOB_MCP_ARGS` | `[]` | JSON array of args |
| `MOBD_SHARED_SECRET` | empty | Optional auth for POST create/cancel — **deferred** until Phase 2 App; leave unset |
| `MOBD_VNC_VIEW_URL` | empty | Returned on tasks / health for svnc viewOnly |
| `MOBD_STATE_PATH` | user config directory + `mob/state.json` | Private conversation snapshot; on macOS: `~/Library/Application Support/mob/state.json` |

## Conversations and runner lifecycle

Update the office **mobd** together with the client. `/health` advertises `apiVersion: 2`; older daemons do not provide conversation history. Old in-memory tasks cannot be recovered after upgrading/restarting.

- `POST /tasks` without `sessionId` creates a conversation and its first turn atomically. With `sessionId`, it continues that conversation; an active turn returns **409**, without adding a user message.
- The first turn uses `codex exec --json`; following turns use `codex exec … resume <threadId> -`. Prompts travel through stdin. Completed `agent_message` items become assistant messages; stderr/tool output stays in debug logs. Replies appear when Codex completes a message item, rather than token by token.
- Conversation IDs, Codex thread IDs, messages and task states are written atomically before acknowledgement/delivery. The file has mode **0600**. Keep it and Codex's own session directory on the office host. Run one mobd writer per state path; this snapshot store is intended for a single office daemon.
- On restart, interrupted turns become **failed** and are never rerun automatically. Completed messages and thread IDs remain available for continuation.
- Cancel returns **202** and keeps the conversation busy until the process stops and output readers finish. SIGINT/SIGTERM also cancels active turns before shutdown.
- Use a service supervisor that cleans up child processes after a hard daemon crash/SIGKILL; otherwise stop any orphaned Codex process before resuming its conversation. Snapshot recovery marks the interrupted turn failed, but cannot stop a process left by a dead daemon.
- SSE events have monotonic per-task `id` fields. `Last-Event-ID` / `?after=` resume in-process replay without duplicating messages. Raw logs are memory-only; after a daemon restart, `GET /sessions/:id` is the authoritative transcript and task snapshot.

The runner follows the session/turn separation and structured message recovery used by [Paseo](https://github.com/getpaseo/paseo/blob/main/packages/server/src/server/agent/providers/codex-app-server-agent.ts) and [Orca](https://github.com/stablyai/orca/blob/main/src/main/codex/codex-app-server-session.ts). MOB keeps the existing CLI runner; app-server RPC is a later option for token deltas or interactive approvals. CLI event and resume behavior follows the [Codex non-interactive documentation](https://developers.openai.com/codex/noninteractive/).
