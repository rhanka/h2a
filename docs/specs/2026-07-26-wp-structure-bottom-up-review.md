# H2A workpackage structure — bottom-up review

**Status:** recommendation to the owner; no Track mutation proposed or made here.  
**Review base:** `0f285c27877a332af5ffe555f5c16b556b02781c` (`origin/main` when this review clone was made).  
**Store read:** `.track/events.jsonl` only; no event was appended.  
**Method:** start with open records and locally reachable in-flight branch tips, then ask which reporting containers those records need. This is deliberately not a criterion-first reclassification.

## Evidence and limits

The store was read through the read-only `track_query`, `track_status`, `track_canevas`, and `track_audit` MCP projections, all at the review base above; the read-only `track report --format text` and `track audit --format json` invocation was also attempted from this clone. The latter produced no report body in this sandbox (only `/home/antoinefa/.npm-global/bin/track` and sandbox stream errors), so this document does **not** quote or infer a CLI report that was not produced. The MCP projections did produce the inventory and audit results cited below.

The status and query projections disagree about labels for the same IDs. For example:

- `track_status(level=wp)` calls `01KXDPBQY1X66M7ZRK72D34S56` **WP14**, while `track_query` gives its leaf `01KTQC2JK2Y3T7R8GQ6EQNHSJ5` `wpLabel: "WP12"`.
- Status calls `01KXDPBR505FKNV9XCZ45P638H` **WP15**, while query gives x9 (`01KWVNYNHVJGA8CCW566PG4WMH`) `wpLabel: "WP13"`.

Therefore this review uses stable item IDs and titles, never a bare `WPnn` label, as evidence. The disagreement itself means a human report cannot be cited reliably by label until that projection bug is repaired.

`track_audit` returned nine findings: two open orphans, six `action`-severity empty workpackages, one cross-workspace subtree, and a singleton test workspace. In particular, the empty items `01KY4Y2NGQ23RWGBYFFWSM7GCN` and `01KY564R6XWB0EJHSE04ZRP8MH` are in `ws:4471…`, not the project workspace `ws:89c45…`; the foreign canvas contains no pending item. The same audit marks `01KWWXCCTW1JFPYY0SYD8NFQHD` (*Execution & runtime*) as cross-workspace. These are store facts, not inferences about intent.

## 1. Open-store inventory

“Open” below means the query’s `AWAITED` or `TO-DO` bucket, including a completed implementation whose acceptance is still unknown. The parent assessment concerns the **current** parent, not whether the item is valuable. `—` means no workpackage ancestor.

| Bucket | Item | Current parent (stable ID) | Does the parent explain it? |
| --- | --- | --- | --- |
| AWAITED | `01KTQC2JH9G7JNJXAH2BY1BHGK` — EVO-3 D6 per-host wake command | Coordination & loop (`01KWWXCCC1JB0Z4YFW04Q2WSEG`) | Yes: host wake is a coordination-loop function. |
| AWAITED | `01KTT31AZVYPVH9VGRN7PVAYDF` — Phase 2a liveness observability | MCP-disconnect / false-live remediation (`01KTST4ASW2DYD2R76VM1DBF37`) | Yes. |
| AWAITED | `01KWVM4Z972ZAFK6TKW753ZBR1` — x4 register MCP connectors to CLIs | Infra, deploy & MCP (`01KWWXCD5BN2G3D97S07HS5JMN`) | Yes, although this is evidence that connector brokering is already partly inside the infrastructure/integration theme. |
| AWAITED | `01KWVM4ZM1TP1R70MB0Q597CE1` — x7 central persistent agent context/memory | Memory & context (`01KWWXCDPTGK8090MRSR3G9D3W`) | Yes. |
| AWAITED | `01KY66T20YS7JEQP73999VPVFJ` — Focus ad-hoc decision dossiers | — | No parent; `track_audit` calls it an open orphan. It belongs with Tracking & record, not a new WP. |
| TO-DO | `01KTQC2G4Y2HW3F5KS1TNTMDW3` — sweep leftover repo-local buses | Infra, deploy & MCP (`01KWWXCD5BN2G3D97S07HS5JMN`) | Yes: operational infrastructure. |
| TO-DO | `01KTQC2GSSXZXK7FWATW6MX5DV` — activity-growth suggestion ladder | Governance child (`01KTQC2G6VWZS0PGAG30TY2S6Q`) | Yes: it governs how work is proposed/escalated. |
| TO-DO | `01KTQC2JA3TDSY494FM101M5Z9` — EVO-4 decision support / situation presentation | Coordination & loop (`01KWWXCCC1JB0Z4YFW04Q2WSEG`) | Plausible, but weakly evidenced: it may also be a Tracking & record/Focus concern. No source ties it more precisely. |
| TO-DO | `01KTQC2JBZ9VFEXMQH7QYS2MYC` — EVO-5 NHI control | Identity, auth & NHI (`01KWWXCD0V5V0M8JJ8MT78HCZ0`) | Yes. |
| TO-DO | `01KTQC2JDS7NYSZEQ4VQHF50NK` — EVO-9 trust concepts | Governance & RACI (`01KWWXCCM1GPD7ZCXTQAX7NTSB`) | Yes. |
| TO-DO | `01KTQC2JFGDCTBV8W2FMT63XNX` — availability worker / busy-on-user | Addressing & presence (`01KWWXCC4NNP5XP45NFY6T3BTR`) | Yes. |
| TO-DO | `01KTQC2JK2Y3T7R8GQ6EQNHSJ5` — EVO-12 gateway broker go-live | MCP-connector root (`01KXDPBQY1X66M7ZRK72D34S56`) | Yes, but it is the root’s only leaf and overlaps the existing infrastructure/MCP theme. |
| TO-DO | `01KTQC2JN365Z1HXCXHJB8WD9X` — EVO-13 k8s MCP-pod sidecar | Infra, deploy & MCP (`01KWWXCD5BN2G3D97S07HS5JMN`) | Yes. |
| TO-DO | `01KWN09E7QE1ACJZVG2Z54MK5R` — seed A | — (`ws:test`) | No project parent; it is a test-workspace fixture, not h2a roadmap work. |
| TO-DO / in progress | `01KWVM4Z0AWMM4MS2SE76ZHHG5` — x2 gateway/Claude subagent proxy bug | Infra, deploy & MCP (`01KWWXCD5BN2G3D97S07HS5JMN`) | Broadly yes (gateway operation), though its original parent was false-live remediation; see §3. |
| TO-DO | `01KWVM4ZD4ADJQ70J1NEH7R6W1` — x5 h2a↔Sentropic workspace alignment | Distribution, CLI & packaging (`01KWWXCDJJ5MJ141ZRW52AAQ7Q`) | **No.** Its wording is an integration/workspace contract, not packaging. |
| TO-DO | `01KWVM4ZGG24C6YQCXH8QHSNTQ` — x6 Greywall around CLIs | Execution & runtime (`01KWWXCCTW1JFPYY0SYD8NFQHD`) | Yes: it is execution wrapping/policy. |
| TO-DO | `01KWVNYNHVJGA8CCW566PG4WMH` — x9 launch own CLI / gateway broker | Native-runtime root (`01KXDPBR505FKNV9XCZ45P638H`) | Mixed: a native runtime can explain the capability, but the title substitutes a Sentropic-main-loop program for the owner’s CLI/gateway request; see §3. |
| TO-DO | `01KXC2W2K7TJAYXPA7SYVS3AY1` — resource governance / anti-OOM | Infra, deploy & MCP (`01KWWXCD5BN2G3D97S07HS5JMN`) | Yes for infrastructure, not specifically MCP. A rename should make that clear. |
| TO-DO | `01KXG8BX2QDZ06EN64C60BJ2RS` — instance steering / restore | Addressing & presence (`01KWWXCC4NNP5XP45NFY6T3BTR`) | Yes. |
| TO-DO / in progress | `01KXG8BX68TY4Z5GQY5TMXCRB3` — harness/worktree placement | Method & harness (`01KWWXCDE8F42NCMVZBWXGAY4X`) | Yes. |
| TO-DO | `01KY7CAZ119CZ3Y7K9VA7DX1M2` — host capability contract | Governance & RACI (`01KWWXCCM1GPD7ZCXTQAX7NTSB`) | Yes. |
| TO-DO | `01KY7CBBRAAKXJBQ3DJNR2CVXC` — cross-host capability contract | Host operator capability parity (`01KY7CAYTVW4PVGQ0D552EENDG`) | Yes. |
| TO-DO | `01KY7CBBYY3343TX635JA5J90K` — adapter guide/conformance tests | Host operator capability parity (`01KY7CAYTVW4PVGQ0D552EENDG`) | Yes. |
| TO-DO | `01KY7CBC4XHTYA1PYSSNQS2P0F` — probe manual CLI enforcement | Host operator capability parity (`01KY7CAYTVW4PVGQ0D552EENDG`) | Yes. |
| TO-DO | `01KY7D1Z0B0TNDP9PK48GAZN6W` — Codex adapter | Host operator capability parity (`01KY7CAYTVW4PVGQ0D552EENDG`) | Yes. |
| TO-DO | `01KY7D1Z6QVKXTR17GP7V38YZX` — OpenCode adapter | Host operator capability parity (`01KY7CAYTVW4PVGQ0D552EENDG`) | Yes. |
| TO-DO | `01KY7D1ZCNZDMYV9YM4VV3VYHJ` — Hermes adapter | Host operator capability parity (`01KY7CAYTVW4PVGQ0D552EENDG`) | Yes. |
| TO-DO | `01KY7D1ZK1XEV46V2RXA4AE7AV` — agy adapter | Host operator capability parity (`01KY7CAYTVW4PVGQ0D552EENDG`) | Yes. |
| TO-DO | `01KY7JYETQVYWDNNQVNZT875FF` — Terra xhigh semantic preset | — | No parent; `track_audit` calls it an open orphan. It is a native-CLI launch contract, so Native CLI & runtime is the closest container. |

This is 30 open store rows: 29 in the project workspace and one explicit `ws:test` fixture. The two project orphans are not a taxonomy argument: they are simply a reporting defect that must be resolved before a percentage can claim full coverage.

## 2. Work actually in flight

The owner identified six active lanes. The locally reachable refs confirm committed evidence for four and also show why the two status/report lanes must be represented as leaves, rather than as empty WPs. They do **not** prove all live process assignments: the sandbox’s process listing exposes only this review process, and no lane-to-branch mapping is stored in Track. That missing mapping is named rather than guessed.

| Owner-described lane | Local evidence | Container needed for honest reporting |
| --- | --- | --- |
| tmux status signals | `origin/codex-tmux-status-signal-set-20260726` at `65f3dd9` is a 300-line status-signal decision spec; `origin/feat/tmux-status-surface` at `d3fc80d` adds `packages/h2a-runtime/src/status-projection.ts`, `packages/h2a/src/status-surface.ts`, tmux code, and status tests (4,068 additions). | A leaf under Addressing & presence (or, if the owner prefers by implementation boundary, Execution & runtime). It is not a WP: empty `01KY564R6XWB0EJHSE04ZRP8MH` is precisely a one-off *Fix* container. |
| MCP connector brokering | `origin/docs-mcp-registry-study` at `f1e5b78` adds `docs/specs/2026-07-26-SPEC_STUDY_h2a-mcp-registry.md` (522 lines). Store records x4 and EVO-12, `01KWVM4Z972ZAFK6TKW753ZBR1` and `01KTQC2JK2Y3T7R8GQ6EQNHSJ5`. | The existing Infra, deploy & MCP theme, renamed to make integration explicit; no separate one-leaf WP. |
| h2a↔Sentropic integration | The store has x5, `01KWVM4ZD4ADJQ70J1NEH7R6W1`, and the historical Sentropic enrollment docs `docs/specs/2026-07-11-sentropic-h2a-enrollment*.md`. `origin/main` includes enrollment work at `0f285c2`; a currently live lane branch cannot be established from local refs. | The same integration container as MCP, with x5 moved from Distribution, CLI & packaging. |
| memory design fusion | `origin/agent/merge-agent-memory-design` at `f0fec42` adds `docs/specs/2026-07-25-h2a-agent-memory-merged-design.md` (508 lines); x7 is `01KWVM4ZM1TP1R70MB0Q597CE1`. | Existing Memory & context. |
| native CLI runtime | The store has x9; locally reachable historical/runtime evidence includes `origin/fix/eradicate-remote-runtime` at `20ab213` (*canonicalize runtime CLI surface*) and `origin/feat/opus5-gateway-thin-consumer` at `ad933b6` (*llm-gateway-runtime thin consumer*). The precise current lane ref is not established. | A dedicated Native CLI & runtime container, as directed by the owner; it must not be renamed as a Sentropic-only integration. |
| repair of the human `track report` | `git worktree list` in the owner checkout shows `/home/antoinefa/src/a2a-cli-fix-track-report` on `fix/track-report-boundary`, currently at `de6ff64`. The local ref’s later work is not established; the store has an older stale completed report feature `01KXHGD0QX2RKN8C5C4N3VK2PE`, not a current repair leaf. | A current leaf under Tracking & record. It should not create a report-fix WP, particularly after a stabilized report was explicitly named as owner value. |

The in-flight table is more important than a cosmetic rename: two actual lanes (tmux status and the report repair) have no open leaf corresponding to their current work. An empty WP makes this worse, not better: `n/a` says there is no denominator while work is happening. The owner should decide the intended leaf records before relying on percentage reporting; this review does not create them.

## 3. The owner’s short items versus the titles applied to them

The underlying source is unusually clear here: the original items are human/local-user `item.created` events in `.track/events.jsonl`. A later reparent does not rewrite the owner’s words.

| Item | What the owner wrote | Current result | Bottom-up reading |
| --- | --- | --- | --- |
| x2 `01KWVM4Z0AWMM4MS2SE76ZHHG5` | “**x2. si ton subagent fonctionne pas, tu es en gw … il y a un bug sur claude pour le proxy des subagent, a traiter convenablement**” (`.track/events.jsonl:242`) | Created below false-live remediation; reparented to Infra, deploy & MCP (`.track/events.jsonl:347`). | The present infrastructure/gateway parent is defensible, although it loses the original explicit Claude-subagent failure mode. It needs a leaf title/acceptance that preserves that mode; no new WP is warranted. |
| x5 `01KWVM4ZD4ADJQ70J1NEH7R6W1` | “**gérer l'intégration propre de h2a a sentropic … gérer les workspaces de sentropic en alignement avec la notion de workspace locale**” (`.track/events.jsonl:245`) | Reparented to **Distribution, CLI & packaging** (`.track/events.jsonl:349`; current `track_query`). | This is a clear semantic displacement. Distribution/packaging does not explain a Sentropic/local-workspace alignment contract. Move it to the one integration theme. |
| x6 `01KWVM4ZGG24C6YQCXH8QHSNTQ` | “**greywall en wrapping des cli … policy … secure vs transparent … mode adaptatif**” (`.track/events.jsonl:246`) | Reparented to **Execution & runtime** (`.track/events.jsonl:350`). | This is a good fit; the title is a durable execution-policy concern. |
| x8 `01KWVNY117D60MY6YWNN78Y60X` | “**je ne suis pas content du EVO roadmap … une étude … structuration des wp … thèmes de travail**” (`.track/events.jsonl:251`) | Stored as the empty workpackage **“x8 / WP-ROADMAP — Étude de restructuration…”** and appears as a child of Tracking & record. Audit calls it empty. | This is a task/review masquerading as its own container: it has no product capability to accumulate, so it produces `n/a`. Demote it to this owner decision/review record; retain the history, remove it from the active WP report. |
| x9 `01KWVNYNHVJGA8CCW566PG4WMH` | “**quand est ce qu'on lance notre propre cli ? deja concu avec l'architecte**” (`.track/events.jsonl:252`) | Originally below **“WP-CLI — Support Hermes/OpenCode/etc comme CLIs h2a”**; later reparented (`.track/events.jsonl:444`) under **“Native h2a agent runtime via sentropic — main loop managed by sentropic (potentially refactored); each h2a session runs local / remote-k8s / in-sentropic (native orchestrator)”** (`.track/events.jsonl:436`). | The applied title has expanded a launch-a-native-CLI/gateway request into a specific Sentropic orchestration design. The native capacity is real and deserves its own WP; the provider-specific sentence should not replace the owner’s stated product boundary. Rename it **Native CLI & runtime** and keep Sentropic contract work in Integration. |

The wording shift for x5 and x9 is evidenced. **Who authored the expanded framing is not established.** The Track events for the expanded WP have `by: human:fabien.antoine@m4x.org` / `local-user`, while the committing change `67acd8d` is authored by `rhanka` and titled “structure WP12 … + WP13 … + split x9.” That is insufficient to attribute the wording to an agent or to the owner; this review makes no such attribution.

There is a related, less direct expansion for x4: the owner recorded “**h2a mcp pour enregistrer les connecteurs MCP aux CLIs**” (`01KWVM4Z972ZAFK6TKW753ZBR1`), while the MCP root promises registration, sharing policy, identity/workspace scoping, and broadcast (`.track/events.jsonl:435`). Those additions may be valid design scope, but their authorship and ratification are not established by the item itself.

## 4. Containers that fall out of the work

The body of work needs the existing durable spine, with four corrections rather than a new taxonomy:

1. **Keep WP1–WP11 as the spine.** Their titles cover actual completed/open work: protocol, presence, coordination, governance, execution, identity, operational/integration infrastructure, record/reporting, harness, package/CLI distribution, and memory. The inventory above finds a natural home for nearly every open project item inside that spine.
2. **Make WP7 the one current integration container.** Rename *Infra, deploy & MCP* to **Infrastructure & integrations** (or **Integration & operations** if the owner wants integration first). Keep its existing infrastructure leaves; merge the standalone MCP root into it; move x5 into it. This is the smallest reportable container that contains the actual MCP and Sentropic integration work without producing an artificial 0% singleton.
3. **Keep a dedicated Native CLI & runtime WP.** Retitle the existing native-runtime root to remove “via sentropic” and make its boundary the native executable, runtime lifecycle, launch semantics, and gateway broker. Put x9 and the semantic Terra launch preset orphan there. This satisfies the owner’s stated position that the native CLI is a complex capability, not a minor tail task.
4. **Treat status/report repairs as leaves in their durable homes.** Tmux status belongs in Presence (or Execution if the owner chooses that implementation boundary); the `track report` repair belongs in Tracking & record. Neither creates a new WP. The in-flight items must be recorded as leaves before their work can truthfully affect a percentage.

This produces the following proposed root set:

```text
Protocol & envelopes
Addressing & presence                 ← tmux status leaf
Coordination & loop
Governance & RACI
Execution & runtime
Identity, auth & NHI
Infrastructure & integrations         ← x4, x5, EVO-12, gateway/ops
Tracking & record                     ← current human-report repair leaf
Method & harness
Distribution, CLI & packaging
Memory & context
Native CLI & runtime                  ← x9, semantic launch-preset leaf
Host operator capability parity & gap governance
```

The first eleven and host-capability roots are already evidenced by nontrivial bodies of work. The Native CLI root is retained by explicit owner direction and by x9/runtime evidence. No separate “tmux”, “spec”, “fix”, “roadmap study”, or one-leaf MCP container survives.

### One integration WP or two?

**Recommendation: one, now.** Merge `01KXDPBQY1X66M7ZRK72D34S56` (MCP connector brokering) into the renamed WP7 and move x5 there. The current record is x4 (connector registration), EVO-12 (gateway broker), and x5 (workspace alignment). They all make h2a interoperable with an outside system and all need identity/workspace scoping. Their work is too small and too intertwined to produce two honest top-level percentages: the current MCP root is 0% over one leaf, while x5 is incorrectly hidden in packaging.

**Counter-argument:** MCP connector brokering could become a customer-facing registry/sharing product, whereas Sentropic enrollment, NHI, and remote orchestration have a particular security/control-plane lifecycle. If each acquires its own independently planned leaves, release cadence, and owner-facing question, separate Integration—MCP from Integration—Sentropic then. A concrete split trigger is at least three active, independently schedulable leaves on each side plus a report the owner actually needs to read separately. That evidence is not yet in the store.

### Native CLI WP

**Recommendation: keep it separate, renamed Native CLI & runtime.** x9’s original request is a complex product capacity, and there is independent local history for canonical runtime/CLI work (`20ab213`, `ad933b6`). The explicit owner position resolves the only close call here. Its clean boundary also avoids letting external-connector work decide the progress of the native executable.

**Counter-argument:** the native CLI touches distribution (WP10), execution (WP5), and Sentropic integration, so a loose “runtime” WP risks duplicate ownership. The answer is a narrow boundary, not deletion: native command/runtime and gateway-broker lifecycle in this WP; packaging/release in WP10; runtime substrate in WP5; external contracts in Integration. If that boundary is not accepted, x9 should be a leaf under WP5 instead—still not a new Sentropic-specific container. That would conflict with the owner’s stated “complex capability” input, so it is not this review’s recommendation.

## 5. Verdict for the current WP1–WP18 roots

The labels in this table are the status projection’s labels only; the ID and title are the durable references. **DELETE** means remove from the active WP/report hierarchy while preserving its event/doc history, not erase append-only events.

| Root | ID / current title | Verdict | Reason from work |
| --- | --- | --- | --- |
| WP1 | `01KWWXBMWJ6HQN86M5RQ1ZMJ4A` — Protocol & envelopes | KEEP | Completed envelope validation and the remaining protocol work are a coherent durable concern. |
| WP2 | `01KWWXCC4NNP5XP45NFY6T3BTR` — Addressing & presence | KEEP | It contains availability, instance steering, and presence work; use it for the tmux-status leaf. |
| WP3 | `01KWWXCCC1JB0Z4YFW04Q2WSEG` — Coordination & loop | KEEP | Wake, conductor, relance, and decision-support records form one ongoing operational loop. |
| WP4 | `01KWWXCCM1GPD7ZCXTQAX7NTSB` — Governance & RACI | KEEP | Trust, capability contract, and governance work are current/open. |
| WP5 | `01KWWXCCTW1JFPYY0SYD8NFQHD` — Execution & runtime | KEEP | x6 is a direct execution-policy leaf. Repair the cross-workspace reporting defect, but it does not refute the theme. |
| WP6 | `01KWWXCD0V5V0M8JJ8MT78HCZ0` — Identity, auth & NHI | KEEP | NHI control remains an open leaf. |
| WP7 | `01KWWXCD5BN2G3D97S07HS5JMN` — Infra, deploy & MCP | KEEP / RENAME / ABSORB | It already owns x2, x4, bus cleanup, the k8s MCP sidecar, and resource governance. Rename it Infrastructure & integrations, move x5 in, and merge the separate MCP singleton into it. |
| WP8 | `01KWWXCD9PYZZBZR5E6JQAK6T6` — Tracking & record | KEEP | The human-report repair and orphaned Focus decision-dossier work belong here. Demote the x8 study child, not this theme. |
| WP9 | `01KWWXCDE8F42NCMVZBWXGAY4X` — Method & harness | KEEP | The in-progress worktree/scratch placement repair has an exact home. |
| WP10 | `01KWWXCDJJ5MJ141ZRW52AAQ7Q` — Distribution, CLI & packaging | KEEP | This is a durable release/package surface. Move x5 out because it is not packaging. |
| WP11 | `01KWWXCDPTGK8090MRSR3G9D3W` — Memory & context | KEEP | x7 and the current merged memory-design work are direct evidence. |
| WP12 | `01KX7HY6B695P5FK1QMXA7C6WZ` — Spec EVO-4b | DEMOTE | A completed *Spec* is a decision/artifact, not a product concern; it has no current leaf and reports `n/a`. |
| WP13 | `01KX944X2B7CC0E6D4BR41E03Q` — Spec h2a↔sentropic enrollment | DEMOTE | Same: preserve its design/dossier, do not make a completed spec a top-level progress container. Sentropic integration work goes to WP7. |
| WP14 | `01KXDPBQY1X66M7ZRK72D34S56` — MCP connector brokering & sharing | MERGE | One open leaf, overlapping WP7/x4. Merge into renamed WP7 rather than report 0% separately. |
| WP15 | `01KXDPBR505FKNV9XCZ45P638H` — Native h2a agent runtime via sentropic | KEEP / RENAME | Keep as Native CLI & runtime for x9 and native-launch work. Remove the unratified/provider-specific framing from the root title. |
| WP16 | `01KY4Y2NGQ23RWGBYFFWSM7GCN` — Native-plugin control plane | DELETE | Empty; in `ws:4471…`, no pending foreign work; audit `action`. Any real control-plane work must first be recorded as a leaf in a durable home. |
| WP17 | `01KY564R6XWB0EJHSE04ZRP8MH` — Fix tmux status surface | DELETE | Empty one-off *Fix* in `ws:4471…`; the live tmux lane is evidence for a leaf under WP2/WP5, never a separate WP. |
| WP18 | `01KY7CAYTVW4PVGQ0D552EENDG` — Host operator capability parity & gap governance | KEEP | Seven open host-adapter/gap leaves are a genuine durable cross-host capability concern. |

The older top-level `S1`/`S2` empty roots (Keepalive/presence and EVO roadmap), `S3` migration root, and `S4` LLM gateway root are also visible in `track_status`. They are not part of the owner’s WP1–WP18 numbering, but they should not stay as active top-level report containers: **DELETE** the empty S1/S2/S4 containers; **DEMOTE** S3 to closed migration history. This is separate from deleting history.

Likewise, the child records named `P…`, `Fix…`, “Mapping…”, and “Spec…” beneath otherwise durable roots are plan/lot/history records, not proposed new top-level themes. Their exact migration semantics are not determined here; the bottom-up rule is simply that a plan step must not render as a peer percentage-bearing product container.

## 6. What the owner’s report says today versus after this recommendation

This is a projection comparison, not a claim that the changes have been made.

| Today (`track_status(level=wp)`) | After owner-approved restructuring and leaf recording | Why it is more honest |
| --- | --- | --- |
| WP7 is 44% (4/9), while x5 is hidden in WP10 and MCP brokering is a separate 0% singleton. | Renamed Infrastructure & integrations is 4/11 = **36%**, assuming it absorbs EVO-12 and x5 (x4 is already there). | It reports the one real integration/operations portfolio, including unfinished Sentropic and connector work, instead of two misleading views. |
| WP10 is 89% (8/9) because x5 counts as packaging. | WP10 becomes 8/8 = **100%** on the records currently assigned to it. | That says packaging has no currently open package/release leaf; x5 no longer falsely depresses it. This remains acceptance-policy dependent. |
| MCP root reports 0% (0/1). | It disappears as a separate root; its leaf reports inside Integration. | A single unsliced item is work, not an independently measurable product theme. |
| Native-runtime root reports 0% (0/1), with x9 framed as Sentropic’s main loop. | Native CLI & runtime reports 0% over two explicitly native leaves after adding the Terra-preset orphan; it should be annotated “no approved first lot” until decomposed. | Zero is not hidden, and the denominator and owner-facing capability are explicit. Do not inflate progress by converting the capability into a vague integration title. |
| Empty Spec roots, WP16, and WP17 render `n/a` at top level. | They disappear from the active conductor table; their docs/events remain visible as history. | `n/a` stops claiming a product container exists when no work is in it. |
| The live tmux status and report-repair lanes do not have current open leaves. | Add/reopen a tmux leaf under WP2 (or WP5) and a report-repair leaf under WP8 before reading their percentages. If the tmux leaf is added to WP2’s current 11/14, that becomes 11/15 = **73%**. | The denominator finally includes the work actually being done. The exact result is conditional because this review is not authorized to write Track. |
| The two open orphans are outside all WP percentages. | Focus dossier → WP8; Terra preset → Native CLI & runtime. | Every open project item is covered exactly once. `ws:test` remains outside the product report. |
| The same roots display contradictory labels between `track_status` and `track_query`. | Repair label assignment before publishing the table. | No percentage is reliably attributable while the heading can identify a different root. |

The central reporting conclusion is conservative: **do not add a WP merely to make a lane visible.** Record the lane as a leaf under the durable concern. Conversely, do not declare a WP 0%/n/a if its actual work has never been recorded as a leaf. These are different failures and need different repairs.

## 7. Owner decisions still open

1. Accept or reject the one-Integration-now recommendation. The split trigger in §4 is intentionally a future decision, not a hidden commitment.
2. Select the implementation boundary for the tmux status leaf: Presence (recommended, because it answers “what is live/true?”) or Execution & runtime (reasonable if it is treated as runtime control-plane state).
3. Approve the Native CLI & runtime root title and its exact boundary. The alternative is x9 under Execution & runtime; this review does not choose that against the owner’s stated preference.
4. Decide the lifecycle mechanics for demoted specs/plan records and deleted empty WPs. This document uses reporting words, not an event-writing recipe, because the Track store is append-only and the owner has not made the decision.
5. Decide the exact leaf records/acceptance for the six live lanes. The observed store cannot establish a current Track item for tmux status or the human-report repair, nor can it map every live lane to a branch/process.
6. Repair the `track_status`/`track_query` label mismatch before accepting a human report as a cited artifact.

## 8. What could not be established

- Who authored the expanded WP title around x9, or whether its Sentropic-main-loop wording was ratified by the owner. The event provenance says local human user; commit `67acd8d` is authored by `rhanka`; that is conflicting/insufficient attribution.
- Why the status and query label projections diverge, beyond the verified examples in §Evidence. No repair was attempted.
- Why WP16/WP17 were written in `ws:4471…`, or why their roots are rendered in the project’s top-level status. Audit establishes the fact, not its cause.
- A live process-to-branch mapping for all six lanes. Local refs confirm the listed branch tips; the sandbox does not expose other agents’ processes, and Track has no lane assignment event.
- The exact content/current diff of the human-report repair lane. Its worktree/ref is locally visible, but no newer committed branch tip or Track leaf identifies the repair.
- Whether the completed foreign enrollment lot should be re-attached to a historical Sentropic-integration record. It is not an open audit finding, and this review does not infer a migration.
- Any future workload that would justify splitting Integration into MCP and Sentropic WPs. The current store does not yet show it.

## Handling note

This review was produced in the isolated clone `/home/antoinefa/src/h2a/tmp/worktrees/wp-review-terra` at `0f285c27877a332af5ffe555f5c16b556b02781c`. No commit, staging, stash, checkout, push, GitHub request, process termination, or `.track/` write was performed. Nothing was removed; the clone is retained because it contains the requested deliverable.
