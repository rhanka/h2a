# BR-74 consumer cutover: canonical compaction metering

## Objective

Ship an h2a installation which actually loads the published Sentropic
`@sentropic/llm-gateway@0.13.1` and `@sentropic/llm-mesh@0.15.0` pair. A
single h2a upgrade must not retain an older optional runtime, because that
silently bypasses the canonical gateway’s first-frame compaction metering.

Prove the installed candidate with real Claude Code through a gateway forced
once to Codex and once to Cloud Code. H2A owns only local bearer, lifecycle,
affinity and redacted observability; provider routing and Anthropic SSE framing
remain wholly in Sentropic.

## Ownership boundary

- `@sentropic/llm-mesh`: enrollment, encrypted keyring, account inventory/health, refresh, model catalogue/council, route policy semantics, planner, affinity and egress adapters.
- `@sentropic/llm-gateway`: Anthropic/OpenAI ingress, caller authorization, route execution, pre-byte fallback, SSE/tools/thinking conversion and metering.
- h2a: public CLI/config, gateway process lifecycle, opaque local bearer mint/forwarding, stable affinity, redacted status projection, and lockstep CLI/runtime installation.
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
- `scripts/release.mjs`
- `packages/h2a/src/bin.ts`
- `packages/h2a/test/release-script.test.js`
- dependency manifests and lockfile only for exact released Sentropic versions

## Forbidden scope

- `.track/**`
- PR #199 and its branch
- local provider credentials, provider OAuth, refresh logic, account pools or model/equivalence tables
- manual npm publication, npm login or tags created away from `origin/main`
- unrelated PTY/tmux backend work

## Lots

- [x] Confirm with Sentropic that BR-74 is the canonical `message_start.usage.input_tokens` fix in llm-gateway 0.13.1.
- [x] Resolve the source lockfile to exactly llm-gateway 0.13.1 and llm-mesh 0.15.0 in an isolated worktree.
- [x] Make the lockstep runtime a required peer, and keep its peer range aligned by the release script.
- [x] Remove obsolete independent-runtime upgrade guidance and cover the install contract.
- [x] Verify no provider-specific proxy/SSE/metering code exists in H2A’s local gateway host.
- [x] Run the focused gateway and release/upgrade tests on the resolved dependency pair.
- [x] Run real Claude Code UAT through a candidate H2A gateway forced to Codex, then forced to Cloud Code; capture first SSE usage, resolved route and continuation after two compactions.
- [ ] Obtain one exact-head third-party review, rebase once, merge and publish only via the main tag CI.
- [ ] Upgrade the global installation and repeat a smoke check against the published runtime pair.

## Candidate provenance

- Sentropic PR: `rhanka/sentropic#532`, merged `c7a68110b555016b496e34215cef3ca0ed4f2f01`
- `@sentropic/llm-gateway@0.13.1` tarball SHA-256: `a1a3ecf48edf8e6faf602dd53bbc0330ecdad49dc7d4577f6ae45f110af3166a`
- `@sentropic/llm-mesh@0.15.0` tarball SHA-256: `e6ad6d8fda99ef4e19177f8204e781e4ec69ca0d3cacd10a0b01a992d7697900`

## Verification gates

- package and root typechecks/builds with the resolved pair above
- package release helper keeps the runtime peer range in lockstep
- no H2A provider proxy, SSE encoder, token-estimation heuristic, account pool or model map
- P0 real Claude Code: forced Codex; nonzero first `message_start.usage.input_tokens`; route attestation; tool plus two compactions continue
- P2 real Claude Code: forced Cloud Code; same first-frame/route/continuation proof
- one exact-head adversarial review; CI green; branch-lifecycle checks before merge
