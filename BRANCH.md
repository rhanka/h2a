# Feature: Harness replaces legacy superpowers workflow defaults

## Scope

**Allowed Paths (implementation scope)**
  - `.gitignore`
  - `BRANCH.md`
  - `packages/h2a/skills/harness/using-harness/SKILL.md`
  - `packages/h2a/src/vendor/harness/cli/method-verbs.js`
  - `packages/h2a/src/vendor/harness/skills/manifest.js`
  - `packages/h2a/src/vendor/harness/skills/manifest.d.ts`
  - `packages/h2a/src/vendor/harness/index.js`
  - `packages/h2a/test/harness-facade.test.js`
  - `packages/remote-k8s-orchestrator/src/k8s/spec.ts`
  - `packages/remote-k8s-orchestrator/src/k8s/spec.test.ts`
  - `packages/h2a-runtime/src/skills-sync.ts`
  - `packages/track/INTENTION.md`

**Forbidden Paths**
  - `docs/superpowers/**`
  - `package.json`
  - `package-lock.json`
  - `.github/**`

**Conditional Paths**
  - None.

## Plan / TODO

- [x] **Lot 1 — Audit active superpowers surfaces**
  - [x] Use subagent read-only audit to find active superpowers references and worktree/tmp conventions.
- [x] **Lot 2 — Replace active workflow guidance**
  - [x] Make harness skill/CLI output the default replacement wording.
  - [x] Move harness branch recipe to repo-local ignored `tmp/worktrees/<slug>`.
  - [x] Add gitignore coverage for repo-local generated worktree/runtime dirs.
- [x] **Lot 3 — Preserve pod compatibility**
  - [x] Add neutral `H2A_WORKTREE_BASE`.
  - [x] Keep `SUPERPOWERS_WORKTREE_BASE` as a temporary legacy alias.
- [ ] **Lot 4 — Verify and publish PR**
  - [x] Build and run targeted tests.
  - [x] Run harness verification.
  - [x] Rebase on `origin/main` before push/PR.
