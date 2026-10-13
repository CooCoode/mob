#!/usr/bin/env bash
# Manage mobd on the office Mac: task API, agent runner, actuation (`mobd mcp`)
# and the live-view relay (GET /vnc). Usage: mobd.sh {start|stop|status|restart}
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# scripts/.env (optional, gitignored) is exported to mobd.
if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/.env"
  set +a
fi
MOBD_LISTEN="${MOBD_LISTEN:-:8080}"
MOBD_BIN="${MOBD_BIN:-${ROOT_DIR}/bin/mobd}"
RUN_DIR="${RUN_DIR:-${SCRIPT_DIR}/run}"
MOBD_PID_FILE="${RUN_DIR}/mobd.pid"
MOBD_LOG_FILE="${RUN_DIR}/mobd.log"
mkdir -p "${RUN_DIR}"

is_mobd_running() {
  local pid
  pid="$(cat "${MOBD_PID_FILE}" 2>/dev/null || true)"
  [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null
}

# Empty means mobd's built-in actuation server (`mobd mcp`, ADR 0008).
mobd_mcp_command() {
  echo "${MOBD_MOB_MCP_COMMAND:-}"
}

usage() { echo "Usage: $0 {start|stop|status|restart}" >&2; exit 2; }

start() {
  if is_mobd_running; then
    echo "mobd already running (pid $(cat "${MOBD_PID_FILE}"))"
    return 0
  fi
  rm -f "${MOBD_PID_FILE}"
  local needs_build=0
  if [[ ! -x "${MOBD_BIN}" ]]; then
    needs_build=1
  elif find "${ROOT_DIR}/cmd" "${ROOT_DIR}/internal" -type f -newer "${MOBD_BIN}" -print -quit | grep -q .; then
    needs_build=1
  fi
  if (( needs_build )); then
    command -v go >/dev/null 2>&1 || { echo "mobd binary missing and Go is not installed: ${MOBD_BIN}" >&2; return 1; }
    mkdir -p "$(dirname "${MOBD_BIN}")"
    echo "Building mobd -> ${MOBD_BIN}"
    (cd "${ROOT_DIR}" && go build -o "${MOBD_BIN}" ./cmd/mobd)
  fi
  export MOBD_MOB_MCP_COMMAND="$(mobd_mcp_command)"
  nohup "${MOBD_BIN}" >>"${MOBD_LOG_FILE}" 2>&1 &
  echo $! >"${MOBD_PID_FILE}"
  local port="${MOBD_LISTEN##*:}"
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if ! is_mobd_running; then
      echo "mobd failed to start; see ${MOBD_LOG_FILE}" >&2
      tail -n 30 "${MOBD_LOG_FILE}" >&2 || true
      rm -f "${MOBD_PID_FILE}"
      return 1
    fi
    if ! command -v curl >/dev/null 2>&1 || curl -fsS "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.2
  done
  if ! command -v curl >/dev/null 2>&1 || ! curl -fsS "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
    echo "mobd process started but health check failed; see ${MOBD_LOG_FILE}" >&2
    return 1
  fi
  echo "mobd started (pid $(cat "${MOBD_PID_FILE}")); MCP=${MOBD_MOB_MCP_COMMAND:-built-in (mobd mcp)}"
}

stop() {
  if ! is_mobd_running; then
    rm -f "${MOBD_PID_FILE}"
    echo "mobd not running"
    return 0
  fi
  local pid="$(cat "${MOBD_PID_FILE}")"
  kill "${pid}" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    is_mobd_running || break
    sleep 0.5
  done
  if is_mobd_running; then kill -9 "${pid}" 2>/dev/null || true; fi
  rm -f "${MOBD_PID_FILE}"
  echo "mobd stopped"
}

status() {
  echo "mobd: $(is_mobd_running && echo "RUNNING (pid $(cat "${MOBD_PID_FILE}"))" || echo STOPPED)"
  if [[ -z "$(mobd_mcp_command)" ]]; then
    echo "mob-mcp: built-in (mobd mcp); permissions: curl -s localhost:${MOBD_LISTEN##*:}/health"
  elif [[ "$(mobd_mcp_command)" == */* ]]; then
    echo "mob-mcp: $(mobd_mcp_command)"
    [[ -x "$(mobd_mcp_command)" ]] && echo "  available" || echo "  missing (mobd tasks will fail until installed)"
  else
    echo "mob-mcp: $(mobd_mcp_command)"
    command -v "$(mobd_mcp_command)" >/dev/null 2>&1 && echo "  available" || echo "  missing (mobd tasks will fail until installed)"
  fi
  is_mobd_running
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  restart) stop; start ;;
  *) usage ;;
esac
