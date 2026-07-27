# SPEC EVOL — h2a tmux status signal set

Date: 2026-07-26

Status: design decision; PR #42 assessed, implementation changes not made here

Base: `origin/main@0f285c27877a332af5ffe555f5c16b556b02781c`

Implementation assessed: PR #42, `feat/tmux-status-surface@d3fc80d0ed74d41f6a46ab0399771b91b59da295`

Earlier sketch assessed: `docs/specs/2026-07-18-DESIGN_h2a-tmux-status-bar.md` from the owner's working tree

## Decision summary

The tmux bar is an attention surface, not an inventory. It has three operational concerns:

1. work delegated on the owner's behalf, split into attributable executions (`J`) and open objective loops (`L`);
2. envelopes waiting for the exact owner scope (`I`);
3. the exact session's gateway posture and, when it fits and is proven, requested model to upstream model dispatched (`gw`).

The full wide form is:

```text
[h2a-h20:claude*] J2!1 I1 L1!1      gw active · claude-fable-5-xhigh→gpt-5.6-sol  14:32
```

The narrow form removes the route as one complete unit, not by inventing abbreviations:

```text
[h2a-h20:claude*] J2!1 I1 L1!1 · gw active  14:32
```

`J`, not PR #42's `A` or `D`, is the delegated-work signal. `A` conflates ordinary local sessions with jobs. `D` counts durable addressable subagent bindings, which says nothing about work running now. Neither answers the owner's complaint.

Names, ids, senders, loop titles, account labels, providers, transports, reasons, and provenance stay out of the bar. They belong in the opt-in `h2a status --human --watch` view and companion `h2a-status` window.

This design prefers an honest `J? I? L0 · gw ?` over a confident-looking false zero. PR #42 is a strong foundation, but its narrow bar is not accepted unchanged.

## D1 — Admission rule

A candidate enters the narrow bar only if all three answers are positive:

1. **Actionable:** seeing it can change what the owner does in the next minute.
2. **Fits:** it has a terse, unambiguous rendering. Detail that makes the count actionable can remain one gesture away.
3. **Truthful:** the value and its scope have an authoritative source. Missing, malformed, stale, ambiguous, or unattributable data is absent or explicitly unknown, never inferred.

There are two costs. Read cost is CPU, subprocess, filesystem, or local HTTP work on every refresh. Attention cost is the width and interpretation the owner pays continuously. A cheap signal can still be refused because its attention cost is not worth its value.

## D2 — Candidate signal decisions

The `Current read cost` column describes the best authoritative source available in the assessed tree, not permission to run every source on every bar refresh.

| Candidate | 1. Actionable in the next minute? | 2. Does it fit the narrow bar? | 3. Can it be established truthfully? | Current read cost | Decision |
|---|---|---|---|---|---|
| Exact managed tmux session state | Yes. `absent` means the target/install is wrong; `unknown` means tmux could not be inventoried. | Yes, but only exceptional state needs a word. A present empty session is represented by explicit zeroes. | Yes, from one exact tmux inventory. A requested name missing from a successful inventory is absent; a failed inventory is unknown. | One shared `tmux list-sessions`, O(number of tmux sessions). `tmux -V` is unnecessary if list failure is classified. | Keep as the guard for every other segment. |
| Gateway posture (`off`, `on/idle`, `active`, `429`, `unavailable`, `unknown`) | Yes for `off`, `429`, `unavailable`, and `unknown`; `on` confirms the expected lane is available. | Yes: `gw <state>`. | Yes from exact launch posture plus the exact client-session gateway snapshot. Stale `active` or expired `429` becomes unknown. | One exact in-memory/local endpoint read with a hard timeout; it must not fetch the full ledger. | Keep. |
| Requested model → upstream model actually dispatched | Yes. An unexpected alias or unsupported route is a stop-and-diagnose event. | Conditionally. The full ids fit only at wider widths; the entire route is omitted when it does not fit. | Yes only when attached to the routing object used for the actual outbound request. A catalogue lookup performed by the renderer is intent, not execution evidence. | No extra I/O once the exact gateway snapshot is read. | Keep at wide/medium widths when proven; otherwise omit, never guess. |
| Plugin `h2a_run` executions delegated on the owner's behalf | Yes; this is the most valuable ambient work signal. It changes whether the owner waits, inspects, or delegates again. | Yes as part of `J<open>[!<attention>]`; names remain in detail. | **Not in PR #42.** The MCP launch becomes an ordinary background `h2a run` and persists `sessionClass:"background"`, but no launch origin or delegator. Until provenance and lifecycle are recorded, its numeric count is not knowable. | One registry/projection read plus exact lifecycle proof; O(attributable executions). No mutating reconciliation. | Admit `J` to the design, but render `J?` or omit it until provenance exists. Never substitute `A` or `D`. |
| `h2a delegate` registry jobs | Yes for pending, running, throttled, failed, or awaiting action. | Yes in the same `J` total; detail distinguishes origin. | Job records carry `role:"job"`, `jobState`, `callbackTo`, and parent fields, but state can be stale after a crash. The projection must preserve read diagnostics and verify lifecycle without mutation. | One registry parse shared with plugin launches, plus bounded local liveness/result probes, O(jobs). | Include in `J` only with the same attribution and freshness rules. |
| All managed sessions/jobs (`A`) | No. The owner's current terminal and unrelated local sessions inflate the number without identifying delegated work. | The token fits, but its semantics do not. | No as “active work”: attached/detached proves tmux client attachment, not that an agent is working; registry reads can also silently collapse corruption to `[]`. | tmux inventory, registry reads, and per-row liveness probes. | Refuse. PR #42 must remove `A` from the narrow bar. |
| Addressable subagent bindings (`D` in PR #42) | No. A static binding count does not change the next action. | It fits, but consumes a scarce slot with inventory. | Binding and revocation state is readable; execution and liveness are not implied. | Full subagent, audit, instance, and identity-alias JSONL reads. | Refuse from the bar; optional inventory in the human view. |
| Inbox waiting count | Yes when non-zero: inspect/respond now. | Yes as `I<n>`; sender and recipient names stay in detail. | Yes only for one declared scope. This design scopes it to the exact owner instance correlated with the tmux session, plus that owner's delegated children. If correlation is absent or ambiguous, use `I?`. A workspace-global total is a different signal and must not masquerade as “my inbox.” | Recipient-scoped directory enumeration and envelope-header validation, O(waiting envelopes in scope). Current PR #42 scans every known mailbox and parses every envelope. | Keep after exact scope is implemented. The companion shows from whom, recipient, type, and age. |
| Objective loops | Yes. Open loops prevent duplicate launches; waiting-human, blocked, stalled, degraded, failed, or unattended loops demand attention. | Yes as `L<open>[!<attention>]`; names stay in detail. | Yes from `listObjectiveLoopsWithDiagnostics()`, with `loopAttendance()` for opted-in loops. “Open” is the contract; the current broad set is not called “running.” | One loops directory listing, one `state.json` per loop, and one small executor-heartbeat read per attendance-applicable loop: O(loops). | Keep. Fold attendance into `L!`. |
| Presence / process liveness | Usually no as a raw count. Knowing three processes exist rarely changes the next action without expectations or work context. | A count fits; peer names do not. | Heartbeat proves process liveness only. `activitySource:"heartbeat"` under-determines activity and may never be rendered as idle, parked, or working. MCP activity proves channel traffic, not useful work. | One JSON read per presence record, O(presence sessions). | Refuse from the narrow bar. Human view wording is provenance-aware. |
| Conductor | Only as the compound condition “pending delegated work and no proven conductor.” A standalone on/off count is not actionable. | A separate `C` wastes width; the compound condition fits in `J!`. | Not from the current `pgrep -f "jobs +conduct"`: it is host-global, not workspace-scoped, and probe failure is indistinguishable from absence. | One `pgrep` subprocess today; a truthful contract needs workspace-scoped attestation/liveness. | Refuse standalone. Fold into `J!` only after conductor truth exists; show detail in the companion. |
| Durable blockages | Yes when they concern this owner/work, but a bare global count lacks the actor/reason needed to act. | `B<n>` fits but duplicates `J!`/`L!` and loses scope. | `listBlockages()` can read records, but PR #42 has no exact owner/work correlation or de-duplication with job/loop attention. | One directory listing plus one JSON file per blockage, O(blockages). | Refuse standalone. Show scoped blockage detail; fold into `J!` or `L!` only through exact links. |
| Attendance | Yes for an opted-in open loop whose executor is unproven. | A separate token is redundant. | Yes for objective loops through fail-closed `loopAttendance()`. Generic peer “attendance” has no declared roster and is unknowable. | One heartbeat file per applicable loop. | Fold loop attendance into `L!`; refuse a generic attendance counter. |
| Account label / id | Usually no. It matters while diagnosing 429/fallback/wrong-lane behavior, not continuously. | No when route, clock, and attention counts already compete for width. | It is truthful only from the selected `PublicAccountDescriptor`; never from `basename(workspaceId)` or a credential class such as `Raw API key`. | No extra I/O once gateway snapshot is available. | Human view only. PR #42 must stop always displaying it in the bar. |
| Provider and transport | Not independently actionable in the normal case; useful for gateway diagnosis. | No alongside the exact route. | Can be carried truthfully from the selected canonical target/account. | No extra I/O once gateway snapshot is available. | Human view only. |
| Agent, job, loop, peer, and sender names | Names make detail actionable but are not themselves ambient signals. | No; cardinality and unbounded width make the bar unstable. | Often truthful, but that does not make them fit. | Already available from the detailed sources. | Human view/companion only. |
| tmux attached/detached | Usually no. It says a client is attached, not that work is happening. | Yes, but misleading beside work counts. | Truthful only about tmux attachment. The wrapper may remain while the CLI has exited. | Included in the tmux inventory. | Session metadata in detail; never count it as active work. |

## D3 — Exact semantics of admitted signals

### `J`: attributable delegated executions

`J` is not “all agents.” It is the union of executions for which the status reader can prove all of:

- the launch origin is a delegation surface (`mcp:h2a_run`, `cli:h2a-delegate`, or another explicit future origin);
- the exact delegating h2a instance or callback owner is stored, not inferred from a name;
- the execution has a stable id and a read-only lifecycle source;
- it belongs to the current exact owner scope.

PR #42's plugin path does not meet this contract. `buildH2aRunInvocation()` launches `h2a run ... --background`; `enrollFromRun()` persists only `sessionClass:"background"`. Custom names are not delegation provenance, and all background sessions must not be presumed delegated.

`J<open>` counts launching, pending, running, and other explicitly non-terminal attributable executions. `J!<attention>` counts only proven attention states, including failed, blocked, or pending work with no proven drain path. A stale or unreadable row degrades the whole narrow count to `J?`; the human view may report “at least N known, incomplete.”

The status path never runs `h2a jobs ls` reconciliation and never mutates the registry.

### `I`: exact owner inbox

The narrow count is not the sum of every mailbox under a shared `.h2a` root. The reader first establishes one unique owner identity by an exact durable link, such as the exact tmux session recorded in that identity's launch context. It then counts valid waiting envelopes addressed to that owner and explicitly linked delegated children.

Zero means the entire declared scope was read successfully. Unknown owner correlation, an orphan mailbox, an unreadable directory, a malformed envelope, or an incomplete scan renders `I?`. The companion shows `from`, recipient, type, created time, and age; none of those names appear in the bar.

### `L`: open objective loops

`L` means open, not “currently executing.” Open is every non-terminal objective loop established by the loop store. Attention includes explicit `waiting-human`, `stalled`, `degraded`, `blocked`, and failed states, plus `loopAttendance() === "unattended"` when attendance is applicable. Attendance is not inferred from ordinary peer heartbeats.

The detailed view shows loop id/name, exact state, agents, attention reason, attendance provenance, and the next owner action.

### Gateway state and route

Gateway state is correlated to the exact tmux `clientSessionId`; workspace basename and shared `local-dev` identity are forbidden. `off`, `unavailable`, and `unknown` remain distinct. Stale active/rate-limit claims decay to unknown rather than remaining asserted.

Canonical route definitions come only from the zero-argument pure read:

```text
describeCanonicalTargetRoutes()
  -> { requestedId, providerId, transportProviderId, model, effort?, kind }
```

No local default alias table is allowed. The current required facts are:

- `claude-opus-5-high` and `claude-opus-5-xhigh` target `gpt-5.6-terra`;
- `claude-fable-5-high`, `claude-fable-5-xhigh`, and `claude-fable-5-max` target `gpt-5.6-sol`;
- supported bare ids remain provider-faithful;
- `claude-opus-4-8` and `claude-opus-4-8-xhigh` resolve to nothing.

The renderer does not call the description function and call the result “actually served.” Routing code attaches the canonical target chosen for the request to the actual outbound dispatch record. The arrow's contract is exact: left is the inbound requested id; right is the model written to the upstream request. Before outbound dispatch establishes that fact, omit the arrow. A faithful route may collapse to one exact model id at reduced widths; an alias retains both full ids or disappears as a unit.

An explicit operator override such as `OPENAI_MODEL_MAP` is not a copied default map. If retained, its provenance must be carried with the actual route and shown in the human view.

## D4 — Absent, empty, unknown, and zero

These states are not interchangeable:

| Situation | Narrow rendering | Meaning |
|---|---|---|
| Exact requested managed tmux session is absent after a successful inventory | `h2a absent` and `gw n/a` | There is no target session. No workload zeroes are emitted. |
| tmux inventory failed | `h2a ?` and `gw ?` | Session existence is unknown. |
| Managed tmux session exists, but no unique h2a owner identity can be correlated | Owner-scoped signals such as `J? I?`; independently readable `L`/`gw` may remain known | A running shell is not proof of protocol ownership. |
| Session and all declared sources exist and were read completely, with no items | `J0 I0 L0` plus exact gateway state | Established empty. This must remain visibly different from absence. |
| One source is unreadable, malformed, stale, ambiguous, over its bounded read budget, or lacks provenance | That source's token is `?`, e.g. `I?`; known sibling tokens remain | Unknown, never zero. |
| Partial data is readable | `?` in the bar; “at least N known, incomplete” in detail | A partial count is not an exact count. |

A missing collection directory may mean zero only when its store contract explicitly defines missing as an empty initialized collection and the enclosing owner/store is established. A missing `.h2a` root does not establish zero.

PR #42 implements useful top-level distinctions (`h2a absent`, `h2a ?`, per-source `?`) but does not close the rule: `loadRegistry()` maps a missing or corrupt runtime registry to `[]`, which can produce a false managed-work zero.

## D5 — Narrow bar versus opt-in detail

The earlier sketch's conceptual split is right: the bar is an index; `h2a status --human --watch` and the optional `h2a-status` tmux window carry the inventory. The exact prior contents are not right.

Changes to the earlier proposal:

- replace `A<active>!<attention>` with attributable `J<open>[!<attention>]`;
- keep `L`, but call it open loops and include proven unattended loops in `L!`;
- add scoped `I`;
- remove addressable-binding `D`;
- retain compact gateway state and conditional exact route;
- move normal account/provider/transport data out of the bar;
- do not duplicate the session name inside renderer output when native tmux identity already displays it.

Width reduction is priority-based and display-column-aware, not JavaScript string-length truncation:

1. retain unknown and attention tokens (`J?`, `J!`, `I?`, non-zero `I`, `L?`, `L!`) and exceptional gateway states (`429`, `off`, `unavailable`, `?`);
2. retain the `J/I/L` base counts so present-empty stays distinct from absent;
3. retain healthy gateway state;
4. add the exact route only if the whole route fits;
5. never abbreviate model ids, names, or values into strings that could mean another real id.

The companion view contains:

- exact delegated execution ids, origin/delegator, tool, state, age, and attention reason;
- inbox sender, recipient, type, and age;
- loop name/id, status, agents, attendance, blockage/decision reason, and next action;
- gateway requested id, dispatched upstream model, effort, route kind/provenance, provider, transport, account, fallback, retry, and timestamps;
- presence as process/channel evidence with provenance.

Presence wording is mandatory: `activitySource:"heartbeat"` renders **process alive; activity unproven**. It never renders idle, parked, active, or working. `activitySource:"mcp"` means recent protocol traffic, not proof of useful work.

## D6 — The live `remote-` prefix is resolved now

Dual-read/single-write compatibility is necessary but does not correct the owner's screen. A live `remote-h20` remains `remote-h20` indefinitely unless someone explicitly renames it.

PR #42 already contains the correct explicit, journalled, collision-refusing, reversible operation. After PR #42 is deployed, the owner runs:

```text
h2a tmux migrate-names --dry-run
h2a tmux migrate-names --apply
```

If the dry run reports a collision, do not apply until it is resolved; the legacy name remains intact. The rename uses the live tmux session identity, so the attached client should remain attached, but the visible session name changes. No upgrade, launch, attach, or status install may perform this rename as a side effect. Rollback is explicit:

```text
h2a tmux migrate-names --rollback
```

Existing/reused sessions also do not automatically receive PR #42's bar. After a successful rename, the owner explicitly installs it on the new exact name:

```text
h2a tmux status install h2a-h20
```

If the owner wants the bar before renaming, the exact command is `h2a tmux status install remote-h20`. New sessions use `h2a-` and install the surface on creation. Nothing in this design kills, reattaches, or silently renames a live session.

## D7 — Read cost and refresh budget

The default ambient refresh remains approximately five seconds. The accepted path is local, bounded, read-only, and segment-specific. It performs no control-plane call and no mutating reconciliation.

| Accepted signal | Required source and target cost | Cost verdict |
|---|---|---|
| Session guard | One shared exact tmux inventory, O(tmux sessions). | Worth it; required to distinguish absent from empty. |
| `J` | One diagnostic-preserving registry/projection read plus bounded lifecycle checks for attributable executions, O(J). | Worth it. Reuse the inventory; do not count ordinary sessions. |
| `I` | Enumerate and validate envelope headers only in the exact owner scope, O(scoped waiting envelopes/bytes). | Worth it only while bounded. If the measured budget is exceeded, use `I?` until an authoritative indexed projection exists; do not scan all mailboxes unconditionally. |
| `L` | List loops, read one state file per loop, and attendance heartbeat where applicable, O(L). | Worth it. |
| `gw` and route | Exact client-session in-memory/local read, O(1), with a 400 ms source timeout and no full-ledger download. | Worth it. A timeout produces `gw unavailable/?`, not a stalled bar. |
| Human-only presence | O(P) presence files. | Not charged to the narrow path. Read only in the detailed view. |
| Human-only bindings | O(JSONL history bytes). | Not charged to the narrow path. |
| Human-only blockages | O(B) blockage files. | Not charged to the narrow path unless exact links fold a result into `J!`/`L!`. |
| Human-only conductor diagnostic | Current one-process `pgrep` is insufficiently scoped. | Not charged to the bar until a truthful attestation exists. |

PR #42 does not meet this cost model. It installs two `#(...)` commands every five seconds. Both create a Node process and execute nearly the full snapshot pipeline before rendering one segment. Across the two calls this includes duplicate tmux inventory, duplicate registry reads and per-row tmux liveness probes, duplicate launch-context option reads, duplicate presence/subagent/inbox/loop scans, and one gateway call that downloads all session-ledger entries with a 400 ms timeout. Static inspection yields roughly twenty fixed tmux subprocesses per refresh pair, plus per-registry-row probes, two full local-store scans, two cold starts, and one HTTP read. There is no latency or scaling measurement.

Implementation must make the readers truly segment-specific or acquire one shared snapshot. Gateway rendering must not trigger presence, inbox, loops, bindings, or managed-work scans. Workload rendering must not read gateway/account detail.

No cache is approved by assumption. First measure cold start and p50/p95 latency on the owner's target machine with empty, typical, and stressed stores. The target is no overlapping five-second invocations, a p95 healthy refresh below 250 ms per segment, and a hard per-invocation deadline below one second. Only a measured miss may justify a short-TTL atomic cache; the cache must preserve unknown versus zero and may never convert stale data into a current claim.

## D8 — O5 gateway source baseline

The baseline is now established:

1. `origin/main@0f285c2` contains no tracked `flow-bridge.ts`/`flow-bridge.js` and no `updateTmuxStatus()` in source.
2. `refs/stash` from 2026-07-16 defines `updateTmuxStatus()` in `proxy-anthropic.ts`, but the stash has no coherent flow-bridge source. That function derives `remote-<basename(workspaceId)>` and overwrites `status-right`.
3. The owner's dirty main checkout contains an ignored generated `packages/h2a-runtime/dist/llm-gateway-runtime/flow-bridge.js` that calls the stash-only symbol. It passes provider as upstream model and `rotating...` as a fallback label. Current source does not export the symbol. This file is orphan drift, not source truth.
4. PR #42 does not resurrect either artifact. It instruments the tracked direct proxy through `session-ledger.ts`, exact `clientSessionId`, and a typed status projection. That is the coherent implementation baseline.

O5 is therefore resolved for design: build only on the tracked direct proxy/ledger path rooted at `0f285c2` plus the reviewed PR changes. Never promote the stash or ignored `dist` file.

One release risk remains: a dirty build/package flow that does not clean `dist` can still package an orphan ignored file because the runtime publishes the whole `dist` directory. PR #42 needs a clean-from-source build/package gate or equivalent proof that stale generated files are absent. This design pass does not delete the owner's ignored artifact.

## D9 — Routing authority and current drift

PR #42 correctly upgrades both gateway consumers to `@sentropic/llm-gateway@0.10.0` and imports `describeCanonicalTargetRoutes()`. Its full-catalogue comparison test is the right pattern.

PR #42 still contains contradictory local assertions and documentation. In particular, both model-catalog test suites assert that bare `claude-opus-4-8` is faithful, while the current authority says `claude-opus-4-8` and `claude-opus-4-8-xhigh` resolve to nothing. `apps/llm-gateway/SPEC.md` also carries obsolete route prose.

Those copied answers must be removed or updated. Tests may assert invariants against `describeCanonicalTargetRoutes()` and the current owner-required examples, but they must not create a second default route catalogue.

The installed dependency in the owner's present checkout is older than the PR's locked 0.10.0 and does not expose the function, so this design did not use it as authority. PR #42's manifest/lock plus the stated 0.10.0 contract define the implementation baseline; verification must install the locked dependency in a clean checkout.

## D10 — PR #42 against this specification

### What PR #42 already satisfies or materially advances

| Area | Assessment |
|---|---|
| Prefix writer/reader | Satisfies: new names use `h2a-`; legacy `remote-` remains reader-only compatibility. |
| Live-name correction mechanism | Satisfies mechanism: explicit dry-run/apply/rollback migration is journalled and collision-refusing. It does not itself change the owner's screen until the owner runs it. |
| Existing-session status install | Satisfies mechanism: explicit exact/all install exists. It is correctly not an implicit live-session mutation. |
| O5 source baseline | Satisfies source choice: direct proxy plus ledger, no stash/flow-bridge resurrection. Clean-package proof remains. |
| Canonical route source | Substantially satisfies: both model catalogues call zero-argument `describeCanonicalTargetRoutes()` from 0.10.0. Copied stale assertions/docs remain. |
| Gateway session identity | Satisfies for ordinary, custom-name, fan-out, and delegated-job launch paths: prospective exact tmux name becomes `clientSessionId`; workspace basename is no longer identity. |
| Gateway field truth | Substantially satisfies: route fields come from `RoutingTarget`, selected/fallback account from `PublicAccountDescriptor`, generic account labels fall back to stable id, overlapping requests suppress ambiguous detail, and stale claims become unknown. The strict outbound-dispatch evidence required by this spec remains to be attached. |
| Absent/unknown rendering | Substantially satisfies: absent, unknown, per-source degradation, stale gateway, and overlapping-route uncertainty are explicit. Corrupt runtime registry to false zero remains. |
| Inbox and loop detail | Foundation satisfies: envelope sender detail and objective-loop detail exist in the human view. Inbox scope and loop attendance need correction. |
| Narrow/detail separation | Foundation satisfies: names are mostly kept in the human watcher and optional companion. Fixed-width tiers and the accepted signal selection are missing. |
| Tmux option ownership | Satisfies: existing clock/right content and prior tmux options are captured/restorable through an install transaction. |
| Frozen bare status | Satisfies intent: additive flags are intercepted without changing bare machine-first `h2a status`. |

### What PR #42 must change

1. Replace bar `A` and `D` with the `J` contract. Persist plugin `h2a_run` origin, exact delegator/owner, stable execution id, and a diagnostic-preserving lifecycle projection. Until then show `J?` or omit it.
2. Stop treating attached/detached local tmux sessions as active work.
3. Make corrupt/missing runtime registry state unknown instead of `A0`/`J0`.
4. Scope `I` to the exact owner and linked delegated children, or explicitly label a workspace-global count in detail. Do not put the current global total in the narrow bar.
5. Define `L` as open loops and fold fail-closed loop attendance into `L!`.
6. Keep presence out of the bar and replace heartbeat-derived “reachable” wording with “process alive; activity unproven” in detail.
7. Remove normal account/provider/transport fields from the bar. Keep them in the companion.
8. Bind the displayed upstream model to the actual outbound dispatch record, and use the package route description as the only canonical default source.
9. Remove/update stale `claude-opus-4-8` assertions and obsolete route prose.
10. Implement display-column-aware priority tiers; never rely on fixed tmux length limits or scalar truncation as width handling.
11. Replace two duplicated full projections with segment-specific reads or one shared measured snapshot. Do not add a cache until target-machine measurements justify it.
12. Prove clean generated packaging so the orphan ignored flow-bridge cannot ship.

Plain verdict: PR #42's narrow bar displays two signals this specification rejects (`A` and `D`), displays a global `I` without saying so, always spends width on account detail, and performs unmeasured duplicated polling. Its `L`, gateway ledger, exact session identity, migration command, absent/unknown grammar, and opt-in companion are the right foundations. The PR should not be accepted unchanged against this signal-set design.

## Peer-review reconciliation

Two independent adversarial reviews examined user value/truth semantics and PR/O5/data provenance. They agreed that `A` and `D` fail the owner's delegated-work need, inbox scope is undefined, heartbeat is only process liveness, the current bar has no real width tiers, and PR #42's polling cost is duplicated and unmeasured.

One review preferred an event-published O(1) gateway snapshot; the other emphasized making the present polling paths segment-specific. This design fixes the observable contract rather than selecting an implementation prematurely: the gateway read must be exact-session O(1), local, bounded, and must not trigger unrelated scans. Whether the snapshot is read from an exact endpoint or event-published local projection is reversible and must be chosen after target-machine measurement. No cache is assumed.

## Acceptance for the next implementation pass

The status surface is ready only when all of the following are demonstrated in a clean checkout rebased on the selected base:

- `J` can prove plugin and CLI delegation origin, exact owner, stable id, and lifecycle; no number is inferred from names or generic background sessions;
- `I` has an explicit exact owner scope and reports malformed/ambiguous/incomplete data as unknown;
- `L` means open loops and includes proven unattended loops in attention;
- heartbeat-only presence is never described as activity, idle, parked, working, or reachability of the protocol channel;
- gateway routes come from the 0.10.0 description at routing time and the displayed upstream model is the model actually dispatched;
- `claude-opus-4-8` and `claude-opus-4-8-xhigh` have no default route, with no contradictory local map/test/doc;
- absent, empty, unknown, partial, and zero fixtures are distinct for every source;
- wide/narrow fixtures are measured by display columns and preserve the priority order;
- a five-second bar refresh is read-only, bounded, source-specific, measured on the target machine, and does not overlap itself;
- the owner can explicitly migrate `remote-h20` and install the bar without a kill, rename side effect, or reattach;
- a clean build/package contains no stale flow-bridge artifact;
- bare `h2a status` remains unchanged.
