#!/usr/bin/env bash
# Install the commit-msg guard. It is runtime-agnostic: claude, codex and agy all
# commit through plain `git commit`, so git runs this hook for every one of them
# wherever core.hooksPath is set.
#
#   bash .githooks/install.sh            # this repo only (core.hooksPath -> .githooks)
#   bash .githooks/install.sh --global   # every repo for this user — covers codex/agy
#                                        # even in fresh clones / sandbox workspaces
set -euo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  --global)
    gdir="${XDG_CONFIG_HOME:-$HOME/.config}/git/hooks"
    mkdir -p "$gdir"
    cp "$dir/commit-msg" "$gdir/commit-msg"
    chmod +x "$gdir/commit-msg"
    git config --global core.hooksPath "$gdir"
    echo "global core.hooksPath -> $gdir"
    echo "Every runtime (claude, codex, agy) in every repo now runs the commit-msg guard."
    echo "Re-run after the hook changes to refresh the global copy."
    ;;
  ""|--local)
    top="$(git rev-parse --show-toplevel)"
    git -C "$top" config core.hooksPath .githooks
    echo "repo core.hooksPath -> .githooks ($top)"
    echo "Use --global to cover codex/agy (and every repo) machine-wide."
    ;;
  *)
    echo "usage: install.sh [--local|--global]" >&2
    exit 2
    ;;
esac
