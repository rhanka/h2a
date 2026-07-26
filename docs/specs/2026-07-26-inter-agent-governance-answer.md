# Inter-agent governance answer for the radar-immobilier peer lane

**Date:** 2026-07-26
**Base examined:** `0f285c27877a332af5ffe555f5c16b556b02781c` (`origin/main`)
**Status:** evidence-backed project answer; implementation decision dossier incomplete pending the named owners
**Method:** facts are tagged `[FACT]`; recommendations and interpretations are tagged `[JUDGMENT]`.

## 1. Exists today

### Direct answer

1. **Recording inter-agent rules:** **partially**. `[FACT]` h2a has typed CONTRACT, POLICY, ENGAGEMENT and AMENDMENT artifacts, negotiation/signing/stabilization primitives, a role/authority vocabulary, an organisation manifest, and a policy-precedence model. It does **not** prescribe one method covering rule location, format, amendment, ratification and discovery at session start. The primitives and the missing lifecycle must not be conflated.
2. **A commitment to add that method:** no project commitment is authorized by this study. The decision belongs to the h2a PRINCIPAL, with the sentropic architect for protocol- or session-schema changes. Section 3 states the decision and expected artifact without committing either owner in advance.
3. **Multi-agent RACI:** `[FACT]` no current schema distinguishes Accountable from Responsible. h2a has canonical roles, an EXECUTIF accountability statement and one declared role per instance in `org.h2a.yaml`; none is a RACI. Because no RACI exists, h2a defines no RACI location, amender, ratifier or amendment lifecycle.
4. **Geo/immo boundary:** `[JUDGMENT]` the existing artifact semantics can represent it, but current discovery and identity/addressing are not strong enough to make that representation binding on an uninformed fresh session. The proposed combination, precedence and drift checks are in section 2.

### Protocol roots: what is actually written, read and enforced

`[FACT]` The store exposes `registry`, `contracts`, `policies`, `engagements`, `artifacts`, `negotiations`, `inbox` and `outbox` paths (`packages/h2a/src/runtime/local-files/paths.ts:32-52`) and maps them under one root (`packages/h2a/src/runtime/local-files/paths.ts:54-75`). Initialisation creates those directories (`packages/h2a/src/runtime/local-files/store.ts:258-268`). The layout sentinel validates only `schemaVersion: "1"` and creation metadata, not the contents of those directories (`packages/h2a/src/runtime/local-files/schema.ts:1-24`, `packages/h2a/src/runtime/local-files/schema.ts:31-39`).

| root | writer and persisted form | reader | enforcement at the write/read boundary | can a never-informed instance discover it? |
|---|---|---|---|---|
| `registry/instances.jsonl` | `registerInstance` duplicate-checks `reg.id` through `findInstance`, which also compares `entry.id`, then appends the supplied value (`packages/h2a/src/runtime/local-files/store.ts:390-409`). It does not reject a duplicate `instance` string when `id` differs. CLI registration parses arbitrary JSON before calling it (`packages/h2a/src/cli.ts:579-607`); MCP registration checks only “object” (`packages/h2a/src/runtime/mcp/handlers.ts:97-110`). | Registry list/find and MCP discovery read the JSONL (`packages/h2a/src/runtime/local-files/store.ts:390-409`; `packages/h2a/src/runtime/mcp/handlers.ts:151-173`). | An `isH2AActorRegistration` guard exists (`packages/h2a/src/types.ts:294-323`) but neither cited write path calls it. The persisted registration schema and the provenance of its roles/keys are therefore not enforced there. | The registry/tool is discoverable after connecting, but session open does not return accepted policies, contracts or governance bindings. |
| `negotiations/<id>/state.json` and `journal.jsonl` | Open writes the supplied record after checking only the status and duplicate id (`packages/h2a/src/runtime/local-files/store.ts:625-649`). Offer, counteroffer, declarations, attestations and escalation append journal events. The generic append handler accepts any object payload (`packages/h2a/src/runtime/mcp/handlers.ts:276-288`), and the store creates/appends without checking negotiation existence or actor/event semantics (`packages/h2a/src/runtime/local-files/store.ts:698-713`). | Store readers require a negotiation id (`packages/h2a/src/runtime/local-files/store.ts:646-649`, `packages/h2a/src/runtime/local-files/store.ts:677-716`). | Journal sequence, previous hash and content hash are verified (`packages/h2a/src/journal.ts:84-130`). That proves chain integrity, not actor authenticity or event validity. The open path does not validate all `H2ANegotiationRecord` fields. | No: the complete MCP catalogue has no negotiation-list verb (`packages/h2a/src/mcp.ts:1-38`), and notifications are filtered by negotiation ids already present in session interests (`packages/h2a/src/runtime/mcp/notifications.ts:195-210`). |
| `contracts/<id>/contract.json` | Stabilization routes a recognized `CONTRACT` here (`packages/h2a/src/runtime/local-files/store.ts:223-255`) and writes once (`packages/h2a/src/runtime/local-files/store.ts:1115-1131`). | The stabilizer returns the path; local code/filesystem readers can read it. The MCP catalogue exposes no contract-list or contract-read verb (`packages/h2a/src/mcp.ts:1-38`). | Stabilization verifies a signature against keys in the registry (`packages/h2a/src/runtime/local-files/store.ts:1019-1037`), full quorum on one hash (`packages/h2a/src/runtime/local-files/store.ts:1044-1061`) and a recognized-kind role-string allowlist (`packages/h2a/src/runtime/local-files/store.ts:1082-1113`). Because registration itself is permissive, this proves key possession/consistency, not authoritative identity, role provenance or ratification. It also does not call the contract structural validator. | No automatic path. A caller must already know the root/path or negotiation. |
| `policies/<id>.json` | A recognized `POLICY` is routed and written by the same stabilization path (`packages/h2a/src/runtime/local-files/store.ts:246-247`, `packages/h2a/src/runtime/local-files/store.ts:1115-1131`). | Same access limits as CONTRACT. | Key possession, same-hash quorum and a role-string allowlist are enforced; authority provenance and detailed policy fields are not. | No automatic path. |
| `engagements/<id>/charter.json` | A recognized `ENGAGEMENT` is routed and written by the same stabilization path (`packages/h2a/src/runtime/local-files/store.ts:249-250`, `packages/h2a/src/runtime/local-files/store.ts:1115-1131`). | Same access limits as CONTRACT. | Key possession, same-hash quorum and a role-string allowlist are enforced; authority provenance and detailed engagement fields are not. | No automatic path. |
| `artifacts/<hash>.json` | AMENDMENT, MANDATE, AUTHORITY, ENFORCEMENT_PLAN and unknown kinds fall back here (`packages/h2a/src/runtime/local-files/store.ts:223-255`). | Local code/filesystem readers by known hash/path; no artifact-list MCP verb (`packages/h2a/src/mcp.ts:1-38`). | Unknown or missing kinds explicitly skip the role-string check with a warning (`packages/h2a/src/runtime/local-files/store.ts:1082-1113`). Write-once remains enforced. AMENDMENT has target/base-hash/change/signature fields but no scope, owner, expiry or effective-order field (`packages/h2a/src/types.ts:223-237`; guard at `packages/h2a/src/artifacts.ts:95-109`), and no cited path applies it to its target. | No automatic path. |
| `inbox/<canonical-address>/*.json` | `putInboxMessage` validates the envelope shape then writes it (`packages/h2a/src/runtime/local-files/store.ts:1276-1290`). | Inbox read/pop accepts an `instance` argument; read validation filters malformed envelopes (`packages/h2a/src/runtime/local-files/store.ts:1263-1273`, `packages/h2a/src/runtime/mcp/handlers.ts:175-194`). | Envelope shape is enforced. Sender identity is not: `actor` need only be an object with a string `instance` (`packages/h2a/src/envelope.ts:109-168`, specifically `packages/h2a/src/envelope.ts:136-138`). | Inbox wake can reveal a deposited envelope only when wake is configured (`packages/h2a/src/runtime/mcp/stdio.ts:342-368`). That is delivery, not binding-rule discovery. |
| `outbox/<canonical-address>/*.json` | Local store outbox methods write envelope JSON (`packages/h2a/src/runtime/local-files/store.ts:1342-1369`). | Local store readers read by address (`packages/h2a/src/runtime/local-files/store.ts:1342-1369`). | Same envelope-shape validation; no sender ownership proof. | No session-open projection or catalogue of rule-bearing outbox records. |

`[FACT]` Artifact schemas do exist: CONTRACT, POLICY, ENGAGEMENT and AMENDMENT guards are in `packages/h2a/src/artifacts.ts:38-109`; their types are in `packages/h2a/src/types.ts:164-237`. Their semantic profiles say CONTRACT is a durable non-executable normative container, POLICY a durable non-executable rule, and ENGAGEMENT an operational executable instance referencing policies (`packages/h2a/src/contractual.ts:41-68`). `auditContractualArtifact` checks these separations (`packages/h2a/src/contractual.ts:142-203`), but the stabilization path cited above does not invoke it. Consequently:

- cryptographic key possession against a permissive registry, same-hash quorum, a recognized-kind role-string allowlist, chain integrity and write-once storage reach the **structural** rung;
- authoritative signer identity/role provenance and ratification do **not** reach that rung;
- detailed contract/policy/engagement shape reaches the **test/library-validator** rung, not the storage boundary;
- lifecycle conventions not invoked by session start remain **spec or habit**, depending on where they live.

### MCP governance-family verbs

`[FACT]` The MCP descriptors deliberately use permissive input schemas and delegate validation to handlers/core (`packages/h2a/src/runtime/mcp/tools.ts:17-21`). A connected MCP client can list the verb descriptors (`packages/h2a/src/runtime/mcp/server.ts:174-233`, `packages/h2a/src/runtime/mcp/server.ts:259-263`). This discovers capabilities, not existing rule state.

| verb/family | persistence | readable by | discovery for an instance never told the identifier/rule |
|---|---|---|---|
| `h2a_open_negotiation` | Writes `state.json`; status and duplicate id are checked (`packages/h2a/src/runtime/local-files/store.ts:625-649`). | A same-root caller that already knows the id, through handlers/store. | Verb yes; existing negotiation no. There is no list verb in `packages/h2a/src/mcp.ts:1-38`. |
| `h2a_offer`, `h2a_counteroffer` | Append propose/counter events containing the supplied artifact (`packages/h2a/src/runtime/mcp/handlers.ts:347-398`). | Known-id journal readers on the same root. | No. |
| `h2a_sign` | Signs the supplied artifact hash with the supplied private key and appends a self-asserted `CONDUCTOR` journal actor (`packages/h2a/src/runtime/mcp/handlers.ts:400-457`). The key is checked against registry keys only during stabilization. | Known-id journal readers. | No. |
| `h2a_append_journal` | Accepts any object payload (`packages/h2a/src/runtime/mcp/handlers.ts:276-288`; permissive descriptor at `packages/h2a/src/runtime/mcp/tools.ts:229-239`) and appends it, creating the negotiation directory even without negotiation state (`packages/h2a/src/runtime/local-files/store.ts:698-713`). | A store/CLI reader that already knows the id. | No; chain integrity does not authenticate its actor or validate its body. |
| `h2a_attest_comprehension` | With `negotiationId`, appends a signed journal event; without it, returns an envelope without persisting or delivering it (`packages/h2a/src/runtime/mcp/handlers.ts:559-584`). The instance must resolve to a registration, but a caller-supplied canonical role need not occur in `registration.roles`; the capability check uses that chosen role and the registration's capabilities, and the supplied private key is not checked against registry keys before persistence (`packages/h2a/src/runtime/mcp/handlers.ts:523-573`). A separate subject-key verifier exists (`packages/h2a/src/comprehension-attestation.ts:103-132`) but is not invoked by this persistence path. | Known-id journal readers; otherwise only the caller receiving the returned envelope. Persistence proves neither role membership nor signature validity against registered keys. | No automatic discovery. |
| `h2a_declare_conflit_interet` | Validates non-empty interests and appends a declaration to the known negotiation (`packages/h2a/src/runtime/mcp/handlers.ts:597-642`). | Known-id journal readers. | No. |
| `h2a_conflict_posture` | Persists nothing; derives posture from a known negotiation journal (`packages/h2a/src/runtime/mcp/handlers.ts:644-659`). | Any same-root MCP caller supplying the id; no caller authorization is passed to the handler. | Verb yes; subject state no. |
| `h2a_escalate` | Appends an `advise`, `decide` or `alert` journal event; the handler constructs a self-asserted `MANDATAIRE` actor from arguments (`packages/h2a/src/runtime/mcp/handlers.ts:661-710`). | Known-id journal readers. | No. |
| `h2a_stabilize` | Verifies key possession against registry keys, same-hash quorum and recognized-kind role strings; writes the immutable artifact, appends final/advisory events and marks the negotiation stabilized (`packages/h2a/src/runtime/local-files/store.ts:984-1131`, `packages/h2a/src/runtime/local-files/store.ts:1234-1252`). It does not establish the provenance of the registered identity/role. | Local readers with the returned path; same-root known-id journal readers. | No catalogue or session-open projection. |
| `h2a_blockage_raise/list/resolve` | Stores/upserts and resolves `<root>/blockage/<safe-instance>.json` (`packages/h2a/src/runtime/blockage/registry.ts:1-18`, `packages/h2a/src/runtime/blockage/registry.ts:35-101`). | Any same-root MCP caller can explicitly list/filter (`packages/h2a/src/runtime/mcp/handlers.ts:969-1028`). Subscribed, same-scope peer sessions receive change notifications (`packages/h2a/src/runtime/mcp/notifications.ts:213-239`). | The list verb is discoverable, but it is not invoked by session open. |
| `h2a_conductor` | Read-only resolution (`packages/h2a/src/runtime/mcp/handlers.ts:1030-1058`). Earliest live active claim wins, then a live registered CONDUCTOR, else null (`packages/h2a/src/runtime/governance/conductor.ts:86-162`). | Any same-root caller providing a workspace id/path. | Verb yes; result only after explicit call. |
| `h2a_conductor_claim/release` | Appends unverified claim/release events to `<root>/governance/conductor-claims.jsonl` (`packages/h2a/src/runtime/governance/claims.ts:1-11`, `packages/h2a/src/runtime/governance/claims.ts:34-119`). Handlers require non-empty strings, not proof of the claimed instance (`packages/h2a/src/runtime/mcp/handlers.ts:1064-1135`). | Same-root conductor resolution folds the log. | No automatic call; a well-shaped self-claim is accepted. |
| `h2a_conductor_launch_check` | Persists nothing and spawns nothing; it is advisory (`packages/h2a/src/runtime/mcp/handlers.ts:1138-1179`). | Explicit same-root caller. | No automatic call. |
| `h2a_conductor_launch` | On confirmation, deposits an unsigned launch-request envelope and records a spawn marker (`packages/h2a/src/runtime/mcp/handlers.ts:1181-1319`; marker layout at `packages/h2a/src/runtime/governance/spawns.ts:1-12`, `packages/h2a/src/runtime/governance/spawns.ts:35-58`). | Target inbox readers and local marker readers. | Delivery may wake a configured target; it does not establish a governance bootstrap. |

`[FACT]` The family has no per-caller authorization context at these entry points. For example, inbox read/pop takes the target `instance` as an argument (`packages/h2a/src/runtime/mcp/handlers.ts:175-194`), escalation takes an `instance` argument and assigns it `MANDATAIRE` (`packages/h2a/src/runtime/mcp/handlers.ts:661-710`), and conductor claim takes an `instance` string (`packages/h2a/src/runtime/mcp/handlers.ts:1064-1097`). “Any same-root MCP caller” above describes that code boundary; it is not a claim about operating-system filesystem permissions.

### Session-start discovery

`[FACT]` There is no present path by which session open tells an instance the rules binding it:

- `OpenSessionRequest` contains identity, host, workspace, display, PID, interests, topics, version, launch context and session id—no governance references (`packages/h2a/src/runtime/mcp/sessions.ts:23-44`).
- `SessionRegistry.open` writes presence and returns a session; interests default to empty arrays (`packages/h2a/src/runtime/mcp/sessions.ts:116-156`).
- `h2a_session_open` returns the session and peers, not contracts, policies, engagement, RACI, exceptions or precedence (`packages/h2a/src/runtime/mcp/handlers.ts:712-767`).
- Automatic boot opens presence with default scope and no negotiation interests (`packages/h2a/src/runtime/mcp/stdio.ts:284-316`).
- The packaged skill's connect path chooses a root, resolves identity and calls session open, then reports identity/session/peers/topics; it does not read governance artifacts (`packages/h2a/skills/h2a/SKILL.md:36-49`). Negotiation operations require an explicit id (`packages/h2a/skills/h2a/SKILL.md:212-223`).
- The h2a plugin manifest's only hook is a Claude `PreToolUse(Bash)` guard (`packages/h2a/hooks/hooks.json:1-16`) that blocks manual h2a CLI invocation (`packages/h2a/hooks/deny-manual-h2a-cli.mjs:1-37`). Separately, `h2a-runtime` can install Claude `SessionStart`/`SessionEnd` enrolment hooks (`packages/h2a-runtime/src/enroll.ts:1-16`, `packages/h2a-runtime/src/enroll.ts:252-260`); those link delegated jobs/sessions (`packages/h2a-runtime/src/enroll.ts:76-117`), not governance rules. Codex has no reliable hook in that runtime path (`packages/h2a-runtime/src/enroll.ts:15-16`).

`[JUDGMENT]` A rule in a private memory is therefore at the **habit** rung. A rule in a known Markdown path is at the **spec-line** rung. Neither becomes binding merely because contracts/policies directories exist.

### Roles, identity and whether an instance can know it is Accountable

`[FACT]` The canonical role vocabulary is `PRINCIPAL`, `EXECUTIF`, `CONDUCTOR`, `AGENTS`, `CONTROL`, `MANDATAIRE` (`packages/h2a/src/types.ts:7-14`). Registrations carry `roles[]`, `scopes[]`, capabilities, endpoints, public keys and accepted policies (`packages/h2a/src/types.ts:104-135`). Automatic identity registration uses role `AGENTS`, empty capabilities and empty accepted policies (`packages/h2a/src/runtime/identity/live.ts:243-279`).

`[FACT]` DEC-016 calls EXECUTIF accountable for an umbrella activity and able to ratify global policies (`DECISIONS.md:149-163`); DEC-017 requires the `{instance, role, scope}` triple (`DECISIONS.md:165-172`). That is role semantics, not an A/R allocation schema.

`[FACT]` `org.h2a.yaml` gives each declared instance one h2a role, scopes and optional mandate rights (`packages/h2a/src/org.ts:30-57`; parser shape at `packages/h2a/src/org-parse.ts:237-308`). It validates canonical roles, unique ids, scopes, at least one PRINCIPAL and communication edges (`packages/h2a/src/org.ts:73-129`). A coach proposal has a PRINCIPAL-ratification envelope model (`packages/h2a/src/org.ts:131-160`), but `h2a org provision` reads the manifest and appends grants without requiring or verifying that envelope (`packages/h2a/src/cli.ts:2830-2887`); coach ratification itself accepts a claimed instance/role and supplied key, then emits or delivers an envelope (`packages/h2a/src/cli.ts:2948-2999`). The ratification lifecycle is therefore an authoring/document convention at this boundary, not an enforced precondition to provisioning. None of these schemas has Accountable/Responsible fields, and h2a defines no RACI location, amender, ratifier or amendment lifecycle.

`[FACT]` The bus does not verify the envelope actor. Although a stronger actor-ref guard exists (`packages/h2a/src/envelope.ts:27-38`), envelope validation checks only that `actor` is an object and `actor.instance` a string (`packages/h2a/src/envelope.ts:109-168`, specifically `packages/h2a/src/envelope.ts:136-138`). A RACI keyed only to that self-asserted string is not structurally attributable.

`[FACT — measured by the requesting lane]` An instance address is the pair `(root, instance)`: two processes at the same workspace path were mutually invisible when one used an explicit root and the other the default. The code has the corresponding seams:

- root selection prefers explicit `--root`, then `H2A_ROOT`, then the global default (`packages/h2a/src/cli.ts:474-495`);
- `SessionRegistry` holds its root outside the presence record (`packages/h2a/src/runtime/mcp/sessions.ts:94-108`);
- the session request/presence schema has no root field (`packages/h2a/src/runtime/mcp/sessions.ts:23-44`; `packages/h2a/src/session.ts:89-139`);
- the auto-recorded launch command omits the root argument (`packages/h2a/src/runtime/mcp/stdio.ts:298-305`).

`[FACT — measured by the requesting lane]` Renaming the repository re-minted the observed instance. On a mint, the implementation uses explicit name, then host-native session name, then workspace basename as its fallback label (`packages/h2a/src/runtime/identity/live.ts:287-321`), and identity construction slugifies that chosen label (`packages/h2a/src/identity.ts:64-70`, `packages/h2a/src/identity.ts:96-103`). `[FACT]` A provider-session binding may reclaim a prior identity when proof-of-possession succeeds (`packages/h2a/src/runtime/identity/bindings.ts:77-97`, `packages/h2a/src/runtime/identity/bindings.ts:132-156`), so this study cannot establish that every rename in every reconnect mode re-mints. It can establish that a bare instance string is not a complete stable address today.

`[JUDGMENT]` Until ordinary actor assertions and root selection are bound to verifiable identity, the strongest available attribution is proof by owned work or a verified key/signature. h2a cannot honestly tell an uninformed instance “you are Accountable” at the structural rung today.

### Existing governance documents and reachability

`[FACT]` A search of `docs/**/*.md` for `RACI`, `governance`, `policy`, `precedence` and `drift` finds the following relevant documents. “Reachable” here means automatically returned/read by the session-open or packaged-skill connect paths cited above, not merely present in Git.

| term | material found | present status | fresh-session reachability |
|---|---|---|---|
| RACI | `docs/specs/2026-06-27-h2a-semantic-v0-FOR-REVIEW.md:1-9`, `docs/specs/2026-06-27-h2a-semantic-v0-FOR-REVIEW.md:25-28`; `docs/specs/2026-06-27-h2a-sentropic-resegmentation.md:73-84`; `docs/specs/2026-06-27-remote-track-reprise-spec.md:84-95`; `docs/specs/2026-06-28-h2a-command-mapping-v2.md:1-7` | review/future package or mapping claims, not a current RACI schema | No; known-path reading only. |
| governance | `docs/evolution-intentions.md:103-116` describes committed org + coach + drift but leaves schema/gating/multi-PRINCIPAL ownership open; `docs/superpowers/specs/2026-06-09-h2a-mission-and-wake-gatekeeping.md:1-5` calls itself a draft and names a private-memory parent vision | intention and draft, not a ratified rule lifecycle | No. The private-memory reference is direct evidence of the defect class raised by the peer lane. |
| policy | `docs/host-integration-matrix.md:23-36` discloses one host policy as enforced for Claude and gaps for other hosts; artifact semantics are in source as cited above | capability disclosure, not inter-agent boundary discovery | No. |
| precedence | The only governance-relevant docs hit identifies `policy-precedence` as a theme (`docs/specs/2026-07-06-wp-perennial-restructuring-PROPOSAL.md:104-105`). The implemented profile is in source: public-authority > contractual > federated > local, with conflicts escalated rather than resolved (`packages/h2a/src/policy-precedence.ts:37-65`, `packages/h2a/src/policy-precedence.ts:105-154`). | executable library profile, not projected at open and not a winner-selection engine | No. |
| drift | `docs/evolution-intentions.md:112-114` proposes coach drift; `docs/loop-decisions.md:55-62` records shipped `org diff` | current org diff compares declared/live roles and scopes (`packages/h2a/src/org.ts:187-290`); it does not compare boundary-contract content or session bindings | No automatic check at open. |

### This repository's own evidence

`[FACT]` `docs/decisions/2026-07-25-evidence-the-rule-cited-as-dec-116.md:1-18` records that eight source files cite DEC-116, while DEC-116 appears zero times in `DECISIONS.md` inside the contiguous 111–115/117 numbering sequence. The evidence file lists the eight sources (`docs/decisions/2026-07-25-evidence-the-rule-cited-as-dec-116.md:39-53`) and identifies the read-only allowlist and key-custody surfaces among them (`docs/decisions/2026-07-25-evidence-the-rule-cited-as-dec-116.md:57-71`). The rationale and final number remain open to the decider (`docs/decisions/2026-07-25-evidence-the-rule-cited-as-dec-116.md:75-96`).

`[JUDGMENT]` This is not a confession offered for symmetry. It is evidence: the code enforces part of the rule at the structural rung while its warrant remains at the habit rung. It is the first documented case here where code is stronger than its recorded authority. h2a therefore cannot lecture another lane as though it already solved the governance lifecycle.

## 2. The real gap

### The missing mechanism

`[FACT]` The current pieces do not compose into the requested method:

1. There is no canonical machine-readable binding that tells a session which POLICY, CONTRACT, ENGAGEMENT, amendments, exceptions and RACI apply to its `(root, workspace, owned work)`.
2. Session open does not return such a binding or fail/warn when it is absent or stale.
3. Artifact storage does not validate the detailed contractual schemas at stabilization.
4. Ordinary envelope actor, conductor claim and several role assertions are self-asserted. Stabilization proves possession of keys from the same permissive registry, same-hash quorum and a role-string allowlist; it does not prove authoritative registration or ratification. Comprehension has a verification primitive, but its MCP persistence path does not verify the supplied key against registered keys or the supplied role against registered roles.
5. The role/org model has no Accountable-versus-Responsible dimension.
6. The implemented precedence profile orders tiers but deliberately escalates conflicts instead of resolving them.
7. `org diff` detects declared/live role and scope drift, not cross-repository boundary, version, hash, exception or precedence drift.
8. AMENDMENT can be signed and stored by hash, but no current resolver applies it to its target or derives an effective rule set; its schema has no scope, owner, expiry or effective-order fields.

### Enforceability ladder

| proposed rule | structural rung | test rung | spec-line rung | habit rung / present stopping point |
|---|---|---|---|---|
| Geo owns acquisition, scraping, storage, proof and citability; immo owns detection, ontology, signals, pipeline and scoring. | Artifacts signed by proven authorities plus a host-start binding consumed before governed work. **Not present.** | Cross-repo fixtures can prove inputs/outputs stay on the correct side. **Not present.** | A ratified shared POLICY and bilateral CONTRACT can state it. **Not present in the inspected h2a repo.** | The humans know it; therefore it currently stops at habit. |
| Accountable and Responsible allocation | Verified owner/authority identity plus explicit A/R fields in a binding projection. **Not present.** | Schema and authorization tests. **Not present.** | A RACI document can state it, but h2a has no current RACI schema. | Self-asserted instance/role is habit-grade attribution. |
| Local repository instructions | A guaranteed host-start consumer verifies a canonical signed reference and delivers it to the fresh agent. **Not present.** | CI checks pointer version/hash against the canonical artifact. **Not present.** | A checked-in repository rule can mirror the local consequence. | Private agent memory is habit and must not be authoritative. |
| Exception to the boundary | A future effective-state resolver accepts only an authority-proven, targeted AMENDMENT with exact base hash, scope and expiry. **Not present.** Current h2a only signs/stores a hash-addressed AMENDMENT and does not apply it. | Resolver, expiry, scope and precedence contract tests. **Not present.** | Exception prose alone. | Oral/private exception. |
| Discovery and drift | Every supported host delivers a binding result to the fresh agent and obtains acknowledgement before governed work. **Not present.** Returning fields from an unconsumed API is insufficient. | Cross-root, rename, stale-hash, missing-binding, host-delivery and parity tests. **Not present.** | Skill/docs tell agents to check. **Not present for governance binding.** | Agents remember to look. |

### Concrete geo/immo recommendation

`[JUDGMENT]` Use the artifacts in combination, not as interchangeable documents:

1. **POLICY — canonical boundary semantics.** One shared, durable POLICY defines the geo reference layer and immo business-semantics layer, including the ownership test for ambiguous work.
2. **CONTRACT — bilateral binding.** A signed CONTRACT between the geo and immo human PRINCIPALs incorporates the POLICY by immutable id/hash and defines the amendment/exception procedure, escalation, evidence and acceptance obligations. It binds the boundary; it does not silently rewrite it.
3. **ENGAGEMENT — work-instance execution.** Each joint initiative has an ENGAGEMENT referencing the CONTRACT/POLICY, naming deliverables, Responsible executors, the human Accountable authority, acceptance evidence and end conditions.
4. **Repository rule — local discoverability mirror.** Each repository carries a short agent-readable rule containing the canonical ids/hashes, local consequences and bootstrap command/pointer. It is a projection, not an authority allowed to silently diverge.
5. **RACI — allocation, not another precedence tier.** RACI maps work/capability surfaces to A/R/C/I. Until identity is repaired, Accountable should be a ratifying human PRINCIPAL or other verified authority; agent Responsibility should be evidenced by owned work and signed output, not a fabricated actor name.

`[FACT]` The current `B_ECOSYSTEM` profile orders `public-authority > contractual > federated > local`, but V1 explicitly does not choose a winning policy; its only deterministic conflict disposition is escalation (`packages/h2a/src/policy-precedence.ts:52-65`, `packages/h2a/src/policy-precedence.ts:142-153`).

`[JUDGMENT]` If the owners ratify this case-specific interpretation, apply:

`public authority > bilateral CONTRACT obligations > ratified shared/federated POLICY boundary > repository-local rule > private memory/habit`

The CONTRACT incorporates and binds the POLICY boundary; it may add bilateral obligations but may not vary that boundary silently. ENGAGEMENT executes under the CONTRACT/POLICY and does not override either. RACI allocates duties and is not a precedence tier. A repository rule may be stricter locally but may not relax the bilateral boundary.

AMENDMENT should inherit the tier of its target, not form a new tier. Only after owners approve a schema and effective-state resolver may a jointly ratified targeted amendment supersede its exact base hash; a POLICY-boundary change must target that POLICY. Until then, a stored AMENDMENT has no operative precedence. Any conflict without that mechanism follows current behavior: **escalate; no winner is selected**.

`[JUDGMENT]` Drift detection should use four comparisons:

- **content drift:** canonical POLICY/CONTRACT ids, versions and hashes—and, after an effective-state resolver exists, the effective targeted AMENDMENT set—match the repository pointers;
- **allocation drift:** RACI A/R entries match verified authority and owned work, not only actor strings;
- **runtime drift:** session-start projection reports bound, missing, stale, wrong-root and ambiguous-address states;
- **behavior drift:** cross-repository contract tests exercise the geo proof/citability outputs consumed by immo semantics without moving ownership across the boundary.

The cheapest **credible** first increment is additive but must include consumption: define a versioned governance-binding result (`unbound|stale|ambiguous|bound` plus canonical pointers/digests), then wire a guaranteed host-start delivery/acknowledgement path so each supported fresh agent receives it before governed work. Extending `h2a_session_open` alone misses stdio auto-open, which calls `SessionRegistry.open` internally and only logs the session (`packages/h2a/src/runtime/mcp/stdio.ts:284-316`); adding an explicit verb alone repeats the discovery defect. The exact host/session/harness surface remains an owner decision. Start advisory only after delivery is testable, disclose host capability, and add missing/stale/wrong-root/host-parity tests. Fail-closed behavior requires a separate ratification of identity, availability and migration consequences.

### Decision dossier — whether h2a should prescribe and bootstrap the method

**Status: Incomplete.** The owner decision is open, and an Opus review surface was not available in this environment.

#### 1. Decision asked

`[JUDGMENT]` The h2a PRINCIPAL must choose whether h2a (A) refuses this scope, (B) documents a manual repository method, (C) specifies an additive protocol bootstrap with repository projections, or (D) immediately enforces a fail-closed binding gate. Scope: h2a's own harness/protocol only; no unilateral changes to geo, immo or sentropic architecture.

#### 2. Context and stakes

`[FACT]` The primitives, discovery gap, identity/address limitations and DEC-116 evidence are documented above. `[JUDGMENT]` This is dossier-level because it affects cross-repository contracts, authority attribution, session availability and security boundaries.

#### 3. Options

| id | choice | strongest case for | strongest case against | cost | reversibility | what would make it win |
|---|---|---|---|---|---|---|
| A | Refuse: h2a remains transport/negotiation primitives only | Preserves a narrow protocol; avoids duplicating repository harness/governance owners; no boot availability regression | Leaves the exact defect class unowned at the inter-agent seam; every project reinvents discovery; primitives remain easy to overstate | low | high | Another named layer already owns a tested, universal bootstrap and h2a can link to it without ambiguity |
| B | Manual checked-in method and skill instructions | Cheapest visible repair; reviewable in Git; works before identity/session redesign | Stops at spec/test rung; depends on every host/agent remembering to read; repeats the “rule present but undiscovered” failure | low–medium | high | Session integration is out of scope for a fixed period and a measured manual-start test proves adequate compliance |
| C | Additive governance-binding projection, guaranteed host-start delivery and acknowledgement, backed by authority-proven artifacts and repo pointers | Repairs discovery at the actual failure point; incremental/advisory rollout; makes drift observable without immediate outages | Adds protocol/schema/host work; advisory mode can be ignored; wrong identity/root may make the projection confidently wrong unless surfaced | medium | high before hard gate | Owners accept h2a as the binding-discovery seam, require every supported host to consume it and make wrong-root/identity states explicit |
| D | Immediate fail-closed session gate | Strongest structural enforcement; prevents an uninformed session from acting; simplest compliance story once mature | Highest outage/migration risk; current identity/root ambiguity can block the right agent or bind the wrong one; freezes undecided owner parameters | high | medium–low | Stable verified address, complete host parity, migration/UAT and emergency bypass are already proven |

#### 4. Recommendation and rationale

`[JUDGMENT]` Recommend **C**, conditional on owner ratification, with B as a temporary repository projection rather than the endpoint. C is the smallest option that addresses discovery because it includes a guaranteed consumer, not merely another callable API. Do not choose D until identity/address and host-parity prerequisites are proved.

#### 5. Reversibility, pre-mortem and interests

- `[JUDGMENT]` **Rollback:** feature-gate host delivery and keep the binding schema additive; disable the advisory delivery without rewriting stabilized artifacts. Moving from advisory to fail-closed is a separate ratified decision.
- `[JUDGMENT]` **Strongest case against C:** governance bootstrap may belong in a higher sentropic harness layer, and putting it in h2a could turn a transport/protocol into a policy authority while still failing to authenticate ordinary actors.
- `[JUDGMENT]` **What would overturn C:** proof that another universally invoked session-start layer already projects the same signed binding, or proof that h2a cannot expose it without coupling unrelated repositories/owners.
- `[JUDGMENT]` **Pre-mortem:** six months later this failed because a bootstrap verb existed but some hosts never injected its result, each remaining host interpreted the optional projection differently, pointers drifted, and agents treated “advisory” as verified authority despite root/identity ambiguity. The prevention is guaranteed delivery/acknowledgement, a versioned schema, host capability disclosure, cross-host contract tests and an explicit `unbound|stale|ambiguous|bound` result.
- `[JUDGMENT]` **Agent interest:** C is easier for the presenter to defend than D because it avoids outage ownership. That convenience diverges from owner value if advisory behavior merely prolongs non-compliance; measured uptake and a separately owned hardening gate are required.
- `[JUDGMENT]` **Owner interest:** value—rules discovered before action; integrity—signed, attributable sources; risk—no premature fail-closed outage; optionality—additive rollout; cost—one shared mechanism instead of per-repository reinvention.

#### 6. Owner validation criteria

| criterion | source | covered by | open gap |
|---|---|---|---|
| Fresh sessions learn the binding before governed work | peer request | C requires guaranteed host delivery/acknowledgement and runtime-drift states | Exact host/session/harness surface: h2a PRINCIPAL + sentropic architect |
| Enforceability rung is explicit | peer request | ladder above | None |
| No self-asserted identity is treated as accountability | measured fact | RACI recommendation and ambiguous state | Identity/address design: sentropic architect |
| Cross-repository owners ratify their boundary | hard constraint | POLICY + CONTRACT proposal | Boundary text/signers: geo and immo human PRINCIPALs jointly |
| Precedence and exceptions are deterministic | question 4 | current escalation-only fact plus proposed target-tier AMENDMENT rule | Effective-state resolver and ecosystem-wide interpretation: h2a PRINCIPAL + sentropic architect |
| Drift is detectable | question 4 | four comparisons | CI ownership and repositories: geo/immo PRINCIPALs with sentropic architect |
| Rollback and UAT precede a hard gate | decision discipline | additive rollout and separate gate | UAT suite and fail-closed threshold: h2a PRINCIPAL |
| Independent adversarial review | harness/decision discipline | two independent harness reviews are required before finalization | Opus reviewer unavailable; dossier remains Incomplete |

## 3. Commitment

### Position

`[FACT]` This branch is authorized to establish facts and draft an answer. It is not evidence that the h2a PRINCIPAL, sentropic architect, or geo/immo owners accepted implementation work.

`[JUDGMENT]` Therefore the honest project answer to question 2 is:

> **No implementation commitment is made here, and this answer refuses to manufacture one.** The decision owner for adding a prescribed inter-agent rule lifecycle to h2a is the **h2a PRINCIPAL**. A historical FOR-REVIEW synthesis names Fabien as the decision authority for that synthesis (`docs/specs/2026-06-27-h2a-semantic-v0-FOR-REVIEW.md:7-9`), but this study did not establish that as a current authority record. The **sentropic architect** co-owns any shared protocol/session-schema, guaranteed host-start delivery or stable-address decision. If those owners approve option C, the expected artifact is a dated `SPEC_EVOL` with numbered decisions, followed by a versioned machine-readable governance-binding schema/effective-state projection, guaranteed host-start delivery and acknowledgement, host capability disclosure and contract tests. Exact schema, transport/host surface, warning/failure policy and migration are deliberately left open to those owners.

The geo/immo boundary itself remains jointly owned and ratified by the **geo human PRINCIPAL** and **immo human PRINCIPAL**. h2a can recommend representation and enforce discovery mechanics; it cannot authoritatively invent their boundary wording, RACI allocation or exceptions.

### Open decisions and owners

| open decision | decision owner | expected artifact if approved |
|---|---|---|
| Does h2a own the prescribed rule lifecycle and session-start binding? | h2a PRINCIPAL | dated `SPEC_EVOL` with a chosen option and acceptance criteria |
| Is the binding part of h2a session protocol or a higher sentropic harness bootstrap? | sentropic architect, with h2a PRINCIPAL | versioned schema/ADR and compatibility matrix |
| Which host-start path guarantees delivery and acknowledgement before governed work? | sentropic architect, with h2a PRINCIPAL | host capability contract, adapters/hooks/readiness design and parity tests |
| What is the canonical stable address and proof for an accountable agent across roots/renames? | sentropic architect | identity/address decision, threat model, migration and conformance tests |
| Does missing/stale/ambiguous binding warn or fail closed, and when? | h2a PRINCIPAL; sentropic architect for protocol availability | rollout decision, UAT, emergency/rollback policy |
| What AMENDMENT fields and resolver create effective rule state, target-tier precedence and expiry? | h2a PRINCIPAL; sentropic architect for shared schema | amendment schema, effective-state algorithm and conformance tests |
| What exact geo/immo boundary text, RACI and signers apply? | geo and immo human PRINCIPALs jointly | signed POLICY + CONTRACT; ENGAGEMENT template |
| Who owns cross-repository content/behavior drift CI? | geo and immo human PRINCIPALs jointly, architecture mechanism by sentropic architect | owner map and cross-repo contract-test job |
| What rationale and final number warrant the behavior currently cited as DEC-116? | h2a decision owner/PRINCIPAL | recorded decision or renumbered references; no inferred rationale |

### What could not be established

1. `[FACT]` The rationale, ratification record or correct final number for DEC-116 could not be found; the existing evidence dossier says those remain open (`docs/decisions/2026-07-25-evidence-the-rule-cited-as-dec-116.md:75-96`).
2. `[FACT]` No current ratified geo/immo POLICY, CONTRACT, ENGAGEMENT or RACI was established from this repository. The peer lane supplied the human-known boundary; this answer does not claim it already exists in agent-readable form.
3. `[FACT]` No current authority record naming the human holder of the h2a PRINCIPAL decision role was established. The cited FOR-REVIEW synthesis historically names Fabien for that synthesis only.
4. `[FACT]` No authoritative names for the geo and immo human PRINCIPALs were established here, so ownership is named by role/project rather than guessed identity.
5. `[FACT]` The measured rename case establishes that re-minting can occur; the source also contains proof-of-possession reclaim paths. This study did not establish universal rename behavior for every host/provider-session/reconnect combination.
6. `[FACT]` `track report` produced no report in this checkout and was terminated after hanging; no track state was written. Consequently no current track acceptance/attention state is asserted here.
7. `[FACT]` Network publication and remote peer-state verification were unavailable and were not required for this local deliverable. No GitHub or remote-lane claim is inferred.
8. `[FACT]` An independent Opus review surface was unavailable. Independent harness reviews can test the draft from distinct lenses, but the decision dossier remains explicitly **Incomplete** rather than pretending the requested reviewer mix occurred.

This draft's reporting assurance is narrow; it is not a new project rule: it does not call primitives a method, a role a RACI, a discoverable verb a discovered rule, a stored AMENDMENT an effective exception, or a self-asserted string accountability, and it does not freeze another owner's open choice.
