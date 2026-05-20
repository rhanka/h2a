# H2A Project Plan

> Last update: 2026-05-20 (Verrous fichier advisory + version de schéma store local-files — DEC-036 ; WP-20 100%)
> Purpose: durable project board for backlog, progress, and sequencing.
> Tracking rule: keep `[x]` for done and `[ ]` for remaining work; update this file after each meaningful change.

## Snapshot

- Overall estimated progress: ~73%
- Published packages:
  - `@sentropic/h2a@0.1.0`
  - `@sentropic/h2a-cli@0.1.1`
- Current repo state:
  - bootstrap repo, npm workspace, tests, and first npm publication are done
  - core contractual model is still only partially implemented
  - CLI/package structure is in place, but real negotiation/runtime flows are still to build

## Priority Order

1. Stabilize the `h2a` core artifact model.
2. Implement the local-files runtime and store.
3. Extend `h2a-cli` around that local runtime.
4. Expose the same surface through a minimal MCP server.
5. Add real host-side integrations for Codex and Claude.
6. Add CI, examples, and release hygiene.

## Workpackage 00 - Foundation And Release (~75%)

- [x] Fix project umbrella name to `h2a`
- [x] Reduce runtime bootstrap to `@sentropic/h2a` + `@sentropic/h2a-cli`
- [x] Initialize local Git repository
- [x] Create and push GitHub repository `rhanka/h2a`
- [x] Bootstrap npm workspace and TypeScript build
- [x] Publish `@sentropic/h2a@0.1.0`
- [x] Publish `@sentropic/h2a-cli@0.1.1`
- [x] Fix CLI package publication so the `h2a` bin is preserved
- [x] Choose the project license (MIT — DEC-027)
- [ ] Deprecate `@sentropic/h2a-cli@0.1.0` with a clear message
- [ ] Automate release/publish flow

## Workpackage 10 - `h2a` Core Contracts (~100%)

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

## Workpackage 40 - Host And Protocol Integrations (~55%)

### MCP track

- [x] Freeze the canonical MCP tool names
- [x] Implement a minimal MCP server inside `@sentropic/h2a-cli` (in-process `createMcpServer({ root })`, 4 wired tools: register / discover / inbox / append_journal; JSON-RPC + stdio transport deferred to a later slice)
- [x] Back the MCP server with the same local-files runtime
- [x] Expose the in-process MCP server over JSON-RPC 2.0 / stdio (`runMcpStdio`) and add the `h2a mcp-serve [--root <path>]` CLI verb
- [x] Wire **all 10 MCP tools** (added `h2a_open_negotiation`, `h2a_offer`, `h2a_counteroffer`, `h2a_sign`, `h2a_stabilize`, `h2a_escalate`); full negotiation lifecycle driveable end-to-end over JSON-RPC (`examples/principal-conductors/run.mjs` exercises this as step 9)
- [x] Define actor identity/auth strategy for MCP calls (V1: no transport auth, caller-declared identity + ed25519 artifact signatures — DEC-032)
- [ ] V2: transport auth (mTLS / signed bearer)

### Codex track

- [x] Scaffold the Codex-side plugin surface (host descriptor + `renderMcpConfig` snippet, exposed as `h2a host setup --host codex`)
- [x] Implement registration flow (MCP-level: `h2a host setup --host codex [--write <file>]` merges `mcpServers.h2a` into the Codex CLI config; pre-existing `mcpServers.h2a` divergence requires `--force`; other entries are preserved)
- [ ] Implement inbox / negotiation operations (end-to-end Codex run still TODO; the snippet exposes the full 10-tool MCP surface but no Codex-driven scenario test yet)

### Claude track

- [x] Scaffold the Claude-side plugin surface (host descriptor + `renderMcpConfig` snippet, exposed as `h2a host setup --host claude`)
- [x] Implement registration flow (MCP-level: `h2a host setup --host claude [--write <file>]` covers both `~/.config/claude/mcp.json` and project-local `.mcp.json`)
- [ ] Implement inbox / negotiation operations (end-to-end Claude Code run still TODO; mirrors the Codex gap)

### Gemini track (wave 2 — DEC-028)

- [x] Decide whether Gemini stays first-wave or second-wave → **deferred to wave 2**
- [ ] In wave 2, add the same minimal surface as Codex/Claude (host descriptor stays in `h2a hosts` meanwhile)

## Workpackage 50 - Governance, Vocabulary, And Model Semantics (~50%)

- [x] Stabilize umbrella naming around `h2a`
- [x] Capture vocabulary v1.7
- [x] Capture `EXECUTIF`, `CONTROL`, and `ENFORCEMENT_PLAN` decisions
- [x] Capture the 2-package topology decision
- [x] Produce compatibility evaluation notes
- [x] Produce the initial runtime proposal
- [ ] Stabilize the mapping to the three ABC models
- [ ] Counter-audit `CONTRACT` vs `POLICY` vs `ENGAGEMENT`
- [ ] Define escalation targets per scope in executable terms
- [x] Define the `1 PRINCIPAL / 15 CONDUCTORS` use case end-to-end (definition is executable in `examples/principal-conductors/`)
- [ ] Frame multi-human modes beyond pairwise dialogue
- [ ] Decide what becomes protocol, what stays policy, what stays implementation

## Workpackage 60 - Quality, Examples, And Ops (~60%)

- [x] Add baseline automated tests
- [x] Keep `npm test` green after publication fixes
- [x] Add CI workflow for build + tests (`.github/workflows/ci.yml`, Node 20/22 matrix)
- [x] Add npm install smoke test for published packages (`.github/workflows/smoke.yml`, installs `@sentropic/h2a-cli@0.1.1` globally and exercises the CLI surface)
- [x] Add an example project for `1 PRINCIPAL / 15 CONDUCTORS` (`examples/principal-conductors/run.mjs`, gated integration test `H2A_RUN_EXAMPLE=1`)
- [x] Add release notes / publish procedure doc (`docs/release.md`)
- [x] Add security/key management notes (`docs/release.md` § Key management)
- [ ] Add compatibility matrix documentation for Codex / Claude / Gemini / MCP

## Open Decisions / User Inputs

- [x] Choose the project license → MIT (DEC-027)
- [x] Confirm whether to deprecate `@sentropic/h2a-cli@0.1.0` → yes, with redirect message (DEC-029); awaiting npm auth
- [x] Choose the next main delivery → core schemas first (DEC-030)
- [x] Decide whether `gemini` stays in wave 1 → deferred to wave 2 (DEC-028)

## Next Recommended Slice

Recommended next implementation slice:

1. Add the missing core artifact schemas in `@sentropic/h2a`
2. Implement the local-files store on top of those schemas
3. Wire `h2a-cli register`, `discover`, and `inbox read` to that local runtime
4. Only then expose the same flow through MCP
