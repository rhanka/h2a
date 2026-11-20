# Git hooks

Repo-managed and harness-shipped guard that blocks (or strips) AI attribution /
co-authorship trailers in commit messages, PR titles, and PR bodies. The guard is
**runtime-agnostic**: Claude Code, Codex, agy/Gemini, Muse, and Mistral Vibe all
commit through `git commit`, so git runs `commit-msg` wherever `core.hooksPath`
points.

## Install (worktree-safe, idempotent)

```sh
# Per-repo (recommended): installs into <git-common-dir>/hooks/commit-msg and
# sets local core.hooksPath to that absolute branch-independent path.
# Covers the main checkout AND every linked worktree on ANY branch, while
# preserving pre-existing commit-msg hooks (commit-msg.local) and forwarding
# sibling hooks (e.g. .githooks/pre-push).
bash .githooks/install.sh --local
# Or from any repo via the shipped harness script:
node /path/to/h2a/packages/h2a/scripts/install-trailer-guard.mjs --local --repo .

# Optional strip mode (removes forbidden trailers in-place instead of rejecting):
bash .githooks/install.sh --local --mode strip

# Machine-wide fallback (covers repos that do NOT override local core.hooksPath):
bash .githooks/install.sh --global

# Deploy the bounded agent-side rule into user instruction files
# (~/.claude/CLAUDE.md, ~/.codex/AGENTS.md, ~/.gemini/GEMINI.md,
#  ~/.config/muse/AGENTS.md, ~/.vibe/AGENTS.md):
bash .githooks/install.sh --agent-rules
```

## Verify (read-only)

```sh
# Check one or more repos (or scan a workspace root such as ~/src):
node packages/h2a/scripts/install-trailer-guard.mjs --check /path/to/repo1 /path/to/repo2
node packages/h2a/scripts/install-trailer-guard.mjs --check --scan-dir ~/src
```

`--check` verifies that:
- the effective `core.hooksPath` exists on disk (catching shadowed empty `.git/hooks` or vanished branch-local `.githooks`),
- `core.hooksPath` is worktree-safe (absolute, not pointing into branch-tracked worktree files),
- an executable `commit-msg` guard is active, and
- reports whether a CI workflow (`no-coauthor-trailer`) is present.

## Blocked patterns (case-insensitive)

- `Co-Authored-By: …` (anchored to line start — prose mentions are allowed)
- `Claude-Session: …` (anchored to line start)
- `Generated-By: <AI>` (anchored to line start, AI tool/provider specific)
- `Generated with [<AI tool>]` (Claude, Codex, Gemini, Antigravity, Mistral Vibe, Muse, Copilot, Cursor)
- `claude.com/claude-code` · `claude.ai/code/session_…` · `🤖`

The hook ignores the `git commit -v` diff (scissors section) and `#` comment lines.
Override per commit with `H2A_TRAILER_GUARD_MODE=strip` or `reject`.

## Reusable GitHub Actions CI check (Node only, no Python)

Add `.github/workflows/no-coauthor-trailer.yml` to any repo:

```yaml
name: no co-author trailer

on:
  pull_request:
    types: [opened, edited, synchronize, reopened]
  push:
    branches: [main]

jobs:
  trailer-guard:
    uses: rhanka/h2a/.github/workflows/no-coauthor-trailer.yml@main
```

The reusable workflow scans every commit in the PR/push range **and** the PR
title/body (which GitHub turns into the squash-merge commit message). Make
`trailer-guard / scan-commits` (or `scan-commits` in `h2a`) a required status check
to block merges carrying trailers.
