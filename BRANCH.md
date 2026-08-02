# Feature: DEF identity-binding cull tool

## Objective

- [x] Emit a deterministic, read-only proof packet for every DEF identity component and keep every component unless all four gates have positive evidence.
- [x] Expose `h2a identity cull --dry-run` and hard-refuse all execution attempts until the root fix, owner authorization, and structural writer fence exist.

## Scope / Guardrails

**Allowed Paths**

- `BRANCH.md`
- `packages/h2a-runtime/src/identity-cull/**`
- `packages/h2a-runtime/src/index.ts`
- `packages/h2a-runtime/src/cli-help-groups.ts`
- `packages/h2a/src/cli-command-map.ts`
- `packages/h2a/test/fixtures/runtime-help-commands.json`
- `docs/reviews/**` only for the required harness review record

**Forbidden Paths**

- `.track/**`
- DEF and PIN stores
- `packages/h2a/src/runtime/identity/bindings.ts`
- dependency manifests and lockfiles
- `Makefile`, Docker files, and generated focus assets

## Plan / Todo (lot-based)

- [x] **Lot 1 — fail-closed analysis and packet**
  - [x] Read the canonical DEF binding bytes exactly, derive only supported identity components, and preserve byte-level evidence.
  - [x] Apply L/O/P/C gates with source gaps and absent `S_R` as explicit UNKNOWN/KEEP reasons.
  - [x] Emit the spec-required packet artifacts, zero-row would-cull set, lookup replay, positive controls, and reconciliation summary.
  - [x] Add focused unit controls for protected/live/owner/fallback/outside-window/quiet/concurrent identities and empty cull set.
  - [x] Gate: focused tests and runtime TypeScript check pass.

- [x] **Lot 2 — CLI and inert execution guard**
  - [x] Register `h2a identity cull --dry-run` with canonical root/output validation and help-map coverage.
  - [x] Implement typed execution prerequisite refusal before any active-store, staging, or quarantine write.
  - [x] Verify the held-descriptor length/hash check detects an injected append and aborts before a rename callback.
  - [x] Run the real DEF dry run and record the packet summary; run runtime-suite baseline/branch failure-set comparison.
  - [x] Gate: execution-refusal and structural-CAS tests pass; cull set remains empty.

## Feedback Loop

- [x] Defer actual descriptor-relative staging, quarantine swap, and restoration until the separately authorized root fix supplies a non-bypassable writer path and native confinement support.
