# Office VNC helpers (`scripts/office-vnc`)

Thin **start / stop / status** wrappers around [websockify](https://github.com/novnc/websockify) so the office Mac can bridge **macOS Screen Sharing (RFB/TCP)** to a **WebSocket** URL for [svnc](https://github.com/xrdavies/svnc) and [`apps/mob`](../../apps/mob).

This is **not** inside `mobd`. VNC stays a separate process; these scripts only make install/ops less manual. A future `mobvnc` service can replace them without changing the viewer contract (`VNC_WS_URL`).

Full topology and acceptance B: [docs/vnc-svnc-setup.md](../../docs/vnc-svnc-setup.md).

## Prerequisites (office Mac)

1. **System Settings → General → Sharing → Screen Sharing** — on. Confirm with a native VNC client (`vnc://127.0.0.1` or LAN IP) first.
2. **websockify** on PATH, or install:
   ```bash
   pip3 install websockify
   # or: python3 -m pip install --user websockify
   ```
3. Copy env and edit ports if needed:
   ```bash
   cd scripts/office-vnc
   cp env.example .env
   # edit VNC_HOST / VNC_PORT / WS_LISTEN_* / optional VNC_PASSWORD
   ```

## Commands

Run from anywhere; scripts resolve their own directory.

```bash
./scripts/office-vnc/start.sh    # start bridge in background
./scripts/office-vnc/status.sh   # running? ports? log tail
./scripts/office-vnc/stop.sh     # stop bridge started by start.sh
```

Defaults (override in `.env`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `VNC_HOST` | `127.0.0.1` | Screen Sharing / RFB host |
| `VNC_PORT` | `5900` | RFB TCP port (verify on your Mac) |
| `WS_LISTEN_HOST` | `0.0.0.0` | WebSocket bind (prefer LAN-only / VPN in production) |
| `WS_LISTEN_PORT` | `6080` | WebSocket port for viewers |
| `VNC_PASSWORD` | empty | Optional; for home client `credentials.password` (not passed to websockify) |
| `WEBSOCKIFY_BIN` | empty | Force a binary; else `websockify` or `python3 -m websockify` |

Runtime files (gitignored under `run/`): `websockify.pid`, `websockify.log`.

## Home / apps/mob

After `start.sh`:

```text
VNC_WS_URL=ws://<office-lan-ip-or-hostname>:6080/
```

Use that in [`apps/mob`](../../apps/mob) or svnc with **`viewOnly: true`**. If Screen Sharing uses VNC Auth, pass the same secret as in `.env` `VNC_PASSWORD` to the client (do not commit secrets).

Prefer intranet or VPN. Do not expose raw VNC or an open websockify to the public internet without WSS + access control ([security.md](../../docs/security.md)).

## What these scripts do *not* do

- Enable Screen Sharing for you (GUI / MDM still required once).
- Implement TLS (put nginx/Caddy/SSH/Tailscale in front when off-LAN).
- Replace a future **`mobvnc`** packaged service — scripts are Phase 1 ops helpers only.
