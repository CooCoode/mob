#!/usr/bin/env bash
# Shared helpers for office VNC ↔ WebSocket bridge scripts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

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
  MOBD_BIN="${MOBD_BIN:-${ROOT_DIR}/bin/mobd}"
  MOBD_RUN_DIR="${MOBD_RUN_DIR:-${RUN_DIR}}"
  MOBD_PID_FILE="${MOBD_RUN_DIR}/mobd.pid"
  MOBD_LOG_FILE="${MOBD_RUN_DIR}/mobd.log"

  PID_FILE="${RUN_DIR}/websockify.pid"
  LOG_FILE="${RUN_DIR}/websockify.log"
}

ensure_run_dir() {
  mkdir -p "${RUN_DIR}" "${MOBD_RUN_DIR}"
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

is_mobd_running() {
  if [[ ! -f "${MOBD_PID_FILE}" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "${MOBD_PID_FILE}" 2>/dev/null || true)"
  [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null
}

# Empty means mobd's built-in actuation server (`mobd mcp`, ADR 0008).
mobd_mcp_command() {
  echo "${MOBD_MOB_MCP_COMMAND:-}"
}

ws_url_hint() {
  local host_display="${WS_LISTEN_HOST}"
  if [[ "${WS_LISTEN_HOST}" == "0.0.0.0" || "${WS_LISTEN_HOST}" == "::" ]]; then
    host_display="<office-lan-ip-or-hostname>"
  fi
  echo "ws://${host_display}:${WS_LISTEN_PORT}/"
}
