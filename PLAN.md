# H2A Project Plan

> Last update: 2026-05-18
> Purpose: durable project board for backlog, progress, and sequencing.
> Tracking rule: keep `[x]` for done and `[ ]` for remaining work; update this file after each meaningful change.

## Snapshot

- Overall estimated progress: ~30%
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
- [ ] Choose the project license
- [ ] Deprecate `@sentropic/h2a-cli@0.1.0` with a clear message
- [ ] Automate release/publish flow

## Workpackage 10 - `h2a` Core Contracts (~30%)

- [x] Define protocol id `sentropic.h2a`
- [x] Implement envelope creation
- [x] Implement envelope validation guard
- [x] Implement negotiation state guard
- [x] Publish first core package bootstrap
- [ ] Implement schemas for `CONTRACT`, `POLICY`, `ENGAGEMENT`, `AMENDMENT`
- [ ] Implement `MANDATE`, `AUTHORITY`, `SIGNATURE`, `ENFORCEMENT_PLAN`
- [ ] Encode role/authority constraints for `PRINCIPAL`, `EXECUTIF`, `CONDUCTOR`, `CONTROL`, `MANDATAIRE`
- [ ] Add canonicalization and hash computation
- [ ] Add signature verification
- [ ] Add append-only journal structures
- [ ] Add compatibility tests on canonical artifacts

## Workpackage 20 - Local Runtime And Store (~5%)

- [x] Document the target local-files mode
- [ ] Freeze the path convention `src/{project}/h2a/...`
- [ ] Implement registry storage layout
- [ ] Implement negotiation storage layout
- [ ] Implement inbox/outbox local transport
- [ ] Enforce immutable stabilized artifacts
- [ ] Implement journal chaining with `prevHash`, `causationId`, `correlationId`
- [ ] Define concurrency / file locking behavior
- [ ] Define migration/versioning strategy for local state

## Workpackage 30 - `h2a-cli` Surface (~40%)

- [x] Create unified `@sentropic/h2a-cli` package
- [x] Keep internal modules for `mcp`, `codex`, `claude`, `gemini`
- [x] Implement `h2a --help`
- [x] Implement `h2a hosts`
- [x] Implement `h2a mcp-tools`
- [x] Publish a working npm CLI package
- [ ] Implement `h2a init`
- [ ] Implement `h2a register`
- [ ] Implement `h2a discover`
- [ ] Implement `h2a negotiate open`
- [ ] Implement `h2a negotiate offer`
- [ ] Implement `h2a negotiate counter`
- [ ] Implement `h2a negotiate sign`
- [ ] Implement `h2a negotiate stabilize`
- [ ] Implement `h2a inbox read`
- [ ] Stabilize JSON output contracts and exit codes

## Workpackage 40 - Host And Protocol Integrations (~10%)

### MCP track

- [x] Freeze the canonical MCP tool names
- [ ] Implement a minimal MCP server inside `@sentropic/h2a-cli`
- [ ] Back the MCP server with the same local-files runtime
- [ ] Define actor identity/auth strategy for MCP calls

### Codex track

- [ ] Scaffold the Codex-side plugin surface
- [ ] Implement registration flow
- [ ] Implement inbox / negotiation operations

### Claude track

- [ ] Scaffold the Claude-side plugin surface
- [ ] Implement registration flow
- [ ] Implement inbox / negotiation operations

### Gemini track

- [ ] Decide whether Gemini stays first-wave or second-wave
- [ ] If first-wave, add the same minimal surface as Codex/Claude

## Workpackage 50 - Governance, Vocabulary, And Model Semantics (~45%)

- [x] Stabilize umbrella naming around `h2a`
- [x] Capture vocabulary v1.7
- [x] Capture `EXECUTIF`, `CONTROL`, and `ENFORCEMENT_PLAN` decisions
- [x] Capture the 2-package topology decision
- [x] Produce compatibility evaluation notes
- [x] Produce the initial runtime proposal
- [ ] Stabilize the mapping to the three ABC models
- [ ] Counter-audit `CONTRACT` vs `POLICY` vs `ENGAGEMENT`
- [ ] Define escalation targets per scope in executable terms
- [ ] Define the `1 PRINCIPAL / 15 CONDUCTORS` use case end-to-end
- [ ] Frame multi-human modes beyond pairwise dialogue
- [ ] Decide what becomes protocol, what stays policy, what stays implementation

## Workpackage 60 - Quality, Examples, And Ops (~20%)

- [x] Add baseline automated tests
- [x] Keep `npm test` green after publication fixes
- [ ] Add CI workflow for build + tests
- [ ] Add npm install smoke test for published packages
- [ ] Add an example project for `1 PRINCIPAL / 15 CONDUCTORS`
- [ ] Add release notes / publish procedure doc
- [ ] Add security/key management notes
- [ ] Add compatibility matrix documentation for Codex / Claude / Gemini / MCP

## Open Decisions / User Inputs

- [ ] Choose the project license
- [ ] Confirm whether to deprecate `@sentropic/h2a-cli@0.1.0`
- [ ] Choose the next main delivery after planning:
  - local-files runtime first
  - MCP server first
  - Codex/Claude integration first
- [ ] Decide whether `gemini` stays in wave 1

## Next Recommended Slice

Recommended next implementation slice:

1. Add the missing core artifact schemas in `@sentropic/h2a`
2. Implement the local-files store on top of those schemas
3. Wire `h2a-cli register`, `discover`, and `inbox read` to that local runtime
4. Only then expose the same flow through MCP
