#!/usr/bin/env bash
# Start websockify: WebSocket → TCP VNC (macOS Screen Sharing).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_env
ensure_run_dir

case "${1:-start}" in
  start) ;;
  restart) "${SCRIPT_DIR}/vnc-stop.sh" ;;
  *) echo "Usage: $0 {start|restart}" >&2; exit 2 ;;
esac

if is_running; then
  pid="$(cat "${PID_FILE}")"
  echo "Already running (pid ${pid})."
  echo "  target: ${VNC_HOST}:${VNC_PORT}"
  echo "  listen: ${WS_LISTEN_HOST}:${WS_LISTEN_PORT}"
  echo "  VNC_WS_URL hint: $(ws_url_hint)"
  exit 0
fi

# Stale pid file
if [[ -f "${PID_FILE}" ]]; then
  rm -f "${PID_FILE}"
fi

listen="${WS_LISTEN_HOST}:${WS_LISTEN_PORT}"
target="${VNC_HOST}:${VNC_PORT}"

echo "Starting websockify"
echo "  bridge: ${listen}  →  ${target}"
echo "  log:    ${LOG_FILE}"

run_websockify() {
  if [[ -n "${WEBSOCKIFY_BIN}" ]]; then
    if [[ -x "${WEBSOCKIFY_BIN}" ]]; then
      nohup "${WEBSOCKIFY_BIN}" --heartbeat 30 "${listen}" "${target}" >>"${LOG_FILE}" 2>&1 &
    elif command -v "${WEBSOCKIFY_BIN}" >/dev/null 2>&1; then
      nohup "$(command -v "${WEBSOCKIFY_BIN}")" --heartbeat 30 "${listen}" "${target}" >>"${LOG_FILE}" 2>&1 &
    else
      echo "WEBSOCKIFY_BIN is set but not executable: ${WEBSOCKIFY_BIN}" >&2
      return 1
    fi
  elif command -v websockify >/dev/null 2>&1; then
    nohup "$(command -v websockify)" --heartbeat 30 "${listen}" "${target}" >>"${LOG_FILE}" 2>&1 &
  elif python3 -c "import websockify" >/dev/null 2>&1; then
    nohup python3 -m websockify --heartbeat 30 "${listen}" "${target}" >>"${LOG_FILE}" 2>&1 &
  else
    echo "websockify not found; install it with 'uv tool install websockify' or set WEBSOCKIFY_BIN in scripts/.env" >&2
    return 1
  fi
  echo $! >"${PID_FILE}"
}

run_websockify

# Brief settle + health check
sleep 0.4
if ! is_running; then
  echo "Failed to start. Last log lines:" >&2
  tail -n 30 "${LOG_FILE}" >&2 || true
  rm -f "${PID_FILE}"
  exit 1
fi

pid="$(cat "${PID_FILE}")"
echo "Started (pid ${pid})."
echo "  VNC_WS_URL for apps/mob / svnc: $(ws_url_hint)"
if [[ -n "${VNC_PASSWORD}" ]]; then
  echo "  VNC password is set in .env (use as svnc credentials.password; not printed)."
else
  echo "  VNC_PASSWORD unset — set in .env if Screen Sharing requires VNC Auth."
fi
echo "  Ensure Screen Sharing is on before connecting."
