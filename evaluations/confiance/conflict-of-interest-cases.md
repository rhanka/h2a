# Conflict-of-interest — calibration on real corruption cases

**Purpose**: ground the EVO-9 **INTÉRÊT** mechanism on documented, public, adjudicated conflict-of-interest / corruption cases, so the disclosure trigger and the ATTENTION risk-ranking are calibrated against what actually breaks trust — not invented. This is the trust-axis analogue of how `evaluations/nhi.md` grounds NHI on the OWASP NHI Top 10.

These cases are **public, documented, and adjudicated**; they are used here only as neutral, illustrative analysis material — not as accusations.

## The mechanism under test (EVO-9 INTÉRÊT, framing ratified 2026-05-30)

- The system **never judges the legitimacy** of an interest and **never forces blanket disclosure**; a private interest with **no collective impact** stays private.
- An interest **must be disclosed** in a signed engagement when **any** of the **3-criterion disjunction** holds:
  1. the signed decision **reaches beyond the declarer's own scope** (a federated/umbrella scope, or another PARTY's scope);
  2. the interested human is a **signer** on the decision (the corruption vector);
  3. a **CONTROL** role (ethics/legal) **flags** it.
- Disclosure is **proportional** to collective impact via `H2A_DISCLOSURE_MODES` (attestation / hash-only … evidence-package / redacted-view).
- The engine **surfaces + routes** (escalation), gated at negotiation stabilization as **advisory** (not a hard veto). ATTENTION ranks the decider's attention toward this risk (procedural, structural — never a substantive judgment of merit).

## Analysis template (per case)

`Context` · `Hidden/undisclosed interest` · `Who held it (role: decider/signer?)` · `Collective impact` · `Disclosure trigger: which of (1)/(2)/(3) fires?` · `Proportional disclosure mode` · `Would the model have surfaced it?` · `Calibration lesson`.

---

## Case 1 — Related-party off-balance-sheet entities (Enron / Fastow LJM, 2001)

- **Hidden interest**: the company's CFO personally managed and profited from the off-balance-sheet partnerships that transacted with the company.
- **Holder**: a senior officer who was **on the signing/approval path** for those transactions.
- **Collective impact**: catastrophic — shareholders, employees, pensions; far beyond the officer's own scope.
- **Trigger**: **(2) signer** (the officer approved deals with entities he benefited from) **and (1) scope reach** (collective, public shareholders). Fires strongly.
- **Disclosure mode**: high impact → `evidence-package` / full disclosure of the related-party structure to the board/CONTROL before any signature.
- **Model verdict**: surfaced. **Lesson**: the strongest, cleanest signal is *signer ∧ related-counterparty*; criterion (2) must key on the **signer set of the specific decision**, not just "works at the company".

## Case 2 — Sovereign-fund flows to interested decision-makers (1MDB, 2009–2015)

- **Hidden interest**: officials directed fund flows toward entities from which they personally benefited.
- **Holder**: decision-makers / signers on the fund's commitments.
- **Collective impact**: national (public funds) — far beyond any declarer's own scope.
- **Trigger**: **(1) scope reach** (sovereign/collective) **+ (2) signer**. Fires.
- **Disclosure mode**: maximal — `evidence-package`; and CONTROL (3) escalation to the PRINCIPAL/authority.
- **Lesson**: criterion (1) "beyond own scope" is essential — a decision touching a *federated/umbrella* (here sovereign) scope must raise the disclosure bar even if the actor would claim it as "internal".

## Case 3 — Awarding a contract to an interested party's firm (generic public-procurement kickback; the PRINCIPAL's "quelqu'un qui bosse dans la boîte")

- **Hidden interest**: a decision-maker has a stake in (or a close relation employed by) a bidding firm.
- **Holder**: the decider/signer of the award.
- **Collective impact**: depends — a small internal purchase vs a large public tender. **This is the calibration knife-edge**: a *private* stake with no collective reach stays private; the moment the award binds a collective/another party's budget and the interested person signs, it must be disclosed.
- **Trigger**: **(2) signer** always; **(1) scope reach** when the award is collective. If purely within the actor's own scope and no signature on a collective decision → **not** triggered (correctly — the model does not force disclosure of every private tie).
- **Disclosure mode**: proportional — a small internal case may discharge with an `attestation`; a public tender needs `evidence-package` + recusal/escalation.
- **Lesson**: this is the case that validates the *proportionality* and the "never force blanket disclosure" invariant. The model must **not** flag every "someone works here" tie — only those meeting (1)/(2)/(3). Getting this boundary right is the core calibration target.

## Case 4 — Voting on awards while receiving payments (FIFA officials, 2015)

- **Hidden interest**: officials voted on hosting/marketing awards while receiving undisclosed payments from interested bidders.
- **Holder**: voters = signers on the collective decision.
- **Collective impact**: the whole federation/public.
- **Trigger**: **(2) signer + (3) CONTROL** (an ethics body is exactly the CONTROL role; here it failed/was captured — the model puts CONTROL's flag as a first-class trigger precisely so capture is harder).
- **Disclosure mode**: `evidence-package`; CONTROL veto/alert on the stabilization.
- **Lesson**: criterion (3) (CONTROL flag) is the human-judgment escape valve; the case shows CONTROL must be **independent / not subordinate** (matches the frozen invariant "CONTROL owns nothing, is not subordinate, has veto/alert").

## Case 5 — Undisclosed industry funding biasing an expert recommendation

- **Hidden interest**: an expert recommending an option is funded by a party that benefits from that option, undisclosed.
- **Holder**: not necessarily a signer — often the **presenter** of the decision dossier (ties to the ATTENTION *presenter non-bias* precondition).
- **Collective impact**: the decider relies on a biased presentation → impaired CONFIANCE.
- **Trigger**: this is the case that justifies the **presenter non-bias gate** (distinct from the signer gate, per the review F4): the *presenter* of the dossier holds a decision-forcing interest even though they may not sign. Caught by the presenter-side `derivePostureConflit`, not the signer-side one.
- **Disclosure mode**: declare the funding (proportional); if it would force the decision, the presentation is invalidated.
- **Lesson**: validates keeping the **presenter non-bias** evaluation separate from the signer/stabilization evaluation — one `derivePostureConflit`, two subjects.

---

## Calibration findings (feed the INTÉRÊT / ATTENTION spec)

1. **Criterion (2) keys on the decision's signer set**, not on employment ("works in the company") — Case 3 shows over-triggering on mere ties would violate "never force blanket disclosure".
2. **Criterion (1) must recognise federated/umbrella/collective scope** as "beyond own scope" — Cases 1, 2, 4.
3. **Proportionality is load-bearing** (Case 3): small internal ↔ `attestation`; collective/public ↔ `evidence-package`. The `H2A_DISCLOSURE_MODES` ladder gives this.
4. **CONTROL independence** (Case 4): criterion (3) only works if CONTROL is non-subordinate (frozen invariant) — otherwise capture defeats it.
5. **Presenter vs signer are distinct subjects** (Case 5): the ATTENTION presenter-non-bias gate and the INTÉRÊT signer gate must both exist, sharing one derivation.

These are the concrete targets the INTÉRÊT pure derivation + the ATTENTION risk-ranking must satisfy. To be expanded with more sourced cases (a deep-research pass can add jurisdictions/sectors); the template above is the unit of analysis.
