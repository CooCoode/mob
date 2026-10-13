#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The live view is relayed by mobd itself (GET /vnc, ADR 0010); vnc.sh is only
# needed for standalone svnc or a custom bridge.
"${SCRIPT_DIR}/mobd.sh" start
