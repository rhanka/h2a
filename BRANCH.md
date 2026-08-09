# BR-73 consumer integration: user-configurable llm-mesh routing

## Objective

Let one h2a user enroll both Cloud Code and Codex through Sentropic, select a preferred transport order or round-robin policy with one CLI command, and run real Claude Code sessions through the shared Sentropic planner/gateway without provider-specific routing code in h2a.

## Ownership boundary

- `@sentropic/llm-mesh`: enrollment, encrypted keyring, account inventory/health, refresh, model catalogue/council, route policy semantics, planner, affinity and egress adapters.
- `@sentropic/llm-gateway`: Anthropic/OpenAI ingress, caller authorization, route execution, pre-byte fallback, SSE/tools/thinking conversion and metering.
- h2a: public CLI/config, gateway process lifecycle, opaque local bearer mint/forwarding, stable affinity and redacted status projection.
- PR #199 is forbidden and remains untouched.
- `.track/**` is forbidden in this worktree because the repository Track log has a separate active writer.

## Allowed scope

- `BRANCH.md`
- `docs/specs/2026-08-09-SPEC_EVOL_llm-mesh-user-routing.md`
- `apps/llm-gateway/**`
- `packages/h2a-runtime/**`
- `packages/h2a/test/gateway-status-transitions.test.js`
- `packages/h2a/test/runtime-status-contract.test.js`
- `packages/h2a/skills/h2a-run/SKILL.md`
- `scripts/dev-test-local.sh`
- dependency manifests and lockfile only for exact released Sentropic versions

## Forbidden scope

- `.track/**`
- PR #199 and its branch
- local provider credentials, provider OAuth, refresh logic, account pools or model/equivalence tables
- manual npm publication, npm login or tags created away from `origin/main`
- unrelated PTY/tmux backend work

## Lots

- [x] Negotiate ownership, policy semantics, accepted mappings and release order with Sentropic.
- [x] Integrate exact local Sentropic candidate tarballs and verify their API by typecheck.
- [x] Replace h2a-local routing/proxy/account implementations with thin Sentropic consumers.
- [x] Add `llm-mesh route show|prefer|strategy|policy|reset` and public-config validation.
- [x] Remove local credential and executable account-id persistence.
- [x] Add focused config, host, bearer and migration tests.
- [x] Reconcile the scoped integration tests/scripts and pass the branch-focused h2a gates.
- [x] Run exact-candidate local probes and real Claude UAT for Cloud-first and Codex-first, multiple sessions, tools, image and compact continuation.
- [ ] Obtain one final third-party exact-head review for each PR and reconcile findings.
- [ ] Merge/publish Sentropic through CI, update h2a lockfile from npm, rebase h2a once, merge and publish h2a through CI.
- [ ] Upgrade and smoke-test the installed global CLI.

## Candidate provenance

- Sentropic PR: `rhanka/sentropic#529`
- Frozen implementation head: `f600f60f0be113fad4154832e24f6718e694862d`
- Package-bearing commit: `f600f60f0be113fad4154832e24f6718e694862d`
- `@sentropic/llm-mesh@0.14.0` tarball SHA-256: `4f4cd900385d40fae370fedb6962bcad9908429821aa5cfc2159fbddbe1c2147`
- `@sentropic/llm-gateway@0.12.0` tarball SHA-256: `b9c51ef55e6600dfe9b543abb54a8284a90f702547c42d886aad70709f51ca18`

## Verification gates

- package and root typechecks/builds
- focused unit/integration suites in both gateway hosts
- no references to deleted account/model/proxy implementations
- no token/account/model table in h2a persisted config or local bearer
- real two-account Claude UAT with observable requested/actual redacted route evidence
- one exact-head adversarial review; CI green; branch-lifecycle checks before merge
