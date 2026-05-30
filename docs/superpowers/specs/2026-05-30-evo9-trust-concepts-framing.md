# EVO-9 — Trust concepts (VALEUR / ATTENTION / INTÉRÊT / MUTUALISATION / CONFIANCE) — framing

**Date**: 2026-05-30 · **Status**: framing (pre-spec) — forks pending PRINCIPAL ratification
**Source**: inbound h2a request from `claude:sentropic-scale` (brief `../sentropic/handover-h2a-trust-concepts.md`, with the user's verbatim prompts). Goal: integrability parity with `iii` **by independent MIT design**; differentiator = h2a models **trust in the engagement** (intentional/governance), not capabilities (mechanical).

## Headline finding (groundwork)

All five concepts fit the proven h2a spine **declare → derive a posture by pure calculation → attest by signature** (the NHI pattern, DEC-087/088) with **zero additions to the frozen `H2A_ARTIFACT_KINDS` and `H2A_ROLES` sets**. The only frozen-surface touch is **one additive optional field on ENGAGEMENT** (VALEUR). The contractual collapse-guard (`contractual.ts`) permits it because it stays within the ENGAGEMENT profile.

Invariants each concept was checked against (all respected): SCOPE never signs; ENGAGEMENT has a scope but is not the scope; CONTROL owns nothing (observes/constrains/vetoes/alerts); AGENTS non-signatory by default; declare→derive→attest.

## Per-concept insertion point

1. **VALEUR / chaîne de valeur** — additive optional field on `H2AEngagement` (`aval` downstream-link + `finaliteAmont`); the chain is **derived by traversal**, never a stored object; cross-org links resolve through the existing disclosure modes (`disclosure.ts`, opaque boundaries by default). Not a new abstraction — the *linkable, named finalité* the existing INTENTION/`successCriteria` already express. No artifact.
2. **ATTENTION** — bilateral comprehension attestation at the `decide` gate, as a **signed `event` envelope** (DEC-088 clone, `comprehension-attestation` body kind). Reuses the escalation/MANDATAIRE `decide` machinery. *Tension*: the agent-side attestation collides with "AGENTS non-signatory" → resolve via a narrow MANDATE right (`attester-comprehension`) vs an unsigned acknowledgement (decision below). No artifact.
3. **INTÉRÊT** (human conflict of interest; agents have none) — declared interest + **derived conflict posture** (cross bindings × collective-scope × signed decision) + **CONTROL** as guardian (its native veto/alert) + a **gate on negotiation stabilization**. The engine surfaces + routes, never judges legitimacy (matches the existing `escalate-not-resolve` stance). No artifact.
4. **MUTUALISATION** — the **positive mirror of NHI9**: scope overlap = a capitalisation opportunity. A **pure derived advisory** (peer of `nhiInventory`) over the registry's instances × scopes; surfaces candidates, obligates nothing; conditioned on serving the objective. Feeds the MIT librarisation goal. No artifact, no field.
5. **CONFIANCE** — a **derived predicate** over an ENGAGEMENT: `attentionAttested ∧ noUndisclosedCollectiveConflict`, checked at stabilization. Not a stored score, not a CONTROL artifact. The core differentiator vs `iii`.

## CRITICAL token collision

`interests` is **already taken** in the codebase: `H2ASessionInterests` (notification subscription topics: scopes, negotiations) — pervasive across `session.ts`/`cli.ts`/`notifications.ts`. The INTÉRÊT concept **must not** use `interest`/`interests` as a code identifier. Use the French concept token **INTÉRÊT** in docs, and `conflit`-prefixed code identifiers (`conflitInteret`, `postureConflit`). Add a VOCABULARY disambiguation note.

## Candidate tokens (French proper nouns; no franglais)

Concept names stay French proper nouns (VALEUR, ATTENTION, INTÉRÊT, MUTUALISATION, CONFIANCE — joining the PRINCIPAL/MANDATAIRE lineage). Code identifiers neutral + collision-free: `aval`/`finaliteAmont` (VALEUR), `comprehension-attestation` body kind + `attester-comprehension` MANDATE right (ATTENTION), `conflitInteret`/`postureConflit` + `declaration-interet` body kind (INTÉRÊT), `mutualisation`/`opportuniteMutualisation` (MUTUALISATION), `postureConfiance` (CONFIANCE). Each warrants a new VOCABULARY entry.

## Forks (PRINCIPAL to ratify before spec)

- **Fork A — VALEUR shape**: ENGAGEMENT field + derived chain *(reco)* vs dedicated artifact (artifact = touches the frozen `H2A_ARTIFACT_KINDS` + the collapse-guard → heavier; rejected).
- **Fork B — phasing**: **3 distinct slices ATTENTION → INTÉRÊT → CONFIANCE** *(reco)* vs one "engagement de confiance" block. ATTENTION is low-risk (DEC-088 clone); INTÉRÊT carries the two hard problems (the `interests` collision + the "impact collectif" threshold); CONFIANCE is the composite (must be last). VALEUR + MUTUALISATION are independent pure derivations → can land in parallel.
- **Fork C — "impact collectif" (disclosure threshold)** *(reco: a 3-part disjunction in existing primitives, gating stabilization)*: an interest must be disclosed when **any** of (1) the signed decision reaches beyond the declarer's own scope (a federated/umbrella or another PARTY's scope), (2) the interested human is a **signer** on the decision (the corruption vector), (3) a **CONTROL** role flags it. Disclosure is **proportional** via the existing `H2A_DISCLOSURE_MODES` ladder (attestation/hash-only … evidence-package/redacted-view). The system blocks + routes, never adjudicates.
- **Fork D — agent-side ATTENTION**: a narrow **MANDATE right** `attester-comprehension` *(reco — gives the principal cryptographic proof the agent understood)* vs an unsigned `event` acknowledgement (more conservative w.r.t. the non-signatory invariant).

## Requested deliverable to `claude:sentropic-scale` ("on itère via h2a")

(a) coherence critique vs the frozen model — **above** (all fit, one ENGAGEMENT field, no new artifact/role); (b) token proposal — **above** (with the `interests` collision flagged); (c) position on the forks — **above**. The full reply is sent once the PRINCIPAL ratifies the forks; then spec + build per slice.

## Slice plan (once ratified)

VALEUR (field + derived chain) and MUTUALISATION (pure advisory) in parallel first (lowest risk); then ATTENTION (signed attestation); then INTÉRÊT (declaration + derived conflict posture + CONTROL gate at stabilization); then CONFIANCE (derived predicate). Each: declare → derive (pure) → attest, with `node:test` and a DEC.
