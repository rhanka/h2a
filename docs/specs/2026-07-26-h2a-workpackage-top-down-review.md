# h2a workpackage structure — top-down review

> **Status:** analysis and recommendation for the owner; not a decision and not an apply plan.
>
> **No Track mutation:** this review performed read-only Track queries and code inspection. It did not
> write to `.track/`, stage, commit, stash, switch the owner's checkout, or run a Track append verb.
>
> **Review clone:** `/home/antoinefa/src/h2a/tmp/worktrees/wp-review-sol`
>
> **Base:** `0f285c27877a332af5ffe555f5c16b556b02781c` (`origin/main`), detached.
>
> **Independent leg:** top-down from the container criterion. It does not attempt to anticipate the
> separate bottom-up item review.

## Recommendation in one page

[JUDGMENT] The product report should have **13 top-level product-theme WPs**:

1. retain the already-ratified eleven themes (`Protocol & envelopes` through `Memory & context`);
2. retain one broadened **Integration & connector federation** WP, using existing item
   `01KXDPBQY1X66M7ZRK72D34S56`;
3. retain one **Native agent runtime & CLI** WP, using existing item
   `01KXDPBR505FKNV9XCZ45P638H`;
4. move `Host operator capability parity & gap governance`
   (`01KY7CAYTVW4PVGQ0D552EENDG`) under `Execution & runtime` as a **lot**, not a top-level theme;
5. stop presenting the two completed spec records, the two foreign-workspace records, and task-shaped
   records as product WPs.

[FACT] This is a recommendation only. Track currently has no item-delete verb and no supported
container-to-leaf demotion. `item set-role` is deliberately limited to
`workpackage ↔ stream`; it cannot remove a role or change a `spec-phase`
(`packages/track/src/cli/index.ts:72-80,598-603`;
`packages/track/src/ingest/contract.ts:339-349`;
`packages/track/src/track.ts:398-436`). In the verdict table, **DELETE** therefore means “remove from the
WP roster while preserving its evidence,” not “erase append-only events.” No such action is authorized by
this document.

The decisive reporting test is:

> **If all current children finished tomorrow, would this container still name a product concern to which
> independent future lots will be assigned, and would its percentage still answer a stable owner question?**

If yes, it can be a WP. If it names a bounded result, study, fix, migration, spec, or one delivery wave, it
is an item or lot. A role marker alone does not make it a legitimate WP.

## 1. Criterion — what is a workpackage here?

### 1.1 What Track actually stores

[FACT] Track does not persist five different aggregate kinds named `spec`, `plan`, `wp`, `lot`, and
`task`. Everything is an `Item`. The optional role is one of
`workpackage | spec-phase | stream`
(`packages/track/src/model/item.ts:16-31,60-78,105-128`).

[FACT] The status levels are read projections:

- `task` = a non-role leaf;
- `wp` = every role-container in the forest;
- `spec` and `plan` = the same root-container tier;
- `lot` = nested container depth one or deeper.

This is explicit in `packages/track/src/report/status-by-level.ts:1-21,140-182`. A “lot” is therefore not a
separate stored type: structurally, it is a container nested below another container. A top-level
`spec-phase` can currently be rendered with a `WP<n>` label even though it is not a
`role:'workpackage'`.

[FACT] Rollup percentages are computed from transitive, non-container leaves:
`done / active`, dropped leaves excluded, and `0/0 ⇒ n/a`
(`packages/track/src/report/status-by-level.ts:69-104`;
`packages/track/src/report/rollup.ts:282-327`). Role-containers themselves are deliberately excluded from
flat buckets (`packages/track/src/report/build.ts:217-230`).

### 1.2 The top-down acceptance test

A legitimate product WP must pass all six tests:

1. **Durable owning concern.** It owns a product artifact, capability, or responsibility expected to
   receive past and future work. Its charter survives any current release.
2. **Stable boundary.** It says what is inside and names the neighbouring WP for what is outside. “And
   also…” is evidence of two concerns or an unmade split.
3. **Independent owner question.** Its rollup answers a recurring question the owner actually pilots,
   such as “is truthful presence healthy?” A single-ticket 0/100 switch is not a useful roadmap percentage.
4. **Several possible lots over time.** One current leaf is acceptable only if the concern clearly has an
   independent future pipeline; otherwise it is a task wearing a container role.
5. **Report honesty.** Every counted unit is comparable enough that `done / active` means something.
   Empty role-containers may not hide open work from the denominator.
6. **Structural integrity.** It belongs to the project workspace, is addressed by ULID or durable code,
   and does not depend on unstable positional labels.

This criterion is consistent with the ratified x8 criterion recorded on
`01KWVNY117D60MY6YWNN78Y60X`: “WP = themes PERENNES … PAS des jalons” and full past-to-future coverage
(`.track/events.jsonl:251,260-262`). The eleven theme records also carry explicit owning concerns and
boundaries (`.track/events.jsonl:263-273`).

### 1.3 A percentage is a claim

[FACT] `track_status(level=wp, requireAccepted=false)` currently exposes 67 role-containers. Cross-checking
the three role queries finds:

- 23 `workpackage` records;
- 40 `spec-phase` records;
- 4 `stream` records;
- **48 containers with no leaf:** 5 workpackages, all 40 spec-phases, and 3 streams.

The audit reports only `role === 'workpackage'` as `empty-wp`
(`packages/track/src/report/audit.ts:107-125`). It does not report the 40 empty spec-phases or three empty
streams.

[FACT] This explains an apparent contradiction in the owner's report. WP5 says `6/6 = 100%`, while its
status subtree includes fifteen open task-shaped spec-phases at `n/a`. WP10 says `8/9 = 89%`, while many
open task-shaped spec-phases also contribute zero to its denominator. The percentages are correct for the
leaves the algorithm counts; they are incomplete as claims about all visible open records.

[JUDGMENT] A restructuring that only cleans titles, while leaving bounded tasks as zero-leaf containers,
would make the tree prettier without making the report more truthful. That is a regression.

## 2. Evidence quality and corrections to the supplied snapshot

### 2.1 Current audit: five empty WPs, not six

Read-only command, from the protected checkout:

```text
TMPDIR=/tmp track audit --format text
track version: 0.85.18
```

[FACT] The observed result contains 9 findings:

- 2 `orphan`, severity `action`;
- 5 `empty-wp`, severity `action`;
- 1 `cross-workspace-subtree`, severity `info`;
- 1 `singleton-workspace`, severity `info`.

That is **7 action findings**, not 6. The five empty WPs are:

| id | title |
|---|---|
| `01KY4Y2NGQ23RWGBYFFWSM7GCN` | Native-plugin control plane |
| `01KY564R6XWB0EJHSE04ZRP8MH` | Fix: tmux status surface |
| `01KWANHGP9R0GCFK3Y276CS1FM` | Mapping CLI finalisé |
| `01KWVM4Z4S0VEFRM80C03NDSYX` | Support Hermes/OpenCode/etc |
| `01KWVNY117D60MY6YWNN78Y60X` | WP-ROADMAP study |

The two orphans are `01KY66T20YS7JEQP73999VPVFJ` and
`01KY7JXXGXTWC0VVVDKS5XSE7K`.

[FACT] I could not establish a sixth current `empty-wp`. The supplied “six” must not be silently repeated
as if verified. The wider empty-container count is 48 because the audit intentionally does not detect empty
spec-phases or streams.

### 2.2 Labels are inconsistent between projections

[FACT] The inconsistency is confirmed:

| stable item id | durable assigned code | `track_status(level=wp)` | child row in `track_query` |
|---|---:|---:|---:|
| `01KXDPBQY1X66M7ZRK72D34S56` | `WP12` | `WP14` | `WP12` |
| `01KXDPBR505FKNV9XCZ45P638H` | `WP13` | `WP15` | `WP13` |

The code assignments are persisted at `.track/events.jsonl:442-443`. The cause is visible in code:
`computeWpTree` honors a container's durable `code`
(`packages/track/src/report/rollup.ts:330-373`), while `statusByLevel` assigns root labels from fresh
`WP<n>`/`S<n>` counters and does not read `code`
(`packages/track/src/report/status-by-level.ts:164-170`). The two top-level spec-phases also consume
positional WP ordinals in `track_status`.

[JUDGMENT] No structural claim should cite “WP12”, “WP14”, “WP13”, or “WP15” alone. Until the projections
converge, cite the ULID and title; otherwise two correct read tools appear to disagree about the same
container.

### 2.3 The roadmap study did produce work

[FACT] The x8 study is not output-free:

- `docs/specs/2026-07-06-wp-perennial-restructuring-PROPOSAL.md`;
- `docs/specs/2026-07-06-wp-restructuring-REPARENT-PLAN.md`;
- `docs/specs/scope-to-theme.map.json`;
- `docs/specs/wp-coverage-report.md`;
- commits `c918633`, `d273dfd`, `907d8aa`, and `f6f723a`;
- reparent events referencing the plan, for example `.track/events.jsonl:358-360`.

The proposal defines the perennial criterion and eleven themes
(`docs/specs/2026-07-06-wp-perennial-restructuring-PROPOSAL.md:12-34,94-133`). The events created those
eleven themes with owning-concern bodies (`.track/events.jsonl:263-273`).

[FACT] The records disagree about completion: the proposal still says “NOT APPLIED”
(`...PROPOSAL.md:3-8,226-236`), the reparent-plan says the eleven were ratified but contains `MISSING`
theme IDs and no populated direct-child table
(`...REPARENT-PLAN.md:1-25`), while the event log shows the reparent apply. Track still projects the study
itself as `to-do`, empty, and `n/a`.

[JUDGMENT] The correct conclusion is not “the study never started.” It produced and partly applied the
current structure, but its realization and artifacts were not reconciled into one trustworthy completion
record.

### 2.4 The foreign-workspace facts

[FACT] Read-only workspace activity at `2026-07-26T18:00:00Z` reports:

```text
workspace ws:4471ea0c…: pending=0, pendingItems=[], stalled=[],
latestEventAt=2026-07-22T15:12:10.974Z
```

WP16 and WP17 were created in that workspace
(`.track/events.jsonl:522-537`). Both are zero-leaf top-level containers in the global status projection.
“Zero pending” does not mean their bodies and acceptance criteria are valueless: workspace activity counts
open leaves, and these records are containers.

[FACT] The `cross-workspace-subtree` finding on WP5 is not caused directly by the two foreign roots.
The concrete foreign leaf under WP5 is completed item
`01KXA2TRS5CS633PCGXQ5TYF1W`, “tmux launch context + gateway 5.6 model mappings.”
WP17's body identifies itself as that item's successor
(`.track/events.jsonl:537`). The exact causal history beyond those records is not established.

## 3. Mechanical verdict on the 18 displayed WPs

“WP<n>” below is the `track_status` label only. The ULID is authoritative.

| displayed label · id | current fact | verdict | criterion reason and target |
|---|---|---|---|
| WP1 · `01KWWXBMWJ6HQN86M5RQ1ZMJ4A` | Protocol & envelopes · `1/1`, 100% | **KEEP AS IS** | Durable wire-contract concern with an explicit boundary to presence and record; its event body covers past and future (`.track/events.jsonl:263`). |
| WP2 · `01KWWXCC4NNP5XP45NFY6T3BTR` | Addressing & presence · `11/14`, 79% | **KEEP AS IS** | Truthful reachability/presence remains a recurring product question; distinct from protocol and identity (`.track/events.jsonl:264`). |
| WP3 · `01KWWXCCC1JB0Z4YFW04Q2WSEG` | Coordination & loop · `10/12`, 83% | **KEEP AS IS** | Owns active coordination, drumbeat, wake, objective loop, and anti-stall; excludes governance and transport (`.track/events.jsonl:265`). |
| WP4 · `01KWWXCCM1GPD7ZCXTQAX7NTSB` | Governance & RACI · `5/8`, 63% | **KEEP AS IS** | Durable authority/RACI/policy concern with an identity boundary (`.track/events.jsonl:266`). |
| WP5 · `01KWWXCCTW1JFPYY0SYD8NFQHD` | Execution & runtime · `6/6`, 100% | **KEEP AS IS structurally; correct its boundary** | Keep the generic execution substrate and external-host lifecycle. Remove “native h2a agent” from its exclusive charter so the owner-approved Native WP is not double-counted. Merge WP18 below it as a lot. |
| WP6 · `01KWWXCD0V5V0M8JJ8MT78HCZ0` | Identity, auth & NHI · `4/5`, 80% | **KEEP AS IS** | Durable identity, keys, proof, auth, and NHI lifecycle concern; distinct from presence (`.track/events.jsonl:268`). |
| WP7 · `01KWWXCD5BN2G3D97S07HS5JMN` | Infra, deploy & MCP · `4/9`, 44% | **KEEP AS IS with a narrower integration boundary** | Keep deploy, hosting, transport, gateway/mesh, and connector wiring substrate. Product-level connector sharing/enrollment belongs to Integration. |
| WP8 · `01KWWXCD9PYZZBZR5E6JQAK6T6` | Tracking & record · `2/2`, 100% | **KEEP AS IS** | Durable append-only record/report/decision/acceptance concern. It is also the correct parent for the completed decision-cockpit spec and the WP-structure study (`.track/events.jsonl:270`). |
| WP9 · `01KWWXCDE8F42NCMVZBWXGAY4X` | Method & harness · `2/3`, 67% | **KEEP AS IS** | Durable development-method artifact and scope/review/test discipline, explicitly separate from recording its results (`.track/events.jsonl:271`). |
| WP10 · `01KWWXCDJJ5MJ141ZRW52AAQ7Q` | Distribution, CLI & packaging · `8/9`, 89% | **KEEP AS IS with a native-runtime boundary** | Keep front-door syntax, install, packaging, publication, compatibility, and release. Native agent behaviour and main-loop semantics are outside; the completed mapping record becomes an item here. |
| WP11 · `01KWWXCDPTGK8090MRSR3G9D3W` | Memory & context · `0/1`, 0% | **KEEP AS IS** | The current percentage is binary, but the owning concern is explicitly perennial, multi-session memory/context, and was separately ratified (`.track/events.jsonl:273`). Revisit only if the future pipeline fails to materialize. |
| WP12 · `01KX7HY6B695P5FK1QMXA7C6WZ` | `role:'spec-phase'`; completed decision-cockpit spec; `n/a` | **DEMOTE from top-level; item/spec under WP8** | It is a bounded completed specification with evidence, not a perennial concern (`.track/events.jsonl:374-379`). Preserve its artifact/evidence under Tracking & record. |
| WP13 · `01KX944X2B7CC0E6D4BR41E03Q` | `role:'spec-phase'`; completed sentropic-enrollment spec; `n/a` | **DEMOTE from top-level; item/spec under Integration** | It is a bounded design and dossier, not the integration capability itself (`.track/events.jsonl:380-385`). |
| WP14/status · `01KXDPBQY1X66M7ZRK72D34S56` | durable code `WP12`; MCP brokering; `0/1`, 0% | **KEEP AS IS structurally; recharter as the one Integration WP** | Connector federation is durable, but one leaf makes today's percentage binary. Bring the known sentropic/MCP integration records into one boundary so the rollup answers “is h2a integration-ready?” rather than “did one ticket finish?” |
| WP15/status · `01KXDPBR505FKNV9XCZ45P638H` | durable code `WP13`; native runtime via sentropic; `0/1`, 0% | **KEEP AS IS structurally; recharter Native agent runtime & CLI** | The owner has established this as a complex independent capability. Remove “via sentropic” from the owning concern; sentropic enrollment is Integration, not the identity of the native runtime. |
| WP16 · `01KY4Y2NGQ23RWGBYFFWSM7GCN` | foreign workspace; no leaf; `n/a`; many criteria | **DELETE from the project WP roster, after splitting/preserving its content** | Its body combines coordination/wake (WP3), host execution/control (WP5), distribution/guard work (WP10), and conformance (WP18 lot). One mixed, foreign, empty root cannot yield an honest percentage. |
| WP17 · `01KY564R6XWB0EJHSE04ZRP8MH` | foreign workspace; bug wearing WP role; no leaf; `n/a` | **DEMOTE to a project-workspace bug under WP5** | The title and body name one bounded rendering/data-feed fix and successor evidence, not a durable concern (`.track/events.jsonl:537`). Preserve the predecessor link and test requirements. |
| WP18 · `01KY7CAYTVW4PVGQ0D552EENDG` | Host parity/gap governance; `0/7`, 0% | **MERGE into WP5 as a lot** | Its seven leaves make the 0% useful, but the concern is a bounded execution-host parity wave within generic Execution & runtime. Nesting preserves the useful lot rollup while preventing another top-level product theme. |

### Why WP18 is a lot, not a thirteenth/fourteenth independent seam

[JUDGMENT] The capability contract, adapter guide, host probes, and host-specific guards form a coherent
delivery wave. They are valuable enough to retain as a nested rollup. They do not own a product capability
outside execution across hosts. Reparenting the existing workpackage under WP5 uses Track's actual
lot-by-depth model and keeps `0/7` visible without claiming a new top-level product theme.

The counter-argument is strong: a normative cross-host contract and conformance suite can have a distinct
owner and recur whenever hosts change. If the owner intends to pilot that percentage independently across
several release waves, WP18 passes the perennial test and should remain top-level. That owner intent is not
established in the record; the current seven leaves were created as one concentrated wave
(`.track/events.jsonl:555-563`).

## 4. Direct answer — does the native CLI/native agent runtime deserve its own WP?

**Yes. Keep `01KXDPBR505FKNV9XCZ45P638H` as a separate product WP, but recharter it.**

### Inside

- the first-party h2a agent's main loop and orchestration semantics;
- native agent state, recovery/resume, tool policy, and resource governance;
- the runtime contract that chooses local, remote-k8s, or in-sentropic placement;
- native operator/runtime commands where their semantics are unique to this first-party agent;
- first-party gateway/runtime behaviour needed to operate that agent.

### Outside

- generic external-host adapters and shared `run/attach/stop/logs/resume` substrate → **WP5 Execution &
  runtime**;
- CLI grammar, command mapping, install, packaging, publication, release, and compatibility surface →
  **WP10 Distribution, CLI & packaging**;
- sentropic enrollment, workspace binding/alignment, connector registry/sharing, and cross-system policy →
  **Integration WP**;
- k8s/OCI/SCW deployment and connector/gateway hosting substrate → **WP7 Infra, deploy & MCP**;
- protocol-level drumbeat, wake, and objective-loop semantics → **WP3 Coordination & loop**.

### Why WP5=100% and WP10=89% do not already answer it

[FACT] The original WP5 body explicitly included “native h2a agent,” and WP10 owns the CLI front door
(`.track/events.jsonl:267,272`). This is the strongest case against a new WP: by the old taxonomy, the
work is already covered and a new container risks double-counting.

[FACT] The displayed numbers do not settle that argument. WP5's `100%` counts six done leaves while
fifteen open empty spec-phases contribute nothing. One of the six is also a foreign-workspace leaf. WP10's
`89%` excludes its many empty task-shaped spec-phases. These numbers establish only the state of counted
leaves, not that a first-party agent product has been delivered.

[JUDGMENT] The owner-provided criterion—“c'est une capacité complexe”—and the independent first-party
artifact/main-loop lifecycle justify a separate owning concern. To avoid a less honest report, the WP5 and
WP10 boundaries must be corrected at the same time. Creating the new WP while leaving their old charters
unchanged would be a duplicate scope, not a clean split.

### Strongest counter-argument and falsifier

**Counter-argument:** the native CLI may turn out to be only a thin command surface over the generic WP5
runtime, shipped by WP10. If it has no independent state machine, owner, release risk, or multiple future
lots, a separate 0/1 WP is taxonomy inflation.

**What would falsify the recommendation:** architectural evidence that the native product has no
independent main loop/state/recovery/runtime contract and cannot be decomposed into at least two coherent
lots without duplicating WP5/WP10. In that case, merge runtime behaviour into WP5 and shipping into WP10.

## 5. Direct answer — one Integration WP or two?

**Position: one Integration WP now, with an explicit data-plane/control-plane split inside it.**

Use `01KXDPBQY1X66M7ZRK72D34S56` as the surviving container, retitled/rechartered
**Integration & connector federation**.

### Strongest argument for the SAME WP

- Both capabilities own h2a's boundary with external systems rather than its internal runtime.
- Both depend on the same identity/workspace/policy vocabulary: who enrolled, which workspace is bound,
  which connector is visible, which credential/consent applies, and which agents/CLIs receive it.
- The owner's report gets one stable question: **“How ready is h2a to integrate external platforms and
  capabilities safely?”**
- Today each new WP is a one-ticket 0% claim. One container can immediately hold four known, independently
  reportable leaves:
  - completed sentropic enrollment spec `01KX944X2B7CC0E6D4BR41E03Q`;
  - sentropic/workspace integration item `01KWVM4ZD4ADJQ70J1NEH7R6W1`;
  - MCP registration item `01KWVM4Z972ZAFK6TKW753ZBR1`;
  - gateway-broker deploy/go-live item `01KTQC2JK2Y3T7R8GQ6EQNHSJ5`.

At the current default `requireAccepted=false`, that known cut would report `1/4 = 25%` and
`AWAITED`, instead of two separate 0/1-style signals plus a completed spec at top-level `n/a`.

### Strongest argument for SEPARATE WPs

- MCP brokering is a **data-plane capability**: connector registry, credentials, private/shared
  visibility, distribution to agents, and revocation.
- Sentropic enrollment is a **control-plane integration**: auth/binding, workspace alignment,
  persistence/resume, server trust, and lifecycle.
- Their threat models, operational owners, and release cadence can diverge. A combined 50% could hide a
  critical 0% on one side behind progress on the other.
- “Integration” is otherwise at risk of becoming the forbidden catch-all for every external product.

### Boundary with WP7

The combined WP owns the **product contract and policy** of integration: enrollment, brokerage, sharing,
visibility, workspace binding, consent, and lifecycle. WP7 keeps the **substrate**: deploy manifests,
connector hosting/wiring, gateway/mesh infrastructure, OCI/SCW/k8s, and operational plumbing.

### What would falsify ONE WP

Split it when all of the following become true:

1. MCP federation and sentropic enrollment have independently accountable owners or release trains;
2. each side has at least two active lots, not merely one ticket;
3. the combined percentage can be shown to mask a material red state on one side;
4. the shared identity/workspace/policy layer is a dependency, not the owning artifact.

That evidence is not currently established. Until it exists, two WPs would produce two noisy 0% claims
more readily than two useful owner controls.

## 6. Empty and foreign WPs — disposition and loss

### 6.1 The five audited empty WPs

| id | recommended semantic result | what a simple deletion would lose |
|---|---|---|
| `01KY4Y2NGQ23RWGBYFFWSM7GCN` | Remove foreign WP shell; split preserved criteria across WP3, WP5/WP18 lot, and WP10. | Its body plus ten acceptance-criterion events, including server-owned scheduling/wake and cross-host E2E requirements (`.track/events.jsonl:522-533`). No leaf work would be deleted, but significant requirements would be. |
| `01KY564R6XWB0EJHSE04ZRP8MH` | Recreate/preserve as a project-workspace bug under WP5; retire foreign WP shell. | The owner-reported regression, predecessor link `01KXA2…`, and required rendered-test matrix (`.track/events.jsonl:537`). |
| `01KWANHGP9R0GCFK3Y276CS1FM` | Completed leaf item under WP10. | Proof that the 255-command mapping was completed and owner-validated (`.track/events.jsonl:165-167,358`). |
| `01KWVM4Z4S0VEFRM80C03NDSYX` | Split the original request: host execution support → WP5/WP18 lot; plugin offering/shipping → WP10. Remove empty shell. | The original x3 request explicitly contains both plugin offering and `h2a run` host support (`.track/events.jsonl:243`). |
| `01KWVNY117D60MY6YWNN78Y60X` | Bounded study item under WP8; reconcile its realization with its actual artifacts. | The acceptance criteria, prior proposal, coverage map/report, and provenance of the eleven-theme restructuring (`.track/events.jsonl:251,260-262,360`). |

### 6.2 Foreign workspace handling

[FACT] Item workspace is immutable. Ordinary reparent forbids cross-workspace moves
(`packages/track/src/track.ts:254-287`). The ratified-plan path can reparent across workspaces, but it
does not change the child's workspace (`packages/track/src/track.ts:290-323`). Therefore placing a foreign
item under a project WP preserves, rather than fixes, a cross-workspace subtree.

[JUDGMENT] The target report should not silently absorb WP16 or WP17 into project WPs. Preserve their
requirements in correctly-scoped project items, retain a provenance link to the foreign records, and
remove/terminalize the foreign containers from the project roster only after the owner approves the exact
migration. The completed foreign predecessor `01KXA2…` must also be addressed (detached from the project
tree or filtered by workspace) if the WP5 cross-workspace audit finding is expected to disappear.

### 6.3 Why “no leaf” is not “nothing to lose”

An empty WP contributes no denominator and therefore no progress signal. It may still carry body text,
acceptance criteria, accountable/responsible actors, and historical intent. Deleting raw events would
violate the append-only record and destroy provenance. The correct owner decision is about **role,
parentage, workspace projection, and evidence preservation**, not erasure.

## 7. Can WPs be locked today?

**No. There is no current WP-creation lock or owner-approval gate.**

### What exists

1. **Creation is directly available.** The CLI accepts
   `item new ... --role <workpackage|spec-phase|stream>` and calls `Track.createItem`
   (`packages/track/src/cli/index.ts:69-80,493-513`).
2. **Creation has structural guards only.** `createItem` checks legal role nesting when a known parent is
   supplied, then emits `item.created`; it does not consult an approved WP roster or owner decision
   (`packages/track/src/track.ts:233-251`).
3. **The ingest seam does not treat creation as binding.** `item.create` has `settles:'never'` and permits
   the role field (`packages/track/src/ingest/contract.ts:154-170`). It is workspace-pinned, but not
   approval-gated (`packages/track/src/ingest/ingest.ts:226-263`).
4. **Reparenting has stronger controls.** Ordinary reparent requires authenticated binding writes and
   same-workspace/cycle/nesting integrity. Cross-workspace `item.restructure` is default-denied and only
   the plan apply opens an explicit capability grant
   (`packages/track/src/ingest/ingest.ts:226-239`;
   `packages/track/src/cli/restructure-apply.ts:1-6,71-108,131-163`).
5. **Audit detects after the fact.** `empty-wp` and `orphan` findings are deterministic `action` records,
   but the audit neither prevents creation nor requires anyone to acknowledge a finding
   (`packages/track/src/report/audit.ts:1-5,98-125`).
6. **The event-store lock is unrelated.** It serializes append integrity; it is not a WP-policy lock.

### What does not exist

The searched code has no:

- workspace-level “WP roster locked” state;
- owner-approved decision reference required by `item.create role=workpackage`;
- default-denied `workpackage.create` capability;
- approval token checked by `Track.createItem`;
- pre-append “must have a leaf” rule;
- mandatory audit acknowledgement gate.

The closest preventative mechanism—the ratified restructure-plan path—controls cross-workspace
**reparenting**, not WP **creation**. Calling audit a lock would confuse detection with prevention. The
current evidence demonstrates the difference: audit found the empty WPs, yet they still entered and
remained in the owner's report.

Per the request, this section reports the mechanism that exists and the mechanism that does not. It does
not propose a new locking design.

## 8. What the owner's report says today and after the recommendation

### 8.1 Today

At `baselineCommit=0f285c27877a332af5ffe555f5c16b556b02781c`,
`track_status(level=wp, requireAccepted=false)` says:

| displayed WP | claim |
|---|---:|
| WP1 Protocol | 100% |
| WP2 Addressing | 79% |
| WP3 Coordination | 83% |
| WP4 Governance | 63% |
| WP5 Execution | 100% |
| WP6 Identity | 80% |
| WP7 Infra | 44% |
| WP8 Tracking | 100% |
| WP9 Method | 67% |
| WP10 Distribution | 89% |
| WP11 Memory | 0% |
| WP12 cockpit spec | n/a |
| WP13 enrollment spec | n/a |
| WP14/status MCP broker | 0% |
| WP15/status native runtime | 0% |
| WP16 foreign plugin-control | n/a |
| WP17 foreign tmux fix | n/a |
| WP18 host parity | 0% |

[JUDGMENT] This looks like eighteen comparable product themes. It is actually eleven perennial themes,
two top-level spec-phases, five later workpackages, two foreign roots, and numerous nested zero-leaf
containers. The visual uniformity overstates the structural uniformity.

### 8.2 Target report shape

After an owner-approved restructuring, the top level should say:

- **13 product WPs**, not 18;
- no top-level `Spec …` or `Fix …`;
- no top-level record from `ws:4471ea0c…`;
- stable Integration and Native identities cited by durable code/ULID;
- Host parity visible as a `0/7` lot under Execution, not as another product theme;
- no task-shaped empty WP pretending to contribute progress.

### 8.3 Known mechanical percentage effects

These are not a final item plan. They show what the report would say if only the explicit moves in this
review were represented as leaves, using the current default `requireAccepted=false`.

| affected concern | current | known target effect | interpretation |
|---|---:|---:|---|
| Integration | MCP `0/1`; enrollment spec `n/a`; x4/x5 elsewhere | `1/4 = 25%`, AWAITED | One completed spec plus three open MCP/sentropic integration leaves gives a non-binary claim. |
| Native runtime & CLI | `0/1 = 0%` | `0/1 = 0%` until decomposed | The WP is justified by durable scope, but the percentage remains noise until real lots/tasks exist. |
| Execution, project workspace only | `5/5 = 100%` plus one foreign done leaf globally | `5/13 = 38%` after nesting WP18's seven open leaves and recreating WP17 as one open project bug | This is more honest than 100%; any preserved WP16 execution leaves would lower it further. |
| Host parity lot | top-level `0/7 = 0%` | nested under Execution, still `0/7 = 0%` | Useful detail retained without a top-level theme claim. |
| Infra | `4/9 = 44%` | `4/8 = 50%` after moving x4 connector registration | Infra stops owning product-level brokerage while retaining substrate. |
| Tracking | `2/2 = 100%` | `3/4 = 75%` if the cockpit spec is a done leaf and the roadmap study keeps its current to-do state; `4/4 = 100%` only if the owner validates the study as done | The unresolved realization mismatch must remain visible. |
| Distribution | `8/9 = 89%` | mechanically `9/9 = 100%` after moving x5 out and representing the done mapping as a leaf | This must not be called an honest final 100% while its task-shaped empty spec-phases remain uncorrected. |

[FACT] Exact post-restructuring percentages are **not established** without the bottom-up, per-item
reparent/split plan and owner decisions on realization/acceptance. Inventing the rest would violate the
criterion that a percentage is a claim. The table above exposes known deltas and the remaining gaps rather
than fabricating a complete report.

## 9. Recommendation risks, counter-position, and owner decisions that remain open

### Strongest case against this recommendation

The existing eleven-theme scheme already assigns MCP to WP7, native execution to WP5, and CLI to WP10.
The cleanest roster is therefore still eleven: move every later item into those themes and add no new
top-level WP. That minimizes labels, honors the already-ratified taxonomy, and avoids creating two more
single-ticket 0% containers.

The owner has supplied a decisive contrary input for Native: it is a complex capability deserving its own
WP. Integration is less settled. This review recommends one Integration WP because the shared external
boundary is coherent and creates a more meaningful rollup than two single-ticket containers.

### Pre-mortem

Six months later this structure failed because “Integration” became a miscellaneous bucket, Native
duplicated WP5/WP10, and agents kept creating task-shaped role-containers because nothing prevented them.
The report had fewer top-level rows but still hid work behind `n/a`. The mitigations are not more naming:
they are explicit scope boundaries, item-level decomposition, reconciliation of empty spec-phases, stable
codes in every projection, workspace-scoped reporting, and an owner decision on whether prevention is
required.

### Presenter-interest disclosure

Keeping the ratified eleven and reusing the two existing WP IDs is easiest and lowest-risk for this
reviewer. That convenience is not by itself owner value. The owner's interests are an honest conductor
report, durable ownership seams, preserved append-only evidence, and a structure that does not need a new
WP for every small request.

### Open owner decisions

1. Ratify or revise the proposed 13-theme top-level roster.
2. Confirm whether WP18 is a nested lot under Execution or a separately piloted perennial concern.
3. Choose how completed/foreign task-shaped containers are preserved when current Track cannot unset their
   roles or delete them.
4. Decide whether the x8 study's produced artifacts are enough to mark/recreate it as completed.
5. Decide whether WP creation needs a preventative control; none exists today.

No decision is recorded by this document.

## 10. What could not be established

- A sixth current `empty-wp`: current Track 0.85.18 returns five.
- The reason the supplied audit summary said “6 action” while the current result has seven action
  findings.
- A decision artifact authorizing creation of `01KXDPBQ…` and `01KXDPBR…`. Their creation time, actor,
  titles, and later assigned codes are established (`.track/events.jsonl:435-445`); the why is not.
- Why WP16 and WP17 were written to `ws:4471ea0c…` rather than the project workspace. Their event bodies
  describe intent, but causal history is not established.
- A direct causal claim that WP16/WP17 themselves caused WP5's cross-workspace audit finding. The observed
  foreign descendant is `01KXA2TRS5CS633PCGXQ5TYF1W`; WP17 references it as predecessor.
- The final per-item population and exact percentage of Integration, Native, or Execution after the
  separate bottom-up leg.
- Independent accountable owners and release cadences for MCP federation versus sentropic enrollment;
  these are the principal facts that could force two Integration WPs.
- A supported Track operation that physically deletes an item or demotes a container to a leaf. None was
  found in the current CLI/domain surface.

## 11. Reproduction commands and read sources

Read-only commands/tools used:

```text
git -C /home/antoinefa/src/h2a rev-parse HEAD
git -C /home/antoinefa/src/h2a rev-parse refs/remotes/origin/main
git -C /home/antoinefa/src/h2a status --porcelain=v1
TMPDIR=/tmp track --version
TMPDIR=/tmp track audit --format text
TMPDIR=/tmp track report --raw --format text --commit 0f285c27877a332af5ffe555f5c16b556b02781c
track_status(baselineCommit=0f285c2…, level=wp, requireAccepted=false)
track_query(baselineCommit=0f285c2…)
track_query(..., role=workpackage|spec-phase|stream)
track_workspace_activity(workspace=ws:4471ea0c…, now=2026-07-26T18:00:00Z)
```

Primary sources:

- `.track/events.jsonl` (read only);
- `packages/track/src/model/item.ts`;
- `packages/track/src/track.ts`;
- `packages/track/src/report/status-by-level.ts`;
- `packages/track/src/report/rollup.ts`;
- `packages/track/src/report/build.ts`;
- `packages/track/src/report/audit.ts`;
- `packages/track/src/ingest/contract.ts`;
- `packages/track/src/ingest/ingest.ts`;
- `packages/track/src/cli/index.ts`;
- `packages/track/src/cli/restructure-apply.ts`;
- the four x8 study artifacts listed in §2.3.
