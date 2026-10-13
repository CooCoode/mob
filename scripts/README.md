# Office service script

`mobd.sh` runs **mobd** on the office Mac. mobd is the whole office side of mob: task API, Codex runner, desktop actuation (`mobd mcp`, [ADR 0008](../docs/adr/0008-actuation-in-mobd.md)) and the live-view relay to Screen Sharing (`GET /vnc`, [ADR 0010](../docs/adr/0010-vnc-relay-in-mobd.md)).

```bash
cp scripts/env.example scripts/.env   # once; adjust the LAN bind and options
./scripts/mobd.sh start               # builds bin/mobd when Go sources changed
./scripts/mobd.sh status
./scripts/mobd.sh restart
./scripts/mobd.sh stop
```

Before the first start, on the office Mac:

- Turn on **System Settings → General → Sharing → Screen Sharing** (the live view).
- Grant **Accessibility** and **Screen Recording** to the app that launches `mobd` (Terminal/iTerm when using this script). `GET /health` reports both under `checks`.

The home App only needs the mobd URL, e.g. `http://<office-ip>:8080`.

Runtime files (`mobd.pid`, `mobd.log`) live in `scripts/run/` and are ignored by Git.

Plain svnc without mob still needs a WebSocket bridge such as [websockify](https://github.com/novnc/websockify); see [docs/vnc-svnc-setup.md](../docs/vnc-svnc-setup.md).
