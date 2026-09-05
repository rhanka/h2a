# SPEC — V1→V2 adapter: h2a memory clients (#148) → graphify `MemoryPortV2`

**Lane:** memory-core (WP11) · **Feeds:** the memory-finalization drive (owner ASAP mandate, gr-conductor) · **Status:** design proposal — the swap is HELD until gr-conductor publishes the contracts package and returns the exact `name@version`.

## Why this is an adapter, not an import swap

`#148` (`feat/memory-seam-h2a-consumer`, rebased clean on main `d79991ce` → `a391540c`, 127/127 green vs the vendored stub) targets the **V1** producer/recall port it vendored (`admitMemoryNote` / `promoteNote` / `requestTombstone` / `recallMemory`, with `MemoryNoteInput`). Graphify main (`20df1405`) exposes **`MemoryPortV2`** (`graphify-memory/contracts/index.ts:917`), a redesign with a different surface. So the vendored-port → real-import step is a **V1→V2 anti-corruption adapter** on the h2a side, keeping the `d11-ceremony` governance logic intact and changing only the port-facing calls.

## Import source: **V (vendored types-only + drift-guard) now**, A (publish) as later cleanup

Measured by gr-conductor: `@graphify/memory-contracts` is `private:true`, has no `publishConfig.access:public`, sits under the `@graphify` scope (not the owned/published `@sentropic`), and has no built dist — so publishing it (**A**) is an owner act plus a scope decision, not a bump, and gr-conductor's session is not npm-authenticated. Under the owner's ASAP mandate, the chosen path is **V**: h2a **re-vendors the V2 contract types** (types-only, **zero graphify runtime** → anti-cycle preserved, exactly as `#148` already vendors V1), and a **CI drift-guard** fails if the vendored copy diverges from graphify main's contract. The adapter logic is identical either way — only the import *source* differs (vendored-guarded vs published). **A remains the clean end-state** for when the owner wants to publish the contract package; migrating V→A is then a one-line import change plus deleting the vendored copy, with no adapter rework.

### The drift-guard (mechanism to settle)
A CI test that fails if h2a's vendored V2 copy no longer matches graphify main's `graphify-memory/contracts/index.ts`. Open sub-decision: how the h2a CI reaches graphify's contract to compare — options: (a) **digest-pin** — store the SHA-256 of the exact graphify type blocks h2a depends on; the guard re-derives and fails on mismatch (simplest; flags any change for a re-vendor review); (b) **structural extract+compare** of the depended-on type names (more robust, more code). Requires the graphify contract source or a committed contract fixture reachable at h2a CI time (graphify is a sibling repo locally; CI reachability is the constraint). Proposed start: (a) digest-pin, tightened later. Owner of the mechanism: memory (me) + whoever owns h2a CI's access to the graphify contract.

## Layering that the adapter must preserve (measured)

graphify **applies** atomically (`requestAdmission` + `transition` are the store-level mechanical accept/lifecycle, `atomic_promotion:true`); h2a **decides** (the 2-leg `d11-ceremony` — absent from the contract, so not redundant). The adapter maps h2a's decisions onto the V2 apply calls; it does not move governance into graphify, and it must not let graphify's `AdmissionPolicy` become a **second** admission authority (see G5).

## Method mapping (measured against `MemoryPortV2`)

| h2a V1 client call | V2 port call | Return | Note |
|---|---|---|---|
| `admitMemoryNote(note)` | `capture(CaptureRequestV2)` | `CaptureAcknowledgementV1` (`committed_pending`) | `committed_pending` = the V1 `pending` admission |
| `promoteNote(noteId, d11Evidence)` | `requestAdmission(AdmissionRequestV1)` | `AdmissionOutcomeV1` (`accepted`) | the D11 verdict **decides**; `requestAdmission` **applies**. Evidence home = G4 |
| `requestTombstone(target)` | `transition({operation:"tombstone", record_id})` | `LifecycleReceiptV1` | receipt is signed (digests) → **O3 tombstone-receipt already covered by V2** |
| `recallMemory(query)` | `recall(RecallRequestV2)` | `RecallPacketV2` | richer: budgets, ranking, redaction, digests |

Also available and worth wiring: `validate(CandidatePayloadV2)` (pre-flight digest — replaces the local `preflight.ts` shape check with a contract-level one), `capabilities()`/`readiness()` (fail-closed gating), `cancelCapture()`.

## Field mapping — `MemoryNoteInput` → `CaptureRequestV2`

`CaptureRequestV2 = { schema_version:2, idempotency_key, payload:CandidatePayloadV2, evidence:EvidenceBundleV1, authorization:AuthorizationContextV1, source_order, deadline_at, cancellation_ref }`.

`CandidatePayloadV2` mapping:
- `memory_kind` (context|decision|evidence) → a `MemoryComponentV2.kind` / `primary_event.type_ref` — **G3** (V2 structures content into `components[]` + a closed `MemoryComponentKind`; the h2a note's flat content must be restructured into one or more components with `text` + `citation_ids`).
- `subject` → carried in a component / scope — **G1** (V2 has no top-level `subject`; the human-subject gating rides `scope_ref` + `purpose_ref` + `retention`).
- `event {at, kind, ref}` → `primary_event: PrimaryEventAnchorV1 {at, type_ref, citation_id}` — `at`→`at` (direct), `kind`→`type_ref` (OpaqueRef, **G3**), `ref`→`citation_id` (+ a `CitationV1` in `citations[]`).
- `principal_owner` + `scope` (private|capitalised) → `scope_ref: OpaqueRef` — **G1** (V2 uses an opaque scope reference, not `{owner, enum}`; the adapter must resolve/construct the ref).
- human `purpose` → `purpose_ref: OpaqueRef` — **G1** (V2 requires `purpose_ref` for **every** capture, not only human-subject; the adapter needs a default purpose for non-human).
- human `TTL` → `retention: RetentionV1 {expires_at?, derivative_rule:"retain"|"make-ineligible"}`.
- reconciliation consent (co-spec C1) → `reconciliation: ReconciliationConsentV1 {family_refs}`.
- `valid_time: ValidIntervalV1` → from the note's temporal bounds (the co-spec `t`/`t_end`; **G6** if only `at` exists, define the interval).
- `trust` tier (earned|asserted|signed) → **NOT supplied by the caller**: V2 derives `TrustBindingV1.class` at admission via the `EvidenceVerifierPort` from `EvidenceBundleV1`. The adapter supplies `evidence: EvidenceBundleV1 {evidence_ref, evidence_digest, citation_ids, attestation?}`, and the verifier classifies. **This aligns with earned-not-asserted** — the adapter stops asserting a tier and supplies evidence instead — **G2** (what evidence does an ordinary agent-memory note carry?).

## Field mapping — D11 promotion → `requestAdmission`

`AdmissionRequestV1 = { candidate_id, authorization:AuthorizationContextV1, deadline_at }`. My `promoteNote(noteId, {leg1_verdict_ref, leg2_verdict_ref, independence_attestation})`:
- `noteId` → `candidate_id`.
- the D11 evidence (two verdict refs + independence attestation) → **G4**: `AdmissionRequestV1` has no evidence field; it carries only `authorization`. Options: (a) the D11 evidence is recorded h2a-side and referenced via `AuthorizationContextV1.context_ref` (an OpaqueRef to the h2a ceremony receipt); (b) the D11 evidence rides the earlier `capture`'s `EvidenceBundleV1`. Proposed: (a) — the ceremony receipt is an opaque ref the authorization carries; graphify applies on a valid authorization, h2a holds the auditable D11 artifact. **Needs gr-conductor/graphify confirmation.**

## Field mapping — recall → `RecallRequestV2`

`RecallRequestV2 = { query, purpose_ref, as_of?, authorization, capability_policy, budgets, page? }` → `RecallPacketV2` (records: `MemoryRecordV2[]` + rank_receipt + digests). My `recallMemory(query, ctx, projection:'notes-only')`:
- `query` → `query`; `ctx.principal_owner` → `authorization` (**G2** credential) + `scope` via `purpose_ref`/authorization.
- `projection:'notes-only'` → V2 returns records (not an induced subgraph) natively — the notes-only guarantee is the record packet. The recall-client keeps only the **projection-shape** duty (no human-subject aggregation); tenancy/redaction is the port's (consistent with the recall-served-by-SQLite spec's single-authority rule).
- `budgets` (max_candidates/results/packet_bytes/deadline) → the adapter must supply sensible defaults (new surface, not in V1).

## Gaps / decisions (each blocks a precise adapter; owner = named)

- **G1 — opaque scope/purpose refs.** `scope_ref`/`purpose_ref` are `OpaqueRef`s, not `{principal_owner, scope-enum, purpose}`. How does the adapter obtain them (construct, look up, or receive)? This is the tenancy/identity boundary. → gr-conductor/graphify + h-arch (ties to I1/D-FED-3).
- **G2 — `AuthorizationContextV1.credential` + the evidence a note carries.** V2 authorization is a `credential` (a token/proof), and trust is verifier-derived from an `EvidenceBundleV1`. What credential does an h2a per-call principal present, and what evidence does an ordinary note carry (for the `asserted` class)? → h-arch (dynamic-principal transport, the D28 gap) + graphify (verifier policy).
- **G3 — content restructuring.** The flat h2a note → V2 `components[]` (`MemoryComponentKind` + `text` + `citation_ids`) and `type_ref` OpaqueRefs. Define the mapping of `memory_kind`/`event.kind` onto the V2 component/type vocabulary. → memory (me) + graphify (the closed `MemoryComponentKind`/`type_ref` sets).
- **G4 — D11 evidence home in `requestAdmission`** (proposed: `authorization.context_ref` → the ceremony receipt). → gr-conductor/graphify confirm.
- **G5 — single admission authority.** h2a's `d11-ceremony` decides; graphify's `requestAdmission`/`AdmissionPolicy` applies. Ensure the `AdmissionPolicy` does not independently re-adjudicate (a second authority = the D10 debt). Proposed: for h2a-decided admissions the `AdmissionPolicy` is pass-through on a valid authorization. → gr-conductor/graphify.
- **G6 — `valid_time` interval** from the note's temporal anchor (bi-temporal D9 slot). → memory + graphify.

## Acceptance criteria

- **AC-A1** — the adapter compiles + re-verifies `#148`'s existing suite green against a **V2-shaped stub** (the D11/tenancy/projection tests unchanged in intent; only the port-facing fixtures move V1→V2).
- **AC-A2** — the `d11-ceremony` governance code is byte-unchanged except its final apply call (`promoteNote`→`requestAdmission`); its 4-round anti-fabrication mutation-checks still pass.
- **AC-A3** — one admission authority: a test shows a `requestAdmission` reaching `accepted` only via an h2a-ceremony-authorized path, not a second graphify adjudication (G5).
- **AC-A4** — tombstone returns a `LifecycleReceiptV1` (signed receipt), and the O3 receipt need is satisfied without a separate extension.
- **AC-A5** — recall returns records (notes-only), tenancy enforced port-side, the recall-client re-filters nothing (consistent with the recall-served-by-SQLite spec's single-authority + fail-closed assertion).

## Sequence

publish `@graphify/memory-contracts@<version>` (gr-conductor) → resolve G1–G6 (short, mostly graphify/h-arch) → build the adapter (heavy → codex, native) against the published types → re-verify green → `#148` merge-ready → gr-conductor coordinates the merge act (h-cond/owner). Swap HELD until `name@version`.
