# Compatibility evaluations — organizational use-case library

> **Purpose**: test the `h2a` model against real organizations before freezing the detailed spec.
> **Method**: for each use-case, map actors → roles, contracts, policies, controls, engagements, escalation flows, a diagram, and gaps.
> **Status**: tracks opened 2026-05-17; refactored into the `evaluations/*.md` library on 2026-05-25; translated to English 2026-05-26. Conclusions are working hypotheses.

## Use-cases

| # | Use-case | Topology | File |
|---|---|---|---|
| A | Traditional enterprise | hierarchy | [a-enterprise.md](./a-enterprise.md) |
| B | Multi-organization ecosystem | peer federation | [b-ecosystem.md](./b-ecosystem.md) |
| C | Government / citizen | public authority | [c-government-citizen.md](./c-government-citizen.md) |
| D | 1 PRINCIPAL / 15 CONDUCTORS (no mediator) | star, no mediator | [d-principal-15-conductors.md](./d-principal-15-conductors.md) |
| E | Agentic-delivery squad (contracted roles) | agile train + squads | [e-agentic-squad.md](./e-agentic-squad.md) |

Each file follows the same structure: Mermaid diagram, mapping, contracts vs policies, multi-actor case, gaps, compatibility hypothesis.

## Review program & backlog

[BACKLOG.md](./BACKLOG.md) — the triple-review protocol + rubric for every artifact, and the backlog of new evaluations to author (ISO 9001 / ISO 27001 / SOC 2 / smart-contract).

## Complementary evaluations

Not organizational topologies — they test `h2a` against external standards/frameworks:

| Topic | Scope | File |
|---|---|---|
| SysML v2 (OMG) | metamodel mapping · SE use-case · API & Services interop · formalizing h2a in SysML/KerML | [sysml-v2.md](./sysml-v2.md) |
| Non-Human Identity | h2a ↔ OWASP NHI Top 10 (2025) coverage + NIST SP 800-207 / CSF 2.0 alignment | [nhi.md](./nhi.md) |
| NHI solutions landscape | veille of the NHI field (vendors/OSS/standards) gating NHI P3 interop | [nhi-landscape.md](./nhi-landscape.md) |
| Smart contracts (blockchain) | h2a off-chain negotiation/authority ↔ on-chain execution; `{chain,address,txHash}` reference | [smart-contract.md](./smart-contract.md) |

## Machine-readable source

Since **DEC-041**, the A/B/C mapping is also machine-readable through `H2A_ABC_MODEL_PROFILES` and verified by `auditAbcModelCompatibility(modelId)` (`packages/h2a/src/abc.ts`, tests `packages/h2a/test/abc.test.js`). These narrative use-cases stay the **design source**; the executable profiles are derived from them. Any track change must update a DEC + the tests.

## Common grid

Every evaluation answers the same questions:

1. **Actors**: which INSTANCE holds which roles (`PRINCIPAL`, `EXECUTIF`, `CONDUCTOR`, `AGENTS`, `CONTROL`, `MANDATAIRE`)?
2. **Scopes**: boundaries between mini-organization, engagement, federation, whole activity?
3. **Authority / mandate / signature**: who signs, for which party, on which scope, with which mandate?
4. **Contracts**: `CONTRACT`, `ENGAGEMENT`, `POLICY`, or referenced external artifact?
5. **Obligations / rights / clauses**: obligations, reserved rights, disclosure, recourse, termination.
6. **Controls / enforcement**: domains with cross-tree constraints/audits, disclosure level.
7. **Escalations / recourse**: who triggers `advise`/`decide`/`alert`, toward which scope authority.
8. **Audit**: traces proving responsibility, consent, compliance, exceptions, decisions.
9. **Deadlocks / precedence**: rules when two policies/contracts/authorities conflict.
10. **Protocol gaps**: missing or to-be-reinforced concepts.

## Q9 research — CONTRACT / POLICY / ENGAGEMENT

Hypothesis retained (enterprise, ecosystem, government models):

- **CONTRACT**: a normative container applicable to parties/scopes, signed by mandated authorities. May mix durable clauses, obligations, rights, policies, evidence, signatures, control/escalation, derived engagements.
- **POLICY**: a durable rule applicable to a scope. Standalone (bylaw, law) **or** a clause of a CONTRACT. Declares `sourceAuthority` + `adoptionMode` (`ratified`/`contractual`/`imposed`/`acknowledged`). **POLICY is not a linear fifth layer** (DEC-018) — it is one of the three normative artifacts.
- **ENGAGEMENT**: the executable operational contract (mission, service, delivery) with charter, roles, success criteria, journal. It *has* a scope; it *is not* the scope.
- **ENFORCEMENT_PLAN / ESCALATION**: the application plan — verifies compliance, detects violations, produces evidence, blocks/alerts/escalates.

## Counter-audit 2026-05-17 (frozen points)

- A `SCOPE` never signs; a mandated INSTANCE signs for a PARTY or a SCOPE.
- `ENGAGEMENT` is not the scope: it *has* a scope.
- `CONTROL` is a role; the application plan is `ENFORCEMENT_PLAN`.
- `MANDATAIRE` is neither mediator, arbiter, nor tribunal.
- Escalation targets the scope's competent authority, not only the local PRINCIPAL.
- Without an inter-contract mediator: ledger, terminal states, base hash, signatures, stale-proposal rules.
- Cross-organization audit rights are minimized: redaction, evidence packages, attestations, hashes.
- The models require recurring obligations, reserved rights, recourse, precedence and controlled disclosure.

## Cross-cutting needs (synthesis)

- **Scope first-class**: every role/policy/engagement/trace attached to an explicit scope.
- **Policy first-class**: durable, versioned, per-scope, with source authority + adoption mode, distinct from the engagement.
- **External authority**: an external actor can impose a policy without being subordinate to the organization.
- **Strong but minimized controls**: audit, veto, alert, policy validation, exception, evidence — without excessive access.
- **Framework contracts vs engagements**: a durable CONTRACT spawns several operational engagements.
- **Inheritance and conflict**: local, federated, contractual and public policies can contradict each other.
- **Multi-level accountability**: local PRINCIPAL, global EXECUTIF, CONTROL and external authority auditable simultaneously.
- **Mandate and signature**: a scope does not sign; a mandated instance signs for a party or a scope.
- **Deterministic negotiation**: ledger, states, hashes, signatures, stale-proposal rules.

## Questions to instruct

1. Minimal schema for `CONTRACT` (parties, scopes, policies, obligations, rights, derived engagements, signatures, evidence, amendments)?
2. Is a durable framework contract a `CONTRACT` with no immediate engagement, or engagement templates?
3. Mandatory external authority: external CONTROL, public EXECUTIF, or a dedicated role?
4. Precedence between internal / contractual / federated / public policy?
5. Minimal audit level for taxes, regulation, shareholders, investors?
6. Minimal schema for `MANDATE` and `SIGNATURE`?
7. Which conflicts must block a signature in V1?
8. A canonical adjudication/recourse role, or is an external AUTHORITY enough?
