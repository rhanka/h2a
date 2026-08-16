# SPEC — `recallMemory` served by SQLite: one authoritative tenancy filter

**Lane:** memory-core (WP11) · **Feeds:** the unified-server build plan (WP6, h-arch) · **Status:** design, HELD — nothing switches before D28 + S2 (owner decision `01M01MN6F14GGY19Y96T00JP82`).

## Decision this builds *from* (not re-questioned)

Owner note 2026-08-09 (`graphify_in_h2a_local_sentropic_light.md`): the local-scope storage **authority is a single SQLite store** — graphify's graph + vector included (sqlite-vec, recursive CTEs); Postgres/AGE only at the full/cloud tier. h2a is a *sentropic local light*. So `MemoryRecallPort` is, locally, **served by SQLite**. The built memory-core clients (#148, port-stubbed, ~2841 lines / 8 files / 151 tests green **against an injected port**) are port-agnostic: the cost of the switch is in the port's server, not the clients.

## The problem this spec closes

`recallMemory(query, ctx)` decides **who may see which notes** (tenancy). If that visibility rule is enforced in **two** places — the SQLite query *and* a re-implementation elsewhere (the h2a recall-client, or a second server path) — the two can drift, and a note becomes visible or hidden depending on which authority answers. That is precisely the dual-authority debt **D10 forbids**. This spec fixes the visibility authority in exactly one place and makes it **structural, not conventional**.

## Rule 1 — the SQLite recall query is the ONE visibility authority

- Tenancy (who-can-see) lives **only** in the SQLite recall query that *is* the `MemoryRecallPort` implementation. There is no second code path that reads the notes store for recall and re-derives visibility.
- The h2a **recall-client does NOT re-filter tenancy.** Its job is **projection shape only**: enforce `projection:'notes-only'` (a recall result is not an induced subgraph) and refuse to aggregate `subject:"human:<id>"` notes into a profile (no `UserModel` reachable). Tenancy (visibility) and projection (shape) are *different concerns*; only tenancy is at risk of duplication, and it stays server-side.
- **Defense in depth WITHOUT a second authority — a fail-closed ASSERTION, not a filter (h-arch's arbitration).** A post-query assertion verifies every returned row is in-scope for `ctx.principal_owner` and **RAISES** (refuses the call) if any is not. This is structurally distinct from a second filter: an assertion **never modifies the result, it refuses** — so the query stays the *sole* authority on who-sees-what, while a store/`WHERE` bug that widened becomes a **loud incident** instead of a silent leak. A filter that *corrects* would be a second authority; an assertion that *refuses* is not. This recovers the safety property `knowledge`'s re-filtered-superset design has (a widening store bug cannot leak) **without** its cost (a second visibility authority).
- **Structural, not convention:** the notes store is read for recall through exactly one query path. AC5 is a structural check that nothing else filters by `scope`/`principal_owner`.

## Rule 2 — the principal is dynamic per call, fail-closed

Three lanes measured the same gap (memory I1, `knowledge`'s contract requirement, h-arch's D28): identity must ride the **request**, not be frozen in the instance. So:

- `ctx.principal_owner` is a **per-call** parameter of `recallMemory`. It is **never** a static per-instance/per-connection credential.
- **Fail-closed:** a missing/empty `ctx.principal_owner` **REFUSES** (returns the structurally-distinct refused shape), and **never** falls back to "return everything." A recall with no principal returns no cross-tenant data — it returns a refusal.
- Corollary carried to the conductor by h-arch: "one server per principal" (D37) is not a desirable property — it is the *symptom* of a transport that cannot carry a dynamic principal. This spec assumes the principal is carried in the call, so a single server serves many principals.

## Rule 3 — the recall query (the visibility WHERE, all in one place)

Given `ctx.principal_owner = P` (fail-closed above), a note is visible IFF, **all evaluated inside the one query**:

- `scope = 'private'` ⇒ `note.principal_owner = P` (owner-only); **or** `scope = 'capitalised'` ⇒ visible within the tenant/workspace boundary (namespace = workspace — see Open item O1 for the exact boundary predicate);
- **AND** the note is not folded out by a **tombstone** — a **single-level `NOT EXISTS` anti-join**, not a recursive cascade (measured by `storage`, `postgres.ts:927-945`: an edge is *live* iff the triple is not tombstoned **AND** its source is alive **AND** its target is alive — an erased endpoint folds its incident edges, **one level, no recursion**; zero `WITH RECURSIVE` in `src/storage`, ports to SQLite verbatim). In the same query, never a post-filter;
- **AND** for a `subject:"human:<id>"` note, its **retention/TTL** (A2) has not expired (expiry fold-out on read);
- **AND** it satisfies the `asOf`/`window` bound (bi-temporal — the D9 slot is reserved; a recall as-of a time returns the store as of that time).

The query **returns notes**, never an induced subgraph (recall ≠ subgraph). Ranking/vector similarity (sqlite-vec) orders results but **never widens visibility** past the WHERE above.

## Feasibility of (b) on SQLite — no blocker to raise

I found no technical reason SQLite cannot hold what graphify holds for `recallMemory`, and `storage` narrowed the base further: **graph traversal lives app-side** (graphology), the `GraphStore` port exposes **no SQL traversal**, and the tombstone fold-out is a **single-level `NOT EXISTS` anti-join** (no recursion) — so SQLite's recursive-CTE maturity is **not on the critical path**, and the scale-of-CTE question falls away with it. vector = sqlite-vec; notes = a table; tenancy + single-level fold-out + TTL + asOf are all expressible as plain `WHERE`/anti-join in the single query. **(b) holds for recall; no new owner decision is needed on this point.** (The one coupling that is *not* free — the D11 verdict-artifact store — is a separate first-rank invariant, out of scope for recall; see the companion study.)

## Acceptance criteria

- **AC1 — single authority.** The tenancy filter exists in exactly one code path (the SQLite recall query). Test: the recall-client passes through whatever notes the port returns, re-checking **no** `scope`/`principal_owner` — it only reshapes (notes-only) and refuses human-subject aggregation.
- **AC2 — fail-closed principal.** `recallMemory` with absent/empty `ctx.principal_owner` **refuses** (structurally-distinct refused shape); it never returns a note. Test proves refusal, not empty-that-reads-as-"no memories".
- **AC3 — private isolation.** A `scope:'private'` note owned by principal A is never returned to principal B. Proven at the query level (not the client).
- **AC4 — fold-out in the same query.** A tombstoned note (and any note reachable only via a tombstoned node) and an expired human-subject note never surface via recall — enforced inside the one query, not a post-filter a caller could skip.
- **AC6 — widening is loud, not silent.** An out-of-scope row injected into the query's result makes `recallMemory` **fail** (the fail-closed assertion raises), never merely absent-from-result. The test proves the *raise*, which is what distinguishes the single-authority-plus-assertion model from a two-authority filter (a filter would silently drop the row and pass).
- **AC5 — no second authority (structural), active DURING the transition.** No code path other than the recall query filters recall visibility by `scope`/`principal_owner`. A structural check (grep/lint) guards against a re-implementation reintroducing the D10 dual-authority debt. **It must run throughout the migration, not only at arrival:** during the graphify→SQLite transition the two implementations coexist (graphify-backed `recallMemory` where authority is `isVisibleTo` inside a pure recall + a re-filtered store scan; SQLite-served where authority is the query itself), and that coexistence is exactly the window where two authorities appear without anyone deciding it. The gate is armed for the whole transition so the transient two-*implementations* window never silently becomes a two-*authorities* window.

## Open items (for the plan, not this spec to decide)

- **O1** — the exact `scope:'capitalised'` boundary predicate: visible to any principal in the same workspace namespace, or a narrower shared set? (tenancy boundary definition — owner/arch call).
- **O2** — where the `asOf`/bi-temporal columns live in the SQLite schema (valid-time vs transaction-time) — deferred to the D9 bi-temporal design; the reserved slot must not be back-filled with an unversioned convention.
- **O3** — vector recall (sqlite-vec) ordering must be proven to never widen visibility past the WHERE (AC-testable once the schema lands).
