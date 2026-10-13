# Office service scripts

These scripts manage the services that run on the office Mac. Copy `env.example` to `scripts/.env` once and set the LAN bind and ports.

```bash
cp scripts/env.example scripts/.env
./scripts/start.sh          # websockify + mobd
./scripts/status.sh
./scripts/stop.sh
```

Each service can be restarted without touching the other one:

```bash
./scripts/vnc.sh             # start websockify
./scripts/vnc.sh restart
./scripts/vnc-status.sh
./scripts/vnc-stop.sh

./scripts/mobd.sh start
./scripts/mobd.sh status
./scripts/mobd.sh restart
./scripts/mobd.sh stop
```

`mobd.sh` builds `bin/mobd` when needed and starts it with the environment from `scripts/.env`. Desktop actuation is built into the same binary ([ADR 0008](../docs/adr/0008-actuation-in-mobd.md)): Codex starts `bin/mobd mcp` over stdio for each task, so there is no separate daemon or Python environment. Grant **Accessibility** and **Screen Recording** to the app that launches `mobd` (Terminal/iTerm when using these scripts); `GET /health` reports both under `checks`. Set `MOBD_MOB_MCP_COMMAND` only to try an external MCP server.

Runtime files are kept in `scripts/run/` and are ignored by Git. Logs are `websockify.log` and `mobd.log`.

The VNC bridge listens on `WS_LISTEN_HOST:WS_LISTEN_PORT` and forwards only to `VNC_HOST:VNC_PORT`. Use the printed `ws://...` value as `VNC_WS_URL` in the home app. Keep it on a trusted LAN/VPN or put WSS and access control in front of it.
