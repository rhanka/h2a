# Evaluations — review program & backlog

> Tracks (1) the **triple-review** of every evaluation, the skills, and the model foundations, and (2) the **new evaluations to author** (certification + smart-contract). [← library](./README.md)

## Triple-review protocol

Each artifact gets **three independent reviews**, then a consolidation:

| Slot | Reviewer config |
|---|---|
| R1 | agy-3.5-high |
| R2 | gpt-5.5-xhigh |
| R3 | opus-4.7-xhigh |

- **Execution note**: a single model cannot fill all three slots. Reviews are run either by the user's own multi-model routing, by `/ultrareview` (multi-agent cloud review of the branch), or one slot at a time. Each review is recorded as `evaluations/reviews/<item>.<slot>.md`; a consolidation note merges the three.
- **Output of each review**: findings against the rubric below (issue · severity · location · suggested fix), plus a verdict (`accept` / `accept-with-changes` / `revise`).

### Review rubric (h2a model evaluations)

1. **Vocabulary fidelity** — only canonical roles/artifacts (`VOCABULARY.md`); no invented terms.
2. **Invariant compliance** — scope never signs; `ENGAGEMENT` *has* a scope (not *is*); anything owned needs a `PRINCIPAL` (`CONTROL` only audits); `POLICY` = durable rule (prefer engagement clauses unless cross-cutting/imposed); delegated agents are execution-only `AGENTS`/`SUBAGENTS`; `MANDATAIRE` never judges; escalation targets the scope's competent authority.
3. **Mapping completeness** — answers the common grid (10 questions, `README.md`).
4. **Topology correctness** — declared topology matches the actor/scope structure.
5. **Gaps honesty** — real gaps surfaced, not hidden; no overclaiming `ready`.
6. **Diagram correctness** — Mermaid renders and matches the mapping table.
7. **Compatibility hypothesis** — sound, with the nearest built-in profile id + the delta.

### Review rubric variants

- **Skills** (`packages/h2a-cli/skills/h2a/SKILL.md`): instruction correctness; safety (no silent store writes; surfaces errors verbatim); alignment with the shipped CLI verbs / MCP tools; host portability (Claude/Codex/Gemini); single-skill subcommand convention (DEC-057).
- **Model foundations** (`VOCABULARY.md`, `SPEC.md`, `INTENTION.md`): internal coherence; frozen-role integrity; CONTRACT/POLICY/ENGAGEMENT/ENFORCEMENT_PLAN separation; protocol/policy/implementation boundary (DEC-043); no drift between narrative and the `@sentropic/h2a` types.

## Backlog A — triple-review of existing artifacts

| # | Artifact | R1 agy-3.5 | R2 gpt-5.5 | R3 opus-4.7 | Consolidated |
|---|---|---|---|---|---|
| 1 | `a-enterprise.md` | ☐ | ☐ | ☐ | ☐ |
| 2 | `b-ecosystem.md` | ☐ | ☐ | ☐ | ☐ |
| 3 | `c-government-citizen.md` | ☐ | ☐ | ☐ | ☐ |
| 4 | `d-principal-15-conductors.md` | ☐ | ☐ | ☐ | ☐ |
| 5 | `e-agentic-squad.md` | ☐ | ☐ | ☐ | ☐ |
| 6 | `sysml-v2.md` | ☐ | ☐ | ☐ | ☐ |
| 7 | Skills — `skills/h2a/SKILL.md` | ☐ | ☐ | ☐ | ☐ |
| 8 | Foundations — `VOCABULARY.md` + `SPEC.md` | ☐ | ☐ | ☐ | ☐ |
| 9 | `nhi.md` (NHI / OWASP Top 10) | ✅ | ✅ | ✅ | ✅ [consolidated](./reviews/nhi.consolidated.md) |

## Backlog B — new evaluations to author (then triple-review each)

Each follows the library structure (diagram, mapping, contracts vs policies, gaps, compatibility hypothesis) and is then run through the triple-review above. Theme for the certification set: **model an organization that *achieves* the certification while *optimizing* its use of h2a** — i.e. h2a's signed engagements, append-only journal, enforcement plans and controlled disclosure become the very evidence the auditor wants.

| # | Evaluation | Type | Angle | File (planned) | Reviews |
|---|---|---|---|---|---|
| B1 | **ISO 9001** (QMS) | cross-cutting | quality-management processes, internal audits, nonconformities, continual improvement → `ENGAGEMENT`/`POLICY`/`CONTROL`/`ENFORCEMENT_PLAN` + recurring obligations; the audit trail is the h2a journal | [`evaluations/iso-9001.md`](./iso-9001.md) **(draft ✅)** | ☐☐☐ (triple-review next) |
| B2 | **ISO 27001** (ISMS) | cross-cutting | Annex A controls, risk treatment, Statement of Applicability → `POLICY` (imposed/contractual) + `CONTROL` + disclosure profile + evidence packages; signed engagements as control attestations | [`evaluations/iso-27001.md`](./iso-27001.md) **(draft ✅)** | ☐☐☐ (triple-review next) |
| B3 | **SOC 2** (Trust Services Criteria) | cross-cutting | security/availability/confidentiality/processing-integrity/privacy → `CONTROL` + `attestation`/`evidence-package` disclosure + recurring-obligation cadence; the report period maps to the journal window | [`evaluations/soc2.md`](./soc2.md) **(draft ✅)** | ☐☐☐ (triple-review next) |
| B4 | **Smart contract (blockchain)** | complementary/interop | h2a signed `CONTRACT`/`ENGAGEMENT` ↔ on-chain contract; negotiation ledger ↔ chain; ed25519 signatures ↔ on-chain sigs; `ENFORCEMENT_PLAN` ↔ on-chain execution. Facets: (a) concept mapping, (b) interop — reference an on-chain artifact by `{chain, address, txHash}` the way SysML §3 references a commit, (c) what stays off-chain (negotiation, disclosure, human authority) | [`evaluations/smart-contract.md`](./smart-contract.md) **(draft ✅)** | ☐☐☐ (triple-review next) |

### Certification-set common questions (to instruct while authoring B1-B3)

- Which clauses/controls become `POLICY` (durable rule) vs `ENGAGEMENT` clauses vs `CONTROL` audits?
- How does the **h2a journal** serve as audit evidence (append-only, hash-chained, signed) — and what does the auditor still need outside it?
- Which **disclosure mode** (DEC-045) fits auditor access (evidence-package / attestation / redacted-view)?
- Recurring-obligation cadence (DEC-047) for surveillance audits / continuous monitoring.
- Nearest built-in profile (likely `A_ENTERPRISE`) + the certification delta.

## Backlog C — NHI solutions landscape (veille, **preliminary to P3**)

> **Gate**: NHI **P3 (interop connectors)** is deliberately **parked** until this landscape is done (DEC-090 left P3 open). P3's target (which external NHI/IAM system to export posture/attestation to) and its build location (`@sentropic/h2a` vs `../sentropic/` connectors) are decisions this veille must inform — we do not pick a connector target before surveying the field.

| # | Artifact | Type | Angle | File (planned) | Reviews |
|---|---|---|---|---|---|
| C1 | **NHI solutions landscape** | veille / market survey | Survey the Non-Human-Identity security field (~2025-2026): commercial vendors, OSS, and standards. For each: identity model, lifecycle coverage (discovery/inventory · auth · rotation · offboarding), integration/API surface, and **fit as an h2a P3 interop target**. Conclude with a shortlist of candidate interop targets + the export shape h2a would need (posture report / signed attestation envelope, DEC-087/088). | [`evaluations/nhi-landscape.md`](./nhi-landscape.md) **(draft ✅, ~40 sources)** | ☐☐☐ (triple-review next) |

**C1 draft outcome** (2026-05-27): shortlist of P3 interop targets, ranked — (1) **SPIFFE/SPIRE** (standards-first: attestation envelope ↔ verifiable credential, keyring ↔ trust bundle, SPIFFE Federation = clean public-key exchange); (2) **an NHI-governance platform as an evidence-feed sink** (posture is already OWASP-NHI/CSF-shaped; Astrix/Token/Clutch — but **Astrix has an unclosed Cisco acquisition, 2026-05-04**, a vendor-bet risk); (3) **secrets manager (Vault/KMS) as a rotation actuator** (the inventory `longLived` list is the work-list). Caveats flagged: IETF WIMSE is drafts-only; **no documented *inbound* posture-ingestion API verified** for the governance vendors → a P3 prerequisite to confirm.

**Scope checklist for C1** (the landscape must cover, factually + sourced):
- **Standards / frameworks**: OWASP NHI Top 10, CSA, NIST (SP 800-207 NPE, CSF 2.0), **SPIFFE/SPIRE** (workload identity), IETF WIMSE.
- **Commercial NHI platforms**: the discovery/governance vendors (e.g. Astrix, Entro, Oasis, Token Security, Clutch, Natoma, Aembit, GitGuardian NHI, Andromeda/SailPoint-adjacent) — capabilities, not marketing.
- **Adjacent**: secrets managers (HashiCorp Vault, cloud KMS), CIEM/CSPM, IdP service-account governance.
- **Per item**: what it is · identity & lifecycle model · API/integration surface · **how h2a posture/attestation could feed it (or vice-versa)** · maturity/caveats.
- **Output discipline**: cite sources (URLs); state only what is sourced; flag uncertainty explicitly (no vendor claim asserted without a citation). Status header: `draft, pending triple-review`.

## How to run a review (once the mechanism is chosen)

1. Pick an item from Backlog A or author one from Backlog B.
2. Run the three reviewer configs against the rubric; save each as `evaluations/reviews/<item>.<slot>.md`.
3. Consolidate into `evaluations/reviews/<item>.consolidated.md`; apply accepted changes to the source doc; tick the row.
