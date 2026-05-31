# EVO-9 — INTÉRÊT (declared interest + derived conflict posture) — design (buildable)

**Date**: 2026-05-31 · **Status**: design, validated by claude:a2a-cli — **ready to delegate** · **Refers**: `2026-05-30-evo9-trust-concepts-framing.md` (Fork C threshold + Opus stabilization), `evaluations/confiance/conflict-of-interest-cases.md` (the 3-criterion calibration corpus), DEC-035 (`H2A_AUTHORITY_MATRIX`, `stabilizeNegotiation`), `H2A_DISCLOSURE_MODES` (DEC-045), DEC-112 (`aval`/`finaliteAmont`).

## Scope (this slice)

Human **conflict of interest** (agents have none): a **declared interest** + a **pure derived conflict posture** + a **CONTROL guardian** + a **gate at negotiation stabilization**. The engine **surfaces + routes, never judges legitimacy** (matches the existing `escalate-not-resolve` stance). Independent of ATTENTION-core (different body kinds/derivations) → can build in parallel; the ATTENTION **dossier-layer** and CONFIANCE compose this later.

## Honesty / invariants
- The engine records *declared* interests and derives a *structural* posture; it **never adjudicates** whether an interest is legitimate, and **never measures** harm. Complexity/impact that cannot be computed is a **declared flag** (`declare`, not `derive`).
- Advisory + escalation; **no welded veto** in `stabilizeNegotiation` (CONTROL gets a role-level alert/veto, not a soldered gate).
- Tokens (frozen French lineage, no franglais, never `interest`): `conflitInteret`, `postureConflit`, body kind `declaration-interet`, `derivePostureConflit`.

## Design — declare → derive → gate

### Core (`@sentropic/h2a`, pure)
- **Body kind** `declaration-interet`:
  ```
  H2ADeclarationInteret = {
    kind: "declaration-interet",
    subject: string,            // the human/role declaring
    interets: string[],         // declared interest descriptors (opaque labels)
    bindings?: string[],        // related scopes/parties the interest touches
    masqueImpactCollectif?: boolean,  // DECLARED "hard-to-measure collective impact" flag (never derived)
    at: string
  }
  ```
- **Pure derivation** `derivePostureConflit(subject, context) -> H2APostureConflit` where the posture is one of `none | a-surveiller | conflit-declarable` derived **only from structural/declared inputs** — never an engine opinion. The **3-criterion disjunction** (Fork C, calibrated against `conflict-of-interest-cases.md`): an interest must be disclosed when **any** of
  1. the signed decision reaches **beyond the declarer's own scope** (a federated/umbrella or another PARTY's scope — structural, via `aval`/scope graph),
  2. the interested human is a **signer** on the decision (the corruption vector — structural, from the signer set),
  3. a **CONTROL** role **flags** it (the human-judgment escape valve).
  Output also carries the **proportional disclosure mode** (from `H2A_DISCLOSURE_MODES`: attestation/hash-only … evidence-package/redacted-view) — proportional, not punitive.

### Two call sites, one derivation (Opus F4)
`derivePostureConflit` is called with **different subjects/moments**, kept distinct:
- the **signers** at **stabilization** (the INTÉRÊT gate — this slice);
- (later) the **presenter** at `decide` (the ATTENTION dossier non-bias gate — different slice, same pure function).

### Gate at stabilization (`@sentropic/h2a` / `stabilizeNegotiation`)
When a signer's `postureConflit` is `conflit-declarable` and undisclosed → `stabilizeNegotiation` **does not auto-stabilize**; it **routes + escalates** (CONTROL alert + the proportional disclosure requirement) instead of silently proceeding. **No veto soldered into the syntactic stabilizer** — it surfaces the blocker and the required disclosure; the declared authority still decides. CONTROL's native alert/veto is the guardian.

### Surface (`@sentropic/h2a-cli`)
- `h2a declare-interest --instance --interets … [--masque-impact-collectif]` (writes the `declaration-interet`).
- `h2a conflict-posture --negotiation <id>` (reads + derives the posture for the signer set; advisory output).
- MCP tool parity optional.

## Test plan (`node:test`)
1. `derivePostureConflit`: each of the 3 criteria independently fires `conflit-declarable`; none firing → `none`/`a-surveiller`. Calibrate against the documented cases (Enron 2∧1, FIFA 2∧3, 1MDB 1∧2, AgenceX procurement 2).
2. proportional disclosure mode scales with scope (small internal → attestation; collective/public → evidence-package).
3. stabilization gate: an undisclosed `conflit-declarable` signer blocks auto-stabilize + routes/escalates (no silent stabilize); disclosure resolves it.
4. **no legitimacy judgment / no measurement**: `masqueImpactCollectif` is read as a declared flag, never computed.
5. proves CONTROL flag (criterion 3) alone triggers, and is non-subordinate.

## Delegation note (orchestrator)
One coherent codex WP. **Boundaries**: `@sentropic/h2a` (body kind + `derivePostureConflit` + stabilization gate hook) + `@sentropic/h2a-cli` (verbs + optional MCP) + tests. Pure-first. DEC-119 (EVO-9 slice 3: INTÉRÊT). Builds in parallel with ATTENTION-core (no shared body kind); expect localized merge conflicts on core `index.ts` + cli verb registration only. Do **not** build the ATTENTION dossier-layer or CONFIANCE here.
