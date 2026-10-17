#!/usr/bin/env bash
# Thin wrapper: the real guard is scripts/check-no-python.mjs (Node).
# Kept so existing callers (`bash scripts/check-no-python.sh`, CI) keep working.
set -uo pipefail
exec node "$(cd "$(dirname "$0")" && pwd)/check-no-python.mjs" "$@"
