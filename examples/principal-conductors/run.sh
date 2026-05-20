#!/usr/bin/env bash
# Wrapper around examples/principal-conductors/run.mjs.
# Ensures the workspace is built (so packages/h2a-cli/dist/bin.js exists),
# then runs the demo.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$REPO_ROOT"
npm --workspaces run build || true
exec node examples/principal-conductors/run.mjs "$@"
