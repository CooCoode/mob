# apps/mob (stub)

Home Mac **mob** client (product name: mob): task dispatch + embedded svnc (`viewOnly`).

Office daemon stays **`mobd`** under `cmd/mobd`. This folder is the home App only.

**Plan:** [docs/client-phase2-lite.md](../../docs/client-phase2-lite.md)

**Stack (recommended):** Tauri 2 + Vite / TypeScript + npm `svnc`.

**Env (client):** `MOBD_URL`, `VNC_WS_URL`.

UI implementation is intentionally not here yet — docs first; code in a follow-up turn.
