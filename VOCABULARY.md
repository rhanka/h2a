# Vocabulary — V1.9 (REVISED 2026-05-20)

> **Status**: §1-5 (Actors, substrate, default flows, exceptional flows, non-actors) **FROZEN V1.7** after user validation (DEC-007 to DEC-009), MANDATAIRE clarification (DEC-013), `alert` routing (DEC-014), multi-human/EXECUTIF/POLICY framing (DEC-015/016), EXECUTIF as a separate role (DEC-017), CONTRACT/POLICY/ENGAGEMENT (DEC-018), REGISTRY/NEGOTIATION (DEC-019), signing by mandated authority (DEC-021), stabilization without mediator (DEC-022), CONTROL/ENFORCEMENT_PLAN distinction (DEC-023), and escalation to scope authority (DEC-024). §3 adds the multi-human taxonomy from DEC-042. §7 (Contractual stack) **REVISED V1.2** (DEC-018/023). §6 stays open by design; the protocol / policy / implementation boundary is now drawn by DEC-043.
>
> **Why this document exists**: during brainstorming, several concepts had been conflated (notably "consultation" between agents, agent→conductor, agent→human). This page restarts from `INTENTION.md` to lay down a clean glossary that supports every downstream spec.
>
> **Convention going forward**: every spec must reference actors/concepts by the canonical name defined here. Any proposed rename or semantic change = a new DEC in `DECISIONS.md` + V1.x bump.

> **Note on canonical names**: the role names PRINCIPAL, EXECUTIF, CONDUCTOR, AGENTS, CONTROL, MANDATAIRE were chosen at project inception in French and frozen as proper nouns by DEC-007..009. They remain as-is across all languages.

---

## 0. Re-foundations from the initial intention

Three sentences from the user verbatim drive everything else:

1. *"The conductor role is essential: it lets **the human pilot** a herd of agents under a conductor's supervision/responsibility."*
   → **The human is the pilot**. The conductor is the **instrument** through which they pilot.
   → The conductor **supervises** the herd and **carries responsibility** (toward the human).

2. *"A flexible collab between CLIs."*
   → Agents collaborate **peer-to-peer** — not everything has to bubble up to the conductor.

3. *"A human can take control of an agent, or of one of the conductors."*
   → **Takeover** is explicitly named as a case distinct from normal operation.

**Conclusion**: the human is not "an external expert one consults". They are resident in the loop **above the conductor by default**; they step into the loop (takeover) or answer **escalations** when the conductor cannot/will not decide.

---

## 1. Primary actors

Six actor types. Each has a **default presence** (where they live in the loop) and an **activation mode** (when they intervene).

### 1.1 PRINCIPAL — the human in executive function (DEC-009)

- **Who**: the human (or humans) who holds the **executive function** over the engagement: owns the goal, authorizes, ratifies, accepts. Not an outside consultant — the ultimate decision-maker.
- **Default presence**: **above** the conductor, **outside** the operational loop.
- **Native interventions**:
  - Initial brief (drafts or validates the engagement charter).
  - Responds to **escalations** raised by the conductor (or, more rarely, by an agent or a control).
  - Occasional **takeover** of an agent or a conductor (REQ-013/014).
  - Accepts the final deliverable (closure).
- **Synonyms considered**: `human-principal`, `commanditaire`, `owner`, `executive`. **Open question**: one PRINCIPAL per engagement, or several (joint engagement ownership)?

### 1.2 CONDUCTOR — the delegate who pilots on the PRINCIPAL's behalf

- **Who**: the engagement's piloting instrument. Often a CLI agent; **may be a human** if the PRINCIPAL chooses to conduct directly.
- **Default presence**: **inside the loop**, at the top of the engagement tree.
- **Responsibilities**:
  - Decomposes the goal into assignments for agents.
  - Supervises execution, consolidates outputs.
  - Decides operational matters.
  - **Default channel** between PRINCIPAL and herd: anything from the PRINCIPAL lands at the conductor, and the conductor is what reaches back to the PRINCIPAL.
  - Proposes most ordinary amendments (DEC-004).
- **Synonyms considered**: `conductor`, `chef-d-orchestre`, `lead`, `pilot-delegate`. **Open question**: one conductor per engagement, or several (co-conduction)?

### 1.2.bis EXECUTIF — the holder of overall accountability (DEC-016)

- **Who**: canonical role separate from PRINCIPAL (DEC-017), human or agentic, accountable for an upper scope spanning several PRINCIPALs, their mini-organizations, their CONDUCTORs, their AGENTS and their CONTROLs.
- **Default presence**: **above or around** federated mini-organizations. EXECUTIF holds accountability for the umbrella scope without erasing each PRINCIPAL's local authority.
- **Native interventions**:
  - Defines or ratifies the overall intention.
  - Creates or ratifies umbrella engagements.
  - Arbitrates between PRINCIPALs, mini-organizations, policies or CONTROLs.
  - Ratifies global policies and major exceptions.
  - Receives umbrella escalations when the local PRINCIPAL is not the sufficient authority.
- **Does NOT by default**: drive the day-to-day work of each mini-organization. That pilot work stays with the local PRINCIPAL and their CONDUCTORs, except by explicit engagement or takeover.
- **Synonyms considered**: `executive`, `sponsor`, `portfolio-owner`, `program-owner`. **Schema rule**: always represent `{instance, role, scope}`; the same INSTANCE may be PRINCIPAL on one scope and EXECUTIF on another.

### 1.3 AGENTS — the operators (DEC-008)

- **Who**: actors (tier CLI — Claude Code, Codex, Gemini, … — or human in operator mode) who **execute** the work within their role slots. Plural by convention: we reason about the herd, not the individual.
- **Default presence**: **inside the loop**, each bound to a slot for the duration of its binding.
- **Native flows**:
  - Receive assignments from the conductor (vertical).
  - **Collaborate peer-to-peer** (horizontal) — this is explicitly the "collab between CLIs" of the intention.
  - Report to the conductor (status, deliverable, blockage).
  - May, in defined cases, ask the PRINCIPAL for a decision via escalation.

#### 1.3.bis SUBAGENTS — the reserved depth (DEC-008)

- **Who**: child agents operating inside an AGENT's scope (e.g. Claude Code's Agent tool, Codex subagents, …).
- **V1 status**: **internal to the AGENT**, not addressable by the protocol, not individually visible to CONTROL or MANDATAIRE. The AGENT consolidates.
- **Anticipated V2 status**: first-class — slots, bindings, audit and takeover at subagent granularity.
- **Why this reserve**: avoid bloating V1, while not painting ourselves into a corner (the V1 protocol must be able to evolve to V2 without a break).
- **Open question** (deferred): when do we flip to V2? Activation criterion to be defined.

### 1.4 CONTROL — cross-tree control functions (DEC-007)

- **Who**: roles **not subordinate** to the conductor. Canonical examples: **cyber, finance, ethics, legal, quality**. Held by a CLI agent or a human.
- **Why the name**: DEC-007 — every cross-cutting function observed is a control function; name by the function (CONTROL) rather than by the topology ("transverse"). The cross-tree property still holds.
- **Default presence**: **inside the loop**, attached to the engagement scope, **outside the subordination tree**.
- **Native rights**:
  - Observation / cross-tree audit subject to the scope's disclosure rights. A CONTROL does not automatically read everything: it may receive redacted views, hashes, attestations or evidence packages.
  - Add constraints to the charter (self-signed for its own domain — DEC-004).
  - Veto on certain actions (defined per CONTROL convention).
  - Alert/notification toward the conductor or the PRINCIPAL (via `alert`, with controlled short-circuit possible — DEC-014).
- **Synonyms considered**: `control`, `control-role`, `oversight`. **Open question**: does a CONTROL talk to agents directly, or only via the conductor?

### 1.5 MANDATAIRE — the neutral presenter

- **Who**: **protocol built-in** role (not typically held by a human; rendered by a dedicated sub-agent, possibly the reference implementation).
- **Default presence**: **inactive**, instantiated on demand whenever a decision requires neutral presentation.
- **Interventions**:
  - Formats and presents options without bias for `decide` and `alert` escalations toward the PRINCIPAL (DEC-013).
  - Not required on `advise`, which stays a light, non-blocking path (DEC-013).
  - Conducts quorum votes (DEC-004).
  - Leads the signing session for human takeovers.
- **Never does**: vote, decide, choose the wording of a question in a way that favors an actor.
- **Also does NOT**: mediate, arbitrate, judge, resolve deadlocks. Those decisions belong to the scope's competent authority (DEC-024).
- **Synonyms considered**: `mandataire`, `notary`, `clerk`, `arbiter`. **Open question**: dedicated mandataire per engagement, or a global "service" mandataire serving several engagements?

---

## 2. Substrate: INSTANCE, SCOPE, PARTY, AUTHORITY, MANDATE, SLOT, BINDING, CONTRACT, POLICY, REGISTRY, NEGOTIATION

Concepts not to be confused:

- **INSTANCE** — a concrete entity (e.g. `claude-code:session-42`, or `human:alice@org`). Stable, identifiable.
- **SCOPE** — domain of application: mini-organization, engagement, federation, program, territory, contract, regulatory domain. A scope never signs.
- **PARTY** — party bound by a contractual artefact: human, organization, federation, administration, supplier, customer, etc.
- **AUTHORITY** — INSTANCE or quorum entitled to decide/signify for a PARTY or a SCOPE.
- **MANDATE** — explicit delegation tying `{instance, role, scope, rights}` and stating what the authority may negotiate, sign, refuse or escalate.
- **ROLE** (template) — a reusable contract defined outside an engagement (e.g. *Conductor*, *Reviewer*, *Cyber*). Describes responsibilities, signing rights, expected output format.
- **SLOT** — a placeholder in an engagement (e.g. in engagement `ship-v1`, the `Conductor` slot exists).
- **BINDING** — the attachment of an INSTANCE to a SLOT for a duration (e.g. `alice` is bound to `Conductor` until closure). A binding may be amended (change, temporary human takeover, etc.).
- **CONTRACT** — a normative container applicable to parties/scopes and signed by mandated authorities. May contain policies, obligations, rights, clauses, external references, and instantiate one or more engagements.
- **POLICY** — a durable, versioned rule applicable to a scope. A policy constrains contracts, engagements and actions; it may be standalone or a clause of a CONTRACT. It declares `sourceAuthority` and `adoptionMode` (`ratified`, `contractual`, `imposed`, `acknowledged`).
- **REGISTRY** — runtime directory of INSTANCE, roles, scopes, endpoints, capabilities, keys and accepted policies. Serves discovery and addressing; it decides nothing.
- **NEGOTIATION** — transient session of offer/counter-offer/signature to stabilize a CONTRACT, POLICY, ENGAGEMENT or amendment. Follows an append-only ledger and is applicable only once the signed artefact is stabilized.
- **OBLIGATION** — duty imposed or accepted: deliver, pay, declare, refrain, keep proof, meet a deadline. May be one-shot or recurring.
- **RIGHT** — right or permission: audit, access, veto, use, payment, reserved decision, recourse.
- **CLAUSE** — normative fragment inside a CONTRACT/POLICY/ENGAGEMENT: obligation, right, condition, exception, confidentiality, escalation, termination.
- **EVIDENCE_PACKAGE** — proof bundle shareable with controlled disclosure: documents, hashes, attestations, logs, signatures, redactions.

The same instance may hold several slots across several engagements, or (to be validated) several slots in the same engagement.

---

## 3. Default flows (no escalation, no takeover)

```
EXECUTIF ──┐ (overall intention / global policy / inter-perimeter arbitration)
           │
PRINCIPAL ─┤ (brief / amendment / escalation-response)
           ▼
      CONDUCTOR ◄──────► CONTROL  (audit, constraint, veto)
      │   ▲
      │   │ (status, report, arbitration request)
      ▼   │
     AGENTS ◄──► AGENTS            (peer-to-peer "CLI collab")
     │
     └─► SUBAGENTS (internal to each AGENT in V1)
```

Three "normal" flows:
1. **Vertical downward**: PRINCIPAL → CONDUCTOR → AGENTS (assignment).
2. **Vertical upward**: AGENTS → CONDUCTOR → (as needed) PRINCIPAL (report).
3. **Lateral**: AGENT ↔ AGENT (collab); CONTROL ↔ any actor (observation + constraint).
4. **Federated**: EXECUTIF ↔ PRINCIPALs/CONDUCTORs/CONTROL when an umbrella scope exists.

Structured multi-human modes (DEC-042):

1. **PEER_DIALOGUE**: PRINCIPAL ↔ PRINCIPAL, informal discussion between mini-organizations.
2. **DELEGATED_COORDINATION**: CONDUCTOR ↔ CONDUCTOR, repeated coordination under local mandates.
3. **SHARED_ENGAGEMENT**: shared charter with roles, controls, policies, success criteria and journal.
4. **FEDERATED_EXECUTIF**: umbrella scope owned by EXECUTIF, without erasing local PRINCIPALs.
5. **CONSORTIUM_QUORUM**: shared scope governed by a quorum/committee rather than a single EXECUTIF.
6. **PUBLIC_AUTHORITY**: policy, evidence or recourse involving an external/public authority.

**No "consult-the-human" exists in the default flow**: if an agent needs a decision, it asks its conductor, which decides or escalates.

---

## 4. Exceptional flows

### 4.1 Escalation
An actor explicitly asks the **scope's competent authority** for arbitration because they cannot/will not decide within their mandate.
- AGENT → CONDUCTOR: not an "escalation" — that is the normal upward flow. No mandataire required.
- CONDUCTOR → PRINCIPAL: default mono-human case, via `advise`, `decide` or `alert` (DEC-012). MANDATAIRE required on `decide`/`alert`, not on `advise` (DEC-013).
- CONDUCTOR/CONTROL/AGENT → EXECUTIF, quorum, external authority or recourse: federated, contractual or governmental case (DEC-024).
- AGENT → PRINCIPAL or CONTROL → PRINCIPAL: **exceptional escalation**, conditioned (e.g. CONTROL cyber detects a problematic conductor act). `alert` may controlled-short-circuit the CONDUCTOR: default copy, exclusion possible with traced reason (DEC-014).

### 4.2 Takeover
The PRINCIPAL substitutes their INSTANCE in place of an existing binding.
- **takeover-agent**: PRINCIPAL becomes the agent on a slot for N actions or a duration.
- **takeover-conductor**: PRINCIPAL pilots directly, the delegated conductor is suspended.
- Governed by **signed amendment** (DEC-004); mandataire leads the session.

---

## 5. What is NOT a protocol actor

Not to be confused with actors:

- **Host CLI** (Claude Code, Codex, Gemini, other) — that is the *technical substrate* hosting an agent, not the agent itself.
- **WORKSPACE** — an agent's local directory (useful for the local-files transport), not an actor.
- **TRANSPORT** (local-files, central MCP, remote) — low layer, transparent to the actor vocabulary.
- **ENGAGEMENT** — an operational artefact that has a scope, not an actor and not the scope itself.
- **CHARTER** — the *document* describing the engagement, not an actor.
- **CONTRACT** — a *normative artefact*, not an actor. May contain or reference policies and engagements.
- **POLICY** — a *durable scope rule*, not an actor and not an engagement. Applied, audited or proposed by actors, often CONTROL or EXECUTIF.
- **REGISTRY** — a discovery service or directory, not an authority. Being listed is not a right to act.
- **NEGOTIATION** — a convergence session, not a contract. It may produce a stabilized signed artefact.
- **Inter-contract MEDIATOR** — absent in V1. Global conflicts between contracts are detected/traced then escalated, not automatically resolved by a hidden actor.
- **ENFORCEMENT_PLAN** — the application plan for rules, not an actor. CONTROL actors may execute or audit it.

---

## 6. Open questions (to be settled in upcoming passes)

1. **Uniqueness**: one unique PRINCIPAL and one unique CONDUCTOR per engagement, or plurality possible?
2. **Human-as-agent**: is the PRINCIPAL in operator mode indistinguishable from a CLI agent at the protocol level, or is there a "this is human" mark on the binding?
3. **CONTROL → AGENTS directly**: yes (consistent with cross-tree audit), or only via the conductor (consistent with a single command chain)?
4. **Mandataire**: per-engagement or as a service? If built-in, how to guarantee/verify neutrality?
5. **AGENT ↔ AGENT collab**: is lateral collaboration free or must it be declared to the conductor (a posteriori? a priori?)?
6. **SUBAGENTS V2**: trigger/criterion for moving internal SUBAGENTS → first-class? (Deferred, V1 stays with internal subagents.)
7. **Peer multi-human**: resolved by DEC-042 (`selectMultiHumanMode`), from PRINCIPAL ↔ PRINCIPAL to CONDUCTOR ↔ CONDUCTOR, shared ENGAGEMENT, EXECUTIF, quorum or external authority.
8. **Multi-role human**: how to represent the same human simultaneously holding local PRINCIPAL, an operational role, CONTROL or EXECUTIF?
9. **CONTRACT**: minimal schema, signatures, parties, rights, obligations, policies, derived engagements.
10. **POLICY**: lifecycle, signature, inheritance, precedence and conflict resolution between scopes.
11. **CONTROL ↔ POLICY/CONTRACT**: minimal rights per domain (propose, impose, audit, veto, alert)?
12. **REGISTRY**: central MCP, local-files, remote, or several synchronizable registries?
13. **NEGOTIATION**: minimal offer/counter-offer format, delays, expiration, quorum, canonical hash.
14. **Without inter-contract mediator**: which conflicts should only be flagged, and which should block a signature?
15. **Adjudication/recourse**: should there be a canonical role separate for tribunal/arbiter, or is an external authority enough in V1?
16. **CONTROL disclosure**: which standard redaction/proof levels should be enforced in cross-organization contracts?

---

## 7. Contractual stack (V1.2 — revised DEC-018/023)

> **Motivation**: a real contract often mixes durable rules, obligations, rights, executable missions, evidence and enforcement mechanisms. The stack must therefore not make `POLICY` a linear fifth layer. It distinguishes normative artefacts (`CONTRACT`, `POLICY`, `ENGAGEMENT`) from the application plan (`ENFORCEMENT_PLAN`).

### 7.1 INTENTION — the why

- **Definition**: high-level, value-driven, possibly loosely structured goal. States a purpose, not an execution.
- **Source**: PRINCIPAL or EXECUTIF depending on scope.
- **Examples**: *"ship product v1 by end of Q3"*, *"remediate the security incident of May 12"*, *"reach GDPR compliance"*, *"pilot a herd of CLI agents" (← our case)*.
- **Properties**: narrative, persistent, may survive several specs, contracts and engagements.
- **Not directly executable** — it is upstream of the chain.

### 7.2 SPECIFICATION — the measurable what

- **Definition**: translation of an intention into **verifiable requirements**, classified (functional, non-functional, CONTROL constraints).
- **Source**: drafted by PRINCIPAL, EXECUTIF or CONDUCTOR; reviewed by CONTROL for domain constraints; ratified by the appropriate authority.
- **Properties**: numbered, traceable, validatable, ideally testable.
- **Not directly executable**, but serves as acceptance criterion and reference for contractual artefacts.

### 7.3 Contractual artefacts — what binds the parties

#### 7.3.1 CONTRACT — the signed normative container (DEC-018/021)

- **Definition**: normative container applicable to parties/scopes and signed by mandated authorities.
- **Possible content**: policies, obligations, rights, parties, roles, control/escalation clauses, evidence, external references, amendment modalities.
- **Relation to engagements**: a contract may instantiate one or more engagements, or define the conditions under which engagements will be created.
- **Examples**: supplier contract, customer contract, employment contract, shareholders' agreement, master agreement, partnership convention, platform regulations.

#### 7.3.2 POLICY — the durable scope rule (DEC-016/018)

- **Definition**: durable, versioned rule applicable to an organizational scope.
- **Source**: local PRINCIPAL, EXECUTIF, CONTROL, contract, external authority or governance engagement depending on scope.
- **Reach**: mini-organization, engagement, contract, federation, umbrella activity, territory, regulatory domain.
- **Two forms**: standalone (e.g. internal policy, law, regulation) or clause/rule contained in a CONTRACT.
- **Adoption**: `ratified` (locally ratified), `contractual` (accepted by contract), `imposed` (law/tax/regulation), or `acknowledged` (recognized without local normative consent).
- **Relation to engagements**: an engagement references applicable policies; a violation or derogation triggers trace, control, veto or escalation depending on domain.

#### 7.3.3 ENGAGEMENT — the executable operational contract (DEC-003/018/021)

- **Definition**: executable operational artefact with a concrete scope, a charter, role bindings, attached controls, applicable policies, success criteria and a journal.
- **Source**: CONDUCTOR or EXECUTIF/PRINCIPAL depending on scope; signers per governance table.
- **Lifecycle**: living charter + signed amendments.
- **Relation to contracts**: may be standalone or derived from a wider CONTRACT.
- **Executable**: this is where actors do the work and execution evidence accumulates.

### 7.4 ENFORCEMENT_PLAN / ESCALATION — the application plan

- **Definition**: cross-cutting plan that applies and verifies INTENTION, SPEC, CONTRACT, POLICY and ENGAGEMENT.
- **What it is not**: not a contract, not a policy, not an engagement; it manages their application.
- **Normal mode**: observation, audit, validation, veto, compliance check, evidence, minimized disclosure.
- **Exception mode**: `advise`, `decide`, `alert`; MANDATAIRE required on `decide`/`alert`, not on `advise`; `alert` allows a controlled short-circuit of the CONDUCTOR.
- **Correction loops**: may trigger engagement amendment, policy exception, contract revision, spec revision or intention clarification.

### 7.5 Relations between layers and artefacts

```
[INTENTION]                         ← why / direction
     │ refined into
     ▼
[SPECIFICATION]                     ← verifiable what
     │ contractualized by
     ▼
[CONTRACT / POLICY / ENGAGEMENT]    ← what binds, constrains, commits
     │ executed in
     ▼
[ACTIONS + JOURNALS + EVIDENCE]     ← observable work

[ENFORCEMENT_PLAN / ESCALATION]     ← applies, audits, alerts, routes arbitration
     ▲             │
     └─────────────┴── may correct contract, policy, engagement, spec or intention
```

- 1 INTENTION → N SPECIFICATIONS.
- 1 SPECIFICATION → N CONTRACTS/POLICIES/ENGAGEMENTS.
- 1 CONTRACT → N POLICIES and/or N ENGAGEMENTS.
- 1 POLICY → N scopes and N constrained engagements.
- 1 ENGAGEMENT → N actions, journals and evidence.
- ENFORCEMENT_PLAN/ESCALATION attaches at any controllable level.
- REGISTRY lets actors discover each other; NEGOTIATION lets them produce or amend contractual artefacts.

### 7.6 Open questions on the contractual stack

1. **Numbering and identity**: standardize `INT-NNN` / `SPEC-NNN` / `CONTRACT-NNN` / `POLICY-NNN` / `ENG-NNN`?
2. **Versioning**: which artefacts are immutable + signed amendments, and which stay editable by their authority?
3. **Minimal CONTRACT**: parties, scopes, policies, engagements, escalation clauses, signatures, evidence, amendments.
4. **Master agreement**: is a master agreement a CONTRACT with no immediate engagement, or a CONTRACT with an engagement template?
5. **External authority**: how to represent law/regulation/tax imposed without local contractual consent?
6. **Precedence**: conflict rule between internal, contractual, federated and public policy.
