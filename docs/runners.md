# Runners

A **runner** connects mobd to one agent CLI (Codex today; Claude Code, Gemini, opencode, pi later). mobd never sees an agent's own output format: each runner translates it into neutral events, and the API, store and App only deal with those.

Related: [mobd-v3.md](mobd-v3.md) (API), [ADR 0004](adr/0004-runner-codex-first.md) (Codex first), [ADR 0008](adr/0008-actuation-in-mobd.md) (desktop tools via `mobd mcp`).

## Contract (`internal/runner`)

```go
type Runner interface {
	Info() Info                       // static: name, label, models, efforts, images, resume, cost
	Check(ctx context.Context) Status // installed? version? (shown on /health)
	Start(ctx context.Context, t *task.Task, opts Options, emit EmitFunc) error
}
```

- `Start` runs **one turn** and blocks until it ends. Cancelling `ctx` must stop the agent and its children and return `context.Canceled`.
- The prompt is `t.Prompt`; `t.Model` / `t.Effort` are already validated against `Info()`; `opts.Images` are files to attach; `opts.SaveImage` stores screenshots from tool results.
- `t.ResumeID` is empty for the first turn of a conversation. Otherwise the runner continues that agent conversation.
- A **Registry** holds the enabled runners and the default (`MOBD_DEFAULT_RUNNER`, default `codex`).

### Events a runner emits

| Event | Fields | Meaning |
| --- | --- | --- |
| `resume` | `resumeId` | The agent's opaque handle for continuing this conversation. Emitted once per turn; mobd stores it on the session. |
| `message` | `messageId`, `message` | A finished assistant reply (upserted by ID). |
| `activity` | `activity` | A step: tool call, command, reasoning, plan, file change, web search, notice. Upserted by `id`; `running` → `completed`/`failed`. |
| `usage` | `usage` | Tokens for the turn, plus `costUsd` if the agent reports a price. |
| `log` | `message` | Debug line (memory-only, shown in Settings → Log). |

Returning an error fails the turn with that message.

### Sessions are pinned to a runner

A conversation's `resumeId` only means something to the runner that created it. The first turn records `session.runner`; later turns use the same runner, and asking for another one returns **409** ("start a new chat to switch"). State written before runners existed is migrated on start: `threadId` becomes `resumeId`, and the runner becomes `codex`.

### Shared pieces

- `runner/cli`: runs an agent CLI for one turn (process group, kill on cancel, draining output, line reading). A runner supplies the command line and a `Parser` (`Line`, `Finish`).
- `runner` helpers: `ToolTitle` ("Click (412, 230)"), `CommandTitle`, `SplitMCPName` (`mcp__mob-mcp__click` → `mob-mcp`, `click`), so every agent's steps look the same in the App.
- `runner/runnertest`: the **contract suite**. Each runner's test gives fake-agent scripts in its native format (reply, failure, hang) and the suite checks: info, missing binary, resume/message/step events, prompt delivery, resume and model passed to the agent, failure message, cancel.

## Asking the user (`ask_user`, `request_approval`)

`mobd mcp` offers two tools next to the desktop tools, for every runner:

- `ask_user(question, options?, allow_text?)` returns the user's answer.
- `request_approval(action, details?)` returns approved or denied (with an optional note). Unanswered means **denied**.

How a call travels:

1. When mobd dispatches a turn it creates a per-task secret and passes `MOB_API`, `MOB_TASK_ID` and `MOB_TASK_TOKEN` to the runner as `Options.MCPEnv`. The runner hands them to the mob-mcp server's environment.
2. The tool calls `POST /internal/tasks/{id}/ask` on mobd (token in `X-Mob-Task-Token`). mobd stores a **question** on the turn, marks the turn and session `waiting`, and publishes a `question` event.
3. The App shows a card; `POST /tasks/{id}/questions/{qid}/answer` with `{answer}` or `{approved, answer?}` settles it and the blocked tool call returns.
4. The question becomes `expired` after `MOBD_QUESTION_TIMEOUT` (default 30m), `cancelled` if the turn is cancelled or the agent drops the call, and `expired` on a mobd restart. The turn keeps the desktop while it waits.

Runners also receive `Options.Instructions` (when to ask, which actions need approval) and `Options.ToolTimeout` (question timeout + 1 minute) so the agent's MCP call is not cut off while the user decides.

| Runner | Instructions | Long tool calls | mob-mcp tools allowed without prompts |
| --- | --- | --- | --- |
| `codex` | `-c developer_instructions=…` | `mcp_servers.mob-mcp.tool_timeout_sec` | `mcp_servers.mob-mcp.default_tools_approval_mode="approve"` |

For Codex, approval is a soft gate: the instructions tell it to call `request_approval`, but `codex exec` cannot force it. A hard gate needs the app-server mode.

## Adding a runner

1. `internal/runner/<name>/`: `Info`, `Check` (usually `cli.Version`), `Start` building the command line and a parser for the agent's JSON stream.
2. Map its output to the events above. Desktop tools arrive from `mobd mcp`; use `SplitMCPName` and `ToolTitle`.
3. `contract_test.go` with `runnertest.Run`, plus parser tests against **real captured output**.
4. Register it in `cmd/mobd/main.go` and add its config (`MOBD_<NAME>_BIN`, models).

## Runners

| Name | Command | Resume | Efforts | Images | Cost |
| --- | --- | --- | --- | --- | --- |
| `codex` | `codex exec --json … [resume <id>] -` (prompt on stdin) | ✓ | minimal, low, medium, high, xhigh | ✓ | — |

Codex models offered to clients come from `MOBD_CODEX_MODELS` (`MOBD_MODELS` is still read).
