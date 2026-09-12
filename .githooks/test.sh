#!/usr/bin/env bash
# End-to-end test for the commit-msg hook: a throwaway repo wired to this .githooks
# dir makes REAL `git commit` attempts, asserting that co-authorship / AI-generation
# footers are rejected (with the right error, and no commit created) and that clean
# messages — including prose that mentions a trailer and `git commit -v` diffs —
# pass. Run: bash .githooks/test.sh
set -uo pipefail
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null  # ignore dev's gpgsign/hooksPath/etc.

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
hook="$hook_dir/commit-msg"
sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT

git init -q "$sandbox"
git -C "$sandbox" config core.hooksPath "$hook_dir"
git -C "$sandbox" config user.email "test@example.com"
git -C "$sandbox" config user.name "hook test"
git -C "$sandbox" commit -q --allow-empty --no-verify -m "baseline"
base="$(git -C "$sandbox" rev-parse HEAD)"

fail=0
try_commit() { printf '%s\n' "$RANDOM" > "$sandbox/f"; git -C "$sandbox" add f
  git -C "$sandbox" commit -m "$1" 2>"$sandbox/err"; }
expect_blocked() {
  if try_commit "$2"; then echo "FAIL [$1]: commit ACCEPTED"; fail=1; git -C "$sandbox" reset -q --hard "$base"; return; fi
  grep -q 'commit blocked' "$sandbox/err" || { echo "FAIL [$1]: blocked without the expected message"; fail=1; }
  [ "$(git -C "$sandbox" rev-parse HEAD)" = "$base" ] || { echo "FAIL [$1]: HEAD moved"; fail=1; }
  echo "ok   [$1]: blocked"
}
expect_allowed() {
  if try_commit "$2"; then echo "ok   [$1]: allowed"; git -C "$sandbox" reset -q --hard "$base"
  else echo "FAIL [$1]: clean commit BLOCKED"; cat "$sandbox/err"; fail=1; fi
}
expect_hook_allows() { # run the hook directly on a crafted message file
  if "$hook" "$2" >/dev/null 2>&1; then echo "ok   [$1]: allowed"; else echo "FAIL [$1]: blocked a clean message"; fail=1; fi
}

# One real commit per alternation branch (a regression in any one is caught):
expect_blocked "Claude Co-Authored-By trailer" "$(printf 'feat: x\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
expect_blocked "generated-with-claude"         "$(printf 'feat: x\n\nGenerated with [Claude Code]')"
expect_blocked "claude.com/claude-code url"     "$(printf 'feat: x\n\nsee https://claude.com/claude-code for details')"
expect_blocked "robot marker"                   "$(printf 'feat: x\n\n\xf0\x9f\xa4\x96 automated')"

# Clean messages that MUST pass (regression guards for the two fixed false positives):
expect_allowed "plain message"                  "chore: routine change"
expect_allowed "prose mentions co-authored-by"  "docs: reject Co-authored-by: trailers in commit messages"

# `git commit -v` appends a scissors + diff; a trailer quoted there must not block:
scissors="$sandbox/scissors.txt"
printf 'docs: edit files\n\n# ------------------------ >8 ------------------------\n# Do not modify the line above.\n+Co-Authored-By: Claude <x@y.z>\n' > "$scissors"
expect_hook_allows "commit -v diff quoting a trailer" "$scissors"
comment="$sandbox/comment.txt"
printf 'docs: edit\n\n# Co-authored-by: this is a comment line, not a trailer\n' > "$comment"
expect_hook_allows "comment line quoting a trailer" "$comment"

if [ "$fail" -eq 0 ]; then
  echo "ALL PASS — blocks co-authored/AI-generation commits; allows clean ones (incl. prose & -v diffs)."
  exit 0
fi
echo "TESTS FAILED"
exit 1
