#!/usr/bin/env bash
# Show status of the office websockify bridge.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_env

echo "Config (from env / defaults):"
echo "  VNC target:  ${VNC_HOST}:${VNC_PORT}"
echo "  WS listen:   ${WS_LISTEN_HOST}:${WS_LISTEN_PORT}"
echo "  RUN_DIR:     ${RUN_DIR}"
echo "  PID file:    ${PID_FILE}"
echo "  Log file:    ${LOG_FILE}"
if [[ -n "${VNC_PASSWORD}" ]]; then
  echo "  VNC_PASSWORD: (set)"
else
  echo "  VNC_PASSWORD: (unset)"
fi

if is_running; then
  pid="$(cat "${PID_FILE}")"
  echo "State: RUNNING (pid ${pid})"
  echo "  VNC_WS_URL hint: $(ws_url_hint)"
  if [[ -f "${LOG_FILE}" ]]; then
    echo "  Recent log:"
    tail -n 5 "${LOG_FILE}" | sed 's/^/    /'
  fi
  exit 0
fi

if [[ -f "${PID_FILE}" ]]; then
  echo "State: STOPPED (stale pid file present)"
  exit 1
fi

echo "State: STOPPED"
exit 1
