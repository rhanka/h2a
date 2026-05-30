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

---

## ATTENTION — refinement (PRINCIPAL directive, 2026-05-30) — TO BE ADVERSARIALLY STABILIZED

> **Verbatim (PRINCIPAL)**: « l'attention doit être aussi pour l'humain. un dossier de décision pour la revue d'un contrat doit être présenté relativement à l'intérêt de celui-ci pour motiver son attention relative à son intérêt, et favoriser également l'intérêt de celui qui présente, mais systématiquement favorablement dans un intérêt non biaisé : ie celui qui pose le dossier ne doit pas avoir d'intérêt susceptible de porter atteinte aux intérêts de l'autre en forçant la décision. Le besoin d'attention doit donc être porté sur les éléments les plus risqués d'un point de vue potentiel risque d'intérêts conflictuels potentiellement inducteur de perte de confiance d'une part, mais aussi intrinsèquement à la complexité d'un sujet (technique, à impacts masqués ou difficiles à mesurer) pour que celui qui décide soit pleinement responsable de sa décision sans zone d'ombre. »

**Structured interpretation** (the model adaptation envisaged; pending adversarial stabilization):

ATTENTION is not merely a bilateral "I understood" attestation. It is the discipline that makes a decision **informed and fully owned**, centred on a **decision dossier** (*dossier de décision*) presented for a contract/engagement review:

1. **Bidirectional, human included.** ATTENTION applies to the *human decider* too, not only the agent. The dossier is framed **relative to the decider's interest** — to motivate genuine attention on what is at stake *for them*.
2. **Presenter non-bias precondition (ties to INTÉRÊT).** The dossier also serves the **presenter's** interest, but only within an **unbiased** frame: the presenter must hold **no interest capable of harming the decider's interest by forcing the decision**. A decision-forcing conflict on the presenter side invalidates the presentation.
3. **Attention is targeted at the highest-risk elements** — a derived *ranking*, not a flat "did you read it". Risk has two axes: (a) **conflict-of-interest risk** (potential loss of CONFIANCE — links INTÉRÊT) and (b) **intrinsic complexity** of the subject (technical; masked or hard-to-measure impacts).
4. **Goal: no blind spot (*zone d'ombre*).** The decider is **fully responsible** because the riskiest / most-complex elements were deliberately surfaced and attested-understood.

**Consequences for the model**:
- ATTENTION binds **ATTENTION ↔ INTÉRÊT ↔ CONFIANCE** into one gate at `decide` / stabilization: comprehension (ATTENTION) of a risk-ranked dossier, presented by a non-conflicted presenter (INTÉRÊT), is the validity condition (CONFIANCE).
- The **presenter** is MANDATAIRE-like (neutral presentation, VOCABULARY §1.5) but with an explicit duty to **rank and surface risk** + a **non-bias precondition**.
- The **dossier de décision** is a **derived, risk-ranked view** (declare → derive), attested bilaterally (declare → derive → **attest**) — consistent with VALEUR/MUTUALISATION being derivations, not artifacts.
- The **risk ranking** is a pure derivation: conflict-posture (from INTÉRÊT) × complexity signals.

**Open questions for the adversarial (Opus 4.8) review**:
- Does "attention targeted at the highest-risk elements" over-reach the invariants "the system never judges legitimacy" / "never forces disclosure"? Surfacing/ranking risk implies *some* model of risk — is that a forbidden judgment, or acceptable because it ranks *attention* (procedural) not *legitimacy* (substantive)?
- How is **intrinsic complexity** made operational without the system pretending to measure the explicitly-unmeasurable ("masked / hard-to-measure impacts")? Declared complexity flags? derived from impact-scope + masked-impact markers? A humble "we flag *that* it is hard-to-measure, we do not measure it"?
- Is the presenter non-bias precondition the **same** gate as INTÉRÊT's stabilization gate, or a **distinct, earlier** gate at presentation time (`decide`)?
- How does "fully responsible, no blind spot" become **verifiable** rather than an unfalsifiable claim? (The bilateral signature attests comprehension of the *ranked dossier* at a given hash — is that enough?)
- Does this collapse ATTENTION and INTÉRÊT back into one concept (contradicting the chosen phased B), or does the dossier/presentation layer sit cleanly on top of both?
