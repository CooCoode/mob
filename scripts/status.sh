#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"${SCRIPT_DIR}/vnc-status.sh" || true
"${SCRIPT_DIR}/mobd.sh" status || true
