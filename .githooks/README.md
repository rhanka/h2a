# Git hooks

Repo-managed hooks that block co-authorship / AI-generation trailers in commit
messages. The guard is **runtime-agnostic**: `claude`, `codex` and `agy` all commit
through plain `git commit` (no `--no-verify`; h2a never commits programmatically),
so git runs this hook for every one of them wherever `core.hooksPath` is set.

## Install

```sh
bash .githooks/install.sh            # this repo only
bash .githooks/install.sh --global   # every repo for this user — covers codex/agy
                                     # even in fresh clones and sandbox workspaces
```

`--local` sets `core.hooksPath .githooks` for the current repo. `--global` copies the
hook into `~/.config/git/hooks` and points the user's global `core.hooksPath` there,
so any runtime committing in any repo is gated (re-run after the hook changes).

Notes:

- A **relative** `core.hooksPath` resolves per worktree root, so a worktree on a
  branch without `.githooks/commit-msg` runs no hook — prefer `--global` for coverage.
- A local `core.hooksPath` overrides a global one.

## `commit-msg`

Rejects any commit whose message carries:

- `Co-authored-by: …` (anchored to line start — prose that mentions it is allowed)
- `Generated with [Claude Code]` / `claude.com/claude-code`
- `🤖`

It ignores the `git commit -v` diff (scissors section) and comment lines, so a diff
hunk or comment that quotes a trailer is not a false positive.

## Enforcement

Local hooks are opt-in and bypassable (`--no-verify`), and a direct push never runs
them. CI (`.github/workflows/no-coauthor-trailer.yml`) runs this **same hook** over
each pull request's commits and over pushes to `main` — a match makes `scan-commits`
red (it *blocks the merge* only when set as a required status check). `bash
.githooks/test.sh` verifies all of the above with real commits, including that a
GLOBAL install gates a repo that never configured a local hook (the codex/agy
fresh-workspace case).
