# Specification — layer 2 of the contractual stack (DEC-010)

> **Layer**: SPECIFICATION (the **measurable what**). Verifiable requirements that translate `INTENTION.md`.
> **Convention**: `REQ-NNN`, continuous numbering. Every change = a new REQ or an explicitly traced amendment.
> **Downstream**: `DECISIONS.md` (design choices justified against these REQs); future `specs/SPEC-*.md` (detailed architectures); future `specs/REQ-MAPPING.md` (REQ → SPEC-doc mapping).

## Vision & scope

- **REQ-001** — Design a **protocol** for collaboration between heterogeneous CLI agents (Claude Code, Codex, Gemini, others), inspired by A2A but adapted to the CLI world.
- **REQ-002** — The protocol must be implementable as a **tool / plugin in each target CLI** (one contract, multiple CLI adapters).

## Transport modes

- **REQ-003** — **Remote** mode: collaboration via a remote service (ultimately tied to the `@sentropic/remote` project).
- **REQ-004** — **Local** mode: collaboration with no network dependency, via **files in each workspace** (drop zone → processing → reply). Must work offline.
- **REQ-005** — **Central MCP** mode: collaboration via a shared MCP service acting as a bus/broker.
- **REQ-006** — The three transports (REQ-003/004/005) must be **interchangeable** without changing agent code — the protocol is transport-agnostic.

## Roles & organization

- **REQ-007** — **CONDUCTOR** role (see `VOCABULARY.md §1.2`): supervises a herd of AGENTS, acts as the interface for PRINCIPAL piloting, carries responsibility for delegated execution.
- **REQ-008** — **CONTROL** roles (e.g. cyber, finance, ethics, legal, quality — see DEC-007) that are neither purely operators nor purely conductors, and that must be able to impose/advise across the organization.
- **REQ-009** — Role terminology must be validated during design — alternatives must be proposed. *(Partially satisfied: DEC-007/008/009.)*
- **REQ-010** — **Organization** mode: the protocol must let one replicate the operating mode of a human organization (hierarchies, roles, responsibilities, escalations).

## Multi-human & organizational federation

- **REQ-029** — The protocol must support several humans, each able to be **PRINCIPAL of their own mini-organization**: own agents, engagements, controls and journals.
- **REQ-030** — The same human must be able to hold a **role in a larger organization** while keeping their local PRINCIPAL perimeter.
- **REQ-031** — The first multi-human mode to specify is a **peer-to-peer human-to-human** mode: each human talks to others from their mini-organization, with no mandatory global executive.
- **REQ-032** — The protocol must also allow more structured multi-human modes, notably one where an **executive** carries responsibility for the umbrella activity spanning several PRINCIPALs and their AGENTS.
- **REQ-033** — Boundaries between mini-organizations must be explicit: identity, authority, read/write rights, escalation routing, journaling and responsibilities must remain auditable.
- **REQ-034** — The protocol must support three distinct multi-human channels: **PRINCIPAL ↔ PRINCIPAL**, **CONDUCTOR ↔ CONDUCTOR**, and **shared ENGAGEMENT**.
- **REQ-035** — The **EXECUTIF** role must represent umbrella responsibility over an activity spanning several PRINCIPALs, their mini-organizations, their CONDUCTORs, their AGENTS and their CONTROLs.
- **REQ-036** — EXECUTIF must not erase the authority of local PRINCIPALs: the protocol must represent local and global responsibilities simultaneously.
- **REQ-037** — The protocol must represent **POLICY** as durable, versioned and applicable to a scope: mini-organization, engagement, federation, umbrella activity.
- **REQ-038** — A POLICY must be distinct from an ENGAGEMENT: it constrains engagements and actions but does not replace a mission's operational charter.
- **REQ-039** — Each ENGAGEMENT must be able to declare the applicable policies and trace violations, derogations, conflicts or related escalations.
- **REQ-040** — CONTROL roles must be able to propose, validate, impose, audit, alert on or veto policies within their domain, according to the rights attached to the scope.
- **REQ-041** — The protocol must define precedence and conflict resolution between policies of different scopes or between CONTROLs of different domains.
- **REQ-046** — The protocol must represent a **CONTRACT** as a signed normative container, distinct from an operational ENGAGEMENT.
- **REQ-047** — A CONTRACT must be able to contain or reference policies, obligations, rights, control/escalation clauses, external references, signatures, evidence and derived engagements.
- **REQ-048** — An ENGAGEMENT must be treated as the executable operational contract: scope, charter, bindings, controls, applicable policies, success criteria, actions, journals and amendments.
- **REQ-049** — ENFORCEMENT_PLAN/ESCALATION must be treated as a cross-cutting application plan over intentions, specs, contracts, policies and engagements — not as a contractual content artefact and not as the CONTROL role.
- **REQ-050** — The protocol must distinguish master agreement, standalone policy, contract clause, derived engagement, regulatory obligation and control action.
- **REQ-061** — The protocol must represent **SCOPE** as a first-class concept distinct from the ENGAGEMENT: an engagement has a scope but is not the scope itself.
- **REQ-062** — The protocol must distinguish **PARTY**, **AUTHORITY**, **MANDATE** and **SIGNATURE**: a scope never signs; an authorized INSTANCE signs for a party or a scope under an explicit mandate.
- **REQ-063** — The protocol must represent **OBLIGATION**, **RIGHT**, **CLAUSE** and **EVIDENCE_PACKAGE** as possible components of a CONTRACT, a POLICY or an ENGAGEMENT.
- **REQ-064** — A POLICY must carry a `sourceAuthority` and an `adoptionMode` (`ratified`, `contractual`, `imposed`, `acknowledged`) to cover laws, taxes, regulations and internal policies.

## Global coordination

- **REQ-011** — Coordination/consolidation **possibly not centralized**: no single mandatory authority point. Either a "root" CONDUCTOR, or a CONTROL role, or a consensus mechanism — to be designed.
- **REQ-012** — **Global coherence** mechanism between AGENTS/CONDUCTORs (audit, aggregated view, conflict resolution).

## Registration, negotiation and stabilization

- **REQ-051** — The protocol must provide a minimal **REGISTRY** where INSTANCEs declare their roles, scopes, capabilities, endpoints, signing keys and accepted policies.
- **REQ-052** — The protocol must represent a **NEGOTIATION** as a transient session between two or more parties aiming to produce a CONTRACT, POLICY, ENGAGEMENT or amendment.
- **REQ-053** — A NEGOTIATION is **stabilized** when the required signers accept the same canonical artefact, identified by version and hash, with verifiable signatures.
- **REQ-054** — In V1, the protocol must operate **without an inter-contract mediator**: negotiations may be bilateral or multilateral and local, but global conflict resolution between contracts remains a concern of ENFORCEMENT_PLAN/ESCALATION or scope authority.
- **REQ-055** — The initial use case must support a human PRINCIPAL piloting **15 CONDUCTORS** able to register, discover their capabilities, negotiate contracts/engagements between each other and stabilize signed artefacts.
- **REQ-065** — A NEGOTIATION must have a minimal state machine: `draft`, `proposed`, `countered`, `accepted`, `rejected`, `withdrawn`, `expired`, `stabilized`, `abandoned`.
- **REQ-066** — Every NEGOTIATION proposal must reference a base version/hash; a stale proposal must be rejected or explicitly rebased.
- **REQ-067** — Stabilization without an inter-contract mediator must rely on a negotiation ledger, quorum/signature rules and explicit terminal states — not on implicit global consensus.

## Human-in-the-loop

- **REQ-013** — The PRINCIPAL can **take control** of an AGENT during execution.
- **REQ-014** — The PRINCIPAL can **take control of a CONDUCTOR** (and therefore of its subordinates).
- **REQ-015** — PRINCIPAL ↔ AGENT/CONDUCTOR transitions must remain **observable and auditable** by the organization.
- **REQ-025** — **HITL per engagement**: human takeover is declared and applies at the engagement level (not globally, not per isolated message). The HITL scope = an engagement's scope.
- **REQ-026** — **Escalation to the PRINCIPAL = protocol primitive** (not a special case of amendment). Any role in an engagement must be able to request the PRINCIPAL's arbitration; the protocol handles the channel, the wait, the timeout, and the trace.
- **REQ-027** — **Neutral presentation of choices submitted to the PRINCIPAL (or to a quorum)**: a dedicated role — **MANDATAIRE** — formulates the question and presents options without bias. The proposer does not ask their own question to the voters.
- **REQ-028** — **Decider absence modes** (PRINCIPAL or quorum) explicitly handled: timeout → declared fallback action (continue/abandon/indefinite pause/escalate higher), and that fallback is itself traced in the charter.
- **REQ-068** — Escalations must be able to target the **scope's authority**: PRINCIPAL, EXECUTIF, quorum, authorized CONTROL, external authority or explicit recourse/adjudication depending on context.
- **REQ-069** — MANDATAIRE must never be modelled as mediator, arbiter or tribunal: it presents neutrally but does not resolve the dispute.
- **REQ-070** — CONTROL audit must support disclosure minimization: redacted views, limited proofs, hashes, attestations and evidence packages, to avoid excessive access in cross-organization settings.

## Organization representation (non-functional)

- **REQ-020** — **Understandable**: the org representation (roles, engagements, hierarchy) must be readable by a non-specialist human.
- **REQ-021** — **Representable**: must be renderable visually (at minimum as a classic org-chart or tree).
- **REQ-022** — **Validatable**: tool-verifiable (schema, type-check, lint of role contracts).
- **REQ-023** — **Changeable**: controlled and versioned mutation (every structural change leaves a trace).

## Execution semantics

- **REQ-024** — **Executable without ambiguity**: execution semantics (who talks to whom, who decides what, in what order) must be deterministic and observable.

## Validation against real-world models

- **REQ-042** — The model must be evaluated against a **traditional enterprise**: supplier contracts, employment contracts, customer contracts, investors, shareholders, regulation, administrations and taxes.
- **REQ-043** — The model must be evaluated against a **multi-enterprise ecosystem**: customers, suppliers, partners, competitors, consortiums, platforms, supply chains and joint ventures.
- **REQ-044** — The model must be evaluated against **government / citizen ecosystems**: citizens, administrations, elected officials, regulators, public services, rights, recourse, legal and fiscal obligations.
- **REQ-045** — Each evaluation must produce an actor/scope/contract/policy/control/escalation/audit/gap mapping, then feed `SPEC.md`, `VOCABULARY.md`, `DECISIONS.md` or detailed specs.
- **REQ-060** — The "1 PRINCIPAL / 15 CONDUCTORS / no inter-contract mediator" case must be treated as an operational evaluation scenario and mapped to tracks A, B and C.
- **REQ-071** — Every ABC evaluation must also audit authority, mandate, signature, disclosure, precedence, deadlock, recourse, recurring obligations and reserved rights.

## Packaging & technical

- **REQ-072** — The umbrella project name must cover **multi-agent, multi-human coordination, organization and human-in-the-loop**; pure agent-to-agent is only one sub-surface.
- **REQ-016** — Project name to be defined (the current working name `a2a-cli` is not final). Revised recommended candidate: `h2a`, core package `@sentropic/h2a` (DEC-025).
- **REQ-017** — **TypeScript**, **npm** package manager (not pnpm) — hard constraint.
- **REQ-018** — **Modular** architecture: core, schemas, local-files, MCP, Codex/Claude adapters must stay separable, even if the public package does not carry the `-modules` suffix.
- **REQ-056** — The minimal runtime must expose a TypeScript core library independent of any CLI, containing types, schemas, validation, canonicalization/hash, signatures and local storage.
- **REQ-057** — The minimal runtime must offer thin adapters for **Codex** and **Claude**, without coupling the protocol to their internal APIs.
- **REQ-058** — The minimal runtime must offer a shared **MCP** server for registration, discovery, negotiation, signature, inbox/outbox, journal and escalation.
- **REQ-059** — The minimal runtime must offer a **bilateral local-files** mode under `src/{project}/h2a/...`, usable offline and without an MCP server.

## Existing integration

- **REQ-019** — Eventually, possible takeover/integration of the `@sentropic/harness` project located in `../sentropic/` (branch to confirm — `br23` or `br25`, to be checked locally). Decide during the design phase whether to absorb, extend, or connect to it.

## Meta

- Every `REQ-NNN` must be traced in `specs/REQ-MAPPING.md` (to be created after brainstorming).
- Any new requirement coming out of downstream brainstorming → add it here, continuing the numbering.
- The canonical vocabulary used here is frozen in `VOCABULARY.md` (V1.7).
