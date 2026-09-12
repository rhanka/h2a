# Git hooks

Repo-managed hooks. Enable once per clone:

```sh
git config core.hooksPath .githooks
```

Notes:

- A **relative** `core.hooksPath` resolves per worktree root, so a worktree checked
  out on a branch that does not contain `.githooks/commit-msg` silently runs no hook.
- A local `core.hooksPath` overrides any global one you may already have set.

## `commit-msg`

Rejects any commit whose message carries a co-authorship or AI-generation trailer:

- `Co-authored-by: …` (anchored to line start — prose that mentions it is allowed)
- `Generated with [Claude Code]` / `claude.com/claude-code`
- `🤖`

It ignores the `git commit -v` diff (scissors section) and comment lines, so a diff
hunk or comment that merely quotes a trailer does not trigger a false positive.
`bash .githooks/test.sh` verifies all of this with real commits.

## Enforcement (important)

Local hooks are **opt-in** (`core.hooksPath`) and **bypassable** (`git commit --no-verify`),
and a direct push never runs them. The CI workflow `.github/workflows/no-coauthor-trailer.yml`
runs this **same hook** over each pull request's commits **and** over pushes to `main`.

- On a **pull request**, a match makes `scan-commits` red — but that only *blocks the
  merge* if `scan-commits` is configured as a **required status check** on `main`
  (a repo setting, outside this PR). Until then the check is advisory.
- On a **push to `main`**, the job cannot reject the push; it turns any trailer that
  slipped in (merge-time composition, `--no-verify`, a bypassed clone) into a **red run
  on `main`** instead of silence.

This PR is **forward-looking**: it prevents new trailers. Trailers already in history
(`main` currently carries several) are not removed by it — that requires a separate
history rewrite.
