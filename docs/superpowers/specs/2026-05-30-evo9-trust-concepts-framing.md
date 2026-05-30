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

---

## Stabilization — adversarial review (Opus 4.8, 2026-05-30)

An adversarial Opus 4.8 review stress-tested the concepts against the frozen invariants. Outcome: all five survive in the declare→derive→attest spine with **no new artifact-kind, no new role**. Two substantive corrections + an honesty fix.

**Must-fix (one mistake from two angles):**
- **F1 — honesty register.** "Fully responsible, no blind spot (*zone d'ombre*)" is **unfalsifiable** — a signature over a dossier proves only "dossier at hash H was presented and acknowledged", never completeness/understanding. **Replace** the claim with its verifiable proxy: *"both parties attested comprehension of the risk-ranked dossier at hash H."* Claim that; explicitly disclaim "no blind spot" (the `nhi.ts` honesty register).
- **F2/F4 — dependency direction.** The refined ATTENTION's *risk-ranked dossier* and *presenter non-bias* are INTÉRÊT computations, so ATTENTION-as-refined cannot ship before INTÉRÊT. **Split ATTENTION**: (1) a bias-free **comprehension core** (true DEC-088 clone — signs the hash of the presented dossier) ships first; (2) the **risk-ranked dossier layer** depends on INTÉRÊT and lands with/after it. Stabilized sequence: **VALEUR + MUTUALISATION (parallel) → ATTENTION comprehension-core → INTÉRÊT → ATTENTION dossier-layer → CONFIANCE** (the 3-bucket spirit of ratified Fork B holds; the boundary moves).

**Stabilized formalization:**
- **Risk ranking = procedural, not substantive (F3/F5).** Ranking *attention* ("look here first") is permitted (it is what MANDATAIRE already does); ranking *risk by a model of harm* is the forbidden "judge legitimacy". So every ranking input must be **structural or declared**, never an engine opinion: conflict-posture (structural), a **declared** masked-impact flag (declare, not derive — h2a flags *that* it is hard-to-measure, never measures it), and structural proxies (touches a cross-scope `aval`, amends a signed artifact, empty `successCriteria`).
- **Presenter non-bias gate ≠ INTÉRÊT stabilization gate (F4).** One pure `derivePostureConflit(subject, …)`, **two call sites**: the presenter at `decide` (earlier), the signers at stabilization. Same derivation, different subjects/moments — keep distinct.
- **CONFIANCE is advisory, not a hard stabilizer gate (F9).** The frozen `stabilizeNegotiation` is deliberately syntactic (signatures + authority matrix). CONFIANCE = a pure derived predicate the caller may attest + an **advisory** surfaced at stabilization; making it *block* is a PRINCIPAL governance choice (open question 1).
- **Agent-side ATTENTION (Fork D) holds, tightened:** a signed `event` comprehension envelope carrying **no `artifactKind`**, contributing **nothing** to the stabilization signer set — never a step toward agents signing engagements. Mechanically it touches nothing frozen (`SIGNATURE` already maps to all 6 roles); the guardrail is semantic.

**Fork verdicts:** A holds (mark opaque-boundary truncation in the derived chain). B holds *after the split repair*. C holds substantively but the trigger **routes/escalates**, it does not weld a veto into the frozen stabilizer (advisory in V1). D holds with the non-binding guardrail.

**Residual questions that genuinely need the PRINCIPAL (not derivable):**
1. Should CONFIANCE / collective-conflict ever **block** stabilization, or only ever advise + escalate? (the frozen stabilizer is syntactic by design.)
2. Who is **obliged to declare** an interest / the presenter non-bias — self-declared, CONTROL-attested, or mandated? (the "chacun porte ses intérêts mais l'impact collectif est protégé" balance — a normative call.)
3. Agent-side ATTENTION: the cryptographic MANDATE right **now**, or unsigned acknowledgement as the V1 default with the signed form deferred?

## Triad coupling — INTÉRÊT ↔ INTENTION ↔ VALEUR (PRINCIPAL insight, 2026-05-30)

> **Verbatim (PRINCIPAL)**: « j'ai aussi le sentiment que l'intérêt, intention et valeur doivent être liés, notamment dans le contexte d'une chaîne executif / humain / agents (notamment pour l'amélioration des policies et etc). »

Direction to formalize (pending its own adversarial pass): **INTENTION** (the upstream value-driven goal, VOCABULARY §7.1), **VALEUR** (the delivered finalité, the `aval`/`finaliteAmont` links of this EVO), and **INTÉRÊT** (alignment / conflict of the humans in the chain) are **one coupled triad along the e2h2a chain** (EXECUTIF → human PRINCIPALs → AGENTS). The coupling is the basis of a **policy-improvement feedback loop**: an EXECUTIF's INTENTION frames the value chain; the realised VALEUR and the declared/derived INTÉRÊT alignment along the chain are the *evidence* that should **inform and improve POLICY** (the existing POLICY artifact / rules). This connects EVO-9 to the build-app vision (prompt 1: agents managing development raise attention; specs/policies evolve via the UI). **Open**: is this a derived "alignment posture" over (intention, value-chain, conflict-postures) that surfaces POLICY-amendment candidates (advisory, like MUTUALISATION) — or a tighter binding? To be framed + stabilized as a follow-on, after the 5 base concepts.
