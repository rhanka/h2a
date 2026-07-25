# CLI help grouping — the vocabulary and its warrant

The intention groups used by `h2a --help` and `h2a explain` are not invented here.
Their vocabulary comes from an **internal design study** that is *not published in
this repository*: it exists only in the owner's working tree and is on no git ref.
There is therefore deliberately **no path to it in this file, in any source comment,
or in any command output** — a pointer no reader can follow is worse than none.

So the study's load-bearing passages are **vendored below, verbatim**, and this
committed file is what the code cites. The rationale travels with the code.

| | |
|---|---|
| Study title | STUDY — Human-centred h2a CLI surface and sentropic seam |
| Study date | 2026-07-17 |
| Rung | **STUDY** — proposal and recommendations only; no implementation commitment |
| Published | **No.** Untracked in the owner's tree; present on no commit and no ref. |

## How to read this

Each excerpt is quoted byte-for-byte from the study, with its section named, and is
followed by **what it warrants** — the specific design decision in this PR that
rests on it. Nothing below is a commitment on the study's behalf: the study is a
proposal, and the only increment taken from it is the first one (excerpt 1).

Two honest limits, stated rather than implied:

- **A vendored excerpt is a quotation, not a ratification.** These passages justify
  the *grouping vocabulary*. They do not make the study's target command map an
  agreed plan, and they do not settle its open decisions S1–S6 (excerpt 8).
- **Nothing enforces that these excerpts still match the study**, because the study
  is not in the repo for a test to read. That is a property of an unpublished
  source, not something a gate here can fix. If the study is ever committed, a
  drift test over these excerpts becomes possible and should be added.

## Excerpt 1 — The scope of this PR: information architecture only, no behaviour change

From § "Incremental path", step 1:

> 1. **Information architecture only:** group `--help`, document the work-session versus peer
>    distinction, publish a command map, and remove stale “remote run” wording. No behavior change.

**What it warrants.** The whole premise of this PR. The study asks for exactly one increment first: group the help, publish a command map, change no behaviour. Every design choice below is bounded by the last four words.

## Excerpt 2 — The four operator questions and the top-level/domain rule

From § "Executive recommendation":

> Make `h2a` the one human-facing CLI, but do not make it a flat bag of every capability. The top
> level should answer the questions an operator asks every day:
>
> 1. What work session should I start, resume, inspect, or attach to?
> 2. Which agent or peer should I coordinate with?
> 3. What is the state of the work, and what needs my attention?
> 4. Which specialist subsystem owns the detailed operation?
>
> The resulting rule is simple:
>
> - `h2a <verb>` is reserved for an operator's frequent cross-cutting action: sessions, agents,
>   coordination, connection, and the two curated work actions `report` and `decision`.
> - `h2a <domain> <verb>` exposes a specialist contract without pretending h2a owns that domain's
>   internals. `track`, `harness`, and `focus` are explicit examples.
> - h2a sends **intent and lifecycle requests** to sentropic. It never grows provider-routing,
>   account-pool, sticky/failover, catalogue, or audit-management commands.
> - A session has one portable descriptor and one observed placement. “Move” means a checkpointed
>   successor or replay, never an implied live PTY migration.
>
> This preserves the good current direction: `h2a run` is the canonical execution front door;
> `remote` survives only where it is a transport or compatibility term, not as the human front door.

**What it warrants.** Why the help is grouped by *intention* rather than by subsystem, and why `SPECIALIST` exists as a group: the study explicitly separates the frequent cross-cutting `h2a <verb>` from the delegated `h2a <domain> <verb>`.

## Excerpt 3 — The five daily group words, and the operator rows they group

From § "Target command map" → "Daily operator surface — top level":

> ### Daily operator surface — top level
>
> | Need | Target command | Meaning and boundary |
> |---|---|---|
> | Start a work session | `h2a run <runtime>` | Start or submit one session request. `<runtime>` is a host adapter such as `claude`/`codex`, or the sentropic-native runtime once ratified. Runtime and placement are independent inputs; placement is not a provider-selection interface. |
> | See work sessions | `h2a ls` | Unified list of local, k8s, and in-sentropic work sessions, with actual placement, state, and next action. It is **not** a presence list. |
> | Return to one | `h2a attach <session>` | Attach using the capability offered by the actual placement; h2a does not emulate a transport that the backend does not offer. |
> | End or continue one | `h2a stop <session>` / `h2a resume <session>` | Human lifecycle request. The result reports the effective backend action and stop/resume reason. |
> | Read its recent activity | `h2a logs <session>` | Read the session's permitted log/capture projection, never an undisclosed provider audit stream. |
> | See the big picture | `h2a status --human` | An **opt-in** concise dashboard: my work sessions, reachable peers, open work/decisions, and one next recommended action. Bare `h2a status` retains its frozen machine-first presence contract. |
> | Coordinate directly | `h2a send <peer> <message>` | Resolve-before-send; output must say either “delivered to live peer” or “deposited for dormant channel.” No inferred remote transport. |
> | Hand work to an agent | `h2a delegate <runtime> <task>` | Create a task-bearing agent job. It is distinct from starting one's own interactive session. |
> | Supervise delegated work | `h2a jobs …` | Keep the already-established plural runtime namespace for job queue, status, decisions, logs, and conduct. |
> | Connect this host | `h2a connect` | Establish local identity, host integration, and h2a presence prerequisites. It does not configure a provider account. |
> | Enroll with sentropic | `h2a enroll …` | Start or inspect the local, human-confirmed enrollment/bind flow. The server owns authorization and binding validation. |
> | Read or record work | `h2a report` / `h2a decision …` | Curated Track lifts for the common operator workflow; full Track remains explicitly namespaced below. |
> | Diagnose | `h2a doctor` | Explain local wiring, compatibility, store, and capability health without altering state by default. |
>
> `h2a --help` should render these as a short “Start / Observe / Coordinate / Work / Set up” guide,
> then link to namespaces. It should not print the full protocol implementation inventory first.

**What it warrants.** The literal source of the group names `START`, `OBSERVE`, `COORDINATE`, `WORK`, `SET_UP` — the closing sentence is the single most load-bearing line for this PR, and the five words are quoted from it, not invented. The table above it is vendored too because the per-group comments in `cli-help-groups.ts` and `cli-command-map.ts` justify individual group MEMBERSHIP by quoting these row labels (“Start a work session”, “Return to one”, “See the big picture”, and so on).

## Excerpt 4 — Advanced session controls, recovery semantics, and the third loop

From § "Advanced session controls" / § "Three loop distinction":

>
> | Target command | Purpose |
> |---|---|
> | `h2a session inspect <session>` | Show the normalized session descriptor: desired and actual placement, lifecycle state/reason, context/resume class, safe gateway/model projection, control capabilities, and provenance. |
> | `h2a session relocate <session> --to <placement>` | Request a successor/recovery at another placement. The default is plan-only; it explains whether the result is checkpoint restore, transcript replay, vendor-native resume, or unsupported. It never claims live process migration. |
> | `h2a session recover <session>` | Make recovery semantics explicit: byte-faithful restore, host-continuable resume, or best effort. This prevents “resume” from silently promising more than a backend can provide. |
> | `h2a peer ls` / `h2a peer inspect <peer>` | List or inspect h2a protocol presence and capabilities. This is the explicit replacement in human documentation for the ambiguous legacy idea of “sessions.” |
> | `h2a message inbox|thread|outbox …` | Specialist message operations. `h2a send` remains the daily shortcut. |
>
> The advanced `session` namespace is intentionally small. It groups operations that expose placement
> or recovery semantics while keeping `run`, `ls`, and `attach` easy to discover.
>
> ---
>
> The CLI must label these separately; “loop” alone is not sufficient:
>
> 1. **Objective/conductor loop:** coordination, work state, relaunch decision, and Track references.
> 2. **Agent LLM/tool loop:** the native runtime's model-to-tool execution inside one session.
> 3. **Process/session supervision loop:** heartbeat, lease, crash/stop detection, and backend recovery.
>
> The native-agent study correctly warns that these have different safety properties. A h2a `loop`
> command must never imply ownership of the LLM/tool loop merely because it observes its session.

**What it warrants.** The source of the `SESSION_RECOVERY` group — a bucket for commands that expose recovery or supervision semantics, distinct from `START`. The `session recover` row and loop #3 are the two phrases that group's comment quotes.

## Excerpt 5 — Specialist namespaces, and quarantined transport

From § "Specialist namespaces and delegation":

> | Namespace | Canonical target role | What h2a owns | What it must not absorb |
> |---|---|---|---|
> | `h2a track …` | Complete work-record interface delegated to `@sentropic/track`. `report` and `decision` remain curated top-level lifts. | Single-plugin entry point, help routing, shared workspace context. | Track's event model, acceptance, provenance, and single-writer rules. |
> | `h2a harness …` | The code-work and PR-method interface. Keep it always namespaced. | Packaging and invocation as the one plugin. | Harness's method, verification, and branch semantics. |
> | `h2a focus web` | Serve/open the human Focus Web surface. | The packaged entry point and repo/context handoff. | Track's decision-focused `focus` semantics. `h2a track focus …` is the unambiguous target. |
> | `h2a loop …`, `h2a conductor …`, `h2a drumbeat …`, `h2a blockage …` | Explicit governance and coordination concepts. | h2a protocol semantics, local coordination adapters, and Track integration. | A generic “govern” mega-namespace that hides materially different safety models. |
> | `h2a negotiate …`, `h2a org …`, `h2a nhi …`, `h2a keys …`, `h2a host …` | Rare protocol, organizational, identity, and host-administration work. | Their existing h2a contracts. | Daily-session help and provider administration. |
> | `h2a remote …` and `h2a relay …` | Quarantined transport/bridge compatibility. `relay` is the taught bridge noun. | The h2a transport contract. | The primary user journey or any new generic remote-control vocabulary. |
>
> The current unnamespaced Track façade (`item`, `accept`, `blocker`, and peers) cannot simply vanish:
> it is public behavior. The target is additive: teach `h2a track …` as the complete specialist
> surface, retain curated top-level lifts, then retain the existing direct forms as documented
> compatibility aliases until a separately approved deprecation plan expires.

**What it warrants.** The source of both the `SPECIALIST` group (rare protocol/identity/org/host work, plus always-namespaced `harness` and `focus`) and the `TRANSPORT` group. The last table row supplies the two phrases the transport heading leans on: “Quarantined transport/bridge compatibility” and “The primary user journey”.

## Excerpt 6 — Commands deliberately absent

From § "Commands deliberately absent":

> ### Commands deliberately absent
>
> The following are not proposed h2a top-level areas:
>
> - `h2a gateway`, `h2a provider`, `h2a account`, `h2a catalogue`, or `h2a failover`.
> - A command that lists or selects sentropic account pools, raw upstream model identifiers, sticky
>   routing state, or provider audit records.
> - A generic `h2a verify`, `h2a check`, or `h2a block` which silently selects a subsystem.
> - A second command family for starting a “native agent” that bypasses `h2a run` and produces a
>   parallel session model.

**What it warrants.** Why `account` and `llm-mesh` get a labelled bucket of their own instead of being filed under an operator intention. The study names these exact areas as ones h2a should not own — yet the two commands ship today. The bucket records the contradiction instead of laundering it. It deprecates nothing.

## Excerpt 7 — New spellings are additive, and `explain` is one of them

From § "Advanced session controls" / § "Compatibility and migration":

> Every new spelling in this section is additive until it has a frozen contract entry. In particular,
> `session`, `peer`, `message`, `send`, `enroll`, `explain`, and `help map` must not silently repurpose
> an existing argv or output shape.
>
> ---
>
> The public `cli-contract.ts` and `docs/contracts/golden/cli-verbs.json` are frozen. The runtime also
> has a separate structured `h2a run` contract. The following is therefore a reversible migration,
> not a flag-day grammar rewrite.
>
> ---
>
> | Existing surface | Target treatment | Compatibility requirement |
> |---|---|---|
> | Proposed `peer`, `session`, `message`, `send`, `enroll`, `explain`, and `help map` | Treat as new public verbs/subverbs, not documentation-only renames. | Add them to the authoritative contract/golden review with a version decision before shipping; no existing verb is repurposed. |

**What it warrants.** Why `explain` is added as a NEW frozen verb (contract + golden fixture + a version decision) rather than folded into `--help`, and why no existing verb, argv or output shape was repurposed to make room for it.

## Excerpt 8 — The open decisions S1–S6 must not be encoded

From § "Decisions still open — sentropic co-validation required":

> ## Decisions still open — sentropic co-validation required
>
> | ID | Fork | Options | Recommendation for the study | Why it needs sentropic |
> |---|---|---|---|---|
> | S1 | Who has final authority for a non-local placement? | h2a runtime/control plane; sentropic agents-lane scheduler; split by session kind. | Split by session kind: h2a is authoritative for local host launch; sentropic is authoritative for sentropic-native execution. Define the k8s case by a placement contract, not by CLI history. | Determines scheduling, leases, credentials, and attach authority. |
> | S2 | Who executes a durable conductor tick? | h2a only; sentropic service only; h2a semantics with sentropic execution. | Keep h2a as owner of governance semantics and human-facing decisions; allow a sentropic durable executor only through fenced, idempotent h2a protocol operations carrying a grant, budget, expiry, stop-reason policy, and lease epoch. | The native-agent study and the brief use different ownership emphasis; this must not become split-brain. |
> | S3 | Native-agent spelling | Preserve bare `h2a`/`h2a --resume`; add `h2a run native`; `h2a agent run`; a sentropic-only command. | Preserve the frozen bare interactive native path and `--resume`. `h2a run native` may be an additive, explicit runtime spelling only after a matrix maps runtime × placement and all old argv/output behavior. | The agents lane may have existing public nomenclature or a required submission workflow. |
> | S4 | Public model intent vocabulary | Preserve provider-looking `--model`; introduce a sentropic policy/profile id; h2a-owned aliases. | Keep `--model` only as a compatibility request and adopt a service-owned opaque profile/intent when available. | Prevents two catalogues and avoids h2a taking routing ownership. |
> | S5 | Remote control of local sessions | h2a direct only; sentropic proxy; sentropic authority dispatching to h2a. | Capability-based control projection: h2a's local adapter remains the local executor. A remote request requires mutual authentication plus a user/tenant-approved, session-bound, action-specific, expiry/nonce-bound capability; revocation and an honest unavailable state are mandatory. | Security, tenancy, liveness honesty, and the remote-control product contract are server concerns. |
> | S6 | What operations may relocate a session? | Allow any session; native only; capability-advertised per backend. | Capability-advertised only, with explicit successor semantics and no claimed PTY migration. Require target policy admission, immutable checkpoint/provenance, source quiesce/fencing generation, residency/data-transfer consent, duplicate/rollback rules, and a terminal operation receipt. | Requires shared checkpoint, workspace-sync, residency, and policy guarantees. |
>
> No S1–S6 outcome should be encoded as a public CLI promise before sentropic confirms the seam.

**What it warrants.** The binding constraint on what this PR must NOT do. No group heading, intention line or map entry promises an ownership boundary, a rename, a deprecation or a future command spelling. The grouping is a reading aid over the command set that ships today.

## Where each group's warrant lives

| Group | Surface | Warranted by |
|---|---|---|
| `START` | both | excerpt 3 (the word), excerpt 2 (why top level) |
| `OBSERVE` | both | excerpt 3 |
| `COORDINATE` | both | excerpt 3 |
| `WORK` | `explain` only | excerpt 3 |
| `SET_UP` | both | excerpt 3 |
| `SPECIALIST` | `explain` only | excerpt 2 (the `h2a <domain> <verb>` rule), excerpt 5 |
| `SESSION_RECOVERY` | both | excerpt 4 |
| `TRANSPORT` | both | excerpt 5, last table row |
| `LLM_LOCAL` | both | excerpt 6 — a labelled bucket, **not** an operator intention |
| `HELP` | both | none; Commander's own built-in help command |
| `UNCLASSIFIED` | `explain` only | none, and deliberately so — it is the *fallback*, carries no semantics, and is empty today |

`LLM_LOCAL` and `UNCLASSIFIED` are kept separate on purpose. `LLM_LOCAL` is a
semantic bucket with a real heading for two commands that genuinely ship;
`UNCLASSIFIED` is the fallback for a verb nobody has grouped yet. Merging them
would file a future ungrouped verb under an LLM-account heading — a confidently
wrong answer where an obviously missing one is wanted.
