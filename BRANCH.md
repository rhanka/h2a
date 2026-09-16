# Native signed `h2a send`

## Objective

Ship the core `h2a send` contract and `h2a_send` MCP tool for patch 0.97.1,
with authenticated local inbox delivery and native/tmux wake coverage. Do not
bump package versions and do not merge the delivery PR.

## Base and ownership

- Branch: `feat/h2a-send-cli`
- Base: `origin/main`
- `packages/h2a` owns identity, signing, resolution, store writes, CLI and MCP.
- `packages/h2a-runtime` owns launcher defaults and tmux sidecar setup only.
- `.track/**` remains single-writer and is forbidden in this worktree.

## Scope

- `packages/h2a/src/**` and focused `packages/h2a/test/**` contracts.
- `packages/h2a/skills/h2a/SKILL.md` for the public send workflow.
- `packages/h2a-runtime/src/config.ts`, `tmux.ts`, and focused tests.
- Packaged host/plugin configuration that renders the wake default.
- This plan, the EVOL spec, and final review evidence.

## Lots

- [x] Add the shared signed-send service and active-key verification.
- [x] Wire the positional CLI verb, help/contract/map, and identity resolution.
- [x] Wire trusted-signer MCP `h2a_send` and update the packaged skill.
- [x] Switch wake defaults/setup to bounded `auto` and preserve tmux metadata.
- [x] Add focused signing, resolution, MCP, native and real tmux tests.
- [x] Run build, scoped tests, full suite, two-peer review, then open the PR.

## Verification gates

- No unsigned envelope can be written through CLI or MCP send.
- Name ambiguity and stale/private-key mismatch are refused before persistence.
- Native and tmux chain paths are exercised by real integration tests.
- Help, CLI manifest, MCP schema, plugin configuration, and runtime defaults
  agree with the implementation.
- `git diff origin/main -- package*.json` contains no version bump.
- Final PR targets `main`, remains unmerged, and carries no AI attribution.

## Verification evidence

- `npm ci`: pass (286 packages added; audit reported the repository's existing
  one low-severity advisory).
- `npm run build`: pass.
- Focused send/wake/native/tmux and contract suites: pass.
- `npm test`: pass on final product commit `c57f18db` — Node 2,137 tests
  (2,099 pass, 17 skipped, 21 TODO,
  0 fail); Track Vitest 1,193/1,193 pass.
- `scripts/check-public-contract.sh`: pass (53 MCP tools, 99 CLI verbs,
  core anti-cycle check).
- `harness verify --json`: pass.
- Version manifests and lockfile: unchanged.
- Delivery PR: #270 against `main`, open and intentionally unmerged.

## Feedback Loop

- Owner: core CLI maintainers — status: deferred, non-gating. Add explicit
  negative tests for zero/multiple ambient sender candidates when this
  resolution policy next changes; the current branch fails closed.
- Owner: identity maintainers — status: rejected for this Linux-local delivery.
  `safeKeyName` is pre-existing and removes `/`, so the review found no path
  traversal; cross-platform helper unification belongs to a separate change.
- Owner: this branch — status: resolved. Corrected the stale `deliver-hint`
  reason and added direct-alias plus CLI auto-detection tests in `c57f18db`.
- Owner: this branch — status: refuted. The real PTY integration exercises
  `mcp-serve` → `sendContext` → `h2a_send` end-to-end in both directions.
