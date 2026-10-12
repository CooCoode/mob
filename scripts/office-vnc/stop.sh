#!/usr/bin/env bash
# Stop the office websockify bridge started by start.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_env

if ! is_running; then
  if [[ -f "${PID_FILE}" ]]; then
    echo "Not running (stale pid file removed)."
    rm -f "${PID_FILE}"
  else
    echo "Not running."
  fi
  exit 0
fi

pid="$(cat "${PID_FILE}")"
echo "Stopping websockify (pid ${pid})..."
kill "${pid}" 2>/dev/null || true

# Wait up to ~5s
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if ! kill -0 "${pid}" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

if kill -0 "${pid}" 2>/dev/null; then
  echo "Process still alive; sending SIGKILL."
  kill -9 "${pid}" 2>/dev/null || true
fi

rm -f "${PID_FILE}"
echo "Stopped."
