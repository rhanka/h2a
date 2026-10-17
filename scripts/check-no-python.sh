#!/usr/bin/env bash
# Zero-Python guard (owner standing rule: 0 Python in repos and jobs).
# Fails on any tracked `*.py` file or any python/pip command invocation outside
# the explicit owner-approved allowlist in scripts/no-python-allowlist.txt.
# Usage: bash scripts/check-no-python.sh   (CI gate: `zero-python` job)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ALLOW="$ROOT/scripts/no-python-allowlist.txt"
rc=0

# 1) No tracked Python sources.
pyfiles="$(git -C "$ROOT" ls-files '*.py' || true)"
if [ -n "$pyfiles" ]; then
  echo "✗ tracked Python files (zero-Python rule):"
  printf '%s\n' "$pyfiles"
  rc=1
fi

# 2) No invocations: python/pip shebangs, or python/pip used as a command.
# Full-line `#` comments are not invocations (`#!` shebangs still checked).
hits="$(git -C "$ROOT" grep -nE -e '#!.*python' -e '(^|[[:space:];{}()|&])(python3?|pip3?)([[:space:]]|$)' -- . 2>/dev/null | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#' || true)"
unexcused="$hits"
if [ -f "$ALLOW" ]; then
  while IFS= read -r entry || [ -n "$entry" ]; do
    case "$entry" in ''|'#'*) continue ;; esac
    file="${entry%%|*}"; lit="${entry#*|}"
    unexcused="$(printf '%s\n' "$unexcused" | awk -v F="$file" -v L="$lit" 'BEGIN{FS=":"} {line=$0; f=$1; sub(/^[^:]*:[0-9]+:/,"",line); if (!(f==F && index(line,L))) print}' || true)"
  done < "$ALLOW"
fi
if [ -n "$unexcused" ]; then
  echo "✗ Python invocations outside the allowlist ($ALLOW):"
  printf '%s\n' "$unexcused"
  rc=1
fi

if [ $rc -eq 0 ]; then
  total="$(printf '%s\n' "$hits" | grep -c . || true)"
  echo "✓ ZERO PYTHON OK ($total allowlisted hit(s), 0 unexcused)"
fi
exit $rc
