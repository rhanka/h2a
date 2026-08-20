# llm-mesh account CLI and legacy pool cutover

## Objective

Make `llm-mesh` the only H2A account namespace without expanding the
Sentropic product contract. H2A removes its legacy account registry, token
store, account selection, quota, bindings and Kubernetes export. OAuth
enrollment continues through the public `@sentropic/llm-mesh` facade already
consumed by H2A.

The canonical enrollment commands become:

```text
h2a llm-mesh account enroll codex
h2a llm-mesh account enroll cloud-code
```

Direct launches use the native CLI authentication. Gateway launches use only
the existing llm-mesh/gateway path.

## Base and ownership

- Branch: `feat/llm-mesh-legacy-cutover`
- Base: `origin/main@f387637079261df3b7d5857eddb69637e638dc7c`
- H2A owns CLI shape, process environment, legacy deletion and migration docs.
- Sentropic owns account credentials, OAuth, keyring, routing and gateway.
- `.track/**` has a separate writer in the repository root and is forbidden in
  this worktree.

## Allowed scope

- `BRANCH.md`
- `docs/specs/2026-08-20-SPEC_EVOL_llm-mesh-account-cutover.md`
- account/gateway documentation, CLI help and changelog
- `packages/h2a-runtime/src/account-pool.ts` and its tests (deletion)
- `packages/h2a-runtime/src/index.ts`
- `packages/h2a-runtime/src/registry.ts`
- directly affected runtime tests
- `packages/h2a/src/hosts/installation-doctor.ts` and its tests
- `packages/h2a/skills/h2a-run/SKILL.md`
- release metadata only as required by the documented tag workflow

## Forbidden scope

- `.track/**`
- any Sentropic repository change
- reading or adapting the private llm-mesh keyring
- static API-key enrollment or cluster account distribution
- list/show/reauth/unenroll APIs invented by H2A
- unrelated routing, model mapping, PTY/tmux or gateway protocol work
- local npm publication, npm login, or a tag not pointing at merged `main`

## Lots

- [x] Lot 0 — ratify the consumer/product boundary, split future API-key and
  cluster needs into non-blocking Track items, and commit the EVOL.
- [x] Lot 1 — move OAuth enrollment to `h2a llm-mesh account enroll`, remove
  `h2a account`, `--account`, `job.accountId`, `account-pool.ts` and all pool
  selection/quota/binding/log/export call sites.
- [x] Lot 2 — make direct launches native and gateway launches llm-mesh-only;
  preserve user credentials, remove only H2A gateway overrides, and reject an
  unavailable explicitly-required gateway without silent direct fallback.
- [ ] Lot 3 — update help, doctor, migration docs and tests; run package and
  real direct/gateway UAT; obtain the requested Fable 5 review and reconcile.
- [ ] Lot 4 — push one PR, merge after green gates, tag the merged `main`, then
  verify CI publication and the npm artifact.

## Verification gates

- old `h2a account` and flat `h2a llm-mesh enroll` are unknown commands
- canonical nested enrollment works for Codex and Cloud Code
- real `h2a run codex --no-gw` uses native login and synthesizes no
  `OPENAI_API_KEY`
- real `h2a run claude --no-gw` uses native login and receives no legacy
  `CLAUDE_CONFIG_DIR`; user auth variables remain user-owned
- real `h2a run claude --gw` uses the existing llm-mesh gateway; required mode
  fails closed when unavailable
- legacy files can remain on disk but runtime and CLI never open them
- no secret reaches argv, help output, JSON, stdout or logs
- targeted unit/integration tests, package typecheck/build, CLI help goldens and
  real candidate-install smoke tests pass
- exact-head Fable 5 review has no unresolved blocker
- release tag points at the merged `origin/main` commit and GitHub Actions is
  the only npm publisher
