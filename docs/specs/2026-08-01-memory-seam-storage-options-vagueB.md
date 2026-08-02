# Memory-seam STORAGE OPTIONS — Vague B (memory-lane spec)

**Owner:** memory lane (h2a). **Purpose:** spec the storage OPTIONS the agent-memory seam needs
*before storage lays them* — the verrou that unblocks **Vague B**. **Gate (met):** D8 closure ratified
(Track `01KYYTFXVVE9Y46X06H6HFXJT8`) + storage §5 consent (`01KYYVM09…`, laid on graphify `main@2006839e`).
**Companion:** graphify `SPEC_AGENT_MEMORY_SUBSTRATE` §5 + `DESIGN-storage-append-port-D5.md`.

This spec is **decisive** (a recommended choice per option, not a menu) so storage can lay Vague B without
another round. It is design-only; nothing merges without the principal.

## 0. Invariants every option MUST hold (arch's common surface)
- **I1 — durable identity slot.** Keys/partitions reference a DURABLE identity LOCATION for
  `principal_owner`/`subject`; **never solder the per-conversation instance id** (durable identity doesn't
  exist yet → **reserve the slot**; h2a addressing identity is minted per conversation = fragile). Storage
  MUST NOT index on an ephemeral conversation-derived id.
- **I4 — one capabilities vocabulary.** Each Vague-B capability is a VERSIONED extension of the *existing*
  `GraphStoreAppendCapability` shape (mirror M4/`queryWindow`), never a second vocabulary.
- **I5 — fail-closed.** Every option declares its behaviour when the backend can't honour it, and the
  **default is REFUSE**, never a silent fallback. A capability a backend lacks is **OMITTED ENTIRELY**
  (the M4 rule), so the caller sees absence and refuses — it never silently no-ops.

## 1. Already LAID (Vague A — do NOT re-open)
`appendNode`/`appendEdge`/`appendTombstone` (unit, upsert-by-key, strict endpoints, tombstone fold-out over
every read surface incl. aggregates), `GraphStoreAppendCapability{version:1, upsert, requiresExistingEndpoints}`,
5 forks resolved (A2-vs-derived-tables, strict edge integrity, **unit-not-batch v1**, anti-cycle type placement,
created/applied booleans). The memory seam's per-turn write already traverses this.

## 2. Vague B options — need · recommendation · fail-closed

### B1. Batch append (deferred in v1 as "batch optionnel plus tard")
- **Need:** the drumbeat write is unit (one note / trigger), but bulk paths exist — initial memory load,
  migration, promoting many pending notes at once. Re-calling unit N× is correct but not the contract for bulk.
- **Recommendation:** add `appendBatch(inputs[], options): Promise<GraphAppendOutcome[]>` as a **versioned,
  forward-compatible** capability (`GraphStoreAppendCapability.batch?: {version:1}`), **all-or-nothing per call**
  (partial-apply is a silent-corruption trap). Keep unit as the primary path.
- **Fail-closed (I5):** backend without batch **omits** the field → caller falls back to a *declared* unit loop,
  never an implicit one; a partial batch failure **throws**, does not half-apply.

### B2. Recall / query at scale (the read path — memory-lane's biggest Vague-B need)
- **Need:** wake-recall reads memory by `asOf` (T6 point) and `window` (T5), tenancy-scoped, tombstone-folded,
  projection-limited. `memory-recall.ts` binds graph-source + tombstone journal; at scale it needs index support.
- **Recommendation:** the recall backend MUST, by construction: (a) apply **tenancy** — `scope:private` is
  **owner-only**, cross-tenant read of a private fact = REFUSE; (b) apply **tombstone fold-out incl. aggregates**
  (an erased element must not still count — A2 teeth); (c) return **`projection:'notes-only'`** — never assemble a
  `subject:"human:"` profile (the projection prohibition holds at READ, not just admission); (d) declare
  **`freshness:'unverified'`** always (a file/snapshot is not attested). Index on `(principal_owner, t)` +
  `subject`; the index is a perf detail, the four guarantees are contract.
- **Fail-closed (I5):** window unsupported → `query:false` declared (mirror existing), caller refuses the window
  path; a recall that cannot prove tenancy/fold-out **returns empty + `refused`**, never a best-effort leak.

### B3. Retention / TTL sweep (A2 — subject-human erasure with teeth)
- **Need:** a `subject:"human:"` fact carries `retention`; past it, the fact MUST NOT be served. Append-only has
  no delete → same mechanism as tombstone.
- **Recommendation:** **on-read fold-out at expiry** (a fact whose `t + retention < now` is excluded from every
  read/aggregate, exactly like a tombstone), PLUS an optional **background compaction** capability that appends
  expiry-tombstones (space reclaim, not correctness). Correctness lives on read; compaction is housekeeping.
- **Fail-closed (I5):** a backend that cannot enforce on-read retention **must refuse subject-human facts at
  admission** (per §3.5 — "a substrate that cannot honour a deletion cannot hold subject-human facts").

### B4. Multi-tenant partition (`principal_owner`)
- **Need:** v1 namespace = one config string; shared/capitalised memory needs per-principal isolation.
- **Recommendation (carried from co-spec):** **namespace carries the workspace; `principal_owner` is a
  gated node ATTRIBUTE**, not a caller-selected namespace (which stays in the hard gate). `scope:private`
  filters to `ctx.principal_owner`; `scope:capitalised` is cross-principal-readable. This avoids partition
  explosion and keeps namespace-selection out of the caller's hands.
- **Fail-closed (I5):** a note whose `principal_owner` ≠ `ctx.principal_owner` on a private read = REFUSE; a
  caller-supplied namespace = REFUSE (hard gate).

### B5. Bi-temporality slot (D9) — RESERVE, do not lay in Vague B
- **Need:** a transaction-time axis distinct from valid-time (`t`/`t_end`) is a *later* contract (owner D9).
- **Recommendation:** **reserve** a `t_tx?` pass-through field now (forward-compatible), but **do NOT lay**
  the second-axis query in Vague B — it is gated on the closed-interval convention (§7) being authoritative
  end-to-end. Laying a second axis over an ambiguous first axis multiplies the boundary error.

### B6. Durable-element identity (I1, cross-cutting)
- **Need:** note `id` + `principal_owner` must survive session/conversation churn.
- **Recommendation:** storage keys on the note's own `id` (ULID-like, author-supplied, stable) and treats
  `principal_owner` as a **reserved durable slot** — today it may carry the fragile per-conversation id, but the
  schema/keys must let the durable id drop in later **without a data migration**. No key derives from the
  conversation-minted instance id.

## 3. What this unblocks
With B1–B6 chosen as above, storage can lay Vague B (batch + recall-at-scale + retention + tenant-partition,
reserving D9/durable-id) without re-deciding. Sequence: recall-at-scale (B2) + retention (B3) are the
load-bearing pair for wake-recall to be real; B1/B4 follow; B5/B6 are reserved slots. **Nothing merges without
the principal; the human-attestation caveat on the ratification (graphify `cd7fad55`) still gates the merge train.**

## 4. Open for the owner / storage (not decided here)
- Whether Vague B's scope is exactly B1–B6 or a subset (this spec is the memory lane's proposed scope — correct it).
- Index/engine specifics (storage's call, within the four recall guarantees of B2).
