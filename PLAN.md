# H2A Project Plan

> Last update: 2026-05-25 (DEC-078 — key management slice 1: keyring `registry/keys.jsonl` + multi-key verification (`resolvePublicKeys`) + `h2a keys add/list`; rotate-in works. V2 line 0.2.x. Next: slice 2 = `h2a keys revoke` (rotate-out). Broker Scénario C still parked, needs user steer.)
> Purpose: durable project board for backlog, progress, and sequencing.
> Tracking rule: keep `[x]` for done and `[ ]` for remaining work; update this file after each meaningful change.

## Snapshot

- Overall estimated progress: ~91%
- Published packages:
  - `@sentropic/h2a@0.1.26`
  - `@sentropic/h2a-cli@0.1.26`
- Current repo state:
  - bootstrap repo, npm workspace, tests, and first npm publication are done
  - core contractual model, local runtime, CLI surface, and MCP server are implemented for the V1 local-files slice
  - host setup and MCP host scenarios are shipped for Codex, Claude Code, and Gemini (DEC-049)
  - release preparation is automated locally and publishing is tag-driven in GitHub Actions
  - `v0.1.26` is tagged on GitHub and published to npm through Trusted Publishing ; OCI image `ghcr.io/rhanka/h2a-cli:0.1.26` + `:latest` published to GHCR ; repo is public ; Windows full-test green (DEC-062 safePathSegment) ; host bridge identity renamed to `remote` (DEC-063)
  - policy precedence is now explicit per ABC context (`H2A_POLICY_PRECEDENCE_PROFILES`) while conflict resolution remains escalated, not automatic
  - controlled disclosure is now explicit per ABC context (`H2A_DISCLOSURE_PROFILES`) ; projection helpers remain policy/implementation work (DEC-045)
  - recourse / adjudication is now explicit per ABC context (`H2A_RECOURSE_PROFILES`) ; the decision itself stays with the declared authority (DEC-046)
  - recurring obligation cadence is now explicit per ABC context (`H2A_RECURRING_OBLIGATION_PROFILES`) ; scheduling and breach evaluation remain policy/implementation work (DEC-047)
  - jurisdiction is now explicit per ABC context (`H2A_JURISDICTION_PROFILES`) ; matching a scope/actor to a jurisdiction remains policy/implementation work (DEC-048)

## Priority Order

1. Stabilize the `h2a` core artifact model.
2. Implement the local-files runtime and store.
3. Extend `h2a-cli` around that local runtime.
4. Expose the same surface through a minimal MCP server.
5. Add real host-side integrations for Codex and Claude.
6. Add CI, examples, and release hygiene.

## Workpackage 00 - Foundation And Release (~100%)

- [x] Fix project umbrella name to `h2a`
- [x] Reduce runtime bootstrap to `@sentropic/h2a` + `@sentropic/h2a-cli`
- [x] Initialize local Git repository
- [x] Create and push GitHub repository `rhanka/h2a`
- [x] Bootstrap npm workspace and TypeScript build
- [x] Publish `@sentropic/h2a@0.1.26`
- [x] Publish `@sentropic/h2a-cli@0.1.26`
- [x] Fix CLI package publication so the `h2a` bin is preserved
- [x] Choose the project license (MIT — DEC-027)
- [x] Deprecate `@sentropic/h2a-cli@0.1.0` with a clear message
- [x] Automate release/publish flow (`npm run release -- --version X.Y.Z` + `vX.Y.Z` tag workflow publishing both packages through npm Trusted Publishing — DEC-038)
- [x] Configure npm Trusted Publishing for `@sentropic/h2a` and `@sentropic/h2a-cli` (`rhanka/h2a`, `release.yml`, allowed action `npm publish`; requires `npm@11.15.0+` or npmjs.com UI)

## Workpackage 10 - `h2a` Core Contracts (~100% + DEC-050 session vocabulary)

- [x] Define protocol id `sentropic.h2a`
- [x] Implement envelope creation
- [x] Implement envelope validation guard
- [x] Implement negotiation state guard
- [x] Publish first core package bootstrap
- [x] Implement schemas for `CONTRACT`, `POLICY`, `ENGAGEMENT`, `AMENDMENT` (type guards)
- [x] Implement `MANDATE`, `AUTHORITY`, `SIGNATURE`, `ENFORCEMENT_PLAN` (type guards)
- [x] Add canonicalization and hash computation (sorted-key JSON + SHA-256)
- [x] Add append-only journal structures (`H2AJournalEntry` + `verifyJournalChain`)
- [x] Add signature verification (ed25519 sign/verify on canonical payload)
- [x] Encode role/authority constraints for `PRINCIPAL`, `EXECUTIF`, `CONDUCTOR`, `CONTROL`, `MANDATAIRE` (DEC-035 : `H2A_AUTHORITY_MATRIX` + `canSignArtifactKind` ; appliquée par `stabilizeNegotiation`)
- [x] Add compatibility tests on canonical artifacts (cross-language fixtures) (DEC-035 : `packages/h2a/fixtures/` + `manifest.json` + `H2A_CANONICAL_FIXTURES`)
- [x] Declare h2a session protocol vocabulary (`H2A_SESSION_STATES` / `H2A_SESSION_NOTIFICATION_TOPICS` / `H2ASession` / `isSessionExpired` / `pickFreshSessions` — DEC-050)

## Workpackage 20 - Local Runtime And Store (~100%)

- [x] Document the target local-files mode
- [x] Freeze the path convention `<root>/.h2a/...` (DEC-031, with `src/{project}/h2a/...` as named-workspace variant)
- [x] Implement registry storage layout (`registry/instances.jsonl`, append-only, dup-guarded)
- [x] Implement negotiation storage layout (`negotiations/<id>/journal.jsonl`, hash-chained)
- [x] Implement journal chaining with `prevHash` (core primitive in WP-10; tampered chain detected on read)
- [x] Implement inbox/outbox local transport (`putInboxMessage` / `readInbox` / `popInboxMessage`)
- [x] Wire `causationId` / `correlationId` semantics into negotiation flow (CLI + MCP propagation: explicit flags win, otherwise inherit `causationId = previous.id` and `correlationId = previous.correlationId` — DEC-033)
- [x] Enforce immutable stabilized artifacts (contracts/policies/engagements) (write-once `wx` flag; fallback `artifacts/<hash>.json` for AMENDMENT/MANDATE/AUTHORITY/ENFORCEMENT_PLAN — DEC-033)
- [x] Define concurrency / file locking behavior (advisory `.lock` files par section critique, recovery PID-staleness, `LockTimeoutError`, knob `createLocalStore({lockTimeoutMs})` — DEC-036)
- [x] Define migration/versioning strategy for local state (`<root>/.h2a-schema.json` v1 + `H2A_STORE_SCHEMA_VERSION`, `StoreSchemaMismatchError`, verbe `h2a store migrate` — DEC-036)
- [x] File-based presence producer (`<root>/.h2a/presence/<sid>.json`) + `SessionRegistry` (heartbeat, scanFresh with TTL sweep, closeAll on stdio shutdown) — DEC-051
- [x] Cross-host lease lock primitive (`withLeaseSync` / `withLease`, TTL + fencing token + nonce-guarded release) — unblocks Scenario B cross-Pod concurrency — DEC-065
- [x] Wire lease lock into the store as opt-in `lockMode: "lease"` (`createLocalStore({ lockMode, leaseMs })`, single dispatcher over all 8 critical sections, `pid` stays default) — DEC-066

## Workpackage 30 - `h2a-cli` Surface (~100%)

- [x] Create unified `@sentropic/h2a-cli` package
- [x] Keep internal modules for `mcp`, `codex`, `claude`, `gemini`
- [x] Implement `h2a --help`
- [x] Implement `h2a hosts`
- [x] Implement `h2a mcp-tools`
- [x] Publish a working npm CLI package
- [x] Implement `h2a init` (creates `<root>/.h2a/` layout)
- [x] Implement `h2a register --json <json>` (writes to `registry/instances.jsonl`)
- [x] Implement `h2a discover [--role] [--scope]` (reads `registry/instances.jsonl`)
- [x] Implement `h2a negotiate open` (persists `state.json`, validates status)
- [x] Implement `h2a negotiate status --id --status` (transitions state)
- [x] Implement `h2a negotiate event` (append-only journal entry)
- [x] Implement `h2a negotiate journal` (verified read)
- [x] Implement `h2a inbox put/read/pop` and `h2a outbox put/read` (file-backed mailboxes)
- [x] Implement `h2a negotiate offer` / `counter` (typed wrappers stamp actor + type + artifact)
- [x] Implement `h2a negotiate sign` (ed25519 sign of canonical `{artifactHash}`, journal append)
- [x] Implement `h2a negotiate stabilize` (verify signatures against registry publicKeys, quorum check, status→stabilized)
- [x] Stabilize JSON output contracts and exit codes (DEC-034 : 3 enveloppes `resource`/`list`/`action` + codes 0/1/2/3 ; manifeste `H2A_CLI_VERB_CONTRACTS` + `docs/cli-contract.md`)
- [x] High-level coordination verbs (`h2a connect`, `h2a doctor`, `h2a sessions`, `h2a keys generate`, `h2a install-skills`) + 3 Claude skills + tutorial — DEC-054
- [x] `install-skills` extended to Codex (`~/.codex/skills/`) and Gemini (`~/.gemini/commands/` TOML) — DEC-055
- [x] Single `/h2a` skill with subcommand routing (connect/status/discover/send/receive/negotiate/disconnect/help) + legacy pruning — DEC-057
- [x] Kubernetes sidecar renderer + `h2a deploy k8s-sidecar` verb (Scenario A of DEC-056) — DEC-058
- [x] Kubernetes cluster-tenant renderer + `h2a deploy k8s-tenant` verb (Namespace + ResourceQuota + RWX PVC + Deployment) with `H2A_LOCK_MODE`/`H2A_LEASE_MS` env fallback in `createLocalStore` — Scenario B of DEC-056, deployable end-to-end — DEC-067
- [x] Host bridge contract formalized (`H2A_HOST_BRIDGE_PROFILES` + `auditHostBridge` + remote profile + PR draft) — DEC-059
- [x] OCI image build + GHCR publish workflow (`ghcr.io/rhanka/h2a-cli:<version>`, multi-arch, non-root, SBOM) — DEC-060
- [x] Cross-OS CI matrix ubuntu/macOS × node 20/22 + cross-platform test runner ; Windows smoke covered, Windows full-test deferred (`:`-in-paths refactor) — DEC-061
- [x] `safePathSegment` for Windows-compatible local-files layout (`:` → `__` in negotiation/instance/session ids and artefact paths) ; Windows back in full-test CI matrix — DEC-062
- [x] Rename host bridge identity + all repo references `remote-controle` → `remote` (matches `@sentropic/remote`, upstream PR `rhanka/remote#2`) — DEC-063
- [x] Store migration rename pass `h2a store migrate --sanitize-paths` (legacy `:`-named entries → safePathSegment form ; dry-run + conflict-safe) — DEC-064

## Workpackage 40 - Host And Protocol Integrations (~95%)

### MCP track

- [x] Freeze the canonical MCP tool names
- [x] Implement a minimal MCP server inside `@sentropic/h2a-cli` (in-process `createMcpServer({ root })`, 4 wired tools: register / discover / inbox / append_journal; JSON-RPC + stdio transport deferred to a later slice)
- [x] Back the MCP server with the same local-files runtime
- [x] Expose the in-process MCP server over JSON-RPC 2.0 / stdio (`runMcpStdio`) and add the `h2a mcp-serve [--root <path>]` CLI verb
- [x] Wire **all 10 MCP tools** (added `h2a_open_negotiation`, `h2a_offer`, `h2a_counteroffer`, `h2a_sign`, `h2a_stabilize`, `h2a_escalate`); full negotiation lifecycle driveable end-to-end over JSON-RPC (`examples/principal-conductors/run.mjs` exercises this as step 9)
- [x] Define actor identity/auth strategy for MCP calls (V1: no transport auth, caller-declared identity + ed25519 artifact signatures — DEC-032)
- [x] Expose machine-readable host compatibility status (`h2a host status`, wave + adapter/setup/scenario flags — DEC-037/044)
- [x] Session lifecycle MCP tools (`h2a_session_open`, `h2a_session_close`, `h2a_discover_sessions`) wired to the SessionRegistry — DEC-051
- [x] MCP push notifications (`notifications/h2a`) on presence join/leave + inbox arrival + negotiation event ; tick-based scanner, configurable interval, sink wired by runMcpStdio — DEC-052
- [x] Real cross-CLI integration test (two `mcp-serve` subprocesses sharing a root, inbox push + graceful close + SIGKILL TTL expiry) — DEC-053
- [~] V2: transport auth — **mechanism DECIDED: signed-bearer end-to-end** (user steer 2026-05-25; transport moves bytes, auth = ed25519 envelope signatures + nonce/timestamp anti-replay; no PKI/mTLS, survives relays/brokers). Slices: [x] signed envelopes in core (DEC-073) ; [x] anti-replay — `checkEnvelopeFreshness` + `createReplayGuard` (DEC-074) ; [x] remote transport (in `runtime/remote/`, **not** a 3rd package): [x] 3a receive boundary `acceptRemoteEnvelope` (DEC-075) ; [x] 3b-i HTTP `createRemoteServer`/`sendRemoteEnvelope` (DEC-076) ; [x] 3b-ii CLI `h2a remote serve` (binds 127.0.0.1 by default) / `h2a remote send`, store+registry-wired (DEC-077). **Signed-bearer transport-auth COMPLETE end-to-end.** mTLS only as an optional deployment-layer add-on, not built.
- [~] V2: key management UX (user steer 2026-05-25) — complements signed-bearer transport. Slices: [x] keyring store `registry/keys.jsonl` + multi-key verification (`resolvePublicKeys` tries ALL active keys) + `h2a keys add/list` (DEC-078) ; [ ] key revocation `h2a keys revoke` (rotate-out — append `revoked`, already subtracted by `listInstanceKeys`) ; [ ] rotation ergonomics/keyring polish. Rotate-in works: add new key, both verify during overlap.
- [x] V2: first-class SUBAGENTS (DEC-008) — **COMPLETE (slices 1-5)**: [x] addressable binding layer in core (DEC-068) ; [x] store binding registration + `h2a subagent register/list` (DEC-069) ; [x] validated routing + parent fan-in + `h2a subagent route/inbox` (DEC-070) ; [x] append-only per-subagent audit trail + `h2a subagent audit` (DEC-071) ; [x] takeover via revocation (status derived from audit) + `h2a subagent revoke`, route refused once revoked (DEC-072). Subagents are addressable, persistent, routable, auditable, revocable.

### Codex track

- [x] Scaffold the Codex-side plugin surface (host descriptor + `renderMcpConfig` snippet, exposed as `h2a host setup --host codex`)
- [x] Implement registration flow (MCP-level: `h2a host setup --host codex [--write <file>]` merges `mcpServers.h2a` into the Codex CLI config; pre-existing `mcpServers.h2a` divergence requires `--force`; other entries are preserved)
- [x] Implement inbox / negotiation operations (DEC-044 : host-specific MCP scenario launches `mcp-serve` from the Codex snippet and drives register/open/offer/inbox over JSON-RPC)

### Claude track

- [x] Scaffold the Claude-side plugin surface (host descriptor + `renderMcpConfig` snippet, exposed as `h2a host setup --host claude`)
- [x] Implement registration flow (MCP-level: `h2a host setup --host claude [--write <file>]` covers both `~/.config/claude/mcp.json` and project-local `.mcp.json`)
- [x] Implement inbox / negotiation operations (DEC-044 : host-specific MCP scenario launches `mcp-serve` from the Claude snippet and drives register/open/offer/inbox over JSON-RPC)

### Gemini track (promoted to wave 1 — DEC-049)

- [x] Decide whether Gemini stays first-wave or second-wave → initially deferred (DEC-028), promoted to wave 1 by DEC-049
- [x] Add the same minimal surface as Codex/Claude: descriptor + `renderMcpConfig` (`~/.gemini/settings.json` + project-local `.gemini/settings.json`), `h2a host setup --host gemini`, host-specific MCP scenario test (DEC-049)

## Workpackage 50 - Governance, Vocabulary, And Model Semantics (~100%)

- [x] Stabilize umbrella naming around `h2a`
- [x] Capture vocabulary v1.7
- [x] Capture `EXECUTIF`, `CONTROL`, and `ENFORCEMENT_PLAN` decisions
- [x] Capture the 2-package topology decision
- [x] Produce compatibility evaluation notes
- [x] Produce the initial runtime proposal
- [x] Stabilize the mapping to the three ABC models (DEC-041 : `H2A_ABC_MODEL_PROFILES` + `auditAbcModelCompatibility`, profils `ok:true` / `ready:false` avec gaps explicites)
- [x] Counter-audit `CONTRACT` vs `POLICY` vs `ENGAGEMENT` (DEC-039 : profils `normative-container` / `durable-rule` / `operational-executable` + `auditContractualArtifact`)
- [x] Define escalation targets per scope in executable terms (DEC-040 : `resolveEscalationTarget` sur `ENFORCEMENT_PLAN.escalations[]`, fallback PRINCIPAL explicite)
- [x] Define the `1 PRINCIPAL / 15 CONDUCTORS` use case end-to-end (definition is executable in `examples/principal-conductors/`)
- [x] Frame multi-human modes beyond pairwise dialogue (DEC-042 : `H2A_MULTI_HUMAN_MODES` + `selectMultiHumanMode`, pair/delegated/shared/federated/quorum/public-authority)
- [x] Decide what becomes protocol, what stays policy, what stays implementation (DEC-043 : `H2A_GOVERNANCE_BOUNDARY_ITEMS` + `classifyGovernanceBoundary`)
- [x] Declare policy precedence profiles for ABC contexts without introducing a hidden V1 resolver (`H2A_POLICY_PRECEDENCE_PROFILES` + `auditPolicyPrecedenceProfile`; conflicts escalate rather than selecting a winning policy)
- [x] Declare controlled disclosure profiles per ABC context (`H2A_DISCLOSURE_PROFILES` + `auditDisclosureProfile` ; 6 modes from `denied` to `full-view` ; V1 ships no projection helper — DEC-045)
- [x] Declare recourse / adjudication profiles per ABC context (`H2A_RECOURSE_PROFILES` + `auditRecourseProfile` ; 7 lifecycle states from `requested` to `closed` ; V1 ships no adjudicator — DEC-046)
- [x] Declare recurring obligation cadence profiles per ABC context (`H2A_RECURRING_OBLIGATION_PROFILES` + `auditRecurringObligationProfile` ; 7 cadences with grace + reporting thresholds ; V1 ships no scheduler — DEC-047)
- [x] Declare jurisdiction profiles per ABC context (`H2A_JURISDICTION_PROFILES` + `auditJurisdictionProfile` ; 7 jurisdiction kinds ; V1 does not check membership — DEC-048)

## Workpackage 60 - Quality, Examples, And Ops (~95%)

- [x] Add baseline automated tests
- [x] Keep `npm test` green after publication fixes
- [x] Add CI workflow for build + tests (`.github/workflows/ci.yml`, Node 20/22 matrix)
- [x] Add npm install smoke test for published packages (`.github/workflows/smoke.yml`, installs `@sentropic/h2a-cli@0.1.26` globally and exercises help/hosts/MCP tools/init/register/discover/host setup)
- [x] Add an example project for `1 PRINCIPAL / 15 CONDUCTORS` (`examples/principal-conductors/run.mjs`, gated integration test `H2A_RUN_EXAMPLE=1`)
- [x] Add release notes / publish procedure doc (`docs/release.md`)
- [x] Add security/key management notes (`docs/release.md` § Key management)
- [x] Add compatibility matrix documentation for Codex / Claude / Gemini / MCP (`docs/compatibility-matrix.md`, backed by `h2a host status` — DEC-037)

## Open Decisions for K8s + remote interop (DEC-056)

All four resolved on 2026-05-23:

- [x] Tenant model → Scenario A (sidecar per session, DEC-058) **and** Scenario B (dedicated cluster tenant, DEC-067) now both shippable. Scenario B unblocked once cross-Pod locking landed (DEC-065/066); use A for per-session coordination, B for a standing shared-store tenant.
- [x] RWX storage → **available on Scaleway natively** (an earlier note wrongly claimed it was not, corrected 2026-05-25). Not a blocker for Scenario B. The real Scenario B prerequisite is a cross-Pod locking primitive (DEC-036 locks are same-machine only).
- [x] Interop contract with `remote` → **two-way formalized** (DEC-059 + PR draft at `docs/pr-drafts/remote-h2a-bridge.md`).
- [x] `@sentropic/h2a-remote` → **deferred V2** (depends on DEC-032 V2 auth, no design now).

## Open Decisions / User Inputs

- [x] Choose the project license → MIT (DEC-027)
- [x] Confirm whether to deprecate `@sentropic/h2a-cli@0.1.0` → yes, done with redirect message (DEC-029)
- [x] Switch release target from `NPM_TOKEN` to npm Trusted Publishing → yes; npm trusted-publisher configs created with allowed action `npm publish`
- [x] Choose the next main delivery → core schemas first (DEC-030)
- [x] Decide whether `gemini` stays in wave 1 → deferred to wave 2 (DEC-028)

## Next Recommended Slice

Recommended next implementation slice:

1. The remaining V1-open work is WP-40 V2 transport auth (mTLS / signed bearer — deferred) and WP-60 ops hardening (cross-OS smoke matrix, audit/log durcissement). Both are no longer pure ABC-policy slices. WP-50 is 100% (only `policy-precedence` stays `partial` by design).
2. Prepare a patch release when the next SDK-visible slice is ready.
