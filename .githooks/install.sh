#!/usr/bin/env bash
# Install or verify the worktree-safe commit-msg attribution-trailer guard.
# Runtime-agnostic: Claude Code, Codex, agy/Gemini, Muse and Vibe all commit
# through plain `git commit`, so git runs this hook wherever core.hooksPath points.
#
#   bash .githooks/install.sh                        # this repo (worktree-safe <git-common-dir>/hooks)
#   bash .githooks/install.sh --local --mode strip   # strip trailers in-place instead of rejecting
#   bash .githooks/install.sh --global               # every repo without a local core.hooksPath
#   bash .githooks/install.sh --agent-rules          # write rule block to all 5 CLI instruction files
#   bash .githooks/install.sh --check [repo...]      # read-only verification
set -euo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
installer="$dir/../packages/h2a/scripts/install-trailer-guard.mjs"

if [ -f "$installer" ] && command -v node >/dev/null 2>&1; then
  exec node "$installer" "$@"
fi

# Fallback when copied standalone without packages/h2a/scripts.
case "${1:-}" in
  --global)
    gdir="${XDG_CONFIG_HOME:-$HOME/.config}/git/hooks"
    mkdir -p "$gdir"
    cp "$dir/commit-msg" "$gdir/commit-msg"
    chmod +x "$gdir/commit-msg"
    git config --global core.hooksPath "$gdir"
    echo "global core.hooksPath -> $gdir"
    ;;
  ""|--local)
    common="$(git rev-parse --git-common-dir)"
    case "$common" in
      /*) ;;
      *) common="$(cd "$common" && pwd)" ;;
    esac
    hdir="$common/hooks"
    mkdir -p "$hdir"
    cp "$dir/commit-msg" "$hdir/commit-msg"
    chmod +x "$hdir/commit-msg"
    git config --local core.hooksPath "$hdir"
    echo "repo core.hooksPath -> $hdir (worktree-safe)"
    ;;
  *)
    echo "usage: install.sh [--local|--global|--agent-rules|--check] [--mode reject|strip]" >&2
    exit 2
    ;;
esac
