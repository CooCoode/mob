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

./bin/mobd
```

If `codex` is not on `PATH`, creating a task still works: the runner logs a clear error and marks the task **failed** (safe stub — mobd does not crash).

## curl examples

```bash
# health
curl -s localhost:8080/health | jq .

# create task
curl -s -X POST localhost:8080/tasks \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Use mob-mcp to open Safari"}' | jq .

# list
curl -s localhost:8080/tasks | jq .

# get one (replace ID)
curl -s localhost:8080/tasks/TASK_ID | jq .

# SSE events
curl -N localhost:8080/tasks/TASK_ID/events

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
| `MOBD_SHARED_SECRET` | empty | Optional auth for POST create/cancel |
| `MOBD_VNC_VIEW_URL` | empty | Returned on tasks / health for svnc viewOnly |
