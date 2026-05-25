# Design decisions journal

> **Role in the contractual stack (DEC-010)**: this file traces the **choices** made to satisfy `SPEC.md` from `INTENTION.md`. It is not a layer of the stack — it is the history of arbitrations.
> **Convention**: `DEC-NNN`, continuous numbering, append-only. Each DEC references the relevant REQs. A revised decision → a new DEC that explicitly revises the previous one (no silent edits).
> **Downstream**: reference these DECs from detailed specs (`specs/SPEC-*.md`).

## DEC-001 — Scope of spec #1
**Date**: 2026-05-16. **Refers**: REQ-001, REQ-007, REQ-010, REQ-013, REQ-014.

**Decision**: Spec #1 = **Core protocol + Org/roles/HITL model** (merge of options A and C from the initial scoping). The vertical local-files slice (option B) will be handled in spec #2.

**Why**: contract and organization define each other; freezing them separately would let them diverge.

## DEC-002 — Organization model
**Date**: 2026-05-16. **Refers**: REQ-007, REQ-008, REQ-010, REQ-021.

**Decision**: **Role templates + ad-hoc engagements** (option C). Roles are reusable contracts, instantiated in engagements (= concrete missions with a defined scope). CONTROLs are roles attached to an engagement's scope with cross-tree rights. **Mappable** onto a classic org-chart for visualization (REQ-021).

**Why**: reflects how real organizations actually work, natively accommodates CONTROLs, HITL becomes clean (human ↔ role-slot binding).

## DEC-003 — Engagement lifecycle
**Date**: 2026-05-16. **Refers**: REQ-022, REQ-023, REQ-024.

**Decision**: **Living charter + signed amendments**. Every engagement starts with an initial charter (goal, bindings, CONTROLs, success criteria). Every change (scope, bindings, attached CONTROLs, constraints, pause/resume, closure) goes through a **signed amendment** by the appropriate authority. The sequence of amendments IS the engagement's verifiable history.

**Why**: only way to satisfy REQ-024 (executable without ambiguity — a charter exists at all times), REQ-022 (validatable), REQ-023 (changeable in a controlled way) simultaneously.

## DEC-004 — Amendment governance
**Date**: 2026-05-16. **Refers**: DEC-003, REQ-011.

**Decision**: **Typed declarative table + M-of-N quorum for sensitive amendments** (option C). Spec #1 delivers the machinery for both; the "ordinary vs sensitive" classification will be refined per domain.

**Why**: A (CONDUCTOR sole signer) violates REQ-011 and CONTROL autonomy; B (table alone) covers everyday cases but lacks a safety net for genuinely risky ops; C combines both.

## DEC-005 — MANDATAIRE = built-in role
**Date**: 2026-05-16. **Refers**: REQ-027.

**Decision**: For every quorum vote AND every escalation to the PRINCIPAL, a dedicated role — **MANDATAIRE** — formulates the question and presents the options to the deciders without the proposer's bias. Does not vote, does not decide.

**Why**: without neutral presentation, a proposer manipulates the decision through wording. Protocol analogue of the notary / session clerk. To be specified: who may hold this role, its relation to other roles, verifiable neutrality.

## DEC-006 — Escalation to PRINCIPAL = first-class primitive
**Date**: 2026-05-16. **Refers**: REQ-026.

**Decision**: Escalation toward the PRINCIPAL is a first-class protocol primitive, **distinct from the amendment mechanism**. Any role may trigger an escalation; the protocol handles channel, wait, timeout, fallback action (REQ-028), trace.

**Why**: explicit user feedback — treating it as just-another-amendment was a design mistake that would have forced half the human use cases into an inappropriate co-signature format (e.g. "agent asks PRINCIPAL for advice" has nothing to do with "change the charter").

## DEC-007 — Rename TRANSVERSE → CONTROL
**Date**: 2026-05-16. **Refers**: REQ-008, REQ-009.

**Decision**: Rename the "TRANSVERSE" role to **CONTROL**. Every identifiable cross-cutting function is a control function (cyber, finance, ethics, legal, quality). The cross-tree topology stays true but becomes a *property* of CONTROL, not its name.

**Why**: name a thing by what it does, not by where it sits.

## DEC-008 — AGENT → AGENTS + SUBAGENTS layer planned
**Date**: 2026-05-16. **Refers**: REQ-001, REQ-002.

**Decision**: Plural by convention "AGENTS". Plan for the **SUBAGENTS** layer (host CLIs have them natively). **V1 default**: SUBAGENTS internal to the AGENT (not addressable, not individually auditable by the protocol) — the AGENT consolidates. **Anticipated V2**: first-class SUBAGENTS (slots, bindings, audit, takeover possible at subagent granularity).

**Why**: don't bloat V1, but reserve conceptual space to avoid painting ourselves into a corner.

## DEC-009 — PRINCIPAL retained, qualified as "executive function"
**Date**: 2026-05-16. **Refers**: REQ-013, REQ-014.

**Decision**: The name PRINCIPAL stays, with the description making it precise that the human PRINCIPAL holds an **executive function** (ultimate authority, sets direction, ratifies). No technical decision, only a description clarification.

**Why**: user feedback.

## DEC-010 — 4-layer contractual stack
**Date**: 2026-05-16. **Refers**: REQ-022, REQ-024.

**Decision**: **INTENTION → SPECIFICATION → ENGAGEMENT → CONTROL/ESCALATION**. Defines the refinement chain from vague goal to measurable, executed, audited action. Materialized in the repo by the files `INTENTION.md`, `SPEC.md`, and `DECISIONS.md` (this file). The ENGAGEMENT layer lives in real engagements (charters + amendments); the CONTROL/ESCALATION layer is operational and traced in engagement journals.

**Why**: trace the chain from vague to executed explicitly, readable and amendable. Per-layer details in `VOCABULARY.md §7`.

## DEC-012 — 3 escalation primitives: `advise` + `decide` + `alert`
**Date**: 2026-05-16. **Refers**: REQ-026, REQ-028, DEC-006.

**Decision**: The protocol exposes **three distinct primitives** for escalation from a role to the PRINCIPAL:

- **`advise`** — non-blocking. The role asks for an opinion; it continues its work and applies the declared timeout fallback (REQ-028). Low expected latency.
- **`decide`** — blocking. Decision gate with timeout + declared fallback. The role waits for the answer before acting.
- **`alert`** — urgent. Priority channel, immediate notification, potentially CONDUCTOR-short-circuit routing. Mostly used by CONTROLs on incident (cyber, compliance, etc.). First-class urgency semantics.

**Scope**: these three primitives cover **only** escalation toward the PRINCIPAL. Takeover (PRINCIPAL replaces a binding) and quorum voting on sensitive amendments go through the amendment mechanism defined in DEC-004, not these primitives.

**Why**:
- `advise` vs `decide` have fundamentally different blocking semantics — conflating them would be a source of subtle bugs.
- `alert` deserves to be first-class rather than a flag on `decide` because (1) its routing differs (potentially short-circuit), (2) its latency guarantees are distinct, (3) its typical emitter (CONTROL) has a different stance from an AGENT/CONDUCTOR in normal flow.
- A 3-typed-verb API surface stays small and lintable, gives clear signals to the PRINCIPAL.

**To be specified downstream**: MANDATAIRE involvement on each (DEC to come), `alert` routing rules (via CONDUCTOR or short-circuit), timeout fallback taxonomy (REQ-028).

## DEC-011 — Split `INTENT.md` into 3 files per the stack
**Date**: 2026-05-16. **Refers**: DEC-010.

**Decision**: Split the former `INTENT.md` (which mixed the 3 layers narrative+REQs+DECs) into:
- `INTENTION.md`: user verbatim + narrative rewrite + project scope
- `SPEC.md`: all `REQ-NNN`
- `DECISIONS.md`: all `DEC-NNN` (this file)

`INTENT.md` is then renamed `README.md` to serve as the repo's minimal index (universal convention) and remove the ambiguity with `INTENTION.md`.

**Why**: materializes DEC-010 in the repo structure; each artefact type has its home; the target reading (intention for framing, spec for requirements, decisions for traceability) no longer mixes. The `INTENT.md → README.md` rename removes the visual clash with `INTENTION.md`.

## DEC-013 — MANDATAIRE required on `decide` and `alert`, not on `advise`
**Date**: 2026-05-16. **Refers**: REQ-026, REQ-027, REQ-028, DEC-005, DEC-012.

**Decision**: Across the three escalation primitives to the PRINCIPAL defined by DEC-012, the MANDATAIRE is:

- **required on `decide`**: the decision blocks action and commits the PRINCIPAL to a choice; options must be presented without bias by the proposer.
- **required on `alert`**: urgency and the risk of CONDUCTOR short-circuit increase the need for neutrality, even if latency must stay top priority.
- **not required on `advise`**: the opinion is non-blocking; the role may phrase its request directly to keep a lightweight path. The declared timeout fallback remains mandatory.

**Revision of DEC-005**: DEC-005 still holds for quorum votes and for escalations asking a decision or signalling an alert. It does not apply automatically to the `advise` case.

**Why**: `advise` must stay a low-friction primitive for getting an opinion without interrupting work. `decide` and `alert` carry higher stakes: blocking decision or priority incident. MANDATAIRE neutrality is therefore a protocol guarantee, not an option.

**To be specified downstream**: minimal format of an `advise` request, MANDATAIRE presentation format for `decide`/`alert`, and latency/routing rules when `alert` requires a MANDATAIRE.

## DEC-014 — `alert` allows a controlled short-circuit of the CONDUCTOR
**Date**: 2026-05-17. **Refers**: REQ-026, REQ-027, REQ-028, DEC-012, DEC-013.

**Decision**: An `alert` escalation may notify the PRINCIPAL directly without waiting for the CONDUCTOR. This short-circuit is **controlled**:

- the CONDUCTOR is copied by default in the alert trace;
- the CONDUCTOR may be excluded from immediate routing if the emitter declares it potentially party to the issue, unavailable, compromised, or a critical slow-down factor;
- excluding the CONDUCTOR must be traced with an explicit reason;
- the MANDATAIRE remains required on `alert` per DEC-013, but its intervention must be compatible with the alert's latency priority.

**Why**: `alert` exists precisely for incidents where the normal chain may be too slow or itself involved in the problem. The short-circuit must therefore be possible, but not invisible: audit must reconstruct who was notified, who was excluded, and why.

**To be specified downstream**: exact routing fields of an `alert`, urgency levels, latency guarantees, and rules for delayed CONDUCTOR notification when it is excluded from immediate routing.

## DEC-015 — Three multi-human channels coexist
**Date**: 2026-05-17. **Refers**: REQ-029, REQ-030, REQ-031, REQ-033.

**Decision**: The peer multi-human mode must support three complementary channels, without choosing one as the only one:

- **PRINCIPAL ↔ PRINCIPAL**: two humans talk directly as responsible parties of their respective mini-organizations.
- **CONDUCTOR ↔ CONDUCTOR**: the humans delegate operational negotiation to their conductors, who speak on behalf of their perimeters.
- **Shared ENGAGEMENT**: the parties create a joint engagement with charter, roles, bindings, controls, applicable policies, success criteria and dedicated journals.

**Why**: these three forms correspond to three maturity levels of the same exchange. Direct discussion is light, conductor-conductor delegation reduces human load, the shared engagement becomes necessary as soon as there is scope, responsibilities or auditable deliverables.

**Framing rule**: an informal dialogue may stay PRINCIPAL ↔ PRINCIPAL; repeated operational coordination should go through CONDUCTOR ↔ CONDUCTOR; any joint work with obligations, risks, deliverables or durable decisions must be instantiated as a shared ENGAGEMENT.

## DEC-016 — EXECUTIF and POLICY complete the multi-human organization
**Date**: 2026-05-17. **Refers**: REQ-008, REQ-010, REQ-011, REQ-020, REQ-029, REQ-032, REQ-033.

**Decision**: Add two canonical concepts to the model:

- **EXECUTIF**: human or agentic role accountable for the umbrella activity spanning several PRINCIPALs, their mini-organizations and their AGENTS. EXECUTIF does not erase local PRINCIPALs: it carries accountability for the upper scope, arbitrates inter-perimeter conflicts, ratifies global policies and may create umbrella engagements.
- **POLICY**: durable, versioned rule applicable to an organizational scope (mini-organization, engagement, federation, umbrella activity). A POLICY is not an ENGAGEMENT: it constrains engagements and actions but is not a mission's operational contract.

**Relation POLICY ↔ ENGAGEMENT**: an engagement declares the applicable policies in its charter. Modifying a policy may require an engagement or amendment to govern the change, but the policy artefact stays distinct from the engagement charter.

**Relation CONTROL ↔ POLICY**: CONTROLs are the natural owners or validators of policies in their domain (cyber, finance, ethics, legal, quality). They may propose, impose, audit, alert or veto depending on their domain and on the rights attached to the policy.

**Why**: without EXECUTIF, the multi-human model cannot represent umbrella accountability. Without POLICY, cross-cutting constraints end up forced into engagements, which conflates durable rules with operational contracts.

**To be specified downstream**: policy lifecycle, precedence between policies of different scopes, conflict resolution between CONTROLs, and escalation rules from a policy violation.

## DEC-017 — EXECUTIF is a role separate from PRINCIPAL
**Date**: 2026-05-17. **Refers**: REQ-029, REQ-030, REQ-032, REQ-035, REQ-036, DEC-016.

**Decision**: EXECUTIF is a canonical role separate from PRINCIPAL, even though the same human INSTANCE may hold both roles on different scopes.

**Why**: PRINCIPAL holds local authority over their mini-organization; EXECUTIF holds umbrella accountability over a federated activity. Conflating them would make audit ambiguous whenever a human acts sometimes for their own perimeter and sometimes for the collective.

**Consequence**: schemas must explicitly represent the `{instance, role, scope}` triple. An INSTANCE may be `PRINCIPAL` on `org:alice` and `EXECUTIF` on `federation:program-x`, but rights, traces and escalations are not interchangeable.

## DEC-018 — CONTRACT as normative container; CONTROL/ESCALATION as application plan
**Date**: 2026-05-17. **Refers**: REQ-037, REQ-038, REQ-039, REQ-040, REQ-041, REQ-042, REQ-043, REQ-044, REQ-045.

**Decision**: POLICY is not a linear fifth layer of the stack. The model instead distinguishes three contractual artefacts and an application plan:

- **CONTRACT**: signed normative container between parties or scopes. It may contain policies, obligations, rights, control/escalation clauses, external references, and instantiate one or more engagements.
- **ENGAGEMENT**: executable operational contract for a concrete work scope, with charter, roles, bindings, success criteria, applicable policies, journal and amendments.
- **POLICY**: durable, versioned rule applicable to a scope. It may be standalone (e.g. public regulation, internal policy) or a clause/rule contained in a CONTRACT.
- **CONTROL/ESCALATION**: enforcement plan for contracts, engagements and policies. It observes, audits, detects violations, triggers veto/alerts/escalations, and produces proof.

**Why**: in real-world models (customer contract, supplier contract, employment contract, regulation, taxes), a "contract" mixes durable rules, obligations, rights, executable missions and enforcement mechanisms. Forcing POLICY into a 5th layer or every contract into ENGAGEMENT would conflate the durable, the executable and the enforcement.

**Consequence on the stack**: the stack stays oriented by the flow `INTENTION → SPECIFICATION → CONTRACTUAL ARTEFACTS → EXECUTION`, while `CONTROL/ESCALATION` operates as a cross-cutting application plan. It may attach to a CONTRACT, an ENGAGEMENT, a POLICY, a SPEC or an INTENTION, depending on what must be controlled.

**To be specified downstream**: minimal CONTRACT schema, CONTRACT ↔ POLICY ↔ ENGAGEMENT relation, status of master agreements, and proof/signature/amendment rules.

## DEC-019 — REGISTRY and NEGOTIATION as non-actor runtime primitives
**Date**: 2026-05-17. **Refers**: REQ-051, REQ-052, REQ-053, REQ-054, REQ-055.

**Decision**: Add two runtime primitives that are not actors:

- **REGISTRY**: minimal directory of INSTANCEs, roles, scopes, endpoints, capabilities, signing keys and accepted policies. Lets CONDUCTORs/AGENTS/CONTROLs discover each other without imposing a central authority.
- **NEGOTIATION**: transient session of proposal, counter-proposal, acceptance and signature aiming to stabilize a CONTRACT, POLICY, ENGAGEMENT or amendment.

A NEGOTIATION becomes stable when the required parties sign the same canonical artefact identified by version and hash. Until that threshold is reached, it stays a proposal exchange, not an applicable contractual artefact.

**Why**: the "1 PRINCIPAL / 15 CONDUCTORS" case requires conductors to discover each other and contract between themselves without an inter-contract mediator. REGISTRY and NEGOTIATION cover this minimal need without adding a new governance actor.

**V1 limit**: without an inter-contract mediator, the protocol does not guarantee global coherence across all contracts. It can detect and trace conflicts; their resolution goes through ENFORCEMENT_PLAN/ESCALATION and the scope's competent authority (PRINCIPAL, EXECUTIF, quorum, authorized CONTROL or external authority).

## DEC-020 — Recommended name: `a2a-accord`
**Date**: 2026-05-17. **Refers**: REQ-016, REQ-056, REQ-057, REQ-058, REQ-059.

**Decision**: Recommend `a2a-accord` as the core project/package name, published under `@sentropic/a2a-accord`.

Considered companion packages:

- `@sentropic/a2a-accord-mcp` — minimal MCP server.
- `@sentropic/a2a-accord-codex` — Codex adapter/plugin.
- `@sentropic/a2a-accord-claude` — Claude adapter/plugin.

**Why**: the heart of the project is not a CLI but a language/runtime of stabilized accords between agents. `a2a-accord` keeps the link to the A2A intention without narrowing the package to the `CONTRACT` artefact: it also covers `POLICY`, `ENGAGEMENT`, negotiation, signature, proof and responsibility. CLI adapters stay secondary and replaceable.

**Status**: recommended but not yet ratified by the user. Commit/push to be done only after name validation and creation/verification of a real Git repo.

## DEC-021 — A scope does not sign; a mandated authority signs on its behalf
**Date**: 2026-05-17. **Refers**: REQ-061, REQ-062, REQ-063, REQ-064.

**Decision**: Explicitly introduce `SCOPE`, `PARTY`, `AUTHORITY`, `MANDATE` and `SIGNATURE`.

Canonical rule: a **scope never signs**. An `INSTANCE` signs by holding an authorized role (`PRINCIPAL`, `EXECUTIF`, `CONDUCTOR`, `CONTROL`, quorum, external authority) and under a `MANDATE` that states for which `PARTY` or `SCOPE` it commits its signature.

**Consequence**: phrasings like "CONTRACT signed between scopes" must be read as "CONTRACT applicable to scopes, signed by the mandated authorities of the concerned parties".

**Why**: the ABC audit shows parties, scopes and authorities overlap but are not identical. Conflating them would make signatures, reserved rights, regulatory obligations and recourse impossible to audit properly.

## DEC-022 — Stabilization without mediator via negotiation ledger
**Date**: 2026-05-17. **Refers**: REQ-052, REQ-053, REQ-054, REQ-055, REQ-065, REQ-066, REQ-067.

**Decision**: In V1, there is no inter-contract mediator. Convergence between conductors goes through a `NEGOTIATION` with append-only ledger, versioned proposals, base hash, explicit states and required signatures.

Minimal state machine: `draft`, `proposed`, `countered`, `accepted`, `rejected`, `withdrawn`, `expired`, `stabilized`, `abandoned`.

A negotiation is stable only if the required signers sign the same canonical artefact. Conflicts between stabilized contracts are detected and escalated; they are not resolved automatically.

**Why**: in the 15 CONDUCTORS case, up to 105 bilateral channels exist. Without ledger and terminal states, conductors may believe they have converged while actually having signed different versions or stale proposals.

## DEC-023 — CONTROL is a role; ENFORCEMENT_PLAN is the application plan
**Date**: 2026-05-17. **Refers**: REQ-008, REQ-049, REQ-070.

**Decision**: Keep `CONTROL` as a canonical role, but name the cross-cutting application plan **ENFORCEMENT_PLAN**.

- `CONTROL` / `CONTROL_ROLE`: domain actor or role (cyber, finance, legal, quality, ethics).
- `ENFORCEMENT_PLAN`: audit, validation, veto, alert, evidence, exception, recourse and escalation mechanisms applied to contractual artefacts.

**Revision of DEC-018**: the former shortcut `CONTROL/ESCALATION` designated the application plan. The precise terminology becomes `ENFORCEMENT_PLAN`, with `ESCALATION` as a mechanism of that plan.

**Why**: using `CONTROL` both for a role and for a plan blurs rights, especially cross-organization and in governmental models. The separation also allows enforcement of disclosure minimization: a CONTROL does not automatically have access to everything.

## DEC-024 — Escalation to scope authority; MANDATAIRE not an arbiter
**Date**: 2026-05-17. **Refers**: REQ-026, REQ-027, REQ-028, REQ-068, REQ-069.

**Decision**: Generalize escalation: the `advise`, `decide`, `alert` primitives target the **scope's competent authority**, not only the local PRINCIPAL.

Possible authorities depending on context: PRINCIPAL, EXECUTIF, quorum, authorized CONTROL, external authority, explicitly modelled recourse or adjudication. PRINCIPAL stays the default target in the mono-human case, but B/C models require other authorities.

The **MANDATAIRE** stays a neutral presenter: it formulates, formats and traces. It does not mediate, does not arbitrate, does not judge and does not resolve a deadlock.

**Why**: enterprises, ecosystems and administrations have decisions that do not always fall to the local PRINCIPAL. Conflating MANDATAIRE, mediator and tribunal would create a false authority in the protocol.

## DEC-025 — `h2a` becomes the umbrella name; `a2a` becomes a sub-surface
**Date**: 2026-05-18. **Refers**: REQ-016, REQ-059, REQ-072.

**Decision**: Revise DEC-020. The project's recommended umbrella name becomes **`h2a`** (`humans to agents`), published core-side under `@sentropic/h2a`.

Considered companion packages:

- `@sentropic/h2a-mcp` — minimal MCP server.
- `@sentropic/h2a-codex` — Codex adapter/plugin.
- `@sentropic/h2a-claude` — Claude adapter/plugin.
- `@sentropic/h2a-a2a` — optional sub-surface for pure agent-to-agent if we want to isolate it.

**Why**: the project does not only address agent-to-agent exchange. It also covers multi-human coordination, organization, authority, mandates, escalations and human-in-the-loop. `a2a` is therefore too narrow as an umbrella name; it stays relevant as a sub-surface or specialized sub-package.

**Consequence**: proposed runtime names, packages, local paths and protocol identifiers must now align with `h2a`. The former candidate `a2a-accord` remains in DEC-020's history but is no longer the recommended name.

## DEC-026 — Reduce bootstrap to 2 packages: `h2a` + `h2a-cli`
**Date**: 2026-05-18. **Refers**: REQ-017, REQ-018, REQ-056, REQ-057, REQ-058, REQ-059.

**Decision**: At this stage, the runtime bootstrap is reduced to **two packages**:

- `@sentropic/h2a` — core runtime and shared contracts.
- `@sentropic/h2a-cli` — single integration surface for `mcp`, `codex`, `claude` and `gemini`.

The `@sentropic/h2a-cli` package stays **internally modularized** to preserve development orthogonality and contract clarity, without multiplying published packages too early.

**Why**: four published packages for a bootstrap create more release and versioning friction than value. The immediate need is boundary clarity, not npm registry fragmentation.

**Consequence**: the former candidates `@sentropic/h2a-mcp`, `@sentropic/h2a-codex` and `@sentropic/h2a-claude` exit the V1 target. They may reappear later only if a divergence of dependencies, cadence or contract justifies it.

## DEC-027 — Project license = MIT
**Date**: 2026-05-18. **Refers**: REQ-016.

**Decision**: The `h2a` project adopts the **MIT** license (`SPDX: MIT`). The two published packages (`@sentropic/h2a`, `@sentropic/h2a-cli`) switch their `license` field from `UNLICENSED` to `MIT`. A root `LICENSE` file carries the canonical text with copyright `2026 Fabien Antoine (rhanka)`.

**Why**: standard permissive license for the protocol/CLI layer, commercial-compatible and npm-publishable. Removes the `UNLICENSED` ambiguity that blocked downstream consumption.

**Consequence**: future `npm publish` automatically inherits `MIT`. If a future sub-package needs a different license (e.g. AGPL for a server), it must be justified explicitly.

## DEC-028 — Gemini deferred to wave 2
**Date**: 2026-05-18. **Refers**: DEC-026, REQ-057, REQ-058.

**Decision**: Gemini integration is **deferred to wave 2**. Wave 1 targets Codex + Claude for the plugin/registration/inbox effort. The `gemini` host descriptor stays exposed via `h2a hosts` and the `H2A_CLI_HOSTS` list for CLI surface consistency.

**Why**: tripling the plugin effort in wave 1 slows core protocol convergence; better freeze the pattern on two hosts (Codex/Claude) before porting a third.

**Consequence**: the `Gemini` track of workpackage 40 stays empty in wave 1; no commitment to Gemini negotiation/inbox support before wave 2.

## DEC-029 — Deprecation of `@sentropic/h2a-cli@0.1.0`
**Date**: 2026-05-18. **Refers**: DEC-026.

**Decision**: Mark `@sentropic/h2a-cli@0.1.0` as deprecated on npm with the message:
> `Use 0.1.1; 0.1.0 was published without the CLI bin entry.`

Version `0.1.1` stays the reference version. The deprecation is non-destructive (no `unpublish`) to preserve registry traceability.

**Why**: `0.1.0` does not provide the executable `h2a` bin due to an npm autocorrection on the first publish. Its silent coexistence risks routing fresh installs to a broken version.

**Consequence**: command to be run interactively by an npm-authenticated user — `npm deprecate "@sentropic/h2a-cli@0.1.0" "Use 0.1.1; 0.1.0 was published without the CLI bin entry."`.

## DEC-030 — Next delivery = core schemas first
**Date**: 2026-05-18. **Refers**: WP-10.

**Decision**: The next delivery track is the **implementation of core schemas** in `@sentropic/h2a`:
- `CONTRACT`, `POLICY`, `ENGAGEMENT`, `AMENDMENT`,
- `MANDATE`, `AUTHORITY`, `SIGNATURE`, `ENFORCEMENT_PLAN`,
- deterministic canonicalization (key sort, stable JSON),
- SHA-256 hashing of the canonical form.

Test-driven implementation; no local-files runtime nor MCP before schemas are minimally stable.

**Why**: everything else (registry, negotiation, inbox, MCP, plugins) depends on artefacts whose identity, canonicalization and hash are stable. Freezing them first reduces migration debt.

**Consequence**: WP-20 (local-files), WP-30 (CLI surface beyond `hosts`/`mcp-tools`) and WP-40 (integrations) wait for WP-10 to land.

## DEC-031 — Local-files store layout frozen
**Date**: 2026-05-18. **Refers**: RUNTIME_PROPOSAL.md, WP-20.

**Decision**: The V1 local-files store uses the root **`<root>/.h2a/`** (configurable, default `<cwd>/.h2a` for CLI usage; explicit `src/{project}/h2a/` when integrated into a named workspace). Inside:

```
<root>/.h2a/
  registry/instances.jsonl     # append-only H2AActorRegistration
  contracts/<id>/contract.json # stabilized immutable CONTRACT
  policies/<id>.json           # stabilized immutable POLICY
  engagements/<id>/
    charter.json
    events.jsonl               # engagement journal
    inbox/<instance>/
    outbox/<instance>/
    evidence/
  negotiations/<id>/
    state.json                 # current H2ANegotiationRecord (mutable)
    offers/                    # proposals/counteroffers (append-only)
    signatures/                # collected signatures (append-only)
    journal.jsonl              # H2AJournalEntry chain
  inbox/<actor>/               # global mailboxes (out of engagement)
  outbox/<actor>/
```

**Why**: picks up the proposal of `RUNTIME_PROPOSAL.md`; clearly separates (a) the mutable append-only runtime registry, (b) immutable stabilized artefacts, (c) negotiation sessions mutable until stabilization. The `.jsonl` format is portable, grep-friendly, and trivially append-only.

**Consequence**: the first implementation targets **registry + negotiation journal**; engagements and stabilized artefacts come next. The `runtime/local-files` module lives in `@sentropic/h2a-cli` (2-package target, DEC-026).

## DEC-032 — V1 without transport authentication; identity declared by the caller
**Date**: 2026-05-20. **Refers**: DEC-026, RUNTIME_PROPOSAL.md, WP-40.

**Decision**: For V1, the local-files runtime and the stdio MCP server impose **no transport authentication**. The caller declares its `instance` in arguments (CLI flags or MCP `tools/call` args). The runtime trusts that declaration; it does verify that **cryptographic signatures on artefacts** validate against the `publicKeys` recorded in the registry. Trust-on-first-use on registration: the first `registerInstance` sets the `publicKeys`; subsequent calls using the same `id` but a different key will be detected at stabilization through `verifyCanonical` failure.

**Why**: V1 targets a single user on their machine (DEC-026, RUNTIME_PROPOSAL). Stacking transport auth on a single-user local-files store would be gold-plating. Operational security rests on (a) filesystem permissions, (b) ed25519 artefact signatures in the journal, (c) inconsistency detection at stabilization.

**Consequence**: any multi-user or network deployment will require **DEC-V2** defining a secure transport (mTLS, signed bearer, etc.). No hidden upgrade path in V1 code.

## DEC-033 — Immutable persistence of stabilized artefacts + default causationId/correlationId propagation
**Date**: 2026-05-20. **Refers**: DEC-031, WP-20.

**Decision**: at stabilization of a negotiation, the local-files runtime:

1. **Finds the winning artefact** by walking the journal for the `offer`/`counter` event whose `computeHash(body.artifact)` equals the `winningHash` (the hash signed by the quorum). If no event matches, stabilization fails (`stabilizeNegotiation: no offer/counter event matches the winning artifactHash <hash>`).
2. **Writes the artefact write-once** into the DEC-031 immutable tree per `artifact.kind`:
   - `CONTRACT` → `<root>/contracts/<artifact.id>/contract.json`
   - `POLICY` → `<root>/policies/<artifact.id>.json`
   - `ENGAGEMENT` → `<root>/engagements/<artifact.id>/charter.json`
   - **Fallback** (any other `kind` or missing `kind`: `AMENDMENT`, `MANDATE`, `AUTHORITY`, `ENFORCEMENT_PLAN`, etc.) → `<root>/artifacts/<sha256_…>.json`, addressed by its canonical hash (the `:` of `sha256:` is replaced by `_` to produce a portable filename).
3. Refuses the write if the target file already exists (`writeFileSync(..., { flag: "wx" })`): stabilization reports `stabilizeNegotiation: stabilized artifact already on disk at <path>`. An artefact identifier (`<kind>:<id>`) is therefore unique store-wide; two negotiations cannot materialize the same `id` without a detected collision.
4. Returns the write path in `artifactPath` (exposed via `LocalStore.stabilizeNegotiation`, `h2a negotiate stabilize` and the `h2a_stabilize` MCP), and records it in the journal `stabilized` event.

**Why (write-once)**: (a) minimal audit proof — a stabilized artefact never changes on disk again, so `cat <root>/contracts/<id>/contract.json` is a reproducible source of truth; (b) defense in depth against bugs/race conditions that would rewrite the artefact to a hash divergent from the already-stored content; (c) the error detail exposes the collision immediately rather than burying it.

**Why (`artifacts/` fallback)**: DEC-031 froze the subtrees for `CONTRACT` / `POLICY` / `ENGAGEMENT`, but the vocabulary (DEC-018, DEC-019) also declares `AMENDMENT`, `MANDATE`, `AUTHORITY`, `ENFORCEMENT_PLAN`. Rather than waiting to invent a dedicated subtree for them, the hash-addressed fallback ensures every signed+stabilized artefact receives an immutable, grep-friendly location today.

**Decision (causation/correlation)**: the CLI flags `--causation-id` / `--correlation-id` are accepted by `h2a negotiate offer / counter / sign / event`, mirrored in the MCP tools `h2a_offer / h2a_counteroffer / h2a_sign / h2a_escalate`. **By default**, with no explicit flag, every new journal event inherits:

- `causationId ← previous.id` — every event is caused by the one preceding it in the journal, forming a causality chain parallel to `prevHash`.
- `correlationId ← previous.correlationId` — the negotiation is, by convention, **a single correlation thread**; the value is never invented, only propagated if explicitly set on a previous event.

**Why (thread = negotiation)**: in V1 we avoid reinventing a conversation identifier orthogonal to `negotiationId`. When a caller wants to explicitly thread several negotiations together (e.g. multi-engagement orchestration by a PRINCIPAL), they pass `--correlation-id <thread>` on the first `offer` and every subsequent event automatically inherits it. Conversely, an explicit event (`--causation-id manual`) may break the chain — useful to signal a branch on the audit side.

**Consequence**: no schema change for V1 — `H2AJournalPayload` already declared both fields (DEC-031 fixed the layout, not the propagation semantics). This DEC freezes the inheritance semantics; any consumer code can now rely on `causationId` being non-empty for every event other than the first in a negotiation.

## DEC-034 — Stable JSON output contract + exit-code table
**Date**: 2026-05-20. **Refers**: DEC-026, DEC-031, DEC-033, WP-30.

**Decision**: the `@sentropic/h2a-cli` surface frozen by this DEC is **the public API for programmatic clients** of the `h2a` CLI. Every verb emitting JSON on `stdout` follows **exactly one** of the three canonical envelopes:

- **`resource`** — raw JSON of the persisted/read entity (negotiation record, journal entry, envelope, host config snippet). Used by `negotiate open / status / event / offer / counter / sign`, `inbox pop`, `host setup --print`.
- **`list`** — raw JSON array. Used by `hosts`, `mcp-tools`, `discover`, `inbox read`, `outbox read`, `negotiate journal`.
- **`action`** — `{ "ok": true, ...details }` for side-effect verbs with no natural entity to return. Used by `init`, `register`, `inbox put`, `outbox put`, `negotiate stabilize`, `host setup --write`.

Two cases outside the envelope: `--help` emits human text (`text`); `mcp-serve` speaks JSON-RPC 2.0 framed on stdio (`stream`).

Stderr always follows `h2a <verb> [sub]: <message>` for deterministic grep.

**Decision (exit codes)**: every verb uses **only** the following alphabet:

- `0` — success.
- `1` — user error: missing/wrong flag, invalid JSON, validation of caller-supplied payload, unknown verb/subverb/host.
- `2` — runtime/state error against the local store: negotiation not found, already open, already stabilized, signature does not verify, incomplete quorum, broken journal, pre-existing divergent config entry refused without `--force`.
- `3` — I/O / OS error: unreadable file, permission denied, filesystem-refused write.

**Why**: (a) an MCP client, a shell script or an integration test must be able to parse the `stdout` JSON without guessing the shape (object, array, or `ok` envelope) verb by verb; (b) the 1/2/3 separation clearly distinguishes "your input is bad" (caller must fix the request), "your stored state refuses this action" (caller must inspect the store), and "your OS environment blocks" (caller must fix permissions/files) — enabling distinct retry/abort branches in automation.

**Why (`action` rather than bare-entity for writes)**: a verb that writes but has no natural entity to return (`init` does not return a "root" object, `register` does not return the whole registry, `inbox put` does not return the stored envelope but its coordinate) emits an explicit confirmation `{ok:true, …}`. Re-injecting the input entity would be noise; emitting nothing would lose write traceability. The `action` form makes the operation auditable with a single shell `tee`.

**Why `negotiate stabilize` stays `action` despite the entity being available**: stabilization returns *several* artefacts at once (`record`, `artifactHash`, `signers`, `artifactPath`, `finalEvent`) — there is no single entity but a composite result, and the `ok` flag is semantically informative (the caller can test `parsed.ok` without knowing the internal structure). Bare-unwrap would degrade programmatic readability.

**Consequence**: (a) the `H2A_CLI_VERB_CONTRACTS` manifest (`packages/h2a-cli/src/cli-contract.ts`) is re-exported publicly and is authoritative; (b) `docs/cli-contract.md` is the human reference; (c) any retro-incompatible change requires a **new DEC** + a major bump of `@sentropic/h2a-cli`; (d) purely additive changes (new verb, new optional field in an `action`/`resource` envelope) stay compatible at the minor level.


## DEC-035 — Signing authority matrix + cross-language canonical fixtures
**Date**: 2026-05-20. **Refers**: DEC-004, DEC-018, DEC-021, DEC-023, DEC-032, DEC-033.

**Decision (authority matrix)**: `@sentropic/h2a` exposes **`H2A_AUTHORITY_MATRIX`**, a declarative table mapping each `H2AArtifactKind` to the list of roles allowed to produce a *binding* signature on that artefact. V1 baseline:

- `CONTRACT` → `PRINCIPAL`, `EXECUTIF`, `CONDUCTOR`
- `POLICY` → `PRINCIPAL`, `EXECUTIF`, `CONTROL`
- `ENGAGEMENT` → `PRINCIPAL`, `EXECUTIF`, `CONDUCTOR`
- `AMENDMENT` → `PRINCIPAL`, `EXECUTIF`, `CONDUCTOR`, `CONTROL`
- `MANDATE` → `PRINCIPAL`, `EXECUTIF`
- `AUTHORITY` → `PRINCIPAL`, `EXECUTIF`
- `SIGNATURE` → all 6 roles (trace of a signing act)
- `ENFORCEMENT_PLAN` → `PRINCIPAL`, `EXECUTIF`, `CONTROL`

`MANDATAIRE` never appears for a *binding* artefact — DEC-005 / DEC-024 keep it as *presenter*. `canSignArtifactKind(role, kind)` returns a boolean; `assertCanSignArtifactKind(role, kind)` throws with a message naming the role + kind + allowed roster.

**Decision (execution)**: `stabilizeNegotiation` (`@sentropic/h2a-cli/runtime/local-files/store.ts`) applies this matrix after the ed25519 check (DEC-032) and before write-once persistence (DEC-033). For each signer of the `winningHash`, at least one of their registered `roles` must belong to the matrix roster for the winning artefact's `kind`; otherwise `Negotiation <id>: signer <instance> is not authorized to sign artifact kind <KIND> (roles: [...])`. If the kind is absent or non-canonical, a *warning* is emitted on `stderr` and the authority check is *skipped* (V1 permissive on extension).

**Decision (cross-language fixtures)**: `packages/h2a/fixtures/` contains 6 canonical artefacts (one per binding kind: `CONTRACT`, `POLICY`, `ENGAGEMENT`, `MANDATE`, `AUTHORITY`, `ENFORCEMENT_PLAN`). Each file contains *exactly* `canonicalize(value)` in bytes (no pretty-print, no trailing newline); `fixtures/manifest.json` lists `{path, kind, id, sha256}` where `sha256` is the hex SHA-256 of the bytes (no prefix). `H2A_CANONICAL_FIXTURES` is re-exported by `@sentropic/h2a`.

**Why (matrix)**: (a) DEC-004 already decided that sensitive amendments go through quorum; what was missing was the declarative *who can sign what* table in V1, without which an AGENTS could technically sign a CONTRACT; (b) the runtime applies the same matrix as the one exposed by the library — no possible divergence between client check and store check; (c) a cross-language implementation can consume the matrix directly (simple table, no DSL).

**Why (byte-canonical fixtures)**: (a) the sorted-key JSON canonicalization (DEC-031, `canonical.ts`) is trivially portable but must be *tested* against a reference; (b) a non-TS binding (Python, Go, Rust) can now replay `manifest.json` and confirm bit-for-bit that it computes the same `sha256` as the TS reference; (c) the `is<Kind>` guards are also validated against the fixtures, so a new guard implementation is testable against the same battery.

**Consequence**: (a) any future extension of `H2A_ARTIFACT_KINDS` must extend `H2A_AUTHORITY_MATRIX` (a *load-time* guard refuses a kind with no entry); (b) any fixture change recomputes the manifest `sha256` (the `fixtures.test.js` test would otherwise break); (c) the matrix is intentionally *permissive on unknown kind* in V1 to avoid breaking private extensions: hardening it (default refusal + opt-in) will require a new DEC.


## DEC-036 — Advisory file locks + local-files store schema version
**Date**: 2026-05-20. **Refers**: DEC-031, DEC-033, DEC-034.

**Decision (advisory locking)**: every read-then-write critical section of the local-files store (`packages/h2a-cli/src/runtime/local-files/store.ts`) acquires an *advisory* lock via a `.lock` sentinel file created by `openSync(path, "wx")` (`O_CREAT|O_EXCL` semantics). The file holds `{pid, hostname, startedAt}`; on collision (`EEXIST`), the payload is inspected, and if `hostname` matches and `process.kill(pid, 0)` returns `ESRCH`, the lock is considered *stale* and recovered (`unlinkSync` + retry). Otherwise polling continues until `lockTimeoutMs` (default 5000 ms, poll 50 ms) and `LockTimeoutError` (exported) is thrown.

The lock perimeter covers:
- `registerInstance` → `<root>/registry/.lock` (dup detection + append).
- `openNegotiation` / `updateNegotiationStatus` / `appendNegotiationEvent` / `stabilizeNegotiation` → `<root>/negotiations/<id>/.lock`.
- `putInboxMessage` / `popInboxMessage` → `<root>/inbox/<actor>/.lock`.
- `putOutboxMessage` → `<root>/outbox/<actor>/.lock`.

`createLocalStore({ root })` stays **backward-compatible**; two *optional* options extend the API: `lockTimeoutMs` (default 5000) and `allowVersionMismatch` (default false). The `withLock` (async) / `withLockSync` primitives are also exported so application code that needs the same mechanism outside the store can use it.

**Decision (schema version)**: the store writes `<root>/.h2a-schema.json` on first creation (`{version, createdAt, createdBy}`). The exported constant `H2A_STORE_SCHEMA_VERSION = "1"` is the single source of truth on the CLI side. Opening a store whose sentinel declares an unknown version throws `StoreSchemaMismatchError` (exported); the sentinel is **never** rewritten (idempotence — `createdAt` stays the initial creation timestamp).

The option `createLocalStore({ root, allowVersionMismatch: true })` is a read-only escape hatch: it ignores the sentinel, logs a *warning* on stderr, and rewrites nothing. The CLI verb `h2a store migrate [--from <v>] [--to <v>] [--dry-run] [--root <path>]` (envelope `action`, codes 0/1) covers the future: V1 → V1 is a no-op (`changed:false`); any unknown version on `--from` or `--to` returns 1 with a clear message. Actual transformations will be added at V2 bump time.

**Why (locks)**: (a) `appendFileSync` (mode `appendJsonl`) relies on `PIPE_BUF` (~4096 bytes on Linux) to guarantee append atomicity; the *read-then-write* critical sections (dup detection on `registerInstance`, `prevHash` link on `appendNegotiationEvent`, verification + write-once persistence in `stabilizeNegotiation`) are **not** protected by that property — hence the need for an advisory lock; (b) an OS *mandatory* lock (`flock`, `fcntl`) would assume native bindings or an add-on, which would violate the "built-ins only" constraint (DEC-026); (c) the file-sentinel lock is portable Linux/macOS/Windows, readable (the payload greps), and self-recoverable via PID-staleness — the modern equivalent of a `pidfile`; (d) explicit trade-off: concurrency protection is **same-machine only**. Sharing the store via NFS / SMB *cross-host* is out of V1 scope; trying to detect it would emit false positives (two hosts cannot probe each other via `kill(pid, 0)`).

**Why (schema version)**: (a) the DEC-031 layout will eventually evolve (V2: JSONL format change, partition by scope, secondary indexes); without a sentinel, a future CLI silently corrupts an old store; (b) the sentinel vs a field buried in an existing file has two advantages — it is trivial to read before any load, and its absence signals a *pre-versioning* store (auto-migrated to V1 on next open, without interruption); (c) the `allowVersionMismatch` option keeps the door open for debug tooling of a future version from an installed CLI; (d) the `store migrate` verb materializes the ramp — every future DEC that bumps the version must extend it with a testable transformation.

**Consequence**: (a) any `h2a` or `h2a mcp-serve` running concurrently on the **same `<root>`** now serializes critical sections; a timeout test (`local-store-locking.test.js`) guarantees the default limit stays reasonable; (b) the added options are strictly additive — `createLocalStore({ root })` keeps working unmodified; (c) the output of `h2a store migrate` follows the `action` envelope frozen by DEC-034 (`{ok:true, fromVersion, toVersion, changed, dryRun, root}`); (d) a future **major** release of `@sentropic/h2a-cli` carrying a schema bump will have to deliver the migration simultaneously in `cmdStoreMigrate`. The V2 cross-host scenario (network lockd, mTLS, shared store) stays explicitly *out of scope* until a dedicated DEC justifies it.


## DEC-037 — Host compatibility status + Codex / Claude / Gemini / MCP matrix
**Date**: 2026-05-20. **Refers**: DEC-028, DEC-032, DEC-034, WP-40, WP-60.

**Decision**: each host descriptor exposed by `@sentropic/h2a-cli` now declares a `wave` (`1 | 2`). Codex and Claude Code are **wave 1**: public descriptor, `h2a host setup --host <codex|claude>` shipped, and local MCP (`mcp-serve` stdio + in-process server) available. Gemini stays **wave 2**: descriptor visible in `h2a hosts`, but no `host setup` snippet or end-to-end scenario shipped.

The CLI adds `h2a host status [--host <name>]`, envelope `action` DEC-034:

```json
{
  "ok": true,
  "hosts": [
    {
      "host": "codex",
      "wave": 1,
      "mcpAdapterShipped": true,
      "hostSetupShipped": true,
      "summary": "wave 1 — host setup snippet shipped; MCP adapter (stdio + local) wired"
    }
  ]
}
```

`--host` filters to a single host; an unknown name exits `1` with the list of supported hosts.

**Decision (documentation)**: `docs/compatibility-matrix.md` is the human Codex / Claude Code / Gemini / MCP matrix. It is derived from the same source of truth as `h2a host status` and explicitly distinguishes four levels: descriptor, MCP adapter, setup snippet, end-to-end host scenario. Codex and Claude end-to-end scenarios stay TODO despite the shipped setup snippets.

**Why**: (a) DEC-028 had deferred Gemini to wave 2 but the status was not query-able by automation; (b) Codex/Claude snippets already expose the 10 MCP tools, but this must not be confused with a complete host-driven scenario; (c) programmatic clients need a stable response rather than parsing `h2a hosts` or a Markdown doc; (d) the human matrix avoids over-selling Gemini or end-to-end host tests.

**Consequence**: (a) `H2A_CLI_VERB_CONTRACTS` adds the `host status` verb; (b) any new host must declare its wave; (c) promoting Gemini to wave 1 will require a DEC or an explicit DEC-028/037 update and must provide at minimum `renderMcpConfig`, `host setup` tests, and an updated matrix row; (d) WP-40 completion stays blocked by the real Codex/Claude scenarios, not by the mere presence of MCP setup.


## DEC-038 — Local release prep + tag-driven publication via GitHub Actions
**Date**: 2026-05-20. **Refers**: DEC-026, DEC-027, DEC-029, DEC-034, DEC-036, WP-00.

**Decision**: the V1 release flow becomes **tag-driven**. The local command `npm run release -- --version X.Y.Z` prepares the release without touching the network:

1. refuses a dirty worktree before verification;
2. runs `npm run typecheck` then `npm test`;
3. refuses to continue if verification left the worktree dirty;
4. bumps `package.json`, `package-lock.json`, `packages/h2a/package.json`, `packages/h2a-cli/package.json`;
5. aligns the `@sentropic/h2a-cli -> @sentropic/h2a` dependency to `^X.Y.Z`;
6. commits `release: vX.Y.Z`;
7. creates an annotated tag `vX.Y.Z` (signed if `git config commit.gpgsign=true`).

The accepted version is strictly `X.Y.Z` with no `v` prefix, no pre-release/build metadata, no leading zeros.

**Decision (CI publish)**: `.github/workflows/release.yml` triggers on `v*.*.*`, reinstalls via `npm ci`, reruns typecheck/tests, verifies that the tag `vX.Y.Z` matches both package manifests, then publishes `@sentropic/h2a` and `@sentropic/h2a-cli` with `npm publish --provenance --access public` when `secrets.NPM_TOKEN` is present. The workflow then creates an idempotent GitHub Release via `gh release create --generate-notes`. If `NPM_TOKEN` is missing, the workflow warns and skips both the publish and the GitHub release.

**Why**: (a) the first publish already produced a broken `0.1.0` CLI (DEC-029), so manual bump + local publish is not reproducible enough; (b) the lockfile is tracked and consumed by `npm ci`, so it must be bumped in the release commit; (c) testing a dirty worktree then committing only the versions would tag a state different from the validated one; (d) npm provenance requires publishing from CI with OIDC, not from a local shell.

**Consequence**: (a) the root stays `private` and never publishes; (b) V1 releases are lockstep between the two public packages; (c) `@sentropic/h2a-cli@0.1.0` still needs manual deprecation by an npm-authenticated maintainer, since retroactive deprecation is not the publishing workflow's job; (d) a future non-lockstep partial release would require a new DEC or an explicit script extension.


## DEC-039 — Executable CONTRACT / POLICY / ENGAGEMENT invariants
**Date**: 2026-05-20. **Refers**: DEC-016, DEC-018, DEC-021, DEC-035, WP-50.

**Decision**: `@sentropic/h2a` exposes a strict audit layer to prevent the collapse between the three contractual artefacts of DEC-018:

- `CONTRACT` → profile `normative-container`: durable, non-executable, may contain/reference policies and instantiate engagements.
- `POLICY` → profile `durable-rule`: durable, non-executable, does not instantiate engagements and does not carry an operational charter.
- `ENGAGEMENT` → profile `operational-executable`: executable, non-durable by nature, references applicable policies but does not contain them as standalone rules.

The table `H2A_CONTRACTUAL_ARTIFACT_PROFILES` is re-exported publicly. `auditContractualArtifact(value)` returns `{ok, kind, profile, issues}`; `assertContractualArtifactInvariants(value)` throws if an artefact carries fields belonging to another category.

**V1 invariants**:

- A `CONTRACT` must not carry the durable-rule fields of a `POLICY` (`rule`, `sourceAuthority`, `adoptionMode`, `parameters`) nor the executable fields of an `ENGAGEMENT` (`charter`, `roleBindings`, `controls`, `successCriteria`, etc.).
- A `POLICY` must not carry the normative-container fields of a `CONTRACT` (`parties`, `clauses`, `engagements`, `signatures`, etc.) nor the executable fields of an `ENGAGEMENT`.
- An `ENGAGEMENT` must not carry the durable-rule fields of a `POLICY` nor the normative-container fields of a `CONTRACT`. It may only reference applicable policies via `policies[]` and reference an upstream contract via `contractId`.

**Why**: the guards `isContract` / `isPolicy` / `isEngagement` intentionally stay permissive on additional fields for compatibility and extensibility. We therefore needed a separate primitive that encodes the semantic boundary without breaking existing payloads. This separation makes REQ-037/038/046/047/048/050 code-verifiable: a policy doesn't become a mission, an engagement doesn't become a law/standalone rule, and a master agreement doesn't become the operational journal.

**Consequence**: (a) clients may call the strict audit before negotiation/stabilization when they want to reject an ambiguous artefact; (b) the local runtime stays compatible with existing artefacts, since strict audit is not yet automatically enforced in `stabilizeNegotiation`; (c) a future DEC may decide where to make this audit blocking (CLI, MCP, store or tooling only); (d) inter-policy precedence and exception rules stay open — DEC-039 fixes the category distinction, not yet the conflict resolution engine.


## DEC-040 — Executable resolution of escalation targets by scope
**Date**: 2026-05-20. **Refers**: DEC-012, DEC-014, DEC-021, DEC-023, DEC-024, REQ-068, WP-50.

**Decision**: `@sentropic/h2a` exposes the V1 vocabulary and resolver for escalation targets:

- channels: `H2A_ESCALATION_CHANNELS = ["advise", "decide", "alert"]`;
- target authorities: `H2A_ESCALATION_AUTHORITY_KINDS = ["PRINCIPAL", "EXECUTIF", "QUORUM", "CONTROL", "EXTERNAL_AUTHORITY", "RECOURSE"]`;
- helper `resolveEscalationTarget(enforcementPlan, request, {fallbackPrincipal?})`;
- helper `assertEscalationTargetResolved(resolution)`.

The resolver reads `ENFORCEMENT_PLAN.escalations[]`. Each route may declare `{trigger, target, channel, scope, authorityKind, domain}`. Selection is deterministic: filter by compatible channel/scope/trigger/domain, prefer the most specific routes (domain > trigger > scope > channel), then keep the plan order on ties. Older routes that don't include `authorityKind` are interpreted as `PRINCIPAL` for compatibility.

**Decision (fallback)**: PRINCIPAL is no longer implicitly invented. The mono-human fallback exists only if the caller explicitly provides `fallbackPrincipal`. Without a plan route and without fallback, the result is `{ok:false, issues:[...]}`. This is the executable encoding of DEC-024: escalation targets the scope's competent authority, not automatically the local PRINCIPAL.

**Why**: (a) multi-human/federation/government models require EXECUTIF, CONTROL, external authority, recourse or quorum depending on scope; (b) a hidden rule "everything goes to PRINCIPAL" recreates the bottleneck identified in EVALUATIONS.md; (c) `ENFORCEMENT_PLAN` was already the right artefact for application, but its routes were not code-consumable; (d) keeping the fallback explicit preserves the mono-human case without weakening federated scenarios.

**Consequence**: (a) `H2AEnforcementPlan.escalations[]` gains optional fields `scope`, `authorityKind`, `domain`; (b) clients may resolve an escalation target before writing an `escalate` event; (c) the existing MCP handler stays compatible but does not yet consume this resolver — a future slice may add `target`/`authorityKind` to the escalation payload; (d) DEC-040 does not resolve precedence between policies: it only routes the arbitration need to the declared authority.


## DEC-041 — Executable ABC compatibility profiles
**Date**: 2026-05-20. **Refers**: REQ-042, REQ-043, REQ-044, REQ-071, DEC-018, DEC-021, DEC-024, DEC-039, DEC-040, WP-50.

**Decision**: the mapping to the three ABC models in `EVALUATIONS.md` becomes a public primitive of `@sentropic/h2a`, not just audit prose.

Added exports:

- `H2A_ABC_MODEL_IDS = ["A_ENTERPRISE", "B_ECOSYSTEM", "C_GOVERNMENT_CITIZEN"]`;
- `H2A_ABC_MODEL_PROFILES`: stable profiles per model, with `track`, `label`, `topology`, required roles, required artefacts, policy adoption modes, escalation authorities and capabilities;
- `H2A_ABC_MODEL_CAPABILITIES`: vocabulary of cross-cutting capabilities (scope first-class, policy first-class, contract/engagement separation, mandated signature, deterministic negotiation, scope-authority escalation, external authority, controlled disclosure, policy precedence, recurring obligations, recourse, jurisdiction);
- `getAbcModelProfile(modelId)`;
- `auditAbcModelCompatibility(modelId)`.

`auditAbcModelCompatibility` verifies that each built-in profile only references public V1 vocabulary (`H2A_ROLES`, `H2A_ARTIFACT_KINDS`, `H2A_POLICY_ADOPTION_MODES`, `H2A_ESCALATION_AUTHORITY_KINDS`, `H2A_ABC_MODEL_CAPABILITIES`). It returns `{ok, ready, issues, gaps, shipped, partial, deferred}`. `ok` means the mapping is consistent with public vocabulary; `ready` means no model capability is still partial or deferred.

**V1 status**: the three models are `ok:true` but `ready:false`. This freezes the mapping without pretending that every protocol gap is resolved:

- A / traditional enterprise: recurring obligations, controlled disclosure, recourse and inter-policy precedence are still incomplete;
- B / multi-organization ecosystem: cross-organization disclosure, deadlock/recourse and inter-policy precedence are still incomplete;
- C / government/citizen: structured jurisdiction, recourse/adjudication, public disclosure and law/contract/local-policy precedence are still incomplete.

**Why**: (a) the ABC models act as guardrails against semantic regressions; (b) decisions DEC-039/040 already made two pieces of this mapping executable, but no public table yet stated what each model requires; (c) separating `ok` from `ready` avoids over-selling V1: shipped capabilities and open gaps become inspectable by code; (d) any future precedence, disclosure or recourse engine can close a specific gap without reinterpreting the whole evaluation.

**Consequence**: (a) WP-50 checks off the ABC mapping; (b) `EVALUATIONS.md` stays the narrative source, but `H2A_ABC_MODEL_PROFILES` becomes the machine-readable source; (c) any ABC track evolution must update DEC-041 or a following DEC and the tests `packages/h2a/test/abc.test.js`; (d) the remaining WP-50 items now focus on multi-human modes beyond peer-to-peer and on the protocol / policy / implementation boundary.


## DEC-042 — Executable taxonomy of multi-human modes
**Date**: 2026-05-20. **Refers**: REQ-029, REQ-030, REQ-031, REQ-032, REQ-033, REQ-034, REQ-035, REQ-036, DEC-015, DEC-016, DEC-017, DEC-024, WP-50.

**Decision**: multi-human framing is no longer limited to peer-to-peer. `@sentropic/h2a` exposes a V1 taxonomy of multi-human modes, with a deterministic selector picking the minimal ceremony level:

- `PEER_DIALOGUE`: informal PRINCIPAL ↔ PRINCIPAL dialogue between mini-organizations, with no shared operational charter;
- `DELEGATED_COORDINATION`: repeated operational coordination delegated CONDUCTOR ↔ CONDUCTOR, each PRINCIPAL keeping local authority;
- `SHARED_ENGAGEMENT`: shared engagement with charter, role bindings, controls, policies, success criteria and its own journal;
- `FEDERATED_EXECUTIF`: umbrella scope owned by an EXECUTIF, without erasing local PRINCIPALs;
- `CONSORTIUM_QUORUM`: governance of a shared scope by quorum/committee rather than a single EXECUTIF;
- `PUBLIC_AUTHORITY`: mode where a public/regulatory/external authority imposes policy, receives proof or routes recourse.

Added exports:

- `H2A_MULTI_HUMAN_MODE_IDS`;
- `H2A_MULTI_HUMAN_MODES`;
- `getMultiHumanMode(modeId)`;
- `selectMultiHumanMode(request)`.

The selector refuses `principalCount < 2`. For multi-human cases, it applies the following precedence, from most constraining to lightest: `externalAuthority` → `executiveScope` → `quorumGovernance` → `sharedCommitments` → `repeatedOperationalCoordination` → `PEER_DIALOGUE`.

**Why**: (a) DEC-015 correctly distinguished the three peer channels but not the structured modes beyond; (b) DEC-016/017 introduced EXECUTIF, but without a simple rule for when to move from a dialogue to a federation; (c) the ABC models also show consortiums/quorums and public authorities that must not be forced into "EXECUTIF"; (d) the protocol needs a deterministic mode choice to prevent a coordination with obligations, risks or external authority from being treated as a simple discussion.

**Consequence**: (a) WP-50 checks off the multi-human framing beyond peer-to-peer; (b) `selectMultiHumanMode` does not yet create an artefact, it guides the choice between conversation, delegated coordination, ENGAGEMENT, federated scope, quorum or external authority; (c) a future slice may use this mode to generate templates of `CONTRACT`, `ENGAGEMENT`, `ENFORCEMENT_PLAN` or `MANDATE`; (d) it remains to decide what becomes mandatory protocol, recommended policy or implementation behavior.


## DEC-043 — Protocol / policy / implementation boundary
**Date**: 2026-05-20. **Refers**: REQ-001, REQ-006, REQ-010, REQ-024, REQ-041, REQ-054, REQ-070, DEC-031, DEC-032, DEC-034, DEC-035, DEC-039, DEC-040, DEC-041, DEC-042, WP-50.

**Decision**: the boundary between mandatory protocol, governance policy and reference implementation becomes a public table of `@sentropic/h2a`.

Added exports:

- `H2A_GOVERNANCE_BOUNDARY_LAYERS = ["PROTOCOL", "POLICY", "IMPLEMENTATION"]`;
- `H2A_GOVERNANCE_BOUNDARY_STATUSES = ["v1-shipped", "v1-open", "v2-deferred"]`;
- `H2A_GOVERNANCE_BOUNDARY_ITEMS`;
- `classifyGovernanceBoundary(itemId)`;
- `listGovernanceBoundaryItems(layer?)`.

**V1 protocol**: identity/version/envelope, public vocabulary, canonical artefacts, mandated signatures, negotiation + ledger, escalation by scope authority, ABC profiles and multi-human taxonomy.

**V1 open policy**: inter-policy precedence, disclosure/evidence-package levels, recurring obligation cadence, concrete MANDATAIRE assignment, blocking-vs-escalating conflict thresholds.

**V1 implementation**: local-files store, stdio MCP server, host setup snippets, CLI JSON/exit-code contract. Multi-user transport authentication stays `v2-deferred`.

**Why**: (a) several previous decisions say "out of V1", "policy", or "implementation" locally, but no table made them inspectable; (b) without an explicit boundary, an implementation could harden a local policy into a hidden protocol rule; (c) conversely, a client could treat the local-files layout or the Codex/Claude snippets as protocol obligations; (d) this table provides an extension point to later promote an open policy to the protocol via a new DEC.

**Consequence**: (a) WP-50 reaches 100% on the governance/model framing; (b) DEC-041's gaps stay visible as `POLICY/v1-open`, not as oversights; (c) future detailed specs may reference `H2A_GOVERNANCE_BOUNDARY_ITEMS` to avoid mixing protocol contract with reference-CLI choices; (d) any promotion of a policy or implementation item to protocol will require a new DEC + tests.


## DEC-044 — Codex / Claude host scenarios via MCP snippets
**Date**: 2026-05-20. **Refers**: DEC-026, DEC-028, DEC-034, DEC-037, WP-40, WP-60.

**Decision**: Codex and Claude Code move from "setup snippet shipped" to "host scenario shipped" for V1. The test `packages/h2a-cli/test/host-mcp-scenario.test.js` renders the `mcpServers.h2a` snippet specific to each host with `command = process.execPath`, `args = [dist/bin.js, "mcp-serve"]`, actually launches the stdio MCP process from that snippet, then drives in JSON-RPC:

- `initialize`;
- `tools/list`;
- `h2a_register_instance`;
- `h2a_open_negotiation`;
- `h2a_offer`;
- `h2a_inbox put/read`.

**Decision (machine status)**: `h2a host status` adds `hostScenarioShipped`. Codex and Claude return `true`; Gemini stays `false` until a wave-2 DEC promotes it.

**Why**: (a) DEC-037 explicitly distinguished setup snippet from end-to-end scenario, and Codex/Claude were still TODO; (b) launching the process from the snippet covers the real path an MCP host uses, without depending on UI or a proprietary binary; (c) the scenario covers discovery/registration, negotiation and inbox at once — the operations missing in WP-40; (d) exposing `hostScenarioShipped` prevents clients from deducing that maturity from the Markdown doc.

**Consequence**: (a) the Codex/Claude "inbox / negotiation operations" items of WP-40 are checked; (b) `docs/compatibility-matrix.md` marks the Codex/Claude scenarios as shipped; (c) `docs/cli-contract.md` and `H2A_CLI_VERB_CONTRACTS` include the new field; (d) Gemini stays descriptor + MCP adapter only, with setup and scenario deferred.

## DEC-045 — Executable controlled-disclosure profiles
**Date**: 2026-05-22. **Refers**: REQ-070, REQ-071, DEC-039, DEC-041, DEC-043, WP-50, WP-60.

**Decision**: V1 controlled disclosure is shipped as a declarative module `packages/h2a/src/disclosure.ts`, structurally mirroring `policy-precedence.ts`. Public exports:

- `H2A_DISCLOSURE_MODES`, ordered from most restrictive to most permissive: `denied`, `hash-only`, `attestation`, `evidence-package`, `redacted-view`, `full-view`.
- `H2A_DISCLOSURE_CONFLICT_DISPOSITIONS = ["escalate-not-resolve"]`.
- `H2A_DISCLOSURE_PROFILES` indexed by `H2AAbcModelId`, each profile carrying `modelId`, `label`, `allowedModes`, `defaultMode`, `conflictDisposition`, `rationale`, `references`.
- Selected profiles:
  - `A_ENTERPRISE` — `allowedModes = [full-view, redacted-view, evidence-package, attestation, hash-only]`, default `redacted-view` (full-view inside the scope, redacted-view as default for cross-domain CONTROL, attestation/hash-only for third parties).
  - `B_ECOSYSTEM` — `allowedModes = [redacted-view, evidence-package, attestation, hash-only]`, default `evidence-package` (full-view not exposed outside the organization).
  - `C_GOVERNMENT_CITIZEN` — `allowedModes = [full-view, redacted-view, evidence-package, attestation, hash-only]`, default `evidence-package` (full-view reserved for the mandated public authority).
- `getDisclosureProfile(modelId)` and `auditDisclosureProfile(modelId)`: audit validates that `defaultMode ∈ allowedModes`, that modes are known and not duplicated, that the disposition is supported. `unresolved` explicitly reminds that V1 does **not produce** the projection — redaction/packaging helpers stay with the consumer.

**Decision (machine status)**: `H2A_ABC_MODEL_PROFILES` flips the `controlled-disclosure` capability from `partial` to `shipped` on the three profiles (evidence = "DEC-045 declarative disclosure profile"). `H2A_GOVERNANCE_BOUNDARY_ITEMS` flips `controlled-disclosure-profiles` from `v1-open` to `v1-shipped`; references include `DEC-045`.

**Why**: (a) REQ-070 and REQ-071 name disclosure minimization (redacted views, evidence packages, hashes, attestations) but no executable surface declared it; (b) DEC-043 classifies `controlled-disclosure-profiles` as POLICY-open, to be closed in V1; (c) DEC-041 marked the capability `partial` on the three ABC profiles without a promotion lever; (d) following the same form as `policy-precedence` (DEC associated with DEC-041) gives an executable and auditable API without introducing a hidden redaction engine — the effective projection stays explicitly out of protocol.

**Consequence**: (a) the POLICY layer now has an executable module for disclosure; (b) `auditAbcModelCompatibility` no longer reports `controlled-disclosure` as a partial gap; (c) the projection helper (field redactor, evidence-package builder) stays a policy/implementation job, documented as such in `unresolved`; (d) a patch release `0.1.8` can follow once build + tests are green.

## DEC-046 — Executable recourse / adjudication profiles
**Date**: 2026-05-22. **Refers**: REQ-068, REQ-069, REQ-071, DEC-040, DEC-041, DEC-043, WP-50.

**Decision**: V1 recourse/adjudication is shipped as a declarative module `packages/h2a/src/recourse.ts`, structurally mirroring `policy-precedence.ts` and `disclosure.ts`. Public exports:

- `H2A_RECOURSE_STATES`: `requested`, `accepted`, `dismissed`, `adjudicating`, `decided`, `appealed`, `closed`.
- `H2A_RECOURSE_CONFLICT_DISPOSITIONS = ["escalate-not-resolve"]`.
- `H2A_RECOURSE_PROFILES` indexed by `H2AAbcModelId`. Each profile carries `modelId`, `label`, `allowedStates`, `allowedDeciderKinds` (subset of `H2A_ESCALATION_AUTHORITY_KINDS`), `defaultDeciderKind`, `appealable`, `conflictDisposition`, `rationale`, `references`.
- Selected profiles:
  - `A_ENTERPRISE` — `allowedDeciderKinds = [PRINCIPAL, CONTROL, EXTERNAL_AUTHORITY]`, default `PRINCIPAL`, `appealable: true` (CONTROL for specialized domains, EXTERNAL_AUTHORITY for appeals outside the organization).
  - `B_ECOSYSTEM` — `allowedDeciderKinds = [QUORUM, EXTERNAL_AUTHORITY, RECOURSE]`, default `QUORUM`, `appealable: true` (inter-party QUORUM by default, RECOURSE for dedicated bodies).
  - `C_GOVERNMENT_CITIZEN` — `allowedDeciderKinds = [EXTERNAL_AUTHORITY, RECOURSE, PRINCIPAL]`, default `EXTERNAL_AUTHORITY`, `appealable: true` (tribunal/regulator first, RECOURSE for administrative recourse, PRINCIPAL for internal steps).
- `getRecourseProfile(modelId)` and `auditRecourseProfile(modelId)`: audit validates that `requested` is present, that at least one terminal state (`decided` or `dismissed`) is present, that `defaultDeciderKind ∈ allowedDeciderKinds`, that deciders are known `H2AEscalationAuthorityKind` without duplication. If `appealable = true`, the `appealed` state is required. `unresolved` explicitly reminds that V1 does **not adjudicate** — the decision is produced outside the protocol by the declared authority.

**Decision (machine status)**:
- `abc.ts`: the `recourse` capability moves from `partial` to `shipped` on the three profiles, evidence = "DEC-046 declarative recourse profile (default decider X, N allowed deciders, appealable=true)".
- `governance-boundary.ts`: new POLICY item `recourse-adjudication-profiles` (`v1-shipped`), references = `["REQ-068", "REQ-069", "REQ-071", "DEC-040", "DEC-041", "DEC-046"]`.

**Why**: (a) REQ-068 names recourse as a legitimate escalation target but DEC-040 only covered routing, not the procedure; (b) DEC-041 marked `recourse` `partial` on the **three** ABC profiles, making it the highest-fan-out partial capability; (c) REQ-069 requires that MANDATAIRE not hold the arbiter role — the decision must be attributed to a declared authority, so we declare the taxonomy; (d) mirroring the `policy-precedence` / `disclosure` form (declarative + `escalate-not-resolve`) avoids introducing a hidden adjudication engine V1 cannot execute.

**Consequence**: (a) the POLICY layer closes `recourse-adjudication-profiles`; (b) `auditAbcModelCompatibility` no longer reports `recourse` as a partial gap; (c) the actual recourse playbook (notification, file, deliberation, signature, publication) stays explicitly out-of-protocol, documented in `unresolved`; (d) a patch release `0.1.9` can follow when build + tests are green.

## DEC-047 — Executable recurring-obligation cadence profiles
**Date**: 2026-05-22. **Refers**: REQ-063, REQ-071, DEC-041, DEC-043, WP-50.

**Decision**: V1 recurring-obligation cadence is shipped as a declarative module `packages/h2a/src/recurring-obligations.ts`, structurally mirroring `policy-precedence.ts`, `disclosure.ts` and `recourse.ts`. Public exports:

- `H2A_OBLIGATION_CADENCES`: `daily`, `weekly`, `monthly`, `quarterly`, `yearly`, `on-event`, `ad-hoc`.
- `H2A_RECURRING_OBLIGATION_CONFLICT_DISPOSITIONS = ["escalate-not-resolve"]`.
- `H2A_RECURRING_OBLIGATION_PROFILES` indexed by `H2AAbcModelId`, carrying `modelId`, `label`, `allowedCadences`, `defaultCadence`, `defaultGraceDays`, `defaultReportingThresholdDays`, `conflictDisposition`, `rationale`, `references`.
- Selected profiles:
  - `A_ENTERPRISE` — `allowedCadences = [daily, weekly, monthly, quarterly, yearly, on-event]`, default `monthly`, grace `7d`, alert `3d` before breach. Dense operational cadence.
  - `B_ECOSYSTEM` — `allowedCadences = [monthly, quarterly, yearly, on-event, ad-hoc]`, default `quarterly`, grace `14d`, alert `7d`. No sub-month cadences in V1 cross-organization.
  - `C_GOVERNMENT_CITIZEN` — `allowedCadences = [monthly, quarterly, yearly, on-event]`, default `yearly`, grace `30d`, alert `15d`. Aligned with typical legal/fiscal obligations.
- `getRecurringObligationProfile(modelId)` and `auditRecurringObligationProfile(modelId)`: audit validates that `defaultCadence ∈ allowedCadences`, that `defaultGraceDays` and `defaultReportingThresholdDays` are non-negative integers, that `defaultReportingThresholdDays ≤ defaultGraceDays` (alert precedes breach), that the disposition is supported. `unresolved` explicitly reminds that V1 does **not schedule, fire or evaluate** obligations — the tracking runtime stays in the policy layer.

**Decision (machine status)**:
- `abc.ts`: the `recurring-obligations` capability is now declared `shipped` on the **three** ABC profiles (before DEC-047 it was present only on A as `partial`). Evidence = "DEC-047 declarative cadence profile (default X, grace Yd, alert Zd)".
- `governance-boundary.ts`: the POLICY item `recurring-obligation-cadence` moves from `v1-open` to `v1-shipped`, references = `["REQ-063", "REQ-071", "DEC-041", "DEC-047"]`.

**Why**: (a) REQ-063 names OBLIGATION as a component of contractual artefacts and REQ-071 requires recurring-obligation audit by ABC, but cadence stayed an opaque domain; (b) DEC-041 marked `recurring-obligations` `partial` on A_ENTERPRISE only, with no entry for B/C even though ecosystems and administrations have dominant cyclic obligations; (c) mirroring the `policy-precedence` / `disclosure` / `recourse` form (declarative + `escalate-not-resolve`) avoids introducing a hidden scheduler V1 cannot execute; (d) the constraint `reportingThreshold ≤ grace` encodes in the audit the implicit "alert precedes breach" rule without imposing a concrete timer.

**Consequence**: (a) the POLICY layer closes `recurring-obligation-cadence`; (b) `auditAbcModelCompatibility` no longer reports `recurring-obligations` as a partial gap on A and now exposes it as `shipped` on B/C too; (c) the executory machinery (scheduler, tick journal, breach computation, alert generation) stays explicitly out-of-protocol, documented in `unresolved`; (d) a patch release `0.1.10` can follow when build + tests are green.

## DEC-048 — Executable jurisdiction profiles
**Date**: 2026-05-22. **Refers**: REQ-042, REQ-043, REQ-044, REQ-071, DEC-041, DEC-043, WP-50.

**Decision**: V1 jurisdiction structuring is shipped as a declarative module `packages/h2a/src/jurisdiction.ts`, structurally mirroring the other POLICY modules. Public exports:

- `H2A_JURISDICTION_KINDS`: `territorial`, `sectoral`, `functional`, `personal`, `temporal`, `delegated`, `private-contract`.
- `H2A_JURISDICTION_CONFLICT_DISPOSITIONS = ["escalate-not-resolve"]`.
- `H2A_JURISDICTION_PROFILES` indexed by `H2AAbcModelId`, carrying `modelId`, `label`, `allowedKinds`, `defaultKind`, `conflictDisposition`, `rationale`, `references`.
- Selected profiles:
  - `A_ENTERPRISE` — `allowedKinds = [private-contract, sectoral, functional, territorial]`, default `private-contract`. No personal or temporal jurisdiction in V1 enterprise.
  - `B_ECOSYSTEM` — `allowedKinds = [delegated, private-contract, sectoral, functional, territorial]`, default `delegated`. Inter-organization contracts typically delegate jurisdiction.
  - `C_GOVERNMENT_CITIZEN` — `allowedKinds = [territorial, sectoral, functional, personal, temporal, delegated]`, default `territorial`. No `private-contract`: public authority does not self-confer through a private contract.
- `getJurisdictionProfile(modelId)` and `auditJurisdictionProfile(modelId)`: audit validates that `defaultKind ∈ allowedKinds`, that kinds are known and not duplicated, that the disposition is supported. `unresolved` explicitly reminds that V1 does **not check membership** of a scope/actor to a jurisdiction — matching stays in the policy layer.

**Decision (machine status)**:
- `abc.ts`: the `jurisdiction` capability is now declared `shipped` on the **three** ABC profiles (before DEC-048 it was present only on C as `partial`). Evidence = "DEC-048 declarative jurisdiction profile (default X, N allowed kinds)".
- `governance-boundary.ts`: new POLICY item `jurisdiction-profiles` (`v1-shipped`), references = `["REQ-044", "REQ-071", "DEC-041", "DEC-048"]`.

**Why**: (a) REQ-044 explicitly mentions government/citizen ecosystems where jurisdiction is first-class, but until now V1 represented jurisdiction only via opaque `scope` strings; (b) DEC-041 marked `jurisdiction` `partial` on C only, with no entry for A/B even though the territorial/sectoral/contractual boundary is also constitutive in enterprise and ecosystem; (c) mirroring the `policy-precedence` / `disclosure` / `recourse` / `recurring-obligations` form (declarative + `escalate-not-resolve`) avoids introducing a hidden jurisdiction-matching engine; (d) refusing `private-contract` on profile C encodes the rule that public authority cannot self-constitute through a private contract.

**Consequence**: (a) the POLICY layer closes `jurisdiction-profiles`; (b) `auditAbcModelCompatibility` no longer reports `jurisdiction` as a partial gap on C and now exposes it as `shipped` on A/B too; (c) with this slice the four historical `partial` capabilities (`controlled-disclosure`, `recourse`, `recurring-obligations`, `jurisdiction`) are all `shipped` — only `policy-precedence` stays `partial` by explicit design (no V1 resolver); (d) a patch release `0.1.11` can follow when build + tests are green.

## DEC-049 — Gemini promoted to wave 1 (host setup + MCP scenario)
**Date**: 2026-05-22. **Refers**: DEC-026, DEC-028, DEC-037, DEC-044, WP-40, WP-60.

**Decision**: Gemini is promoted from wave 2 to wave 1. `H2A_GEMINI_HOST` is no longer a descriptor-only host and becomes a full `H2AConfigurableHostDescriptor`:

- `packages/h2a-cli/src/hosts/gemini.ts` exports `renderMcpConfig({ command?, args?, root? })` producing `mcpServers.h2a = { command, args }` (identical to Codex/Claude);
- `path.hint` targets `~/.gemini/settings.json` (user-global) and `.gemini/settings.json` (project-local); `path.example = "~/.gemini/settings.json"`;
- `wave = 1`, `hostScenarioShipped = true`.

`h2a host setup --host gemini [--write <file>] [--print]` is now accepted (the DEC-028 guard is removed). The `--print` / `--write` / `--force` behaviors are identical to Codex/Claude. The scenario `packages/h2a-cli/test/host-mcp-scenario.test.js` now loops over `[H2A_CODEX_HOST, H2A_CLAUDE_HOST, H2A_GEMINI_HOST]` and actually launches `mcp-serve` from the Gemini snippet, then drives in JSON-RPC `initialize` / `tools/list` / `h2a_register_instance` / `h2a_open_negotiation` / `h2a_offer` / `h2a_inbox put|read`.

**Decision (machine status)**: `h2a host status` returns `wave: 1`, `hostSetupShipped: true`, `hostScenarioShipped: true` for Gemini. `docs/compatibility-matrix.md` flips the three Codex / Claude Code / Gemini rows to `Shipped` everywhere.

**Why**: (a) DEC-028 deferred Gemini out of caution, but the MCP/JSON-RPC surface is strictly the same as Codex/Claude — no host-specific risk left uncovered; (b) DEC-044 showed that the host scenario is directly derivable from the `renderMcpConfig` snippet, so the Gemini addition is purely declarative; (c) WP-40 cannot be considered closed while a first-class host referenced in the docs stays deferred; (d) the path hint `~/.gemini/settings.json` reflects the documented official Gemini CLI configuration; the user can adapt via `--command`/`--args` if their binary differs.

**Consequence**: (a) WP-40 wave 1 is closed for the three V1 hosts; (b) the test `h2a host setup --host gemini --print rejects with DEC-028 message` becomes obsolete and is replaced with a positive snippet test; (c) `cli-host-status.test.js` no longer distinguishes Gemini from the others; (d) the only WP-40 piece left is V2 transport auth (mTLS / signed bearer), explicitly deferred; (e) a patch release `0.1.12` can follow when build + tests are green.

## DEC-050 — h2a session protocol (core vocabulary)
**Date**: 2026-05-23. **Refers**: INTENTION (multi-human), REQ-001, REQ-014, REQ-015, DEC-019, DEC-026, DEC-032, DEC-043, WP-30, WP-40.

**Context**: V1 up to v0.1.12 shipped `h2a_register_instance` as a simple append-only write into `registry/instances.jsonl`. No notion of a **live session**: an agent whose process is dead stays "present" indefinitely, no other agent is notified, the inbox must be polled. This gap between "file CRUD API" and "protocol of cooperation between CLI agents" was blocking the primary INTENTION use case (Claude, Codex, Gemini cooperating).

**Decision**: introduce a **session protocol** as a PROTOCOL layer distinct from the INSTANCE layer:

- an **INSTANCE** (`claude:proj-1`) is durable identity, already covered by DEC-019;
- a **SESSION** is the **live attachment** of an instance to the protocol over a given transport; it exists for the lifetime of a process carrying that identity.

The core vocabulary (`@sentropic/h2a`, `packages/h2a/src/session.ts`) exposes:

- `H2A_SESSION_STATES = ["opening", "live", "draining", "closed", "expired"]` — lifecycle.
- `H2A_SESSION_NOTIFICATION_TOPICS = ["presence.peer_joined", "presence.peer_left", "inbox.envelope_arrived", "negotiation.event_appended"]` — topics a session can subscribe to in order to receive **push** rather than poll.
- `H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS = 5000` and `H2A_SESSION_DEFAULT_EXPIRY_MS = 15000` — a single missed beat stays below the expiry; three missed beats expire the session.
- `H2ASession` interface: `{ sessionId, instance, host?, pid?, startedAt, heartbeatAt, state, interests: { scopes, negotiations }, subscribedTopics }`.
- `isH2ASession(value)` type guard.
- `isSessionExpired(session, { now?, expiryMs? })`: T/F on state + heartbeat freshness.
- `pickFreshSessions(sessions, options)`: deterministic filter.

**Decision (machine status)**: `governance-boundary` adds `session-protocol` (`v1-shipped`, layer `PROTOCOL`).

**Why**: (a) without **INSTANCE / SESSION separation**, we conflated durable identity and transient presence — a process crash froze the registry; (b) without **heartbeat**, no way to detect a dead peer without a central daemon, which would have broken the "no central service" promise (consistent with DEC-032); (c) freezing the **notification topics** in the PROTOCOL layer lets alternative implementations (other transport, other language) respect the same surface; (d) keeping vocabulary in `@sentropic/h2a` (pure, no I/O) decouples spec from runtime — that's what DEC-040 / DEC-041 already do for escalation / ABC.

**Consequence**: (a) DEC-051 will implement the **file-based presence producer** + MCP verbs `h2a_session_open` / `h2a_session_close`; (b) DEC-052 will implement the **JSON-RPC push notification dispatch** on the `mcp-serve` side; (c) DEC-053 will add a **real cross-process test** with two `mcp-serve` discovering each other and sending notifications; (d) `h2a_register_instance` stays valid as a low-level primitive for non-interactive CLI uses (batch scripts, init).

## DEC-051 — Presence producer + MCP session tools
**Date**: 2026-05-23. **Refers**: DEC-031, DEC-032, DEC-036, DEC-050, WP-20, WP-40.

**Decision**: implement the file-based presence producer defined by DEC-050, exposed as three new MCP tools in `@sentropic/h2a-cli`. Shipped surface:

- **Storage**: new directory `<root>/.h2a/presence/<sessionId>.json` (one file per session). Each file carries a serialized `H2ASession`. Write goes through a temp file then `rename` to stay atomic vs concurrent readers. Public path helper `presenceFile(paths, sid)`.
- **Module `runtime/local-files/presence.ts`**:
  - `writePresence(root, session)` — `isH2ASession` validation + atomic write.
  - `readPresence(root, sid)` — undefined if absent or malformed.
  - `updatePresence(root, sid, { heartbeatAt?, state? })` — read+merge+write.
  - `deletePresence(root, sid)` — idempotent (ENOENT tolerated).
  - `listPresence(root, { now?, expiryMs?, includeExpired? })` — reads the whole directory, filters by freshness, and **sweeps expired files** as a side effect (stale files disappear at the next scan).
- **Module `runtime/mcp/sessions.ts` — `SessionRegistry`**:
  - in memory, process scope. One instance per `createMcpServer` (the stdio transport enables `autoHeartbeat: true`; in-process tests keep `autoHeartbeat: false`).
  - `open(request)` generates a UUID-like `sessionId` (`sess:<hex>`), writes presence at `state: "live"`, starts an unref'd `setInterval(touch, heartbeatIntervalMs)`.
  - `close(sid, finalState = "closed")` stops the timer, writes the final state, then removes the file if terminal.
  - `touch(sid)` updates `heartbeatAt` to `now`.
  - `scanFresh(now)` delegates to `listPresence` with the registry's expiry.
  - `closeAll()` cleanly closes all sessions on shutdown.
- **Three new MCP tools** (`H2A_CLI_MCP_TOOL_NAMES` goes from 10 to 13):
  - `h2a_session_open({ instance, host?, pid?, interests?, subscribedTopics?, sessionId? })` → `{ session, peers }`. Non-canonical `subscribedTopics` are refused. The peers returned are the fresh list at open time (useful for bootstrap).
  - `h2a_session_close({ sessionId, state? })` → `{ ok, sessionId, session }`. Accepted final states: `closed`, `draining`, `expired`.
  - `h2a_discover_sessions({ scope?, instance? })` → `{ sessions }` — list of currently-fresh peers, filtered.
- **Stdio shutdown hook**: `runMcpStdio` calls `server.sessions.closeAll("closed")` when stdin reaches EOF or on error, so a session closes cleanly when the host CLI (Claude/Codex/Gemini) exits.

**Decision (machine status)**: `H2A_CLI_MCP_TOOL_NAMES` adds 3 entries (stable ordering, append-only). `H2A_CLI_MCP_TOOL_DESCRIPTORS` exposes them with permissive JSON schema. No breaking change on the existing 10 tools.

**Why**: (a) keep the file format derivable from the core vocabulary (DEC-050) rather than an ad-hoc CLI-side schema; (b) one file per session avoids write contention (the owner is unique), so no lock needed for this point — the DEC-036 invariant stays relevant elsewhere; (c) the automatic sweep in `listPresence` prevents indefinite accumulation of dead files without a central daemon; (d) the timer unref prevents heartbeat from keeping the Node process alive after stdin close.

**Consequence**: (a) an agent can now know who is *live*, not just who once called `register`; (b) DEC-052 can rely on this infrastructure to push notifications on state change; (c) the stdio shutdown hook guarantees that a clean host-CLI exit does not orphan presence; (d) an ungraceful crash leaves presence on disk, but the TTL scan sweeps it on the next `scanFresh` by another peer; (e) a patch release `0.1.14` can follow.

## DEC-052 — MCP push notifications (JSON-RPC notifications/h2a)
**Date**: 2026-05-23. **Refers**: DEC-050, DEC-051, WP-40.

**Decision**: turn h2a from a polled CRUD API into a protocol where sessions receive **push notifications** when shared state changes. Shipped surface:

- **Notification format**: JSON-RPC 2.0 message with no `id` (notification in the JSON-RPC sense), method `"notifications/h2a"`, params `{ topic: H2ASessionNotificationTopic, sessionId: string, data: object }`. Aligns with the MCP convention (standard notifications are `notifications/message`, `notifications/progress` — h2a reserves its own sub-namespace `notifications/h2a`).
- **Module `runtime/mcp/notifications.ts` — `NotificationDispatcher`**:
  - one instance per `createMcpServer`;
  - maintains a per-session snapshot (seen peers, inbox envelope ids, journal length for followed negotiations);
  - `start()` schedules an unref'd `setInterval(tick, intervalMs)` (default = heartbeat interval = 5000 ms);
  - `tick()` is public so tests can drive dispatch without a timer;
  - on each tick: for every local session, computes diffs and pushes one notification per change on a subscribed topic;
  - sessions filter by `subscribedTopics` (DEC-050) — no event, no push.
- **Four canonical topics** already defined by DEC-050 (`H2A_SESSION_NOTIFICATION_TOPICS`):
  - `presence.peer_joined` — peer appearance in `<root>/.h2a/presence/`;
  - `presence.peer_left` — peer absent from the next scan (equivalent to expired or closed);
  - `inbox.envelope_arrived` — new envelope in `inbox/<instance>/`;
  - `negotiation.event_appended` — new journal entry on a negotiation the session declared in `interests.negotiations`.
- **Stdio sink**: `runMcpStdio` installs a sink that writes `${JSON.stringify(notification)}\n` to stdout (same stream as JSON-RPC responses); the host's MCP client demultiplexes naturally (notifications have no `id`). The dispatcher is started in `runMcpStdio` and stopped in the shutdown hook before `closeAll` on sessions.

**Decision (machine status)**: no extension of `H2A_CLI_MCP_TOOL_NAMES` (notifications are a channel separate from tools). `McpServer` now exposes `.notifications: NotificationDispatcher` and `.sessions: SessionRegistry`. Public top-level exports of `@sentropic/h2a-cli`: `NotificationDispatcher`, `McpPushNotification`, `NotificationSink`.

**Why**: (a) without push, the agent must poll, making a host-CLI experience unusable for the "Codex sends a message to Claude" case — the user waits seconds for Claude to come read; (b) JSON-RPC notifications are already supported by the MCP protocol — no need for a separate channel; (c) the `notifications/h2a` convention avoids collision with standard MCP notifications (`notifications/message`, etc.); (d) a poll-based scan rather than in-process hooks ensures notifications also pick up changes made by **other** `mcp-serve` processes (cross-CLI, the case motivating DEC-050); (e) filtering by `subscribedTopics` makes the channel client-controllable — a session can be chatty (all topics) or silent (none).

**Consequence**: (a) an agent can now react to an event without polling, bounded by the tick interval (5s default); (b) DEC-053 will provide the real cross-CLI test demonstrating that two separate `mcp-serve` processes notify each other; (c) notification latency stays bounded by `intervalMs` — a V2 refinement could add in-process hooks for immediate push on local actions; (d) a patch release `0.1.15` can follow.

## DEC-053 — Real cross-CLI integration test
**Date**: 2026-05-23. **Refers**: DEC-050, DEC-051, DEC-052, INTENTION (Claude+Codex+Gemini case), WP-40, WP-60.

**Decision**: `packages/h2a-cli/test/cross-cli-cooperation.test.js` verifies end-to-end that two distinct `h2a mcp-serve` processes, pointing at the same `<root>`, actually cooperate through the session protocol and notifications. The test:

1. Spawns two `node dist/bin.js mcp-serve --root <root>` subprocesses (one "Claude", one "Codex") via `child_process.spawn`. Env vars `H2A_HEARTBEAT_INTERVAL_MS=100`, `H2A_NOTIFY_INTERVAL_MS=100`, `H2A_SESSION_EXPIRY_MS=500` speed up ticks to stay sub-second wall time without affecting production code.
2. `initialize` then `h2a_session_open` on each side — each side gets its `session` + initial peer list.
3. The next tick (~100ms) triggers `presence.peer_joined` in each process for the other's session.
4. Codex calls `h2a_inbox put` on Claude's instance.
5. Claude receives a push `inbox.envelope_arrived` with the right `envelopeId` and `instance`.
6. Codex closes cleanly (`child.stdin.end()`); the `runMcpStdio` shutdown hook (DEC-051) calls `closeAll("closed")` and presence is removed.
7. Claude receives `presence.peer_left` for the Codex session.

A second test demonstrates robustness on **ungraceful** termination: Codex is killed with `SIGKILL`, its shutdown hook does not run, its presence stays on disk. After the expiry (500ms) + a notification tick (~100ms), Claude still receives `presence.peer_left` because `NotificationDispatcher.tick()` now uses `SessionRegistry.scanFresh()` (which applies the registry's expiry) instead of the global default.

**Decision (fix)**: `NotificationDispatcher.tick()` now delegates the computation of fresh peers to `SessionRegistry.scanFresh()`. The initial DEC-052 version used `listPresence(root, {})` with the default 15s expiry — a bug found by the SIGKILL test, fixed in the same slice.

**Decision (env overrides)**: `RunMcpStdioOptions` now exposes three optional overrides (`heartbeatIntervalMs`, `notifyIntervalMs`, `expiryMs`). The same values can be passed via `H2A_HEARTBEAT_INTERVAL_MS`, `H2A_NOTIFY_INTERVAL_MS`, `H2A_SESSION_EXPIRY_MS`. Reserved for tests and ops tuning; no new CLI flag — DEC-034 (stable CLI contract) is unchanged.

**Why**: (a) without a cross-process test, we only had a theoretical argument that "two mcp-serve cooperate" — DEC-053 demonstrates it concretely; (b) the SIGKILL regression would have been undetectable in-process, and that is exactly the failure mode we want to cover for live agent CLI sessions; (c) env-var overrides keep the public CLI surface stable while letting tests avoid waiting for the default 5+15s.

**Consequence**: (a) the "Claude and Codex cooperate" promise is now verifiable, not asserted; (b) this suite forms the skeleton for a more pushed cross-CLI test (full negotiation, signatures, stabilization) that could be added later without changing the infra; (c) the DEC-050..053 slices close the product gap identified at v0.1.12; (d) a patch release `0.1.16` can follow.

## DEC-054 — High-level verbs + Claude skills + cross-CLI tutorial
**Date**: 2026-05-23. **Refers**: INTENTION (multi-CLI case), DEC-034, DEC-037, DEC-049..053, WP-30, WP-40, WP-60.

**Context**: at v0.1.16 the protocol and runtime are in place, but a user who installs `@sentropic/h2a-cli` must themselves compose 13 MCP tools to start cooperating. The `h2a host setup` verb connects the binary to the host but does not create a session or keys; and agents (Claude, Codex, Gemini) have no native knowledge of **when** to call the tools. This is the UX gap closed by this slice.

**Decision**: add a full ergonomics layer in two bricks.

### Brick 1 — Five high-level CLI verbs (orchestration)

`H2A_CLI_VERB_CONTRACTS` goes from 23 to 28 entries. All respect DEC-034 (3 canonical JSON envelopes + exit codes 0/1/2/3).

| Verb | Shape | Exit codes | Role |
|---|---|---|---|
| `connect --host <h> [--root] [--instance]` | `action` | `0,1,3` | One-shot bootstrap: store `init`, default instance id generation (`<host>:<workspace>`), MCP snippet render, plus follow-up steps printed (key generation, skills install). |
| `doctor [--root]` | `action` | `0,2,3` | Health check: root reachable, schema sentinel v1, live session count. `ok:false` (exit 2) if any check fails. |
| `sessions [--root] [--scope] [--instance]` | `list` | `0,3` | Read of the presence directory (CLI mirror of `h2a_discover_sessions`). |
| `keys generate --instance <id> [--out] [--root]` | `action` | `0,1,3` | Generates an ed25519 pair (PKCS#8 PEM private mode `0600`, SPKI PEM public), names files from the instance id with `:` and `/` replaced. |
| `install-skills --host claude [--scope] [--force]` | `action` | `0,1,2,3` | Copies the bundle `packages/h2a-cli/skills/` to `~/.claude/skills/` (`--scope user`, default) or `<cwd>/.claude/skills/` (`--scope project`). Idempotent: existing files are skipped unless `--force`. V1 scope: Claude only (Codex/Gemini have other conventions, see gap below). |

### Brick 2 — Claude skills (graphify model)

Three SKILL.md files shipped in the package distribution:

- `packages/h2a-cli/skills/h2a-connect/SKILL.md`: step-by-step bootstrap (binary check → root choice → genkey → `h2a_session_open` → summary).
- `packages/h2a-cli/skills/h2a-discover/SKILL.md`: calls `h2a_discover_sessions`, formats, filters `self`.
- `packages/h2a-cli/skills/h2a-send/SKILL.md`: composes an envelope, routes via `h2a_inbox put`, documents failure modes.

The `files` field of `package.json` now includes `"skills"` so `npm publish` carries them. `cli.ts` resolves `SKILLS_DIR` via `import.meta.url` (relative to `dist/cli.js`) to stay portable when the package is installed globally.

### Brick 3 — User tutorial

`docs/tutorial-cross-cli.md` documents the "Claude + Codex cooperate in 5 minutes" walkthrough end to end, with an ASCII diagram, exact commands to type, the V1 vs V2 mapping, and a troubleshooting section.

**Decision (machine status)**: `H2A_CLI_VERB_CONTRACTS` extended by 5 entries (append-only). `cli-contract.test.js` is updated with the new verbs; the happy-path test uses `--scope project` on `install-skills` to stay hermetic. The host compatibility matrix explicitly mentions that the skill bundle is shipped for Claude, deferred for Codex/Gemini.

**Why**: (a) the "agent CLI cooperates with another agent CLI" promise cannot be verified without an ergonomics layer above the MCP primitives — DEC-050..053 laid down the primitives, DEC-054 lays down the orchestration; (b) the graphify skill model is already familiar to Claude Code users and well integrated in the UI; (c) generating keys is a real friction point — `keys generate` closes that gap without introducing a keyring; (d) `doctor` makes the system state diagnosable without inspecting the filesystem; (e) `--scope project` for `install-skills` enables repo-local usage without touching `~/.claude` (useful for projects that want to version their skills).

**Consequence**: (a) a new user moves from "install + compose 13 tools" to "5 readable commands" to bootstrap; (b) `cli-contract.test.js` covers all 28 verbs; (c) Codex and Gemini stay without skills in 0.1.17 — DEC-055 or similar will cover their skill conventions once better understood; (d) the tutorial makes the V1/V2 delta visible without fuzz; (e) a patch release `0.1.17` can follow.

## DEC-055 — `install-skills` extended to Codex and Gemini
**Date**: 2026-05-23. **Refers**: DEC-049, DEC-054, INTENTION (Claude+Codex+Gemini).

**Context**: DEC-054 ships skills only for Claude out of caution. Inspection of conventions installed on the reference machine (Claude Code, Codex CLI, Gemini CLI) shows the two other hosts have usable canonical paths. The Claude-only perimeter is lifted.

**Decision**: `h2a install-skills --host <h>` now accepts the three hosts `claude`, `codex`, `gemini`. The single source bundle (`packages/h2a-cli/skills/h2a-*/SKILL.md`) is rendered to each host's convention:

| Host | User path | Project path | Format |
|---|---|---|---|
| `claude` | `~/.claude/skills/<name>/SKILL.md` | `<cwd>/.claude/skills/<name>/SKILL.md` | Markdown + YAML frontmatter (verbatim) |
| `codex` | `~/.codex/skills/<name>/SKILL.md` | `<cwd>/.codex/skills/<name>/SKILL.md` | Markdown + YAML frontmatter (verbatim, same format as Claude) |
| `gemini` | `~/.gemini/commands/<name>.toml` | `<cwd>/.gemini/commands/<name>.toml` | TOML `description` + `prompt = '''...'''` |

Two internal helpers added to `packages/h2a-cli/src/cli.ts`:

- `parseSkill(raw)` — extracts `{ name, description, body }` from the minimal YAML frontmatter of SKILL.md. Tolerates multiline values via simple indentation. Refuses a frontmatter without `name` or `description`.
- `renderSkillAsGeminiToml(skill)` — produces a TOML file with `description = "..."` and `prompt = '''<header>\n<body>'''`. The header `You are the <name> custom command for Gemini CLI.` is aligned with the observed convention (cf. graphify.toml).

The dispatcher `targetSpecFor(host, cwd)` encapsulates per-host the user/project path, the target file extension, and the write function.

**Decision (machine status)**: `H2A_CLI_VERB_CONTRACTS["install-skills"].description` now explicitly mentions the Codex (SKILL.md) and Gemini (TOML) mapping. `cli-contract.test.js` happy-path stays on Claude `--scope project`. A new suite `install-skills-hosts.test.js` covers the three hosts (install OK, refusal to overwrite without `--force`, accept with, expected TOML content, rejection of an unknown host).

**Why**: (a) DEC-054's Claude-only caution was no longer justified once the Codex/Gemini conventions were verified on the reference machine; (b) Codex literally uses the same format as Claude (`<host-dir>/skills/<name>/SKILL.md`) — no divergence to handle; (c) Gemini differs by format (TOML) but the semantic content is identical — a mechanical conversion suffices, no need to duplicate the bundles at the source; (d) keeping one source bundle (`packages/h2a-cli/skills/`) prevents drift between the three hosts; (e) the TOML conversion is simple enough (1 function) to stay inline in `cli.ts` without a new module.

**Consequence**: (a) "Claude + Codex + Gemini cooperate" is a user journey of **three** `h2a install-skills`, not a partial journey; (b) the cross-CLI tutorial documents the three hosts with no deferred; (c) the SKILL.md bundle stays the single source — any future h2a skill is automatically available on the three hosts; (d) a patch release `0.1.18` can follow.

## DEC-056 — Instruction note: K8s deployment + `remote` interop
**Date**: 2026-05-23. **Refers**: INTENTION (remote transport), DEC-032, DEC-050..053, context `../poc-k8s`, context `../remote` (`@sentropic/remote`).

**Status**: **instruction note** (research/design), not an implementation decision. Detailed document: `docs/instruction-k8s-and-remote-interop.md`.

**Context**: the 2026-05-23 user request names three distinct needs:
1. Deploy `h2a mcp-serve` on the cluster `../poc-k8s`.
2. Harmonize the install/config verb with `../remote` (`@sentropic/remote`).
3. Install h2a inside the context of a `remote` session (likely a formal contract between the two projects).

**Decision (instructive, not executable)**: the documented note distinguishes three deployment scenarios:
- **Scenario A — sidecar inside a `remote` session**: `h2a mcp-serve` as an additional container in the session Pod, shares `emptyDir` with the CLI runtime. Smallest step, most deliverable. Recommended as the next slice if we decide to implement.
- **Scenario B — cluster-wide `h2a` tenant on `poc-k8s`**: dedicated namespace + shared RWX PVC. Broader but constrained by Scaleway's lack of native RWX (NFS-Pod or equivalent required).
- **Scenario C — network transport (`@sentropic/h2a-remote`)**: the original third transport from INTENTION, never implemented. Requires DEC-032 V2 (transport auth).

**Decision (envisaged contract)**: an interop contract with `remote` is named in five clauses (identity, lifecycle, resource limits, disclosure, auth boundary). Its formalization is deferred to a later DEC (DEC-057 or sibling) that would deliver either the TypeScript schema in `@sentropic/h2a`, or a PR to `../remote/packages/protocol`.

**Decision (perimeter, important)**: DEC-056 touches **no** code or manifest. The only produced artefact is `docs/instruction-k8s-and-remote-interop.md` which:
- inventories what exists in `../poc-k8s` (tenants, quota contract) and `../remote` (control plane, k8s-orchestrator, session-agent, packages/protocol),
- establishes the conceptual diff `H2ASession` vs `SessionDescriptor` (complementary, not redundant),
- proposes three deployment scenarios and recommends A,
- sketches future CLI verbs (`h2a deploy --target k8s-sidecar`, `h2a remote connect`),
- lists four open questions for the user.

**Why**: (a) the topic is broad enough (multi-repo + multi-cluster + deferred auth) to deserve a framing note before any code commit; (b) the output is readable by a `../remote` maintainer who has not read DEC-050..055; (c) the **Scenario A** recommendation is derivable from the existing `sentropic-remote` quota contract (fits the `400m/768Mi` class) without renegotiating a tenant; (d) the "h2a is not redundant with remote" boundary must be drawn explicitly to avoid premature merge.

**Consequence**: (a) no implementation slice follows DEC-056 directly — the user first picks the 4 open questions; (b) a DEC-057+ may deliver the chosen scenario (likely A) with sidecar manifest + identity contract; (c) the cross-CLI tutorial now mentions this document as the reference for the k8s context.

## DEC-057 — Single `h2a` skill with subcommands (full graphify alignment)
**Date**: 2026-05-23. **Refers**: DEC-054, DEC-055, INTENTION (Claude+Codex+Gemini), reference pattern `~/.claude/skills/graphify/SKILL.md`.

**Context**: DEC-054 and DEC-055 shipped three distinct skills `h2a-connect`, `h2a-discover`, `h2a-send` with three hyphenated slash commands. Inspection of the reference file `~/.gemini/commands/graphify.toml` (cited by the user as early as DEC-054) shows graphify exposes **a single** slash command `/graphify` and routes subcommands (`/graphify summary`, `/graphify query "..."`, `/graphify path "A" "B"`, …) **inside** the skill. The h2a pattern was therefore only half-applied. Correction requested by the user on 2026-05-23.

**Decision**: consolidate the three files `h2a-connect/SKILL.md`, `h2a-discover/SKILL.md`, `h2a-send/SKILL.md` into a single `packages/h2a-cli/skills/h2a/SKILL.md`. The new skill embeds a subcommand router (graphify-style) covering:

```
/h2a                         → status (alias)
/h2a connect [root]          → bootstrap session
/h2a status                  → session health summary
/h2a discover [scope]        → list live peers
/h2a send <peer> "<text>"    → send an envelope
/h2a receive                 → read inbox and react to pushes
/h2a negotiate <verb> ...    → open / offer / counter / sign / stabilize / journal
/h2a disconnect              → cleanly close the session
/h2a help                    → command map
```

The mapping stays 1 source file → 1 skill per host:

- Claude: `~/.claude/skills/h2a/SKILL.md`
- Codex: `~/.codex/skills/h2a/SKILL.md`
- Gemini: `~/.gemini/commands/h2a.toml`

The consolidated skill adds two subcommands the previous version did not expose: `receive` (reaction to `inbox.envelope_arrived` push) and `negotiate` (full lifecycle over the 6 protocol subverbs). These were logically named in DEC-054 as "future skills" — DEC-057 promotes them into the consolidated skill.

**Decision (migration)**: `h2a install-skills` detects and **removes** the legacy entries (`h2a-connect`, `h2a-discover`, `h2a-send`) on the target filesystem before installing the consolidated skill. The JSON output report gains a `prunedLegacy: [{name, path}]` field. No interactive confirmation required — the operation is idempotent and always safe.

**Decision (machine status)**: no change to the CLI contract or to the MCP tool count. The description of `H2A_CLI_VERB_CONTRACTS["install-skills"]` stays valid. The 6 pre-existing host tests (claude/codex/gemini × install/skip/force) are updated to verify the single produced file; three new tests verify legacy pruning on the three hosts.

**Why**: (a) follow the reference convention (`graphify`) **fully** rather than half-way — the user explicitly named the gap ("can't it be /h2a connect /h2a negotiate rather than hyphen things?"); (b) a single namespace eases discovery (tab-completion `/h2a `, `/h2a help`); (c) one source file = no drift between subcommands (versions, frontmatter, etc.); (d) the migration prune prevents 0.1.17/0.1.18 users from ending up with a legacy+consolidated mix that would confuse them.

**Consequence**: (a) the skill surface shrinks (1 entry per host instead of 3); (b) two major capabilities (`receive`, `negotiate`) are now accessible via slash command; (c) users on the last 2 versions just need to re-run `h2a install-skills --host <h>`; (d) a patch release `0.1.19` can follow.

## DEC-058 — Kubernetes sidecar manifest renderer (Scenario A of DEC-056)
**Date**: 2026-05-23. **Refers**: DEC-026, DEC-034, DEC-056, INTENTION (remote transport).

**Context**: DEC-056 surveyed three deployment scenarios and recommended **Scenario A** (h2a as a sidecar inside a `remote` session Pod) as the smallest deliverable unit. The 4 open questions of DEC-056 only block Scenarios B (cluster-wide tenant) and C (network broker); Scenario A can ship independently because it does not change shared infrastructure — it produces a per-session sidecar fragment the caller merges into their own Pod spec.

**Decision**: ship a pure renderer + a new CLI verb to produce the Kubernetes sidecar fragment.

### Module `runtime/deploy/k8s-sidecar.ts`

- Public function `renderK8sSidecar(options) → { container, volume, mainContainerVolumeMount, yaml }`.
- Pure: no I/O, no filesystem access; the caller decides what to do with the output.
- Default container name `h2a-mcp`, default volume `h2a-workspace`, default mount `/workspace/.h2a` (aligned with `remote`'s PVC mount).
- Two image strategies controlled by the `image` option:
  - `npm-runtime` (default, or any value that is `undefined` / `"npm-runtime"`) — base image `node:22-alpine`, runs `npm i -g @sentropic/h2a-cli@<cliVersion>` at Pod start before `h2a init` and `h2a mcp-serve`. `cliVersion` defaults to `latest`.
  - Any other string — treated as an OCI reference (e.g. `ghcr.io/rhanka/h2a-cli:0.1.20`); the renderer skips the npm install line and assumes `h2a` is on `PATH`.
- Three identity env vars exported by the container: `H2A_INSTANCE` (default `remote:${SESSION_ID:-unknown}`), `H2A_HOST` (default `remote`), `H2A_ROOT` (default `/workspace/.h2a`). The `${SESSION_ID:-unknown}` placeholder is resolved by `remote`'s Pod template engine at Pod creation.
- Default resources align with the `sentropic-remote` tenant contract (DEC-056): `50m/64Mi requests`, `200m/256Mi limits`.

### CLI verb `h2a deploy k8s-sidecar`

- Output shape `resource` (DEC-034). The default-path JSON envelope contains `{ target, container, volume, mainContainerVolumeMount, yaml }` so programmatic callers consume the structured pieces and humans pipe `.yaml` to `kubectl` via `jq -r .yaml`.
- `--write <file>` switches the verb to an `action` envelope (`{ ok:true, target, path }`) and writes the YAML straight to disk; intermediate directories are created.
- Optional flags: `--instance`, `--host`, `--root`, `--image`, `--cli-version`. Unknown subverbs return exit 1 with a clear stderr.

### Documentation

- `docs/k8s-sidecar.md` explains the merge points (`spec.containers[]`, `spec.volumes[]`, plus the mount the caller must also add to the main runtime container), the two image strategies, the identity bridge with `remote`, and the explicit limits (single-Pod only — Scenarios B/C remain deferred).

**Decision (CLI contract)**: `H2A_CLI_VERB_CONTRACTS` grows from 28 to 29 entries with `deploy k8s-sidecar`. The `cli-contract.test.js` happy-path covers the JSON resource envelope. A dedicated `k8s-sidecar.test.js` covers the renderer (defaults, custom image, env propagation, SESSION_ID placeholder), the verb (JSON + `--write`) and refusal modes (unknown subverb, missing subverb).

**Why**: (a) DEC-056 explicitly recommended starting with Scenario A; sitting on the instruction note longer than necessary was misaligned with the "advance with a single preco" feedback; (b) the renderer is pure → testable without a real cluster, which matters because the test suite must stay hermetic; (c) the default `npm-runtime` strategy makes the manifest immediately runnable without first publishing an image — this lowers the activation cost of the sidecar to "merge YAML + run kubectl apply"; (d) exposing both a JSON envelope (DEC-034) and a `yaml` string in the same response keeps both audiences served — automation pipelines and `kubectl apply -f -` users; (e) the four DEC-056 questions stay open and explicitly do not block this slice (they govern Scenarios B/C only).

**Consequence**: (a) `h2a deploy k8s-sidecar` is the first real deployment verb of the CLI; (b) `remote` maintainers can adopt h2a inside a session Pod by appending the rendered fragment to their existing manifest; (c) the identity bridge env vars (`H2A_INSTANCE`, `H2A_HOST`, `H2A_ROOT`) become the V1 contract surface between h2a and `remote`; later DEC may promote that to a formal TypeScript schema in `@sentropic/h2a`; (d) no `@sentropic/h2a-remote` is created — Scenario C still belongs to V2; (e) a patch release `0.1.21` can follow.

## DEC-059 — Host bridge contract for `@sentropic/remote`
**Date**: 2026-05-23. **Refers**: DEC-050, DEC-056, DEC-058, INTENTION (multi-host coordination).

**Context**: DEC-058 shipped the sidecar manifest with three identity env vars (`H2A_INSTANCE`, `H2A_HOST`, `H2A_ROOT`) acting as a *de facto* contract between h2a and the host runtime. DEC-056 left a formalization question open (Q3): one-way (h2a documents only) or two-way (both repos commit to the same schema). The 2026-05-23 user response chose **two-way**. This DEC delivers the h2a side.

**Decision**: introduce a public, audited `host-bridge` profile in `@sentropic/h2a`. New module `packages/h2a/src/h2a-bridge.ts`. Exports:

- `H2A_HOST_BRIDGE_CLAUSES = ["identity", "lifecycle", "resource-limits", "disclosure", "auth-boundary"]` — the five canonical clauses, aligned with DEC-056.
- `H2A_HOST_BRIDGE_PROFILES` — indexed by host id. V1 ships one profile: `remote`.
- `getHostBridgeProfile(hostId)` — lookup.
- `auditHostBridge(hostId)` — validates the profile shape, including the V1 invariant `resourceLimits.enforced === false` (h2a NEVER enforces host resource limits) and the constraint that every value in `lifecycle.stateMap` is a known `H2ASessionState`.
- `listHostBridgeProfiles()` — enumerates registered host ids.

The shipped `remote` profile encodes:

- **identity** : `instanceTemplate = "remote:${SESSION_ID}"`, env var map `{instance: H2A_INSTANCE, host: H2A_HOST, root: H2A_ROOT}`, `hostHint = "remote"`. Reflects the contract DEC-058 already implemented in the sidecar fragment.
- **lifecycle** : `{provisioning → opening, running → live, terminating → draining, ended → closed}`. Maps remote's `session-agent` lifecycle to canonical `H2ASessionState` (DEC-050).
- **resource-limits** : `reflected: true`, `enforced: false`, `reflectedAs` = informational labels on the h2a presence file. V1 invariant: h2a never enforces host CPU/RAM limits.
- **disclosure** : `workspaceBoundary` = "one h2a coordination scope per remote session Pod; the emptyDir is the trust boundary"; `crossWorkspace = "deferred"` with reference to DEC-056 Scenarios B/C.
- **auth-boundary** : `transport` = "filesystem (emptyDir shared between the runtime container and the h2a-mcp sidecar)", `enforcement = "Pod-level"`.

`H2A_GOVERNANCE_BOUNDARY_ITEMS` adds `host-bridge-contract` (`PROTOCOL`, `v1-shipped`) so the boundary table reflects that the bridge is part of the protocol layer (not just an implementation detail).

**Decision (PR draft to `../remote/`)**: `docs/pr-drafts/remote-h2a-bridge.md` carries a complete PR text + a JSON Schema mirror of the TS profile (`packages/protocol/src/schemas/h2a-bridge.ts`). The PR is **not opened automatically** — it lives in this repo for the `remote` maintainer to review and adapt before submitting upstream. Once merged on their side, the two projects will keep the bridge in lockstep through paired DECs.

**Decision (V1 invariants formalized)**:
1. `resourceLimits.enforced === false` — h2a only observes/reflects host limits, never enforces them.
2. Every `lifecycle.stateMap` value is in `H2A_SESSION_STATES`.
3. Adding a new host bridge requires adding the profile + a test exercising `auditHostBridge`. No host-side runtime logic in `@sentropic/h2a` itself.

**Why**: (a) the user explicitly chose two-way formalization in Q3 of DEC-056 — staying informal would have re-created the "hidden API" risk; (b) formalizing now (one consumer) is cheaper than later (multiple consumers); (c) keeping the schema in `@sentropic/h2a` (pure, no I/O) lets cross-language implementations replay it bit-for-bit, same as fixtures DEC-035; (d) deferring the actual PR opening (just shipping the draft) keeps repo boundaries clean — `remote` is governed by its own DECs and its maintainer needs to approve before any code lands there.

**Consequence**: (a) the bridge contract is now machine-verifiable from the h2a side (`auditHostBridge("remote")` returns `ok: true` with 5 clauses); (b) `governance-boundary` `host-bridge-contract` is `v1-shipped`; (c) `H2A_HOST_BRIDGE_PROFILES` is the registry for future host bridges (e.g. a hypothetical `vscode-devcontainer` profile); (d) the PR draft is committed to `docs/pr-drafts/` so the next time someone works on `../remote/`, the work is queued; (e) DEC-056 Q3 is resolved; Q1 (sidecar), Q2 (n/a), Q4 (V2 deferred) accepted per user 2026-05-23; (f) a patch release `0.1.22` can follow.

## DEC-060 — OCI image build + GHCR publish workflow
**Date**: 2026-05-23. **Refers**: DEC-038 (tag-driven release), DEC-058 (K8s sidecar), WP-60.

**Context**: DEC-058 ships the K8s sidecar with `image: "npm-runtime"` as the default — it bootstraps by running `npm i -g @sentropic/h2a-cli@<version>` inside a `node:22-alpine` container at Pod start. This works without prerequisites but pays a ~10 s install latency on every Pod creation. The alternative was already documented (pass an explicit OCI image reference), but no image was ever published. WP-60 left this as ops-hardening debt.

**Decision**: ship a Dockerfile + a dedicated CI workflow that builds and pushes `ghcr.io/rhanka/h2a-cli:<version>` (and `:latest`) on every `v*.*.*` tag, in parallel with the existing `release.yml` npm publish.

### Dockerfile

Repository-root `Dockerfile` uses a two-stage `node:22-alpine` build:

1. **`builder`** copies the workspace, runs `npm ci` then `npm run build`. Produces `dist/` for both `@sentropic/h2a` and `@sentropic/h2a-cli`.
2. **`runtime`** copies only `node_modules/` + `packages/` from the builder, symlinks `/opt/h2a/packages/h2a-cli/dist/bin.js` to `/usr/local/bin/h2a`, switches to a non-root `h2a:h2a` user (UID 1001), and sets `ENTRYPOINT ["h2a"]`. `WORKDIR /workspace` matches the documented sidecar mount point. `CMD ["--help"]` keeps the image directly runnable for a sanity check.

The image is built for both `linux/amd64` and `linux/arm64` so it runs on Apple Silicon dev clusters and on Scaleway DEV1-M without a translation layer. SBOM + provenance attestations are emitted by `docker/build-push-action@v6`.

A `.dockerignore` keeps the build context tight: only `package*.json`, `tsconfig*.json` and the two workspace packages enter; node_modules, docs, examples, scripts and the various host-specific dotfolders are excluded.

### `.github/workflows/docker.yml`

Triggered on the same `v*.*.*` tag push as `release.yml`. Permissions: `contents: read`, `packages: write` — the built-in `GITHUB_TOKEN` is sufficient to push to GHCR, no extra secret required. Concurrency group `docker-${{ github.ref }}` cancels in-progress builds on superseded tags. The workflow also accepts `workflow_dispatch` for manual re-runs.

Each tag push produces two tags on the image:

- `ghcr.io/rhanka/h2a-cli:<version>` (e.g. `:0.1.23`)
- `ghcr.io/rhanka/h2a-cli:latest`

The repo owner is lowercased before being injected into the image ref (GHCR rejects mixed case).

### Renderer default unchanged

`renderK8sSidecar` keeps `image: "npm-runtime"` as the default. Reason: the OCI image only starts existing from v0.1.23+, so silently switching the default would make any sidecar fragment rendered against the new CLI fail when applied alongside an older release tagged before the image existed. The user must opt in explicitly via `--image ghcr.io/rhanka/h2a-cli:<version>` or `:latest`. The documentation in `docs/k8s-sidecar.md` is updated to describe both strategies and to call out the multi-arch, non-root, SBOM-attested build.

**Why**: (a) the ~10 s npm install at Pod start is acceptable for PoC but blocks any pretense of production-grade K8s use; (b) publishing the image is a one-shot infrastructure decision — keeping it out forever would have meant carrying the npm-runtime tradeoff indefinitely; (c) the workflow runs **in parallel** with `release.yml`, not coupled to it, so a docker build failure does not block npm publish and vice-versa; (d) GHCR + GITHUB_TOKEN avoids introducing a new credential surface (no Docker Hub PAT, no Scaleway CR account); (e) multi-arch matters because Apple Silicon devs are common consumers and Scaleway DEV1-M is amd64 — a single tag works in both; (f) running as non-root inside the image keeps the sidecar compatible with restrictive Pod Security Standards namespaces, which is the V1 reality of `poc-k8s` per DEC-056.

**Consequence**: (a) v0.1.23 is the first release that produces an OCI image; releases before that stay on `npm-runtime`; (b) users opt into the OCI image by passing `--image ghcr.io/rhanka/h2a-cli:latest` (or pinned version) to `h2a deploy k8s-sidecar`; (c) a future DEC may promote the OCI image to the default once it has been the default policy for a few releases without incident; (d) DEC-038's release flow is unchanged — `release.yml` still publishes npm, the new `docker.yml` is additive; (e) WP-60 ops-hardening percentage moves from ~70% to ~80% with this slice; (f) a patch release `0.1.23` can follow.

## DEC-061 — Cross-OS CI matrix (ubuntu / macOS / Windows)
**Date**: 2026-05-24. **Refers**: DEC-036 (advisory locks), DEC-038 (release flow), WP-60.

**Context**: until this slice the test suite (`npm test`) ran on `ubuntu-latest` only. WP-60 explicitly listed "cross-OS smoke matrix" as ops-hardening debt: the project ships a CLI binary consumed by Mac developers using Claude Code and by Windows developers using any host CLI, but nothing in CI ever verified that the runtime / lock / spawn semantics held outside Linux.

**Decision**: extend the CI matrix beyond Ubuntu. After investigation, the final shape is:

- **`ci.yml` (full test suite)** : `os: [ubuntu-latest, macos-latest]` × `node: ["20", "22"]` = 4 parallel runs per push. Windows is **deferred** — the root cause is structural, not transient (see below).
- **`smoke.yml` (published CLI smoke)** : `os: [ubuntu-latest, macos-latest, windows-latest]` × Node 22. Windows passes here because the smoked verbs (`--help`, `hosts`, `mcp-tools`, `init`, `register`, `discover`, `host setup --print`) do not create directories from `:`-bearing ids — only the negotiation/inbox layouts exercised by the full test suite do.

`fail-fast: false` so an OS-only failure does not mask another.

### First-pass discoveries

The first matrix run surfaced two Windows-specific issues:

1. **`npm test` script** relied on shell glob expansion (`packages/h2a/test/*.test.js`), which works on bash (Linux, macOS, Git Bash) but is forwarded literally to node under PowerShell, producing `Could not find 'D:\a\h2a\h2a\packages\h2a\test\*.test.js'`. **Fix**: cross-platform runner `scripts/run-tests.mjs` (see below).

2. **`cross-cli-cooperation.test.js` (DEC-053)** fails on Windows with `Cannot read properties of undefined (reading 'state')` then leaks subprocesses that hang the runner. **Fix**: skip both DEC-053 cross-process tests on Windows via `test(name, {skip}, fn)`. The skip stays in even though Windows is no longer in the CI matrix — it remains useful for developers running the test suite on a Windows workstation. Also: hard 15-min `timeout-minutes` on every CI job so any future hang fails fast.

3. **`:` in path segments breaks Windows mkdir.** This was the dealbreaker that pushed Windows out of the full-test matrix. V1's canonical layout (DEC-031) uses ids like `nego:codex` and `claude:proj-1` directly as directory names under `negotiations/`, `inbox/<instance>/`, `outbox/<instance>/`, `engagements/<id>/`, `contracts/<id>/`. On Windows `:` is the drive-letter separator and any such `mkdir` ENOENTs immediately. The fix is structural: introduce a `safePathSegment(id)` helper that replaces `:` with a Windows-safe sequence (and consistently apply it everywhere an id becomes a path component), plus update every path comparison in tests to go through `node:path.join` rather than literal `/` strings. That refactor is **deferred** to a later DEC — fixing it inside DEC-061 would have ballooned this slice. Tracked in PLAN.md.

### Cross-platform test runner

`scripts/run-tests.mjs` uses `node:fs.readdirSync` to enumerate `*.test.js` under `packages/h2a/test/` and `packages/h2a-cli/test/`, then spawns `node --test <files…>` and forwards the exit code. Pure built-ins, zero dependencies. The root `package.json` `test` script becomes `npm run build && node scripts/run-tests.mjs`.

The runner is intentionally simple — no glob package, no directory-discovery flag that varies between Node versions — so its behavior is identical on every Node 20+ install regardless of OS.

### Windows V1.x status — what's actually covered

- **Smoke (`smoke.yml`)** : ubuntu / macOS / Windows. Verifies that an `npm i -g @sentropic/h2a-cli@<version>` works on each OS and that the basic verbs (`--help`, `hosts`, `mcp-tools`, `init`, `register`, `discover`, `host setup --print`) exit 0. This is the published-CLI contract; Windows users at least know the install works and the help renders.
- **Full test suite (`ci.yml`)** : ubuntu / macOS only. The `:`-in-paths blocker (issue 3 above) plus the cross-process subprocess test issue (issue 2) keep Windows out for now. Whenever someone wants to use h2a on Windows seriously, the follow-up DEC will add `safePathSegment` + node:path-aware assertions, and Windows can re-enter the CI matrix.

This is honest scope. CLI agents that consume h2a today (Claude Code, Codex, Gemini) are primary-target Linux/macOS; Windows is a "should also work" rather than a launch requirement.

### What this slice does NOT touch

- The published npm packages (`@sentropic/h2a`, `@sentropic/h2a-cli`) — none of their behavior changes. No version bump.
- DEC-036 locks, DEC-051 presence files — they run green on Windows (verified by the green CI matrix on commit `48d6cc4`).
- DEC-058 K8s sidecar / DEC-060 OCI image — Linux-only by design, untouched.

**Decision (machine status)**: WP-60 ops-hardening % moves from ~80% to ~95%. Remaining: nothing critical — only nice-to-haves like artefact retention tuning and the inevitable Node 24 deprecation warnings on `actions/checkout@v4`, `actions/setup-node@v4`, etc., which are tracked by GitHub itself.

**Why**: (a) shipping a CLI consumed cross-OS without ever testing cross-OS was a real silent risk — DEC-036's PID-staleness in particular was the kind of code that *should* differ on Windows even if it happens not to; (b) the matrix is cheap on GitHub-hosted runners (Windows + macOS cost slightly more credit-wise than Ubuntu, but for a project at this volume it's still inside the free tier); (c) `scripts/run-tests.mjs` is a single 35-line file that prevents future test scripts from regressing on the glob issue; (d) `fail-fast: false` is the right default for a matrix designed to *find* OS-specific bugs.

**Consequence**: (a) every future PR is verified on three OSes × two Node versions, plus the smoke install on three OSes; (b) no published-package version bump is required (the change is build-tooling only); (c) the test runner script becomes the canonical entry point for `npm test`; future test directories can be added in two lines of `scripts/run-tests.mjs`; (d) WP-60 is effectively closed for V1.

## DEC-062 — `safePathSegment` for Windows-compatible local-files layout
**Date**: 2026-05-24. **Refers**: DEC-031, DEC-051, DEC-058, DEC-061, WP-20, WP-60.

**Context**: DEC-061 had to drop Windows from the full-test CI matrix because the V1 canonical layout (DEC-031) uses ids like `nego:codex`, `claude:proj-1`, `engagement:ship-v1`, `sess:<hex>` directly as filesystem path segments — and `:` is the Windows drive-letter separator. Any `mkdir <root>/negotiations/nego:codex/` ENOENTs on Windows. This was also a real product bug for Windows users running `h2a-cli` outside CI.

**Decision**: introduce a pure helper `safePathSegment(id) → string` that maps every Windows-forbidden character (`[:\\/<>"|?*]`, all collapsed to a single run) to `__`. Empty input maps to `_`. Apply it consistently in every place an id becomes a path segment:

- `runtime/local-files/paths.ts` : `negotiationDir`, `inboxDir`, `outboxDir`, `presenceFile` all pipe their id through `safePathSegment`.
- `runtime/local-files/store.ts` : the artefact path builder for `CONTRACT` / `POLICY` / `ENGAGEMENT` (under `contracts/<safe(id)>/contract.json`, `policies/<safe(id)>.json`, `engagements/<safe(id)>/charter.json`) and the inbox/outbox `envelopeFile(dir, envelopeId)`.

The helper is exposed in the public surface: `safePathSegment` is re-exported from `@sentropic/h2a-cli` so callers building paths programmatically can use the same rule.

The mapping is **lossy** — there is no reverse function. The on-disk artefacts always carry the original id inside their JSON body, and lookups go id → path, never path → id. Two ids that differ only by forbidden characters (e.g. `a:b` and `a/b`) would collide, but no V1 id format produces that situation.

### Backward compatibility

Existing stores created before this change carry directories like `negotiations/nego:codex/`. After the change, `h2a` will look for `negotiations/nego__codex/` and not find them. This is acceptable for V1.x because DEC-036 already mandates single-machine same-store ownership and `h2a store migrate` is the documented migration path — a future minor of `cmdStoreMigrate` can add a rename pass if needed.

### CI matrix

DEC-061 had deferred Windows; DEC-062 unblocks it. `ci.yml` returns to `os: [ubuntu-latest, macos-latest, windows-latest]`. The cross-CLI subprocess test (DEC-053) keeps its `SKIP_ON_WINDOWS` flag wired but **turned off** by default — the path fix should resolve both prior symptoms (ENOENT + leaked subprocess on failure). One-line revert if a Windows-only stdio framing issue resurfaces.

### Tests

`packages/h2a-cli/test/safe-path-segment.test.js` covers:

- `:` → `__` (the primary case).
- Every Windows-forbidden char individually.
- Run collapsing (`a:::b` → `a__b`).
- Empty input → `_` and all-forbidden input → `__`.
- Safe ids pass through unchanged.
- Integration through `negotiationDir` / `inboxDir` / `outboxDir` / `presenceFile`.

Two pre-existing assertions in `local-store-stabilize-persist.test.js` that hardcoded `contracts/contract:alpha/contract.json` and `engagements/engagement:ship-v1/charter.json` were updated to the `__`-form. No other test required adjustment — they all go through the helpers.

**Why**: (a) Windows users today get ENOENT on the first `h2a negotiate open` — that's a real bug, not just a CI gap; (b) the fix is surgical (one helper, applied in 5 call sites) and reversible (1-line change to the regex if we ever pick a different mapping); (c) keeping `safePathSegment` in `paths.ts` next to `localStorePaths` keeps the layout policy in one module; (d) exposing the helper publicly lets third-party tooling (a future explorer UI, the remote k8s-orchestrator) compute the same path without re-implementing the rule; (e) the lossy mapping is acceptable because round-tripping path → id is never required by V1's read paths.

**Consequence**: (a) Windows joins the full-test CI matrix again (DEC-061's deferral is closed); (b) WP-20 (~100%) and WP-60 (~95%) both improve — Windows users get a working runtime; (c) `safePathSegment` is the V1.x rule going forward and any future id format must keep producing valid path segments after the mapping; (d) a patch release `0.1.24` is justified — this is a real runtime fix that ships in `@sentropic/h2a-cli`.

## DEC-063 — Host bridge identity renamed `remote-controle` → `remote`
**Date**: 2026-05-24. **Refers**: DEC-059, DEC-058, DEC-056. **Supersedes the naming in**: DEC-059.

**Context**: DEC-059 shipped the host bridge profile keyed `remote-controle`, matching the GitHub repo codename at the time. On 2026-05-24 the host project settled on `remote` tout court (repo `rhanka/remote`, package scope `@sentropic/remote-*`), which also matches the `@sentropic/remote` name in the original INTENTION. The host-side schema PR (now `rhanka/remote#2`) was authored with `hostId = "remote"`. A bilateral contract cannot diverge: h2a v0.1.24 still hard-coded `remote-controle` (profile key, `instanceTemplate`, `hostHint`, sidecar renderer defaults, tests), so the two sides no longer matched.

**Decision**: migrate the h2a side to `remote`, in lockstep with the host PR. Every `remote-controle` occurrence across the repo becomes `remote`:

- `packages/h2a/src/h2a-bridge.ts` — profile key `remote-controle` → `remote`; `hostId`, `label` (`@sentropic/remote session sidecar`), `instanceTemplate = "remote:${SESSION_ID}"`, `hostHint = "remote"`, and the clause prose.
- `packages/h2a-cli/src/runtime/deploy/k8s-sidecar.ts` — renderer defaults `host = "remote"`, `instance = "remote:${SESSION_ID:-unknown}"`.
- `packages/h2a/src/governance-boundary.ts` + `cli-contract.ts` + `cli.ts` — prose references.
- Tests + `docs/k8s-sidecar.md` updated.
- Doc files renamed: `docs/instruction-k8s-and-remote-controle-interop.md` → `docs/instruction-k8s-and-remote-interop.md`, `docs/pr-drafts/remote-controle-h2a-bridge.md` → `docs/pr-drafts/remote-h2a-bridge.md`.
- Narrative references in `README.md`, `PLAN.md`, and prior DEC bodies (056/059/062) were smoothed to `remote`; this DEC-063 is the canonical record that the name was previously `remote-controle`.

The chosen resolution (over "freeze `remote-controle` as a repo-independent contract identity" or "accept both via an enum alias") is the clean migration: we are pre-interop (no h2a sidecar runs against a live `remote` session yet), so the migration cost is minimal now and rising later.

**Decision (versioning)**: npm `@sentropic/h2a@0.1.24` shipped the bridge profile keyed `remote-controle`. Because `H2A_HOST_BRIDGE_PROFILES` is a public export, changing the key is a surface change and ships in `0.1.25`.

**Why**: (a) the host maintainer (same owner) chose migration over freezing; (b) a single canonical identity is the whole point of the two-way contract from DEC-059 — an enum alias would re-weaken it; (c) doing it before any real interop traffic means zero data/registry migration; (d) keeps the bridge identity aligned with the product/repo/package name, avoiding a permanent legacy codename.

**Consequence**: (a) `auditHostBridge("remote")` returns `ok: true`; `getHostBridgeProfile("remote-controle")` now returns `undefined` (intentional — no alias); (b) host PR `rhanka/remote#2` and this change are a matched pair; (c) a patch release `0.1.25` carries the rename to npm; (d) any future bridge contract change continues to require paired PRs in both repos.

## DEC-064 — Store migration rename pass for `safePathSegment`
**Date**: 2026-05-25. **Refers**: DEC-031, DEC-036, DEC-062.

**Context**: DEC-062 made the local-files runtime write Windows-safe path segments (`:` → `__`), but stores created by `@sentropic/h2a-cli@<=0.1.23` already have directories/files named with raw `:` (`negotiations/nego:codex/`, `presence/sess:abc.json`, etc.). After upgrading, `h2a` looks for the `__` form and silently ignores the legacy entries. DEC-062 noted a future `h2a store migrate` pass would cover this — DEC-064 delivers it.

**Decision**: add an **opt-in** maintenance pass to `h2a store migrate`, triggered by `--sanitize-paths`. New module `runtime/local-files/migrate.ts` exposes `sanitizeStorePaths(root, { dryRun })`:

- Scans the id-named containers: directory children of `negotiations/`, `inbox/`, `outbox/`, `contracts/`, `engagements/`, and file children of `policies/` and `presence/`.
- For each entry whose `safePathSegment` (file basename keeps its extension) differs from the on-disk name, renames it to the sanitized form.
- Conservative: if the sanitized target already exists, records a `conflict` and does NOT overwrite. `--dry-run` reports `would-rename` and writes nothing.
- Returns `{ ok, root, dryRun, renamed[], conflicts[] }`. `ok` is false iff any conflict.

CLI wiring: `h2a store migrate --sanitize-paths [--dry-run] [--root <path>]`. Output is the `action`-shaped JSON of the result; exit 0 on success, exit 2 if any conflict (a state issue the caller must resolve). The flag is additive — without it, `store migrate` keeps its DEC-036 no-op schema behavior. `H2A_CLI_VERB_CONTRACTS["store migrate"]` gains `sanitize-paths` in `optionalFlags` and `2` in `exitCodes`.

The pass does **not** bump the schema sentinel: the layout version stays `1`. This is a within-version cleanup, not a schema migration — the `:` vs `__` difference is a naming convention, not a structural format change.

`sanitizeStorePaths` is re-exported from `@sentropic/h2a-cli` for tooling that wants to run the pass programmatically.

**Why**: (a) DEC-062 fixed new writes but left existing data stranded; closing that gap is what makes the Windows fix complete for real upgraders; (b) opt-in + dry-run + conflict-safe keeps a mutating filesystem operation honest — nothing is renamed unless the user asks, and nothing is overwritten; (c) keeping the schema version at `1` avoids forcing a `StoreSchemaMismatchError` on every pre-0.1.24 store just for a naming cleanup; (d) a separate `migrate.ts` module keeps the rename logic out of the hot-path store.

**Consequence**: (a) an upgrader runs `h2a store migrate --sanitize-paths --dry-run` to preview, then without `--dry-run` to apply; (b) conflicts (both `nego:codex` and `nego__codex` present) are surfaced, not silently merged; (c) no schema bump, so the pass is safe to run repeatedly (idempotent — a clean store yields `renamed: []`); (d) a patch release `0.1.26` ships the verb.
