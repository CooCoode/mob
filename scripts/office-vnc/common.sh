#!/usr/bin/env bash
# Shared helpers for office VNC ↔ WebSocket bridge scripts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

load_env() {
  local env_file="${SCRIPT_DIR}/.env"
  if [[ -f "${env_file}" ]]; then
    # shellcheck disable=SC1090
    set -a
    source "${env_file}"
    set +a
  fi

  VNC_HOST="${VNC_HOST:-127.0.0.1}"
  VNC_PORT="${VNC_PORT:-5900}"
  WS_LISTEN_HOST="${WS_LISTEN_HOST:-0.0.0.0}"
  WS_LISTEN_PORT="${WS_LISTEN_PORT:-6080}"
  VNC_PASSWORD="${VNC_PASSWORD:-}"
  WEBSOCKIFY_BIN="${WEBSOCKIFY_BIN:-}"
  RUN_DIR="${RUN_DIR:-${SCRIPT_DIR}/run}"

  PID_FILE="${RUN_DIR}/websockify.pid"
  LOG_FILE="${RUN_DIR}/websockify.log"
}

ensure_run_dir() {
  mkdir -p "${RUN_DIR}"
}

resolve_websockify() {
  if [[ -n "${WEBSOCKIFY_BIN}" ]]; then
    if [[ -x "${WEBSOCKIFY_BIN}" ]] || command -v "${WEBSOCKIFY_BIN}" >/dev/null 2>&1; then
      echo "${WEBSOCKIFY_BIN}"
      return 0
    fi
    echo "WEBSOCKIFY_BIN is set but not executable: ${WEBSOCKIFY_BIN}" >&2
    return 1
  fi
  if command -v websockify >/dev/null 2>&1; then
    command -v websockify
    return 0
  fi
  if python3 -c "import websockify" >/dev/null 2>&1; then
    echo "python3 -m websockify"
    return 0
  fi
  echo "websockify not found. Install with: pip3 install websockify" >&2
  echo "Or set WEBSOCKIFY_BIN in scripts/office-vnc/.env" >&2
  return 1
}

is_running() {
  if [[ ! -f "${PID_FILE}" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [[ -z "${pid}" ]]; then
    return 1
  fi
  if kill -0 "${pid}" 2>/dev/null; then
    return 0
  fi
  return 1
}

ws_url_hint() {
  local host_display="${WS_LISTEN_HOST}"
  if [[ "${WS_LISTEN_HOST}" == "0.0.0.0" || "${WS_LISTEN_HOST}" == "::" ]]; then
    host_display="<office-lan-ip-or-hostname>"
  fi
  echo "ws://${host_display}:${WS_LISTEN_PORT}/"
}
