#!/usr/bin/env bash
# End-to-end test for the commit-msg hook: spins up a throwaway git repo wired to
# this .githooks dir and makes REAL `git commit` attempts, asserting that
# co-authorship / AI-generation footers are rejected and clean messages pass.
# Run: bash .githooks/test.sh
set -uo pipefail

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT

git init -q "$sandbox"
git -C "$sandbox" config core.hooksPath "$hook_dir"
git -C "$sandbox" config user.email "test@example.com"
git -C "$sandbox" config user.name "hook test"
# Baseline commit (hook bypassed only to establish a parent for reset).
git -C "$sandbox" commit -q --allow-empty --no-verify -m "baseline"

fail=0
attempt() { # writes a staged change and tries to commit with the given message
  printf '%s\n' "$RANDOM" > "$sandbox/f"; git -C "$sandbox" add f
  git -C "$sandbox" commit -q -m "$1" 2>/dev/null
}
expect_blocked() {
  if attempt "$2"; then
    echo "FAIL: [$1] commit ACCEPTED but should be blocked"; fail=1
    git -C "$sandbox" reset -q --soft HEAD~1
  else
    echo "ok:   [$1] blocked"
  fi
}
expect_allowed() {
  if attempt "$2"; then
    echo "ok:   [$1] allowed"; git -C "$sandbox" reset -q --soft HEAD~1
  else
    echo "FAIL: [$1] clean commit BLOCKED but should pass"; fail=1
  fi
}

# The exact footer a Claude co-authored commit would carry:
expect_blocked "Claude Co-Authored-By trailer" \
  "$(printf 'feat: x\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
expect_blocked "Generated with Claude Code + robot marker" \
  "$(printf 'feat: x\n\n\xf0\x9f\xa4\x96 Generated with [Claude Code](https://claude.com/claude-code)')"
expect_blocked "lowercase co-authored-by (any author)" \
  "$(printf 'feat: x\n\nco-authored-by: someone <a@b.co>')"
expect_allowed "clean single-line message" "chore: routine change"
expect_allowed "clean message with body" \
  "$(printf 'fix: y\n\nA normal explanatory body with no footers.')"

if [ "$fail" -eq 0 ]; then
  echo "ALL PASS — the hook blocks co-authored/AI-generation commits and allows clean ones."
  exit 0
fi
echo "TESTS FAILED"
exit 1
