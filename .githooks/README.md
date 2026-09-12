# Git hooks

Repo-managed hooks. Enable once per clone:

```sh
git config core.hooksPath .githooks
```

(Worktrees of the same repo share this config, so a single setup covers them all.)

## `commit-msg`

Rejects any commit whose message carries a co-authorship or AI-generation trailer:

- `Co-authored-by: …`
- `Generated with [Claude Code]` / `claude.com/claude-code`
- `🤖`

The hook is local fast feedback. The gate is CI: `.github/workflows/no-coauthor-trailer.yml`
runs the same check on every pull request, so a bypass (`--no-verify`, or an unconfigured
clone) is still caught before merge.
