# STUDY — Human-centred h2a CLI surface and sentropic seam

Date: 2026-07-17  
Rung: **STUDY** — proposal and recommendations only; no implementation commitment  
Scope: the `h2a` command-line surface as the single-plugin front door, including its seams with sentropic

## Status and authority

This study follows the 2026-07-17 co-design brief. It treats the brief's ownership boundary as
authoritative and the frozen h2a CLI contract as a compatibility constraint. It does not redefine
provider routing, account policy, the model catalogue, or sentropic's agents lane.

The conclusion is deliberately a **target information architecture**, not a rename patch. Any
cross-owner conclusion is labelled **co-validation required with sentropic**.

### Grounding and live context

- The h2a help surface confirms `h2a` as the front door: it exposes the local-only `h2a_run` tool,
  delegates Track/Harness/Focus under the one plugin, and retains `h2a remote …` as a transport
  compatibility namespace rather than a session-launch front door.
- `packages/h2a/src/cli-contract.ts` and `docs/contracts/golden/cli-verbs.json` freeze the native
  CLI verbs; the runtime has an additional structured `h2a run` contract. The native-agent study
  remains the source for portable session and loop distinctions.
- The brief-cited
  `docs/specs/2026-06-26-llm-gateway-capitalization-model-routing.md` is not present in this
  checkout. Its already-actuated boundary is therefore taken from the brief and remains subject to
  the pending llm-mesh seam response rather than being reconstructed locally.
- Gateway 0.9 and mesh 0.8 are integrated; Gemini/Antigravity provider calibration is active on the
  mesh side. This is specifically a reason **not** to freeze provider names, provider-specific flags,
  or a second h2a catalogue. h2a may render a safe service-attested outcome, but only sentropic
  defines the routing/policy behind it.

## Executive recommendation

Make `h2a` the one human-facing CLI, but do not make it a flat bag of every capability. The top
level should answer the questions an operator asks every day:

1. What work session should I start, resume, inspect, or attach to?
2. Which agent or peer should I coordinate with?
3. What is the state of the work, and what needs my attention?
4. Which specialist subsystem owns the detailed operation?

The resulting rule is simple:

- `h2a <verb>` is reserved for an operator's frequent cross-cutting action: sessions, agents,
  coordination, connection, and the two curated work actions `report` and `decision`.
- `h2a <domain> <verb>` exposes a specialist contract without pretending h2a owns that domain's
  internals. `track`, `harness`, and `focus` are explicit examples.
- h2a sends **intent and lifecycle requests** to sentropic. It never grows provider-routing,
  account-pool, sticky/failover, catalogue, or audit-management commands.
- A session has one portable descriptor and one observed placement. “Move” means a checkpointed
  successor or replay, never an implied live PTY migration.

This preserves the good current direction: `h2a run` is the canonical execution front door;
`remote` survives only where it is a transport or compatibility term, not as the human front door.

## Design constraints

### Human-centred rules

- **Name the thing before exposing the machinery.** A human operates a *work session*, a *peer*, a
  *job*, or a *work record*; they should not have to infer whether an internal store, tmux pane,
  Pod, or provider route owns it.
- **One command, one visible noun.** `h2a ls` lists work sessions; `h2a peer ls` lists h2a protocol
  peers. These are deliberately not collapsed: a managed agent session and a live h2a presence
  attachment are different things.
- **Explain before destructive or durable action.** A placement change, enrollment bind, relaunch,
  or agent launch first renders a plan and its authority/placement consequence. `--confirm` is the
  execution gate where the existing contract already calls for one.
- **Keep machine contracts stable.** JSON output, exit-code semantics, and all frozen verbs remain
  machine-first. Human-oriented views are additive (`--human` or a TTY formatter), never a silent
  replacement for a public JSON shape.
- **Do not overload risky generic verbs.** `verify`, `check`, and `block` stay namespaced because
  their meanings differ materially between Harness, Track, protocol security, and peer blockage.

### Ownership rules

- h2a owns the human/host-facing coordination experience: protocol, host adapters, local launch,
  session request construction, h2a run, governance semantics, and Track/Harness/Focus integration.
- sentropic's `llm-gateway` and `llm-mesh` own provider transport, provider/model routing,
  account policy, sticky/failover, the provider catalogue, and audit.
- A CLI flag is not an ownership claim. A h2a flag may express a requested quality or a gateway
  posture; the service, not h2a, resolves it to a provider/account/upstream.
- No command should cause a user to copy a provider token, account selector, route, or failover rule
  between the two products.

## Target command map

The map distinguishes the **canonical target** from existing compatibility surfaces. It intentionally
does not require all of the following aliases to be introduced at once.

### Daily operator surface — top level

| Need | Target command | Meaning and boundary |
|---|---|---|
| Start a work session | `h2a run <runtime>` | Start or submit one session request. `<runtime>` is a host adapter such as `claude`/`codex`, or the sentropic-native runtime once ratified. Runtime and placement are independent inputs; placement is not a provider-selection interface. |
| See work sessions | `h2a ls` | Unified list of local, k8s, and in-sentropic work sessions, with actual placement, state, and next action. It is **not** a presence list. |
| Return to one | `h2a attach <session>` | Attach using the capability offered by the actual placement; h2a does not emulate a transport that the backend does not offer. |
| End or continue one | `h2a stop <session>` / `h2a resume <session>` | Human lifecycle request. The result reports the effective backend action and stop/resume reason. |
| Read its recent activity | `h2a logs <session>` | Read the session's permitted log/capture projection, never an undisclosed provider audit stream. |
| See the big picture | `h2a status --human` | An **opt-in** concise dashboard: my work sessions, reachable peers, open work/decisions, and one next recommended action. Bare `h2a status` retains its frozen machine-first presence contract. |
| Coordinate directly | `h2a send <peer> <message>` | Resolve-before-send; output must say either “delivered to live peer” or “deposited for dormant channel.” No inferred remote transport. |
| Hand work to an agent | `h2a delegate <runtime> <task>` | Create a task-bearing agent job. It is distinct from starting one's own interactive session. |
| Supervise delegated work | `h2a jobs …` | Keep the already-established plural runtime namespace for job queue, status, decisions, logs, and conduct. |
| Connect this host | `h2a connect` | Establish local identity, host integration, and h2a presence prerequisites. It does not configure a provider account. |
| Enroll with sentropic | `h2a enroll …` | Start or inspect the local, human-confirmed enrollment/bind flow. The server owns authorization and binding validation. |
| Read or record work | `h2a report` / `h2a decision …` | Curated Track lifts for the common operator workflow; full Track remains explicitly namespaced below. |
| Diagnose | `h2a doctor` | Explain local wiring, compatibility, store, and capability health without altering state by default. |

`h2a --help` should render these as a short “Start / Observe / Coordinate / Work / Set up” guide,
then link to namespaces. It should not print the full protocol implementation inventory first.

### Advanced session controls

| Target command | Purpose |
|---|---|
| `h2a session inspect <session>` | Show the normalized session descriptor: desired and actual placement, lifecycle state/reason, context/resume class, safe gateway/model projection, control capabilities, and provenance. |
| `h2a session relocate <session> --to <placement>` | Request a successor/recovery at another placement. The default is plan-only; it explains whether the result is checkpoint restore, transcript replay, vendor-native resume, or unsupported. It never claims live process migration. |
| `h2a session recover <session>` | Make recovery semantics explicit: byte-faithful restore, host-continuable resume, or best effort. This prevents “resume” from silently promising more than a backend can provide. |
| `h2a peer ls` / `h2a peer inspect <peer>` | List or inspect h2a protocol presence and capabilities. This is the explicit replacement in human documentation for the ambiguous legacy idea of “sessions.” |
| `h2a message inbox|thread|outbox …` | Specialist message operations. `h2a send` remains the daily shortcut. |

The advanced `session` namespace is intentionally small. It groups operations that expose placement
or recovery semantics while keeping `run`, `ls`, and `attach` easy to discover.

Every new spelling in this section is additive until it has a frozen contract entry. In particular,
`session`, `peer`, `message`, `send`, `enroll`, `explain`, and `help map` must not silently repurpose
an existing argv or output shape.

### Specialist namespaces and delegation

| Namespace | Canonical target role | What h2a owns | What it must not absorb |
|---|---|---|---|
| `h2a track …` | Complete work-record interface delegated to `@sentropic/track`. `report` and `decision` remain curated top-level lifts. | Single-plugin entry point, help routing, shared workspace context. | Track's event model, acceptance, provenance, and single-writer rules. |
| `h2a harness …` | The code-work and PR-method interface. Keep it always namespaced. | Packaging and invocation as the one plugin. | Harness's method, verification, and branch semantics. |
| `h2a focus web` | Serve/open the human Focus Web surface. | The packaged entry point and repo/context handoff. | Track's decision-focused `focus` semantics. `h2a track focus …` is the unambiguous target. |
| `h2a loop …`, `h2a conductor …`, `h2a drumbeat …`, `h2a blockage …` | Explicit governance and coordination concepts. | h2a protocol semantics, local coordination adapters, and Track integration. | A generic “govern” mega-namespace that hides materially different safety models. |
| `h2a negotiate …`, `h2a org …`, `h2a nhi …`, `h2a keys …`, `h2a host …` | Rare protocol, organizational, identity, and host-administration work. | Their existing h2a contracts. | Daily-session help and provider administration. |
| `h2a remote …` and `h2a relay …` | Quarantined transport/bridge compatibility. `relay` is the taught bridge noun. | The h2a transport contract. | The primary user journey or any new generic remote-control vocabulary. |

The current unnamespaced Track façade (`item`, `accept`, `blocker`, and peers) cannot simply vanish:
it is public behavior. The target is additive: teach `h2a track …` as the complete specialist
surface, retain curated top-level lifts, then retain the existing direct forms as documented
compatibility aliases until a separately approved deprecation plan expires.

### Commands deliberately absent

The following are not proposed h2a top-level areas:

- `h2a gateway`, `h2a provider`, `h2a account`, `h2a catalogue`, or `h2a failover`.
- A command that lists or selects sentropic account pools, raw upstream model identifiers, sticky
  routing state, or provider audit records.
- A generic `h2a verify`, `h2a check`, or `h2a block` which silently selects a subsystem.
- A second command family for starting a “native agent” that bypasses `h2a run` and produces a
  parallel session model.

## Session model and placement

### One descriptor, two kinds of truth

Every work session needs a portable **Session Descriptor**. h2a owns the client-side representation
and renders it; each backend provides the authoritative facts for the fields it owns.

The descriptor contains these conceptual fields:

- **Identity and concurrency:** h2a correlation id, backend-issued execution id, runtime kind
  (`host-adapter` or `sentropic-native`), h2a actor, descriptor schema version/revision, and a scoped
  creation idempotency key.
- **Workspace:** local `ws:<fingerprint>`, optional opaque `sentropicWorkspaceId`, and the signed
  binding record/version when one is relevant.
- **Context:** an opaque conversation/checkpoint reference plus an explicit resume class. It does not
  embed transcript bytes or secrets.
- **Execution contract:** requested runtime, tool/capability policy reference, resource/network
  policy reference, and a *model/quality intent* — not provider credentials or a resolved route.
- **Placement:** `requested`, `actual`, backend reference, locality/data-residency capability, and
  advertised controls (`attach`, `logs`, `checkpoint`, `relocate`, `stop`).
- **Lifecycle:** normalized state, observed-at time, stop/failure reason, recovery capability, and
  audit/provenance references plus the latest operation receipt.

“Requested” and “actual” must remain distinct. A request for `sentropic` placement may be pending,
denied by policy, or placed elsewhere only if the user has asked for an allowed fallback and the
result makes that choice explicit.

The descriptor is not a last-writer-wins shared document. h2a is authoritative for the request and
correlation fields; the executing backend is authoritative for its execution id, actual placement,
lifecycle observation, and advertised controls. A mutating operation carries the descriptor revision
(`If-Match`-style), an idempotency scope/TTL, and returns an immutable receipt. A stale revision is a
conflict to reconcile, never a reason to guess or overwrite the other side's state.

### Placement semantics

| Placement | h2a experience | Backend truth | Relocation/recovery rule |
|---|---|---|---|
| `local` | h2a launches through a host adapter and exposes tmux/pane controls where available. A native local runner, if agreed, has the same session descriptor but a different executor. | The local adapter or local native executor reports lifecycle. sentropic may observe or capitalize an enrolled session, but cannot control it without a separately authorized local executor. | A vendor CLI/PTy session is not live-migrated. Use vendor-native resume or a transcript/checkpoint successor when available. |
| `k8s` | The same `run`/`ls`/`attach`/`logs` verbs remain valid; h2a reports the Pod/backend capability rather than making the user learn a second CLI. | The currently agreed runtime/control-plane returns the actual workload and attach capabilities. | Create a new workload from an approved workspace/context checkpoint; do not assert PID or tmux continuity. |
| `sentropic` | The same session controls render the service-advertised capabilities. | The sentropic agents lane owns a sentropic-placed native LLM/tool-loop runtime, its durable checkpoints, and its execution lifecycle. | Restore or re-instantiate from a native checkpoint with the same descriptor/policy version. |

Runtime and placement form a matrix; `native` is **not** a spelling for the `sentropic` placement:

| Runtime | `local` | `k8s` | `sentropic` |
|---|---|---|---|
| Host adapter (`claude`, `codex`, …) | Current h2a adapter. | Existing runtime/control-plane compatibility path. | Not a native-loop claim; any supervised vendor path is separately described and has weaker governance. |
| Sentropic-native | **Co-validation required:** authenticated local worker, capabilities, and update/recovery owner. | **Co-validation required:** worker image, capability/credential delivery, residency, and workload owner. | Sentropic agents-lane execution is the intended service-owned case. |

`h2a run native --placement <local|k8s|sentropic>` is therefore only a possible future grammar;
the frozen bare interactive `h2a` native-agent path and `h2a --resume` remain compatibility inputs
until an approved command-by-command map says otherwise.

The `k8s` authority split is a **co-validation required with sentropic** item. h2a may retain a local
adapter/control-plane implementation, while sentropic may own durable placement/orchestration for
the agents lane. The CLI must be written against the placement contract, not against whichever
implementation wins that decision.

## The h2a ↔ sentropic seam

The seam should be a small family of versioned request/projection contracts, not an import of each
other's implementation. h2a accepts a human action, validates its local/host constraints, then
sends an intent. sentropic returns an accepted/rejected operation and a projection with opaque
references. h2a renders it honestly.

Every mutating seam operation needs the same minimum safety envelope: caller/tenant and host-principal
authentication, a session-bound and scope-limited authority grant, descriptor revision, idempotency
key plus retention scope, a fenced execution/lease epoch where a leader acts, and an immutable
operation receipt. Projections are descriptive; they are never ambient authority to attach, stop,
resume, or run a process.

| Zone | h2a owns | sentropic owns | Seam contract | CLI expression |
|---|---|---|---|---|
| Run and session lifecycle | User-facing `run`, host adapters, local launch, local session descriptor, h2a protocol identity, and user-visible lifecycle requests. | For sentropic-native sessions, accepted execution and durable server-side lifecycle. For any shared placement service, its scheduler/workload authority. | `SessionLaunchIntent` carries the h2a correlation id, idempotency scope, descriptor revision, workspace binding ref, placement request, runtime, tool/policy ref, and model intent. `SessionProjection` carries a backend execution id, actual placement, state/reason, controls, revision, and provenance. | `h2a run`, `ls`, `attach`, `session inspect`; no provider or cloud plumbing flags. |
| Gateway and model/provider resolution | Express a bounded desired posture (`auto|required|off`) or model/quality intent; pass it unchanged; show requested vs service-attested effective result. | Provider transport; catalogue; account policy; route resolution; sticky/failover; provider mapping; audit. | A service-owned `ResolvedModelProjection`: accepted policy/intent ref, effective public label if safe, availability/error class, audit ref. No account id, upstream token, or route mutation endpoint. | Existing `--model` is compatibility input. The target does not add `h2a gateway` management commands. |
| Enrollment and workspace binding | Local guided flow, consent presentation, local fingerprint discovery, safe storage of client-side state, and command help. | OIDC/PKCE or device-code authorization, authorized workspace list, admin-gated bind/create validation, opaque workspace id, binding record, server-side retention/RBAC. | Authentication precedes workspace enumeration. `EnrollmentStatus` and `WorkspaceBinding` expose safe capability state and ids necessary for signed binding, but not bearer tokens. A server-verified host-key binding and scoped, short-lived action grants are required; bind/upload capabilities remain separate. | `h2a enroll`, `h2a enroll status`, and a printed confirmation plan; never `h2a login --token` or a raw server-routing flag. |
| Governance, objective loop, and conductor | h2a governance vocabulary, loop policy/intent, Track references, local fallback/adapters, and human decision presentation. | If ratified, durable scheduling/ticking and server-side execution of the native agents-lane work; its own service health/audit. | Separate conductor protocol operations from the agent runtime. Each operation has an immutable human-decision/grant ref, scope/action budget/expiry, stop-reason policy, fenced lease epoch, idempotency key, and receipt; takeover/revocation rules prevent stale local fallback action. | Keep `h2a loop …` and `h2a conductor …`; show “local fallback”, “service-driven”, or “awaiting authority” explicitly. |
| Agents lane / native loop | h2a session descriptor, host-facing tooling and protocol integration, human command surface, coordination with non-native host agents. | The sentropic-native LLM-to-tool loop, its checkpoints, tool execution policy enforcement, gateway calls, durable agent-lane orchestration. | `NativeAgentRunIntent`, checkpoint/context reference, tool-capability/policy ref, lifecycle events, and a capability-based control projection for each runtime × placement combination. | `h2a run native` is an additive proposed entry point, subject to co-validation and compatibility with bare `h2a`; no `h2a agent-loop` copy of the service runtime. |

### Three loop distinction

The CLI must label these separately; “loop” alone is not sufficient:

1. **Objective/conductor loop:** coordination, work state, relaunch decision, and Track references.
2. **Agent LLM/tool loop:** the native runtime's model-to-tool execution inside one session.
3. **Process/session supervision loop:** heartbeat, lease, crash/stop detection, and backend recovery.

The native-agent study correctly warns that these have different safety properties. A h2a `loop`
command must never imply ownership of the LLM/tool loop merely because it observes its session.

## Gateway and enrollment UX

### Gateway: intent, not configuration

The current local launcher exposes gateway toggles and a model override. The target keeps those as
compatibility inputs but tightens their meaning:

- `gateway=required` means “only start if the service can attest that the requested governed gateway
  posture is in effect”; it is not a request to select a provider account or URL.
- `gateway=auto` means “use the deployment's eligible service path when the runtime supports it”; the
  final projection reports what actually happened. It **fails closed** if the governed path is
  unavailable, unless the request carries an explicit, user-authorized direct-fallback grant.
- `gateway=off` is a direct host-adapter posture. A native sentropic runtime may reject it if that
  would violate governance; the error is a service policy result, not a h2a workaround.
- `--model` remains accepted for compatibility. Its future contract should be a service-approved
  intent/profile, not a promise that a provider-specific identifier will be used verbatim.

For the existing flags, the proposed compatibility mapping is `--llm-gateway`/`--gw` → `required`
and `--no-llm-gateway`/`--no-gw` → `off`. Omission preserves the legacy configuration resolution
until an EVOL explicitly changes the default. The structured result must record requested posture,
effective governance mode/policy revision, and effective outcome; it must never silently turn
`auto` into unreported direct vendor authentication.

The exact public vocabulary for model/quality intent is **co-validation required with sentropic**.
Until it is agreed, h2a should not mint a second catalogue abstraction.

### Enrollment: a human is authorizing a binding, not “logging in”

Enrollment deserves a first-class but narrow h2a journey:

1. `h2a enroll authenticate` completes PKCE/device-code authentication before h2a enumerates any
   server workspace or binding metadata.
2. `h2a enroll plan` then shows the local fingerprint, eligible sentropic workspace choices, the
   proposed create-or-bind operation, transcript-upload consequence, and required administrator role.
3. `h2a enroll apply --confirm` sends the selected binding request. A server-verified host-key
   binding establishes the durable principal; scoped, short-lived action grants are rotated/revoked
   by the service. Consent for transcript upload remains a separate per-workspace gate.
4. `h2a enroll status` shows binding state, safe server identity, upload-consent state, last verified
   synchronization, and repair guidance — never tokens or plaintext transcript content.

The names above are a design target, not a commitment to specific subcommands. The important
boundary is that sentropic validates authorization, RBAC, binding uniqueness, and opaque workspace
identifiers; h2a does not duplicate that policy locally.

## Decisions still open — sentropic co-validation required

| ID | Fork | Options | Recommendation for the study | Why it needs sentropic |
|---|---|---|---|---|
| S1 | Who has final authority for a non-local placement? | h2a runtime/control plane; sentropic agents-lane scheduler; split by session kind. | Split by session kind: h2a is authoritative for local host launch; sentropic is authoritative for sentropic-native execution. Define the k8s case by a placement contract, not by CLI history. | Determines scheduling, leases, credentials, and attach authority. |
| S2 | Who executes a durable conductor tick? | h2a only; sentropic service only; h2a semantics with sentropic execution. | Keep h2a as owner of governance semantics and human-facing decisions; allow a sentropic durable executor only through fenced, idempotent h2a protocol operations carrying a grant, budget, expiry, stop-reason policy, and lease epoch. | The native-agent study and the brief use different ownership emphasis; this must not become split-brain. |
| S3 | Native-agent spelling | Preserve bare `h2a`/`h2a --resume`; add `h2a run native`; `h2a agent run`; a sentropic-only command. | Preserve the frozen bare interactive native path and `--resume`. `h2a run native` may be an additive, explicit runtime spelling only after a matrix maps runtime × placement and all old argv/output behavior. | The agents lane may have existing public nomenclature or a required submission workflow. |
| S4 | Public model intent vocabulary | Preserve provider-looking `--model`; introduce a sentropic policy/profile id; h2a-owned aliases. | Keep `--model` only as a compatibility request and adopt a service-owned opaque profile/intent when available. | Prevents two catalogues and avoids h2a taking routing ownership. |
| S5 | Remote control of local sessions | h2a direct only; sentropic proxy; sentropic authority dispatching to h2a. | Capability-based control projection: h2a's local adapter remains the local executor. A remote request requires mutual authentication plus a user/tenant-approved, session-bound, action-specific, expiry/nonce-bound capability; revocation and an honest unavailable state are mandatory. | Security, tenancy, liveness honesty, and the remote-control product contract are server concerns. |
| S6 | What operations may relocate a session? | Allow any session; native only; capability-advertised per backend. | Capability-advertised only, with explicit successor semantics and no claimed PTY migration. Require target policy admission, immutable checkpoint/provenance, source quiesce/fencing generation, residency/data-transfer consent, duplicate/rollback rules, and a terminal operation receipt. | Requires shared checkpoint, workspace-sync, residency, and policy guarantees. |

No S1–S6 outcome should be encoded as a public CLI promise before sentropic confirms the seam.

## Compatibility and migration

The public `cli-contract.ts` and `docs/contracts/golden/cli-verbs.json` are frozen. The runtime also
has a separate structured `h2a run` contract. The following is therefore a reversible migration,
not a flag-day grammar rewrite.

| Existing surface | Target treatment | Compatibility requirement |
|---|---|---|
| `h2a run`, `ls`, `attach`, `stop`, `resume`, `delegate`, `jobs`, `workspace` | Keep canonical. Repair all help, examples, generated hooks, and diagnostics so they say `h2a`, never `remote`. | Preserve argv, structured result, exit behavior, tmux/state discovery, and legacy persisted state per the runtime canonicalization EVOL. |
| Bare interactive `h2a` and `h2a --resume` native-agent path | Preserve as frozen inputs. A later `h2a run native` is additive, never an implicit replacement. | A product decision must map both invocations' argv, effective placement/runtime, stdout, exit codes, and resume semantics before any deprecation. |
| Standalone `remote` binary | Retire only through its separately owned package's dependency-free migration binary. | h2a must not ship a fake shim; this repo cannot unilaterally change that executable. |
| `h2a remote …` | Preserve as native transport compatibility namespace. Do not teach it as the session front door. | Keep transport terms, `.remote`, `REMOTE_*`, and remote session compatibility intact. |
| `h2a h2a bridge` | Retain as an alias; teach `h2a relay bridge`. | Existing scripts remain accepted. |
| `h2a sessions` and bare `h2a status` protocol inventory | Preserve their machine-first output. `h2a status --human` is opt-in only; `h2a peer ls` is a new explicit surface. | Do not silently change a presence query into a work-session query or auto-format output by TTY. |
| `inbox put|read|pop`, `outbox put|read`, and `thread` | Keep every existing command exact. `h2a message …` and `h2a send` are additive front-door aliases over the same addressing/liveness rules. | Per-command mapping must preserve argv, JSON shape, exit codes, and dormant-vs-live delivery reporting. |
| Direct Track façade verbs | Keep as public aliases; add/teach `h2a track …` progressively and retain top-level `report`/`decision`. | Track remains the source of truth and sole writer; h2a delegates rather than forks state. |
| `h2a harness …` | Keep namespaced. | No bare `verify`/`check` alias that could run the wrong safety gate. |
| `h2a focus web|serve` versus bare `h2a focus` | Teach `h2a focus web` for the web UI and `h2a track focus` for a Track decision. | Keep bare focus behavior until an explicit contract migration says otherwise. |
| Proposed `peer`, `session`, `message`, `send`, `enroll`, `explain`, and `help map` | Treat as new public verbs/subverbs, not documentation-only renames. | Add them to the authoritative contract/golden review with a version decision before shipping; no existing verb is repurposed. |

Before any rename or deprecation, ship a generated `h2a help map`/`h2a explain <legacy-command>` view,
a compatibility table, and shell completion. A legacy invocation must name its canonical successor
without changing stdout shape or exit code during the supported window. The table in this study is a
policy summary; an EVOL must carry the exhaustive old argv → new argv/alias → stdout → exit-code map
for every frozen CLI and runtime command.

The present public-contract prose still names the historical path `packages/h2a-cli/src/cli-contract.ts`,
while this repository's implementation is `packages/h2a/src/cli-contract.ts`. That documentation
pointer must be reconciled without changing behavior. The future EVOL must name both authorities:
the frozen core CLI verb contract and the separate structured runtime `h2a run` contract.

## Incremental path

1. **Information architecture only:** group `--help`, document the work-session versus peer
   distinction, publish a command map, and remove stale “remote run” wording. No behavior change.
2. **Additive discoverability:** add the explicit `peer`, `session`, and `track` paths as aliases or
   wrappers only where their owning contracts agree; introduce `explain` and completion.
3. **Descriptor before placement:** agree the Session Descriptor, capability projection, operation
   ids, and stop/recovery taxonomy. Make `session inspect` useful before adding relocation.
4. **Sentropic-native integration:** after S1–S6 co-validation, freeze the runtime × placement
   matrix and route an additive `run native` through the agreed agents-lane interface while retaining
   bare-native compatibility. Expose the same honest lifecycle projection in `ls`.
5. **Deprecation only after evidence:** measure legacy use, preserve contract tests, and obtain the
   necessary owner/package releases before changing taught canonical commands.

## Independent review reconciliation

Two independent adversarial readings were applied to this v1 before handoff:

- **CLI/public-contract review:** accepted the need to preserve bare `h2a` and `h2a --resume`, to
  keep bare `h2a status` machine-first, and to map every frozen mailbox/thread and Track command.
  The study now treats human status, `peer`, `session`, `message`, and `send` as explicit additive
  contract work rather than documentation-only aliases.
- **Seam/safety review:** accepted the distinction between native *runtime* and *placement*, the
  need for descriptor revision/reconciliation, authenticated enrollment before workspace discovery,
  no-silent-direct gateway downgrade, and capability/fencing requirements for remote local control,
  conductor actions, and relocation.

The two reviews converge on an important gate: runtime × placement, authority, and capability
semantics must be co-owned with sentropic before an EVOL promises them publicly.

## Co-design questions sent to sentropic

The following questions were addressed via h2a to
`claude:llm-mesh:e5f8b95941e9` (envelope `env:1784322654000:8a9c`):

1. Which service-owned identifiers may h2a accept or render (model intent, policy/profile,
   enrollment/binding ref, placement request, run/workload id), and which provider details are
   prohibited from the h2a surface?
2. What request, status, logs, and attach contract should h2a use for local, k8s, and
   in-sentropic placement?
3. Who owns enrollment UX/state, and what is the smallest truthful h2a projection?
4. Under the native-agent D5 seam, is the sentropic conductor/agents lane a peer execution control
   plane for h2a governance, and which noun/contract should h2a expose?

At the time of this v1, that exact llm-mesh instance was not live; the message was deposited for its
wake. No `claude:architect` live session was discoverable, so no architectural response is claimed.
The S1–S6 recommendations remain pending their review.

## Acceptance for a future EVOL

This study is ready to become an EVOL only when all of the following are true:

- sentropic has co-validated S1–S6 and the versioned seam vocabulary;
- a Session Descriptor and lifecycle/recovery taxonomy are frozen;
- the CLI contract has a complete old-to-new compatibility map, including help and generated command
  wording;
- the `h2a run` contract distinguishes requested, attested-effective, and unsupported gateway/model
  postures without revealing service-owned routing details or silently downgrading `auto` to direct;
- authentication precedes enrollment workspace discovery, and remote/local control is protected by
  server-verified host identity plus session-bound, short-lived, revocable action capabilities;
- descriptor revision/reconciliation, operation idempotency, fenced conductor authority, and a safe
  relocation transaction are frozen for every mutating seam operation;
- one human can tell, from `h2a status --human` and `h2a session inspect`, what is running, where, who can
  control it, and what next action is safe;
- no command duplicates sentropic provider policy, account routing, catalogue, sticky/failover, or
  audit management.
