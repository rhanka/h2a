# EVOL Spec — Single Shared MCP Lane Remediation (PR #355 + PR #354)

| Field | Value |
|---|---|
| Status | Draft for double spec review, then owner GO-CODE. No code is authorized by this document alone. |
| Kind | Remediation spec (EVOL). Defines target behaviour, lots, RED tests, exact files, gates, rebase plan. |
| Owner decision | 2026-10-18, code-fix after unfavourable reviews: "Spec d'abord" (spec first, two GO-CODE, then code). |
| Target release | **0.98.8**. The lane was moved out of 0.98.7 on 2026-10-17; 0.98.7 ships from `main` without this lane. |
| PRs in scope | [#355](https://github.com/rhanka/h2a/pull/355) `feat/0.98.7-mh-l6` at `ef9bde52a`; [#354](https://github.com/rhanka/h2a/pull/354) `feat/0.98.7-registry-r5r6` at `e8508e394`, stacked on #355 (+16 commits). |
| Review verdicts | Both PRs **NON-FUSIONNABLE** in two independent reviews (Astra max; Sol 6.1 xhigh). 4 P1, 7 P2, 3 CI findings after de-duplication. |
| Answer to the owner question | "mcp unique sera quand dans quelle version ?" — **0.98.8**, and only after every gate in §9 passes. No date is promised by this spec. |
| Language | This spec is in English. The French summary is in `summary.md` next to this file. |

## 0. How to read this spec

- `MUST` / `MUST NOT` state the target behaviour the owner asked for, or a contract clause already in force. The source is cited on the same line or in the same table row.
- `[PROPOSITION]` marks a design or sequencing choice made by this spec. A proposition is not an owner decision and not a contract clause. It needs spec review, and owner GO-CODE where §11 says so.
- `unknown`, `source-gap`, `unverified`, `partial`, `not covered` are factual status terms. They never mean "probably fine".
- Every lot is RED-first: the listed failing test exists and is observed failing on the reviewed head before any product edit in that lot. A lot that starts green has no regression proof and does not count.
- This spec writes no code, runs no test suite, and touches no owner live state. All code-phase commands below are instructions for the later build phase, under the confinement rules recalled in §9.1.

## 1. Authority and evidence

### 1.1 Order of authority

1. Owner verbatim requests in the Track registry (§2, Appendix A) and owner decisions (§1.3).
2. The lane contracts cited by the build briefs (§1.2), at the exact versions and hashes below.
3. The two independent code reviews (§5). They are evidence about the reviewed heads, not new requirements.
4. Agent reports. They record what was built and what the builders already declared `not covered`. They do not override 1–3.
5. This spec's `[PROPOSITION]` items, weakest of all.

Where two sources disagree, the higher source wins and the disagreement is recorded in §10 or §11. It is never resolved silently inside a lot.

### 1.2 Contracts cited by the lane

| Contract | Exact artefact | Role in this spec |
|---|---|---|
| Handover / MH spec v7 | `0985/handover/spec-v7-astra.md` (120 665 chars, 2 203 lines) | Normative for #355: central routing (§4), shim (§5), cold stop (§6), v1 migration (§7), `h2a upgrade` (§8, esp. §8.1), qualification (§10, esp. §10.2), lots MH-L0..L8 (§12). |
| Option A decision note | `0985/l3-explain/out.md` | 0.98.7-generation code accepts a live switch conducted from outside and never initiates one. Carried into 0.98.8 as a non-regression constraint (§3, RQ-07). |
| Registry entry contract v8 | `/home/antoinefa/src/sentropic/.tmp/registry-contract/registry-entry-contract-v8.md`, SHA-256 `9114b5ad4ddbd2f93ded999df69f887e05f9232ea06c4d6eecedbde7332a378c`, 224 169 bytes (recomputed for this spec; matches the R5/R6 brief) | Normative for #354: composition (§6), host discovery and shared MCP (§7.1–§7.4), refusals (§9), lots and gates (§10.1–§10.2). Final OWNER ADDENDUM is binding per its preamble. |
| Registry contract v9 | Same directory, `registry-entry-contract-v9.md`, SHA-256 `278f6613c0738a0da89679450139f1c0c1935c8224e6cca085d8874b7919ff31`, 226 415 bytes, dated 2026-10-17 | Exists and is newer than v8. The R5/R6 build was briefed and reviewed against **v8**. Whether remediation targets v8 or v9 is an open decision (§11, D-03). Default until decided: v8, because every finding in §5 cites v8. `[PROPOSITION]` |
| Owner addenda R5/R6 | `OWNER-ADDENDUM-r5r6-0987.md`; `OWNER-ADDENDUM-r5r6-0988.md` | R5+R6 built on the lane before its merge; integration qualification only on the integrated lane+main head; CI receipt per GWRC-CI-V1 option A; remote routing (R2 → R7a → R3, after immo [#679](https://github.com/rhanka/sentropic/pull/679)) is refused explicitly and tested in this release, with no silent fallback. The 0988 addendum records the move to 0.98.8 and keeps the original owner quote verbatim. |
| h2a-side registry guide | `0985/registry-h2a/spec-h2a-registry-v3.md` | Guide only. The contract wins on any conflict (brief wording). |

### 1.3 Owner decisions that bind this remediation

Source: `0985/DECISIONS-owner.md`. Only the decisions that change this lane are listed.

| Date | Decision | Effect on this spec |
|---|---|---|
| 2026-10-11 | H1 MCP first; H4 single upgrade command; `h2a upgrade` never restarts the native host | LOT-1 scope; native-host restart stays forbidden on every path (§3, RQ-05). |
| 2026-10-11 | MCP: cold switch once from v1, then add-only contract; `listChanged` announced from the handover generation | LOT-2 qualification oracles (§7). |
| 2026-10-12 | 0.98.7 = big milestone: shared MCP that no longer drops + complete upgrade command (manual and auto) + protected install + hot-switch preparation; gateway moves later. Estimates in agent-hours and review rounds, never human engineer-days | Lot estimates in §7 follow this rule. The spec-v7 day estimates (§12 there) are historical and are not reused. |
| 2026-10-16 | "tous les mcp de h2a devraient passer pareil par le mcp registry" — main MCP, Track MCP and `ui://` MCP registered and discovered via the cluster-mesh MCP registry; Focus skill in the cluster-mesh skills registry | LOT-3..LOT-6 scope; `ui://` and the Focus skill stay bounded by their own gates (§10). |
| 2026-10-16 | MCP `ui://` = module of `@sentropic/h2a` on the single MCP endpoint | No second host endpoint may be introduced by remediation. |
| 2026-10-16 ~22:05 | R5+R6 version answer: "Dans la 0.98.7" (then superseded on release number only, see next row) | Preserved verbatim in the addenda. |
| 2026-10-17 ~01:35 | Ship `main` as 0.98.7 (rc on `next`, then stable, same tree). Single MCP + registry lane → **0.98.8**; later version table shifts by one | Release target of this spec. Branch names still say `0.98.7`; §8 keeps them for PR continuity. `[PROPOSITION]` |
| 2026-10-17 | Branch updates by rebase on `main` (`push --force-with-lease`), never merge `main` into a branch; PRs land on `main` with a merge commit, never squash (owner rule of 2026-07-30, recalled 2026-10-17) | §8 is written under this rule. The older merge-based briefs (`brief-laneint.txt`, early R5/R6 merge habit) are superseded for branch updates. |
| 2026-10-18 ~20:55 | Code-fix after unfavourable reviews: "Spec d'abord" — remediation spec per branch, two GO-CODE, then code | This document. Code starts only after §11 gates. |
| Standing | 0 Python in repos and jobs; conventional English commit subjects with no attribution trailer; targeted tests only locally, full suites in CI only | §9.1. |

### 1.4 Evidence read for this spec

| Input | What was used | Status |
|---|---|---|
| `0985/rev355a-last.md` (Astra max) | Verdicts, 2 P1 on #355, 2 P1 + 3 P2 on #354, CI analysis, 53/53 targeted tests claimed by the reviewer | Read in full. Reproductions are reviewer evidence; code phase must re-prove each one as a RED test (§7). |
| `0985/rev355s-last.md` (Sol 6.1 xhigh) | Verdicts, same 4 P1, 5 P2 on #354, CI analysis, 63/63 targeted tests under Node 22.22.1 claimed by the reviewer | Read in full. Same rule as above. |
| `0985/mhl6-report.md` (1 395 lines) | Head: MH-L6 sub-lots A..F-2c6, "MH-L6 and E3b remain incomplete, no FUSIONNABLE verdict", explicit NOT-covered table. Tail: rebase/CI evidence appendix | Head and NOT-covered sections used as builder declarations. The long evidence appendix was sampled, not re-audited line by line: `partial`. |
| `0985/r5r6-report.md` (916 lines) | Head: 8 commits, RED/green table for 6 registry test files, NOT-covered table, deviations (interim bridge lock `h2a.registry-bridge-lock/v1`, interim bin `h2a registry-bridge`, explicit `--binding` for hosted verify). Tail: same rebase/CI evidence appendix | Same rule: head used, appendix sampled: `partial`. |
| Briefs `brief-mhl6.txt`, `brief-r5r6.txt`, `brief-lane088*.txt`, `brief-laneint.txt`, `brief-rev355*.txt` | Contract citations, confinement rules, lane history (merge era → rebase era) | Read. |
| Track registry, WP2.2 + WP12 | 8 + 10 items enumerated; 20 `item show` reads including both workpackage containers (Appendix A) | Read-only. Caveats in §1.5. |
| Reviewed worktrees | `mh-l0` at `ef9bde52a`, `r5r6` at `e8508e394`, both clean; every file:line cited by the reviews re-read at those heads for this spec | All 11 defect sites confirmed present as cited (§5). |
| `origin/main` (local ref) | `d0b1afa38a3f9cf86c6cbe48b4d2a9c2b086a188`, 2026-10-18, merge of [#377](https://github.com/rhanka/h2a/pull/377); merge-base with the lane is `5ccc98198`; lane is 66 behind, 171 ahead (#355) / 187 ahead (#354) | Local ref only. Freshness against the remote at code-phase start is `unverified` until the code phase fetches (§8, step 0). |

### 1.5 Source gaps recorded before any requirement

| # | Gap | Consequence for this spec |
|---|---|---|
| SG-1 | The Track CLI path named in the task brief under `~/.npm-global/.../@sentropic/track/dist/cli/bin.js` does not exist in this confinement. Reads were done read-only with the repository build `/home/antoinefa/src/h2a/packages/track/dist/cli/bin.js`, working directory `/home/antoinefa/src/h2a`, `item ls` + `item show` only. No Track write, no import. | Item bodies in §2 are quoted from that fallback reader. The stated installed path is `unverified`. |
| SG-2 | `/home/antoinefa/src/h2a` itself is a dirty checkout on an unrelated branch (`docs/org-raci-wp7-hinfra`), with `.track/events.jsonl` and `.track/head.json` modified in the working tree. | §2 reflects that working-tree registry state, which may include uncommitted events. It is the best available owner-request source and is labelled as such. No remediation lot may write `.track` from a lane worktree (§9.1). |
| SG-3 | Track item `01M515FVQC1M8D17BADRTH8Z6Z` still says "Version: 0.98.7" in its body. The 2026-10-17 owner decision moved the lane to 0.98.8. | Stale registry text. This spec follows the decision (§1.3). Fixing the registry text is a Track write for its designated writer, outside every lot here (§10). |
| SG-4 | Registry contract v9 exists but no brief, report or review in the input set targets it. Its delta against v8 was not reviewed for this spec. | D-03 in §11. Until decided, lots cite v8 section numbers. |
| SG-5 | No fresh CI query was run for this spec. CI states are taken from the two reviews (checked 11:41 UTC on their review date) and the agent reports. | CI-01..CI-03 (§5.3) are `unverified` against today's remote. §8 requires a fresh read before rebase. |
| SG-6 | The two huge evidence appendices in the agent reports were sampled. Individual log files under `0985/0988-rebase-ci-evidence/` were not opened. | Builder test counts are reported as builder claims, never as spec-verified results. Every acceptance test in §7 must be re-run in the code phase. |

## 2. What the owner asked for (verbatim sources)

Owner phrases below are quoted from Track item bodies read for this spec (SG-1, SG-2 apply). Spelling is preserved. Each phrase is tied to requirements in §3; §12 carries the full traceability table.

### 2.1 WP2.2 — "WP-F MCP-disconnect / false-live remediation" (`01KTST4ASW2DYD2R76VM1DBF37`)

| Item | Title | State | Owner phrase / demand used by this spec |
|---|---|---|---|
| `01M515FVQC1M8D17BADRTH8Z6Z` | MCP unique partagé qui ne décroche plus à l'upgrade | TO-DO / in-progress | « mcp unique sera quand dans quelle version ? » (10/10 05:04); « mcp unique: ca avance vraiment avec gemini 3.8 ? » (10/10 06:05); « n'omets pas le mcp-handover et pty-handover stp (reprise de socket) dans le plan » (11/10 15:37). Body also records: publication off `latest` until tested with real Claude clients. |
| `01M0KMX0N8HYQPA74PENBR90QF` | Reconnexion automatique MCP + actualisation sessions (`h2a restore`) via le serveur PTY centralisé | TO-DO | Owner feature request 2026-08-21: MCP made fragile again (drops at reboot/upgrade); centralisation must favour a stable process; optional per-MCP automatic reconnection triggered by PTY drive input, CLI upgrade restart, gateway pivot, etc., without breaking live sessions; `h2a restore` reflects real state after reconnect/restart. Explicitly depends on the centralised server existing first. |
| `01M53PPTH6EAPPFKZRF78V7T6Q` (D-013) | Reconnexion MCP en instruction ad hoc via le runtime | TO-DO | « le mcp a vraiment besoin d'être reconnecté ? le runtime devrait pouvoir permettre de lancer des instruction ad hoc comme la reconnection mcp anywhat (track, delegue) » (2026-08-01). |
| `01M53PQ5C10XEV6M7W0ZWBMTBX` (D-040) | MCP h2a: charger la version installée, démarrer sans reconnexion manuelle | TO-DO | « pourquoi quand je relance /mpc ca relance la veille version de h2a et pas celle qui est installée » (2026-08-14); « sur claude je dois reconnecter le mcp h2a (il ne fonctionne pas au démarrage) » (2026-09-12); plus repeated startup-failure reports through 2026-09-19. Body distinguishes D-040 (startup, loaded version, reconnection) from the single-MCP item. |
| `01KTT31AZVYPVH9VGRN7PVAYDF` | Phase 2a observability (`lastMcpActivityAt`, `connectionConfidence`) | done | Delivered observability. Remediation must not regress it (§3, RQ-11). |
| `01KTST4Y13EEVZWN2GXC071D4W` | Root-cause analysis: MCP drop = false-live (host without stdio auto-reconnect + blind heartbeat) | done | Root cause on record. It is why a per-session stdio server cannot be the target design (§3, RQ-01). |
| `01KV41H39HE2220KYGJ9NMMF5R` | `discover --live` presence-first + `connectionConfidence` | done | Delivered. Non-regression only. |
| `01KTST53F1CNBDXTWKPGDF0YAJ` | Phase 2 degraded sub-state when process alive without MCP activity | cancelled | Out of scope. Listed so no lot re-opens it by accident. |

### 2.2 WP12 — "MCP connector brokering & sharing" (`01KXDPBQY1X66M7ZRK72D34S56`)

| Item | Title | State | Relevance to this lane |
|---|---|---|---|
| `01M51R4ZFXJVPVFFWM1RABQ8YP` | Tous les MCP et le skill focus exposés via les registres cluster-mesh | TO-DO | Direct. Owner phrases (16/10): « focus devrait être présenté comme un putain de skill au registry de cluster-mesh pour les skills idem pour le mcp d'ui »; « tous les mcp de h2a devraient passer pareil par le mcp registry ». Scope per body: main MCP, Track MCP, `ui://` MCP (Focus/DS rendering) and Focus skill, registered and discovered via the cluster-mesh registries instead of installer-written config. |
| `01KWVM4Z972ZAFK6TKW753ZBR1` (x4) | h2a mcp pour enregistrer les connecteurs MCP aux CLI | TO-DO | Direct neighbour: register MCP connectors to CLIs through h2a. This lane covers h2a's own three MCP exposures only; third-party connector brokering stays with WP12 (§10). |
| `01M53PQCDA68QTYXY4Q6D6JB0S` (D-058) | jev/rtk on all CLIs; `judge` MCP skill gated on a token, after the first cluster-mesh version | TO-DO | Explicitly after this lane ("dans la 0.98.x apres la premiere version cluster mesh"). Not covered (§10). |
| `01KTQC2JK2Y3T7R8GQ6EQNHSJ5` (EVO-12) | Gateway broker deploy + go-live | TO-DO | Gateway scope, moved out of this lane by owner decisions. Not covered (§10). |
| `01KWVM4ZD4ADJQ70J1NEH7R6W1` (x5) | h2a ↔ Sentropic integration, workspace alignment | TO-DO | Neighbour. Only the registry contract seam is in scope here. |
| `01KYQ5KJWXFBRK2M2ZC8T1E221`, `01KYQ5KK3Z8ZGN4Q1VSMKXWJGR`, `01KYQ5KKTDWJZN270VYPK19C4Y` | Dossiers/UAT, remote control, Track report inside Sentropic | TO-DO | Not covered. They ride on the same single endpoint later; remediation must not add a second endpoint for them. |
| `01KYQWKM5DJF3GTD1E6TFVYB7T` | Sentropic enrollment has no entry point (Lot 0 client inert) | TO-DO (bug) | Not covered. Recorded because it is the same defect class as F-02/F-03 (built but unreachable). Remediation gates in §9 explicitly test reachability through the public surface to avoid repeating it in this lane. |
| `01M38WT0XG2KVRJ4HN28XETYNE` | Diagram frame-placement nature mechanism, written but not applied | TO-DO | Out of scope (diagrams). No lot touches it. |

### 2.3 The three owner demands this remediation must satisfy

Distilled from §2.1–§2.2 and the review briefs. Wording in quotes is the owner's; the rest is this spec's restatement.

1. **One shared MCP that stays connected.** "MCP unique partagé qui ne décroche plus à l'upgrade": one shared central MCP runtime serves the CLI sessions; an h2a upgrade does not disconnect live sessions, does not load the old version after install (D-040), and does not need a manual reconnect at startup (D-040, D-013).
2. **No per-CLI, per-version reconfiguration.** After one explicit bootstrap per host, changing h2a versions or changing the selected MCP providers must not require editing each CLI's MCP configuration again. The host keeps one stable entry, keyed `h2a`, across upgrades (registry contract §7.1, §7.3).
3. **MCP servers and skills are discovered through registries.** "tous les mcp de h2a devraient passer pareil par le mcp registry": the main h2a MCP, the Track MCP and the `ui://` MCP are package-owned registry entries, selected and configured through the registry lifecycle (`register / select / configure / compile / activate`), and the Focus skill goes through the skills registry. Registration is neither activation nor authorization (contract preamble).

Anything beyond these three demands is out of scope for remediation unless a cited contract clause makes it a precondition. Owner wording of 2026-10-13 applies: the perimeter is not extended beyond the owner request.

## 3. Target behaviour (normative requirements)

Each requirement is testable through a public surface (CLI verb, MCP wire, host config file, lock file). Internal-only claims do not satisfy a requirement.

| ID | Requirement | Source |
|---|---|---|
| RQ-01 | Exactly one MCP effect authority per server generation: the shared central runtime. A per-CLI-session bridge is transport plumbing only. It MUST NOT spawn an independent coordination or Track server authority, and MUST NOT silently fall back to one when central attachment fails. Failed attachment yields a typed refusal (`central_unavailable` / `missing_binding` family), never a substitute server. | Registry v8 §7.4, §6 (Activate row); WP2.2 root-cause item. |
| RQ-02 | At least one real Claude client path is actually admitted to the central and stays usable across the qualifying scenarios (initialization, recovery, dynamic catalog protocol + usage, usability), with measured evidence recorded in the qualification manifest. A release MUST keep at least one effectively qualified Claude path for every promise it announces. No client is admitted on protocol fixtures alone, and none is inferred from the launcher environment. | Spec v7 §10.2; registry v8 §7.4; manifest comment at `mcp-central-qualification.ts:18`. |
| RQ-03 | Upgrade does not disconnect the MCP. Under `h2a upgrade`, attached sessions survive through the shim/bridge according to the handover contract: immutable attachment owner, generation/epoch checks, no replay of unknown-outcome effects (send, launch, prompt, UI action), explicit unknown-outcome state where required. First transition from v1 is cold; afterwards the tool-list contract is add-only with `listChanged`. | Spec v7 §1.3, §5, §6, §7; registry v8 §7.4. |
| RQ-04 | After install, the loaded MCP is the installed version. No stale previous-version MCP is relaunched by a host reconnect, and startup needs no manual reconnect step on the qualified paths. | D-040 (§2.1); spec v7 §8. |
| RQ-05 | One upgrade command surface, fully wired: `h2a upgrade [--to <version>] [--dry-run] [--json] [--strict]`, `h2a upgrade --check [--json]`, `h2a upgrade status [--json]`, `h2a upgrade resume <upgradeId> [--json] [--strict]`, `h2a upgrade abort <upgradeId> [--json]`, `h2a upgrade compensate <upgradeId> --component mcp\|gateway [--json] [--strict]`, `h2a upgrade unmanage [--dry-run] [--json]`. Exit codes: 0 = requested selection done or no change needed (policy deferrals described), 2 = incomplete without definitive failure or strict-deferred step, 1 = real failure or contradiction. `SUCCESSOR_FAILED` is a real failure even beside a successful selection. A readable `status` returns 0 and resumes nothing. Diagnostic and dry-run requests MUST NOT enter the install path. No parallel `h2a handover …` surface. The native host is never restarted by upgrade: not on success, error, resume, abort, compensation or downgrade. | Spec v7 §8.1, §1.3; owner H4. |
| RQ-06 | Automatic upgrade and manual upgrade share the same orchestrator. There is no second code path that installs on behalf of a status, check or dry-run request. | Spec v7 §1.3 (H4), §8.9. |
| RQ-07 | The shipped generation accepts a live switch conducted from outside, under strict authorization, and never initiates one itself. The conformance pair may exercise that acceptance in qualification; the product does not start a live switch on its own. | Option A (`l3-explain/out.md`); DECISIONS 2026-10-15 (MH-L3 "passage à chaud", product never initiates). |
| RQ-08 | Host bootstrap is one explicit operator action per host/profile, through the registry bridge installer. It writes exactly one entry, always keyed `h2a`, in the host's native format (Claude Code plugin JSON or qualified `.mcp.json`; Codex plugin JSON or qualified `config.toml` `[mcp_servers.h2a]`; agy JSON `mcp_config.json`; Muse JSON `settings.json` only after stdio pickup is proven, else blocked; Vibe TOML `[[mcp_servers]]` named `h2a`). It preserves unrelated entries, comments and settings; a second identical install is byte-idempotent; plugin and file mechanisms for one host/profile are mutually exclusive and duplicates are refused. Launch paths (`h2a run`, `prepareCentralMcpForLaunch`, plugin preparation, daemon restart, bridge `serve`) MUST NOT write host MCP config, plugin declarations or the selection lock. | Registry v8 §7.1, §7.2, §7.3. |
| RQ-09 | Host config edits are transactional and loss-free. A concurrent user edit detected before publication aborts the install and leaves the concurrent bytes intact — the refusal itself MUST NOT restore older bytes over them. If any later step of the install transaction fails (receipt, lock), the host config is restored to its exact pre-install bytes or the install reports a named irrecoverable state; it MUST NOT leave a migrated config without its lock/receipt. Unknown same-key ownership is a conflict, never an overwrite. Uninstall removes only the unchanged installer-owned entry and refuses a conflicting user edit. | Registry v8 §7.1 (atomic compare-and-replace), §7.3 (installer tests); findings F-04, F-05. |
| RQ-10 | Registry lifecycle semantics hold end to end: `catalog()` is metadata-only with zero execution; `register` validates and freezes the local definition shell without calling its loader; `select` is an explicit complete allowlist (default empty, no wildcard); `configure` is per-provider; `compile` produces one immutable dispatch plan or diagnostics with no partial activation and no mutation of the active generation on refusal; `activate` accepts only the exact issued plan bytes and swaps atomically. A mutated plan object handed back by `compile` MUST NOT become activatable. Requests from an LLM or MCP peer cannot register, configure, select or activate providers. | Registry v8 §6, §9. |
| RQ-11 | Identity and session binding survive the bridge. The bridge establishes the auto-open presence identity through the qualified central attachment (verified installation, principal, native session ID, canonical workspace, current generation). `h2a_identity_status` on a conforming bridge session does not report `identity_disabled`. Provider parameters, lock values, CLI arguments and transport session IDs alone never mint identity. Track resolves the authorized repository per request from the validated attachment workspace, never from the central daemon's working directory. Delivered WP2.2 observability (`lastMcpActivityAt`, `connectionConfidence`, `recipientConfidence`) keeps working. | Registry v8 §7.1 step 5, §7.4; `cli.ts` auto-open semantics; WP2.2 done items. |
| RQ-12 | Qualified-name continuity: migration keeps the server key `h2a` and the plugin identity, so host-visible qualified tool IDs (`mcp__h2a__*`, and `mcp__plugin_h2a_h2a__*` where the host generates it) are exactly equal before and after migration at the same selection. No extra `sentropic-registry`, `track` or UI server keys appear in host declarations. | Registry v8 §7.1, §7.3 (RC2-M2). |
| RQ-13 | The published publisher entries are usable by the shipped registry: `sentropic.h2a` (coordination) and `sentropic.track` register, select, configure and compile from the packed artefacts, in both supported installed layouts (monorepo sibling packages and npm tree with Track under `h2a/node_modules/@sentropic/track`). A lazy definition's `load()` returns the validated handler contract the registry expects (handler `Map`), and unselected entries never evaluate their loader. | Registry v8 §3, §5, §6; findings F-09, F-10. |
| RQ-14 | The hosted read-only service (claude.ai connector) composes from the registry with its allowlist enforced (e.g. `hosted-read-only` excludes `h2a_send` dispatch). A hosted deployment lock that fails verification (e.g. `missing_binding`) MUST NOT be activatable; activation re-verifies admission instead of trusting the draft file. The hosted boundary stays OAuth-authenticated and independent of the private central transport. | Registry v8 §5.2, §6, §7.2, §7.4; finding F-08. |
| RQ-15 | Remote routing that depends on Sentropic R2 → R7a → R3 (after immo #679) is refused with an explicit typed diagnostic wherever it is missing, and that refusal is tested. There is no silent fallback to a local substitute, an unpinned fetch, or launch-time `npx`. | Owner addenda (§1.2); registry v8 §10.1 chain. |
| RQ-16 | Interim artefacts are named as interim and carry their migration identity: the h2a-owned bridge lock (`h2a.registry-bridge-lock/v1` today) and interim bridge command (`h2a registry-bridge` today) record the bridge identity in the install receipt so the later switch to `sentropic.registry-lock/v1` / `sentropic-registry` is an explicit migration, not a silent format change. Owners: R7a owns the final lock format and bin. | R5/R6 report deviations; registry v8 §7.1, §7.3. |
| RQ-17 | Nothing in this lane requires reconfiguring each CLI at each h2a version: adding or removing a provider changes only the selection lock; a new lock revision compiles to a new immutable generation through explicit bridge reload/restart; failed compilation preserves the admitted generation. A missing lock means an empty selection with an actionable diagnostic, never an inferred h2a server. | Registry v8 §7.1 steps 1–6, §7.3; owner demand 2 (§2.3). |

## 4. Current state at the reviewed heads

Facts below were re-read at `ef9bde52a` (#355) and `e8508e394` (#354) for this spec. They describe the starting point of remediation, before any lot runs.

### 4.1 What exists and is credited

- The MH machinery (MH-L0..L5 history plus MH-L6 sub-lots A..F-2c6 per the builder report) is present: central server, shim bridge (`bridgeCentralMcpStdio`), qualification gate, H4 journal/selection/delegation modules, closed-image packaging, and the new upgrade parser/dispatch modules under `packages/h2a/src/runtime/upgrade/`. The builder explicitly reports MH-L6 and E3b incomplete and claims no FUSIONNABLE verdict.
- The R5/R6 registry surface is present on #354: descriptors, local register/select/configure/compile, host bootstrap, hosted composition, CLI verbs (`registry`, `registry-bridge`, `hosted-lock`), generated entries for `sentropic.h2a` and `sentropic.track`, and 6 targeted test files reported green by the builder (7/7, 10/10, 8/8, 6/6, 7/7, 3/3). Green targeted tests coexist with the P1/P2 defects in §5: the existing tests do not cover the failing public paths. That is the core lesson every lot in §7 encodes as RED-first public-path tests.
- Central routing policy already refuses to invent qualification: `shouldUseCentralMcp` requires `qualifiedClaudeInitialize` plus Linux, `host=claude`, native session ID, canonical root, protocol-2 marker, and excludes structured sidecars and the cluster-mesh message backend (`mcp-central-policy.ts:31`). The defect is not the gate; it is that nothing can ever pass it (F-01).
- The registry bridge already refuses `hosted-read-only` on a CLI bridge, refuses `shared-central` off Linux / off Claude, and refuses a selection whose served surface differs from the delegated server (`cli-registry.ts:252` on #354). The defect is what happens after those checks: delegation to an independent stdio server (F-03).
- Vibe already has a TOML-aware installer path (`installVibeHost`, `vibe-toml.ts`) on #354. The TOML defect is specific to Codex falling through to the JSON path (F-06).

### 4.2 Gap summary against §3

| Requirement | State at reviewed heads |
|---|---|
| RQ-01 single authority | **Failed on #354.** The installed bridge serves an independent stdio server (60 tools, local store, no central marker in reviewer reproductions). |
| RQ-02 admitted real Claude | **Failed on #355.** `clients: []`; every initialization is refused and stays on per-session stdio. Explicitly deferred to MH-L8 by the builder. |
| RQ-03 upgrade keeps sessions | **Not covered.** No admitted client exists to exercise it end to end; handover machinery is present but its release promise is unqualified. |
| RQ-04 installed version loaded | **Partial / unverified.** Packaging and selection machinery exists; the public upgrade surface that drives it is not wired (F-02). |
| RQ-05/RQ-06 upgrade surface | **Failed on #355.** `cli.ts:7708` still calls the legacy `cmdUpgrade`; `parseUpgradeCommand`, `resumeUpgrade`, `abortUpgrade` are unreachable from the CLI. Status/dry-run enter the install path in reviewer reproductions. |
| RQ-07 passive live-switch acceptance | **Partial.** Present per MH reports; not re-audited by the two reviews. Remediation treats it as non-regression, not as new scope. |
| RQ-08 bootstrap formats | **Failed for Codex file installs** (JSON written to `config.toml`, F-06). Other hosts: builder-green tests, native pickup unqualified (R7b, §10). |
| RQ-09 transactional edits | **Failed on #354.** Concurrent edit destroyed by the refusal path (F-04); failed receipt write leaves migrated config without lock (F-05). |
| RQ-10 registry semantics | **Failed on #354.** Plan mutable and self-compared (F-07); refused compile mutates active handlers (F-11). |
| RQ-11 identity through bridge | **Failed on #354.** Installed bridge args omit `--auto-open`; `h2a_identity_status` returns `identity_disabled` in the Astra reproduction. Root cause is F-03 (no central attachment), with the missing flag as its visible symptom on the stdio path. |
| RQ-12 name continuity | **Partial.** Key `h2a` is used by renderers; the before/after qualified-ID equality test required by v8 §7.3 (`registry-host-tool-identities.test.js`) does not exist yet. |
| RQ-13 usable publisher entries | **Failed on #354.** Coordination definition loader returns no handler `Map` (F-09); Track manifest resolution assumes a monorepo sibling layout (F-10). |
| RQ-14 hosted lock admission | **Failed on #354.** `activateHostedLock` performs no verification (F-08). |
| RQ-15 typed refusal for remote routing | **Partial.** Central-profile refusals exist; full remote-routing refusal matrix depends on LOT-3 landing the conforming profile first. |
| RQ-16 interim artefacts named | **Met as deviation.** Interim lock/bin are declared in the builder report and receipts. Remediation must preserve this, not "fix" it by inventing the R7a formats early. |
| RQ-17 lock-only reconfiguration | **Failed in effect.** The lock machinery exists, but the served path bypasses the central it is meant to select (F-03), so lock changes do not deliver the promised behaviour. |

## 5. Finding registry (de-duplicated)

Severity keeps the reviewers' P1/P2 labels. "Both" means Astra and Sol found the same defect independently. File:line values are the reviewers' citations, re-verified at the reviewed heads for this spec (all 11 sites match). Reproductions are summarized; the code phase turns each one into a committed RED test before fixing (§7).

### 5.1 P1 — merge blockers (4)

| ID | PR | Defect | Site | Reviewer reproduction (summary) |
|---|---|---|---|---|
| F-01 | #355 | No real client is admitted to the shared MCP. The qualification manifest ships `clients: []`, so every `initialize` fails qualification and every session stays on individual stdio. The "single shared MCP" purpose cannot be qualified at all. Builder left this to MH-L8. Violates spec v7 §10.2 (at least one effectively qualified Claude path) and registry v8 §7.4. Both reviews. | `packages/h2a/src/runtime/mcp-central-qualification.ts:20` | `qualifiedClaudeInitialize()` returns `false` for a valid Claude `2.1.296` initialization (Astra) and for any version (Sol). |
| F-02 | #355 | The new H4 upgrade path is not wired into the CLI. Dispatch still calls legacy `cmdUpgrade`; `parseUpgradeCommand` / `resumeUpgrade` are never used by the public surface. Diagnostic and simulation requests run the install path. Violates spec v7 §8.1. Both reviews. | `packages/h2a/src/cli.ts:7708` | Astra: `upgrade status --json --skip-hosts` and `upgrade resume nonexistent-transaction --skip-hosts` both run the npm lookup path, exit 0, "already current or registry unreachable"; no H4 status or transaction check. Sol: `runCli(["upgrade","status",…])` and `cmdUpgrade({"dry-run":"true"},…)` each call `stageInstall` once. |
| F-03 | #354 | The registry bridge bypasses the central server and loses automatic identity. `registry-bridge serve` delegates straight to `runMcpServe` (independent stdio authority) instead of the authenticated central attachment (`bridgeCentralMcpStdio` / shim). Installed bridge args omit `--auto-open`. Violates registry v8 §7.4 (authenticated central attachment or explicit refusal). Both reviews. | `packages/h2a/src/cli.ts:7753`; `packages/h2a/src/registry/host-bootstrap.ts:50` (`bridgeArgs`); delegation in `packages/h2a/src/registry/cli-registry.ts:306` | Real SDK session, `shared-central` lock, private HOME, `H2A_MCP_CENTRAL=0`: connects, exposes 60 tools, creates a local store, no central marker (Sol); `h2a_identity_status` → `identity_disabled` (Astra). Each bridge becomes its own stdio authority. |
| F-04 | #354 | Refusing a concurrent host-config edit destroys that edit. `atomicWriteWithBackup` correctly detects the change, then its `catch` "best-effort restore" rewrites the pre-read bytes over the concurrent edit. Violates registry v8 §7.1 atomic compare-and-replace and §7.3 preservation. Both reviews. | `packages/h2a/src/registry/host-bootstrap.ts:160` | Replace the config between initial read and staging publication: install refuses with "config changed / refusing to overwrite", and the concurrent edit is gone afterwards. |

### 5.2 P2 — correctness and contract defects (7)

| ID | PR | Defect | Site | Reviewer reproduction (summary) |
|---|---|---|---|---|
| F-05 | #354 | A failed install leaves the config migrated with no lock. Config write precedes receipt write; if the receipt write fails, nothing restores the previous MCP entry. Transaction is not atomic across its own steps. Astra only. | `packages/h2a/src/registry/host-bootstrap.ts:322` | Create a directory at `<config>.h2a-registry.json`, run `registry bootstrap install`: exit 2, config already replaced by the bridge entry, lock/receipt absent. |
| F-06 | #354 | Codex file install uses JSON for its TOML config. Every non-Vibe host falls through to `installJsonHost`, including Codex `config.toml`. Violates registry v8 §7.2 (Codex file target is TOML `[mcp_servers.h2a]`; old JSON hints are not qualification). Astra only. | `packages/h2a/src/registry/host-bootstrap.ts:397` | `bootstrap install --host codex --config <fixture>/config.toml`: valid TOML is refused as "not JSON"; if the file is absent, install succeeds by writing JSON into `config.toml`. |
| F-07 | #354 | The compiled plan stays mutable and its integrity check compares an object with itself. `compile` stores the same object reference it returns; `activate` hashes `issued` vs `plan`, which are the same mutated object. Violates registry v8 §6 (one immutable plan). Both reviews. | `packages/h2a/src/registry/registry.ts:434` | Compile `hosted-read-only`, add `plan.ownership.h2a_send = "sentropic.h2a"` (Sol also extends `orderedCapabilities`), activate, dispatch `h2a_send`: accepted, handler runs once despite initial exclusion. |
| F-08 | #354 | `hosted-lock activate` accepts a draft that `verify` refuses. Activation copies the file with no admission check. Both reviews. | `packages/h2a/src/registry/hosted.ts:187` | Draft lock with unbound tenant: `verifyHostedLock` → `missing_binding`; `activateHostedLock` on the same file → `activated`, active lock published. |
| F-09 | #354 | The published coordination definition is unusable by the shipped registry. `load()` imports `runtime/mcp/handlers.js`, which does not provide the expected handler `Map`. Sol only. | `packages/h2a/src/registry/definitions.ts:44` | Register `h2aCoordinationDefinition`, select/configure `sentropic.h2a`, compile → `invalid_entry: … loader returned no handler map`. |
| F-10 | #354 | Track manifest resolution depends on the monorepo layout. `packedManifests()` resolves Track as a sibling package (`../../../track/…`), which breaks in a valid npm tree where Track lives under `h2a/node_modules/@sentropic/track`. Sol only. | `packages/h2a/src/registry/cli-registry.ts:58` | In a temporary copy of the npm layout with the Track asset present: bootstrap succeeds, then serve fails `ENOENT` on the wrong path. |
| F-11 | #354 | A refused compilation mutates the active handlers. `compile` assigns `stored.handlers` before full validation completes, so a later refusal still leaves the new handlers in place under the old generation. Violates registry v8 §6 atomicity ("candidate failure retains the previous valid active generation"). Sol only. | `packages/h2a/src/registry/registry.ts:383` | Activate G1, recompile with a different loader and an invalid transport: compilation refused, generation still G1, dispatch already uses the new handlers. |

### 5.3 CI findings (3)

CI state in both reviews: #354 = 18/18 green; #355 = 17 green, 1 red. Run [39105171197](https://github.com/rhanka/h2a/actions/runs/39105171197), job `build-and-test (ubuntu-latest, 22)`, step "Run npm test", 25 min 48 s.

| ID | Finding | Evidence per reviews | Spec disposition |
|---|---|---|---|
| CI-01 | The red job is a **local test timeout**, not a proven functional assertion failure and not the global job budget. `candidate-artifacts.test.js` kills its packaging producer at the test-internal 230 s limit (`231093 ms`, `killed: true`, `SIGTERM`), then `npm test` exits 1. Global job timeout is 35 min. | `packages/h2a/test/candidate-artifacts.test.js:38` (`timeout: 230_000`, test budget `240_000` at line 29, re-read for this spec). Both reviews agree. | LOT-7. The fix must be evidence-based (slowest-step timings from CI), never a blind budget raise and never a weaker tarball assertion. Raising any budget needs the timing evidence attached and double review (§9). |
| CI-02 | A second failure cause in the same initial run: fragmented-chunk oracle false negative in `drive.functional.test.ts`. The journal contains `"r"` then `"ecent-human-input\r"`, while the predicate searches the whole string inside a single chunk. The test passes in isolation. Sol only. | `packages/h2a-runtime/src/native-terminal/drive.functional.test.ts:251` (`value.chunks.some(chunk => chunk.data.includes("recent-human-input"))`, re-read for this spec). | LOT-7. `[PROPOSITION]` Fix the oracle to match over the concatenated stream. That corrects the observation method; it must keep asserting the same product fact (the human input reached output before the drive lease decision). If review judges any part of the change a weakening, the lot stops and escalates (§11). |
| CI-03 | Attempt 3 of the same run failed in 55 s before tests: artifact `m17-39105171197-3-node22` not found; only attempt-2 artifacts exist. It requalifies nothing. Both reviews. | [Job 117664703638](https://github.com/rhanka/h2a/actions/runs/39105171197/job/117664703638). | LOT-7. Integration qualification runs on a fresh push/merge-ref event for the rebased head (§8), never on a rerun of an old attempt. Artifact naming across attempts is checked, not assumed. |

### 5.4 Builder-declared gaps that remediation inherits (not review findings)

These were already declared `not covered` by the builders. Remediation lots must not silently absorb them; §10 lists their final disposition.

- MH-L6 report: B2-3 real observers for legacy engine closures (.5/.6) + M18 producer; E2b3 other native entries and legacy probe; E3b2b PR-artifact smoke, backfills, final packaging; E3c .6 freeze and real relaunches U07/U11; F remainder (common CLI/auto surface, U01/U05/U08, inter-transaction authority completion, M18 activation); real-machine diagnostics on unqualified profiles; load/endurance (M17); independent review selection failed (`selection-failed`, no consensus claimed).
- R5/R6 report: live switch of the hosted service onto the composition (`mcp-http/app.ts`, deployment decision + owner GO); filtered server for partial selections (typed refusal today); R5-CA central adapters for codex/agy/muse/vibe with strict `central_unavailable` and no fallback; Sentropic R2/R7a/R3 and shared GWRC-CI-V1 block; R7b native host qualification; R6 UI module beyond the hosted boundary.
- Version note: both worktrees and `origin/main` currently carry `@sentropic/h2a` version `0.98.7` (re-read for this spec). The 0.98.8 bump is a release act at the end of integration, not a remediation lot edit (§8).

## 6. Target design

Normative behaviour is §3. This section fixes the shape that the lots implement. Every item here is a `[PROPOSITION]` unless it restates a cited contract clause.

### 6.1 One authority, two transports, zero substitutes `[PROPOSITION]`

- The central runtime (MH lane, #355) remains the only coordination/Track effect authority for the conforming `shared-central` profile.
- Two client-side attachments exist and both end at the same authenticated binding:
  1. **Direct shim path** (existing): host launches `h2a mcp-serve` / `mcp-central-connect`; `bin.ts` peeks the first `initialize`, applies `shouldUseCentralMcp`, and either runs `runCentralShim` → `bridgeCentralMcpStdio` or falls back to legacy stdio **only outside the conforming registry profile** (existing behaviour for ineligible routes, registry v8 §7.4 last-but-one paragraph).
  2. **Registry bridge path** (#354, to fix): host launches the single installed `h2a` bridge entry; the bridge reads the lock, compiles the plan, and for `shared-central` delegates to the **same** `bridgeCentralMcpStdio` attachment with the verified native-session context. It never delegates to `runMcpServe` as an authority.
- `H2A_MCP_CENTRAL=0` (and equivalents) on the conforming profile is an explicit opt-out that produces a typed refusal at bridge level, not a silent stdio authority. Outside the conforming profile, existing opt-out semantics are unchanged. This split is the exact difference between "existing behaviour" and "compliance with the new `shared-central` registry profile" (registry v8 §7.4).
- Partial selections (lock surface ≠ served surface) keep today's typed refusal until a filtered server exists. Remediation does not invent subset serving (builder NOT-covered item, §10).

### 6.2 Qualification manifest: earned entries only `[PROPOSITION]`

- `claudeQualificationManifest.clients` stays evidence-based and exact (name, version, platform, Node majors, protocol versions, five boolean observations, evidence string). No wildcard, no range, no environment inference — the current type and comment already encode this and are kept.
- An entry is added only by the LOT-2B campaign output: measured initialization, recovery, dynamic-catalog protocol oracle (new `tools/list` received by the shim within the pre-fixed scenario delay, ≤ 10 s after the planned stimulus), dynamic-catalog usage oracle (same session, same shim, added tool actually invoked, ≤ 3 identical pre-defined solicitations), usability — per spec v7 §10.2 M10.
- Until at least one entry exists, every surface that describes the lane (PR body, release notes, status output) MUST describe the shared MCP as not yet admitted for real clients. The lane is not mergeable *as the single-shared-MCP delivery* before LOT-2B (§9, gate G-2). Merging inert machinery earlier under a reduced claim is an owner decision, not a default (D-01, §11).

### 6.3 Upgrade wiring: parse, authorize, then act `[PROPOSITION]`

- `runCli` routes `upgrade` through `parseUpgradeCommand(argv-after-upgrade)` first. Parse failures are usage errors (exit 1, no side effect, no install call).
- Actions map as follows: `run` → the existing H4 orchestrator entry (selection/install/activation pipeline built by MH-L6 F-lots) with `dryRun` honoured before any mutation; `--check` → version check only (`current`/`latest`/`upgradeAvailable` preserved); `status` → read-only H4 journal/selection report, resumes nothing, exit 0 when readable; `resume` → `resumeUpgrade` (CLI authority check first, engine reconcile second); `abort` → `abortUpgrade` (only reversible PREPARING/PREPARED closes, idempotent); `compensate` → component-scoped compensation for `mcp|gateway`; `unmanage` → existing unmanage path with `dryRun` support.
- Every action returns the versioned result envelope; JSON mode writes no logs to stdout; exit codes come from `upgradeExitCode` semantics (§3, RQ-05). Legacy `cmdUpgrade` behaviour that §8.1 explicitly preserves (bare-command JSON, `--check` fields) is preserved through the new routing, not by keeping the old dispatch.
- The wiring lot owns CLI contract, help text, fixtures and goldens together (spec v7 §8.1: "Contrat CLI, aide, fixtures et schémas évoluent ensemble").

### 6.4 Host bootstrap transactions `[PROPOSITION]`

- One transaction function owns the whole per-host install: read original bytes → render candidate → preflight every fallible step that can be preflighted (receipt path writable and not a directory, lock path valid, format adapter selected) → compare-and-publish config → write receipt/lock → on any failure after publication, restore exact original bytes and remove partial receipt/lock artefacts created by this transaction.
- Concurrent-edit detection happens against a fresh re-read immediately before `rename`. On mismatch the transaction aborts **without writing the target at all**: the staging file is unlinked, the concurrent bytes stay, the error reports the refusal. The current catch-restore is removed for the not-yet-published case; restore-on-failure applies only to bytes this transaction itself published.
- Format adapters are selected by host, never by fallthrough: `claude`/`agy`/`muse` → JSON adapters (each with its own native shape); `codex` file mechanism → TOML adapter for `config.toml` `[mcp_servers.h2a]`; `vibe` → existing TOML adapter. A host/format pair with no qualified adapter returns `unsupported_host` before any write. Writing JSON bytes into a `.toml` target is impossible by construction (adapter output is validated by re-parsing in the target format before publication). `[PROPOSITION]` on the re-parse validation detail; the format assignment itself is registry v8 §7.2.
- Muse file install stays blocked (`unsupported_host`) until generic stdio bridge pickup is proven on the exact Muse build (registry v8 §7.2). No arbitrary HTTP URL workaround.

### 6.5 Registry core: freeze, clone, validate-then-commit `[PROPOSITION]`

- `compile` builds the plan as a fresh value, deep-freezes it (or stores a canonical-byte snapshot), stores **that snapshot** in `issuedPlans`, and returns a value the caller cannot use to mutate the issued snapshot (frozen object and/or independent clone). `activate` compares canonical bytes of the presented plan against the stored snapshot bytes; any divergence is `integrity_mismatch`.
- Handler loading during `compile` goes into per-candidate scratch state. `stored.handlers` (the active generation's dispatch table) is replaced only at successful activation. A refused candidate leaves dispatch bit-identical to before the attempt.
- `activateHostedLock` runs the same admission verification as `verifyHostedLock` (including operator-attested `--binding` contracts) before publishing; a non-`ok` verdict aborts with the same diagnostics and publishes nothing.
- The coordination definition's `load()` adapts the real handler module to the registry's expected shape (`{ handlers: Map, manifest? }` per the shipped registry's loader contract) inside the lazy boundary. The static import graph of `./registry/definitions` stays free of cluster-mesh, h2a-runtime, node-pty and handler modules (existing header contract, kept).
- Packed asset resolution uses package-relative resolution that works in both layouts of RQ-13 (e.g. `import.meta.resolve` / `createRequire` against the `@sentropic/track` package root, with the monorepo sibling as a tested fallback — exact mechanism is `[PROPOSITION]`, both layouts are gated either way).

## 7. Remediation lots

### 7.0 Lot rules (apply to every lot)

- **Order and stacking.** LOT-0 → LOT-1 → LOT-2A on #355; LOT-3 → LOT-6 on #354 rebased onto the new #355 head; LOT-2B qualifies the integrated head; LOT-7 closes CI/integration. LOT-4, LOT-5, LOT-6 are mutually independent once LOT-3's bridge seam is fixed, but they land in numeric order to keep single-writer files single-writer (`cli.ts`, `host-bootstrap.ts`, `registry.ts`, `cli-registry.ts` each have exactly one owning lot at a time). `[PROPOSITION]` on ordering; the dependencies LOT-1→LOT-3 (public CLI truth) and LOT-2→LOT-3 (admitted route to attach to) are hard.
- **RED first.** Each lot starts by committing (or at minimum running and recording) its RED tests against the rebased pre-fix head. The RED run command and output go into the lot report. A RED test that skips for any reason counts as failed, per owner rules.
- **Public path only.** RED/green tests drive the public surface named in the lot (built `dist` CLI in a temp HOME, MCP SDK wire session, or the registry API exactly as a consumer calls it). Direct unit tests of internals may be added, but never as the only proof.
- **Confinement.** Tests use `mkdtemp` dirs with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `TMPDIR` inside the temp dir. No test touches real host homes, the installed `h2a`, or owner live state. Processes started by a test are stopped by that test (own PIDs only).
- **Both Node majors.** Every lot gate runs its targeted files on Node 22 and Node 24 (owner decision 2026-10-12: Node 20 is out of the qualified domain). Targeted commands only locally (`node --test <file>` / `vitest run <file>`); full suites run in CI.
- **Build freshness.** Tests that exercise `dist` run against a build from the same tree (`tsc -b` clean, exit 0, no output). Stale-dist green counts as no proof.
- **No guard weakening.** No lot deletes, skips, or loosens an existing test, timeout, or refusal to reach green. The single test-oracle correction in LOT-7 (CI-02) is gated as described there.
- **Commits.** Conventional English subjects, no attribution trailer, one coherent commit per lot step, pushed fast-forward to the lot's own branch only (rebase pushes use `--force-with-lease` per §8). Never `main`.
- **Estimates** are agent-hours and review rounds (owner rule), marked as estimates, not measurements. They exclude CI wall-clock and reviewer latency.

### LOT-0 — Freeze, rebase, baseline (no behaviour change)

| Field | Content |
|---|---|
| Branch | #355 first, then #354 onto it (full procedure in §8). |
| Goal | Both branches on current `origin/main`, reviewed defects still reproducible, baseline recorded. No product edit in this lot. Any conflict resolution that would change behaviour stops the lot and is reported, not improvised. |
| RED tests | None new. Baseline = re-run of the reviewer reproduction sketches as throwaway probes in `/tmp` (not committed) to confirm F-01..F-11 still reproduce after rebase, plus targeted re-run of: `packages/h2a/test/mcp-central.test.js`, `packages/h2a/test/mcp-central-attachments.test.js`, `packages/h2a/test/upgrade.test.js`, `packages/h2a/test/registry-r5-cli.test.js`, `packages/h2a/test/registry-r5-host-bootstrap.test.js`, `packages/h2a/test/registry-r5-lifecycle.test.js`, `packages/h2a/test/registry-r6-hosted.test.js`, `packages/track/src/mcp/registry-contract.test.ts` (Node 22 + 24). Divergence from builder-reported results is recorded, not fixed here. |
| Exact files | No source files. Conflict-prone set pre-identified in §8. `.track/` diff must stay empty on both branches (verified, as the builders did). |
| Gates | Clean `git status`; `tsc -b` exit 0; baseline table in the lot report with commands and outputs; fresh `gh` CI read for both PRs recorded (closes SG-5 for the code phase). |
| Exit | Rebased heads pushed with `--force-with-lease`; defects F-01..F-11 confirmed present; estimate: 2–4 agent-hours, 0 review rounds (conductor check only). `[PROPOSITION]` |

### LOT-1 — Wire the H4 upgrade surface into the CLI (F-02 → RQ-05, RQ-06)

| Field | Content |
|---|---|
| Branch | #355 (`feat/0.98.7-mh-l6`, worktree `mh-l0`). |
| RED tests first | New file `packages/h2a/test/upgrade-h4-cli-wiring.test.js` `[PROPOSITION]` (or extension of `packages/h2a/test/upgrade.test.js` if review prefers; one home only). Cases, all through `runCli`/built binary with every external operation stubbed and counted: (a) `upgrade status --json` returns the H4 versioned envelope, exit 0, `stageInstall` calls = 0, npm lookup calls = 0; (b) `upgrade resume <unknown-id> --json` fails with the typed transaction/authority error, exit 1, install calls = 0; (c) `upgrade --dry-run --json` performs zero install/mutation calls; (d) `upgrade --check --json` keeps `current`/`latest`/`upgradeAvailable` and installs nothing; (e) `upgrade abort <id>` on a reversible fixture transaction closes it idempotently (second abort = same result); (f) `upgrade compensate <id> --component mcp` routes to component compensation, `--component bogus` is a usage error with zero side effects; (g) `upgrade unmanage --dry-run` mutates nothing; (h) unknown flag / missing `<upgradeId>` / stray positional → usage error, zero side effects; (i) a `SUCCESSOR_FAILED` outcome beside a completed selection exits 1; (j) `status` on a readable journal exits 0 and advances no transaction phase. On the pre-fix head, (a)–(d) fail exactly as in F-02. |
| Exact files | `packages/h2a/src/cli.ts` (dispatch at the F-02 site; remove legacy-only routing for the H4 surface); `packages/h2a/src/runtime/upgrade/upgrade-cli.js` (`parseUpgradeCommand`, `upgradeExitCode` — reuse as-is unless RED proves a gap); `packages/h2a/src/runtime/upgrade/upgrade-dispatch.js` (`resumeUpgrade`, `abortUpgrade`); the H4 store/orchestrator modules those two already depend on (read at code time; no new parallel orchestrator); `packages/h2a/src/cli-contract.ts`, `packages/h2a/src/cli-command-map.ts` (verb/flag surface, help); goldens under `docs/contracts/golden/` and `packages/h2a/test/dispatch-characterization-goldens.test.js`, `packages/h2a/test/cli-contract.test.js` (regenerate only from the new real `--help`/contract output, hash recorded). |
| Implementation contract | §6.3. Manual and automatic upgrade enter through this one routing (RQ-06): the auto-upgrade caller is re-pointed at the same orchestrator entry the `run` action uses; a grep-level proof that no other call site reaches the install pipeline is part of the lot report. Native host is never restarted on any branch of the dispatch. |
| Gates | RED→green on the new file (Node 22 + 24); neighbours green: `upgrade.test.js`, `mh-l6-upgrade-run.test.js`, `upgrade-public-api-compat.test.js`, `cli-contract.test.js`, `dispatch-characterization-goldens.test.js`; `tsc -b` clean; public-contract check (verb inventory) consistent. |
| Exit | F-02 closed with red-before/green-after proof. Explicitly still open after this lot: F-remainder items the builder declared (B2-3 observers, M18 activation, U01/U05/U08 depth) — they are §10, and this lot must not claim them. Estimate: 4–8 agent-hours, 1–2 review rounds. `[PROPOSITION]` |

### LOT-2A — Qualification mechanism integrity (F-01, code half → RQ-02)

| Field | Content |
|---|---|
| Branch | #355. |
| Goal | Prove the admission mechanism is correct and cannot be bypassed or faked, **without** inventing a qualified client. After this lot, `clients` may still be empty; what changes is that emptiness is loudly and correctly reported, and a future measured entry is the only thing needed. |
| RED tests first | Extend or add `packages/h2a/test/mcp-central-qualification.test.js` `[PROPOSITION]` (check for an existing home first). Cases: (a) with a synthetic fixture manifest containing one exact entry, `qualifiedClaudeInitialize` accepts only byte-exact name/version/platform/Node-major/protocol matches with all five observations true and non-empty evidence; each single-field deviation refuses; (b) the shipped manifest with `clients: []` refuses every initialization **and** the `bin.ts` route reports the unqualified state on stderr (`claude_version_unqualified`) while keeping legacy stdio behaviour outside the conforming profile; (c) no environment variable, flag, or config value can force admission (matrix over `H2A_MCP_CENTRAL`, settings `enabled`, `--host`, sidecar readiness envs, cluster-mesh backend flags — admission still requires the manifest match); (d) structured sidecar launches stay excluded. On the pre-fix head, (b)'s reporting/expectations and any missing exactness case fail; (a) may already pass — passing parts are recorded as mechanism proof, not as lot credit. |
| Exact files | `packages/h2a/src/runtime/mcp-central-qualification.ts`; `packages/h2a/src/runtime/mcp-central-policy.ts` (`shouldUseCentralMcp`, `centralRoutingEnabled`); `packages/h2a/src/bin.ts` (initialize peek + reporting); `packages/h2a/src/runtime/mcp-central-shim.ts` and `packages/h2a/src/runtime/handover/shim-bridge.js` only if RED proves a reporting/refusal gap there. |
| Implementation contract | No new bypass, no widened match (no semver ranges, no prefix match), no fixture entry shipped in the production manifest. Test fixtures use clearly synthetic client names/versions that cannot collide with a real Claude build. |
| Gates | New/extended test file green (22 + 24); neighbours: `mcp-central.test.js`, `mcp-central-attachments.test.js`, `mh-l3-central.test.js`, `mh-l4-central.test.js`; `tsc -b` clean. |
| Exit | Mechanism proven; F-01 remains open as a **qualification** blocker until LOT-2B. The lot report states this in its first line. Estimate: 3–6 agent-hours, 1 review round. `[PROPOSITION]` |

### LOT-2B — Real-Claude qualification campaign (F-01, evidence half → RQ-02, RQ-03)

| Field | Content |
|---|---|
| Branch | #355 integrated head (after LOT-1, LOT-2A; ideally after LOT-3 so the bridge path is qualified in the same campaign — sequencing `[PROPOSITION]`, decision D-01). This is the MH-L8 scope the builder deferred, bounded to what F-01 needs. |
| Goal | At least one real Claude build admitted with measured evidence, or a recorded, explicit failure that keeps the lane unmergeable under its current claim. Both outcomes are valid lot results; a silent empty manifest is not. |
| RED first | The campaign itself is the test: before it runs, the conforming-path check "a real Claude session attaches to the central and completes the M10 oracles" fails (that is F-01). The campaign protocol is committed **before** execution: exact Claude version/build, OS, Node major, negotiated protocol, stimulus and pre-fixed delays (spec v7 §10.2: protocol oracle ≤ 10 s after the planned stimulus; usage oracle ≤ 3 identical pre-defined solicitations, same session, same shim), recovery scenario (central restart under attached sessions), add-only catalog scenario (tool added via `listChanged`, then invoked), and the upgrade-survival scenario (RQ-03: `h2a upgrade` with sessions attached; no unknown-outcome replay). Changing the protocol after seeing results invalidates the run. |
| Environment | Real Claude binary in an isolated qualification HOME with enrolled seats under the owner's seat rules (temporary HOMEs, login files only, erased after; shared-quota campaign cap per the 2026-10-18 seat decision). Never the owner's live sessions or live h2a state. Linux first (qualified domain); other platforms stay unqualified (§10). |
| Exact files | `packages/h2a/src/runtime/mcp-central-qualification.ts` (add earned entries only, evidence string naming the campaign artefact); campaign evidence under the lane's existing evidence convention (`docs/plan/mh-l6/evidence/…` on #355 — confirm exact home at code time, do not invent a second evidence tree); qualification harness/test files as committed by the protocol (names fixed in the protocol commit). |
| Gates | Manifest diff contains only earned entries; every boolean in each entry maps to a named observed artefact; LOT-2A tests still green with the populated manifest; a negative check (neighbouring unlisted Claude version still refused) is recorded. |
| Exit | Either RQ-02 satisfied for ≥ 1 named Claude build, or F-01 stays open with the failing oracle named (deterministic shim failure blocks qualification and is never converted into an opportunistic client exclusion — spec v7 §10.2). Estimate: 8–16 agent-hours plus seat/quota availability, 2 review rounds. `[PROPOSITION]` |

### LOT-3 — Registry bridge attaches to the central (F-03 → RQ-01, RQ-11, RQ-15, RQ-17)

| Field | Content |
|---|---|
| Branch | #354 (`feat/0.98.7-registry-r5r6`, worktree `r5r6`), rebased on the LOT-1/LOT-2A head. |
| RED tests first | New `packages/h2a/test/registry-bridge-central.test.js` `[PROPOSITION]`, driving the real MCP SDK wire against the built bridge in a temp HOME with a fixture central (test-owned process on a temp runtime base; marker under the temp dir): (a) `shared-central` lock + qualified fixture route → initialize succeeds **through the central** (central-side attachment observable: attachment record / marker generation consumed, no local store created by the bridge process); (b) same lock with central absent / stale marker / wrong root / protocol mismatch → typed refusal on the wire (`central_unavailable` family), zero tools served, no local store, bridge exits with the refusal code; (c) same lock with `H2A_MCP_CENTRAL=0` → typed refusal, **not** a 60-tool stdio server (this is the exact F-03 reproduction, inverted); (d) after successful attachment, `tools/list` equals the compiled plan surface and `h2a_identity_status` is not `identity_disabled`; (e) Track call through the bridge resolves the fixture repository from the attachment workspace, not from the central process cwd (two-repository fixture); (f) non-Claude host with `shared-central` → `missing_binding` refusal (keeps today's gate, now also asserting no server starts). On the pre-fix head, (a) fails (no attachment), (c) fails (serves 60 tools), (d) fails (`identity_disabled`). |
| Exact files | `packages/h2a/src/cli.ts` (`registry-bridge` deps wiring at the F-03 site: delegate to the central shim, not `runMcpServe`, for the conforming profile); `packages/h2a/src/registry/cli-registry.ts` (`cmdRegistryBridge`: replace `delegateServe(passthrough)` terminal step with the attachment binding; keep all existing refusals); `packages/h2a/src/runtime/mcp-central-client.ts` / `packages/h2a/src/runtime/mcp-central-shim.ts` / `packages/h2a/src/runtime/handover/shim-bridge.js` (reuse `bridgeCentralMcpStdio`; adapt its options seam only as needed for bridge-supplied verified context); `packages/h2a/src/registry/host-bootstrap.ts` (`bridgeArgs`: installed args carry the identity-establishing context the attachment needs — at minimum stop dropping auto-open semantics; exact arg shape follows the shim's existing flag contract in `mcp-central-context.ts`, no new flag vocabulary); `packages/h2a/src/registry/bridge-lock.ts` only if the lock must name the attachment contract explicitly (binding ref `h2a-local-central` / contract `h2a.central-attachment/v2` already exist — reuse). |
| Implementation contract | §6.1. The bridge invokes the attachment factory only after lock/metadata/pin preflight and successful compile (registry v8 §7.1). Identity comes from the attachment, never from lock/args (§3, RQ-11). `runMcpServe` remains reachable for the legacy non-conforming routes only; the lot report includes the call-site inventory proving the conforming profile cannot reach it. No host config is written by `serve` (hashes asserted in test). |
| Gates | New file green (22 + 24); neighbours: `registry-r5-cli.test.js`, `registry-r5-lifecycle.test.js`, `mcp-central-attachments.test.js`, `mcp-central.test.js`, `mcp-identity-readiness.test.js`; `tsc -b` clean; served-surface equality with the 60-tool descriptor set still enforced. |
| Exit | F-03 closed. Non-Claude central adapters (R5-CA) remain refused and §10-listed; this lot does not widen host support. Estimate: 8–14 agent-hours, 2 review rounds. `[PROPOSITION]` |

### LOT-4 — Host-bootstrap transaction safety and native formats (F-04, F-05, F-06 → RQ-08, RQ-09, RQ-12)

| Field | Content |
|---|---|
| Branch | #354. Single writer for `host-bootstrap.ts` in this lot (LOT-3's `bridgeArgs` touch lands first). |
| RED tests first | Extend `packages/h2a/test/registry-r5-host-bootstrap.test.js` and add `packages/h2a/test/registry-host-tool-identities.test.js` (the file registry v8 §7.3 already names). Cases: **F-04** — deterministic concurrent edit injected between read and publish (test hook or staged-write interposition) → install refuses, target bytes afterwards equal the concurrent bytes exactly, no backup-restore overwrite, staging file removed. **F-05** — receipt path pre-created as a directory (reviewer setup) → install exits non-zero and target bytes equal the exact pre-install bytes (previous entry restored), no partial receipt/lock left by the transaction. **F-06** — Codex: valid `config.toml` fixture installs as TOML (`[mcp_servers.h2a]`, unrelated tables/comments preserved, re-parseable as TOML, not JSON); absent `config.toml` creates valid TOML, never JSON bytes; a JSON-shaped `config.toml` is refused without writes. **RQ-08 matrix** — for each host in {claude, codex, agy, muse, vibe}: exactly one entry keyed `h2a`; second identical install byte-idempotent (same bytes, same lock revision); unrelated entries/settings preserved; duplicate mechanism refused; `muse` returns `unsupported_host` with zero writes until its pickup proof exists; uninstall removes only the unchanged installer-owned entry and refuses after a user edit of that entry. **RQ-12** — Claude and Codex fixtures (plugin and file mechanisms): capture complete qualified tool-ID sets before migration, migrate, assert exact set equality at the same selection; allowlist/hook fixture replay with no new denials. On the pre-fix head, F-04/F-05/F-06 cases fail as reproduced by the reviewers. |
| Exact files | `packages/h2a/src/registry/host-bootstrap.ts` (`atomicWriteWithBackup` F-04 site; `installJsonHost` ordering F-05 site; `installBridgeEntry` host dispatch F-06 site; `installVibeHost` kept and reused as the TOML pattern); `packages/h2a/src/registry/vibe-toml.ts` (extend/reuse for Codex TOML only if the Codex shape fits without weakening Vibe's; otherwise a sibling Codex TOML adapter module next to it — one adapter per format, `[PROPOSITION]` on the split); `packages/h2a/src/registry/bridge-lock.ts` (receipt/lock writes pulled into the transaction); `packages/h2a/src/registry/cli-registry.ts` only for bootstrap verb exit-code/diagnostic plumbing. |
| Implementation contract | §6.4. Preflight everything preflightable before publishing config bytes. The refusal path never writes the target. Restore covers only self-published bytes. Format chosen by host, validated by re-parsing candidate bytes in the target format before rename. Legacy non-default entries (existing `legacyJsonDeviation` logic) keep refusing silent normalization. |
| Gates | Extended + new files green (22 + 24); neighbours: `host-config-preservation.test.js`, `host-mcp-scenario.test.js`, `registry-r5-cli.test.js`, `vibe-mcp-direct.test.js` (interim direct Vibe entry migrates to the bridge entry with key preserved — R5/R6 brief requirement, asserted here); `tsc -b` clean; fixture homes only, real HOME never touched (asserted by test env). |
| Exit | F-04, F-05, F-06 closed; RQ-12 fixture-level proof done (native-build repetition is R7b, §10). Estimate: 6–10 agent-hours, 2 review rounds. `[PROPOSITION]` |

### LOT-5 — Registry core integrity and hosted admission (F-07, F-11, F-08 → RQ-10, RQ-14)

| Field | Content |
|---|---|
| Branch | #354. Single writer for `registry.ts` and `hosted.ts`. |
| RED tests first | Extend `packages/h2a/test/registry-r5-lifecycle.test.js` and `packages/h2a/test/registry-r6-hosted.test.js`. Cases: **F-07** — compile `hosted-read-only`, mutate every reachable field of the returned plan (`ownership`, `orderedCapabilities`, nested records, selection array), then activate → `integrity_mismatch` (or frozen-object throw before activate), dispatch of `h2a_send` still refused, handler call count = 0; the unmutated plan still activates. **F-11** — activate G1 with handler set A; attempt compile with handler set B plus an invalid transport → refusal; assert active generation still G1 **and** dispatch still invokes A (call-counted), B never invoked; repeat with each late-validation failure the registry can produce (name collision, missing handler, manifest drift). **F-08** — draft hosted lock with unbound tenant: `verify` → `missing_binding`; `activate` (API and `hosted-lock` CLI verb) → same diagnostic, active lock file absent/unchanged; a fully bound draft activates and the active bytes equal the verified draft. **RQ-10 guards** — `catalog()` performs zero loader calls (counted); `register` performs zero loader calls; unknown/duplicate select IDs refuse; MCP-peer-originated register/select/configure/activate attempts have no API path (existing surface test kept). On the pre-fix head, F-07/F-11/F-08 cases fail exactly as reproduced. |
| Exact files | `packages/h2a/src/registry/registry.ts` (compile scratch-state + issued-plan snapshot at F-07/F-11 sites; `activate` byte comparison); `packages/h2a/src/registry/hosted.ts` (`activateHostedLock` admission at F-08 site; share the verification core with `verifyHostedLock`, no second divergent checker); `packages/h2a/src/registry/cli-registry.ts` (`hosted-lock` verbs pass operator bindings into activation verification). |
| Implementation contract | §6.5. Freezing strategy must survive structured-clone/JSON round-trips used by existing callers (checked against `cli-registry.ts` and hosted composition call sites at code time). No diagnostic code is renamed; `integrity_mismatch` and `missing_binding` keep their current spellings (registry v8 §9 vocabulary). |
| Gates | Extended files green (22 + 24); neighbours: `registry-r5-descriptors.test.js`, `packages/track/src/mcp/registry-contract.test.ts`, `registry-bridge-central.test.js` (LOT-3, compile path shared); `tsc -b` clean. |
| Exit | F-07, F-11, F-08 closed. Hosted live switch onto `mcp-http/app.ts` stays §10 (deployment decision). Estimate: 4–8 agent-hours, 1–2 review rounds. `[PROPOSITION]` |

### LOT-6 — Publisher definitions usable from packed layouts (F-09, F-10 → RQ-13)

| Field | Content |
|---|---|
| Branch | #354. |
| RED tests first | Extend `packages/h2a/test/registry-r5-descriptors.test.js` and `packages/track/src/mcp/registry-contract.test.ts`; add `packages/h2a/test/registry-packed-layout.test.js` `[PROPOSITION]`. Cases: **F-09** — register the real exported `h2aCoordinationDefinition` from the built `./registry/definitions` subpath, select/configure `sentropic.h2a`, compile → `ok`, plan surface equals the manifest tools, loader evaluated exactly once and only after selection (catalog/register evaluate it zero times). **F-10** — build two temp install trees from the packed tarballs (or a faithful copy of the built layout): (i) monorepo siblings, (ii) npm tree with `@sentropic/track` under `@sentropic/h2a/node_modules/`; in both, `registry catalog` + bridge preflight (up to the LOT-3 attachment refusal with no fixture central) succeed with no `ENOENT`; a tree with the Track asset deleted fails with a typed `invalid_entry` naming the missing asset, not a raw `ENOENT` stack. **Static graph** — importing `./registry/definitions` loads no cluster-mesh / h2a-runtime / node-pty / handler module (module-load inventory asserted, existing header contract). On the pre-fix head, F-09 fails with the reviewer's `loader returned no handler map`; layout (ii) fails with `ENOENT`. |
| Exact files | `packages/h2a/src/registry/definitions.ts` (loader adapter at F-09 site); `packages/h2a/src/runtime/mcp/handlers.ts` only if a minimal exported factory is cleaner than adapting in `definitions.ts` (either way, one adapter, reviewed); `packages/h2a/src/registry/cli-registry.ts` (`packedManifests` resolution at F-10 site); `packages/h2a/package.json` + `packages/track/package.json` (exports/files only if RED proves the packed tree lacks the asset — no version bump); `packages/h2a/registry/manifest.h2a.json`, `packages/track/registry/manifest.track.json`, `scripts/generate-registry-entries.mjs` only through regeneration (`--check` must pass; never hand-edit generated entries). |
| Implementation contract | §6.5 last two bullets. The handler `Map` keys are exactly the manifest tool names; drift between loaded manifest and registered shell keeps refusing (existing check in `registry.ts` kept). Track-only selection may depend on the h2a transport package as **code**, recorded in the receipt, without activating coordination tools (registry v8 §7.1). |
| Gates | All files above green (22 + 24); `generate-registry-entries.mjs --check` green; public MCP surface unchanged (60 tools) unless a contract change is separately decided; `tsc -b` clean. |
| Exit | F-09, F-10 closed. Estimate: 4–7 agent-hours, 1–2 review rounds. `[PROPOSITION]` |

### LOT-7 — CI evidence repair and integration qualification (CI-01, CI-02, CI-03)

| Field | Content |
|---|---|
| Branch | #355 then #354 (integration head). No product behaviour change is expected from this lot; any product slowness it uncovers becomes its own finding, not a budget edit. |
| CI-01 RED/green | First reproduce with evidence: run the single targeted file `packages/h2a/test/candidate-artifacts.test.js` locally in a temp-HOME harness and record per-step producer timings (the test already isolates HOME/XDG/TMPDIR); read the failing CI job log for the current head. Only then choose, in this order: (1) remove proven redundant producer work, (2) parallelize inside the producer if already supported, (3) as a last resort propose a budget change with the timing table attached for double review + owner-visible note in the PR. The tarball assertions (exact five-package cohort, payload manifests for Node 22/24, clean stderr) stay byte-for-byte as strict. Success = the file passes locally with margin recorded, and the CI job's `npm test` step completes on a fresh push event. |
| CI-02 RED/green | RED: deterministic unit reproduction of the fragmented-chunk case (`["r", "ecent-human-input\r"]` must satisfy the oracle). Green: oracle matches over the concatenated chunk stream in `packages/h2a-runtime/src/native-terminal/drive.functional.test.ts`; the surrounding assertions (lease refusal, exit code 2, instruction never arrives) unchanged. Targeted run: `vitest run packages/h2a-runtime/src/native-terminal/drive.functional.test.ts` (22 + 24), repeated to shake out ordering sensitivity, count recorded. |
| CI-03 | No code fix claimed. Integration runs are fresh `pull_request` events on rebased heads (§8). The lot report lists, per PR: run URL, head SHA, every job result, and confirms artifact names match the attempt that produced them. A cancelled/rerun-mismatched run is reported as `unverified`, never as green. |
| Integration gates | Both PRs: full CI green on the integrated heads (conductor runs/reads the full suites in CI; local runs stay targeted). GWRC-CI-V1 option A receipt per the owner addenda (h2a CI executes, Sentropic verifies the shared receipt) — if the shared block is not yet available from the Sentropic side, that is recorded as an external blocker (§10), not bypassed. Zero-Python gate, no-attribution-trailer gate, security-debt gate: green, named individually. |
| Exact files | `packages/h2a/test/candidate-artifacts.test.js` and/or `scripts/pack-candidate.mjs` (only per the evidence order above); `packages/h2a-runtime/src/native-terminal/drive.functional.test.ts` (oracle only); `.github/workflows/ci.yml` only if artifact naming across attempts is proven defective there (currently `unverified` — read first). The interim branch-`push` trigger once added for #354 (`d789a0f4`) is absent at the reviewed heads (verified for this spec); keep it absent. |
| Exit | CI-01..CI-03 dispositioned with evidence; merge decision inputs complete for §9. Estimate: 4–8 agent-hours excluding CI wall-clock, 1–2 review rounds. `[PROPOSITION]` |

## 8. Rebase and integration plan (on current `origin/main`)

Baseline measured for this spec (local refs, 2026-10-18): `origin/main` = `d0b1afa38` (merge of [#377](https://github.com/rhanka/h2a/pull/377)); lane merge-base = `5ccc98198`; #355 is 171 ahead / 66 behind; #354 is 187 ahead / 66 behind and contains #355's head plus 16 commits. Files changed on both sides since the merge-base: only 6 (`BRANCH.md`, `packages/h2a/package.json`, `packages/h2a-runtime/package.json`, `packages/h2a-runtime/src/index.ts`, `packages/h2a/test/helpers/node-track-observation-lab.js`, `scripts/run-tests.mjs`). The conflict surface is therefore small; the risk is semantic drift in those 6 files plus generated/golden churn, not volume.

Procedure (code phase, LOT-0; owner rebase rule §1.3 throughout):

0. **Fetch and freeze.** `git fetch origin` in the lane worktree; record the new `origin/main` SHA (it supersedes `d0b1afa38` if moved), both PR head SHAs, and a fresh `gh` CI read for [#355](https://github.com/rhanka/h2a/pull/355) and [#354](https://github.com/rhanka/h2a/pull/354). Confirm both worktrees clean. Keep any valid uncommitted work found — there is none at spec time; re-check anyway.
1. **Rebase #355.** In `mh-l0`: `git rebase origin/main` on `feat/0.98.7-mh-l6`. No merge of `main`, no squash, no commit dropping: all 171 lane commits replay (history shape may be inspected with `git log --oneline origin/main..HEAD | wc -l` before/after). Resolve conflicts file by file, behaviour-preserving on both sides: released `main` behaviour wins outside the MH contracts; MH contracts win only where spec v7 says so; each non-trivial resolution is listed in the LOT-0 report. The 6 overlap files get explicit semantic checks (package versions stay in lockstep with `main`'s train; `run-tests.mjs` keeps both sides' gates; `BRANCH.md` keeps `main`'s current content plus lane sections only where they do not contradict it).
2. **Verify #355 baseline.** `tsc -b`; LOT-0 targeted baseline (§7); `.track/` diff empty; then `git push --force-with-lease` with the exact expected old head. Hooks that would call the installed `h2a` stay disabled per confinement practice already used on this lane; the equivalent checks run in CI.
3. **Rebase #354 onto the new #355 head.** In `r5r6`: `git rebase --onto <new-#355-head> ef9bde52a` (old #355 head) so only its own 16 commits replay. Same conflict rules; registry generated files (`packages/*/registry/*.json`, goldens) are regenerated from the rebased tree, never hand-merged. Verify + `--force-with-lease` push as in step 2.
4. **Fresh CI.** Pushes create new `pull_request` runs; read every job. Do not rerun old attempts to "repair" evidence (CI-03). If a job is cancelled externally, one rerun of that job is acceptable and is named as a rerun in the report.
5. **Lots land stacked.** LOT-1/LOT-2A commits on #355 (fast-forward pushes). After each #355 move that LOT-3+ depends on, rebase #354 again with the same `--onto` pattern before continuing #354 lots. Never merge #355 into #354 as a merge commit (the early-lane habit recorded in the R5/R6 report is superseded by the rebase rule).
6. **Docs/version targeting.** Lane docs that still announce 0.98.7 as the lane target are corrected to 0.98.8 in the lot that touches them (or one small docs commit per branch in LOT-0 if review prefers). `[PROPOSITION]` Branch names and PR numbers stay unchanged (renaming orphanates PR discussion and CI history); package version numbers stay at `main`'s train (`0.98.7` today) until the conductor's release bump to 0.98.8 at integration end. No lot bumps versions.
7. **Landing order.** #355 merges to `main` first (merge commit, never squash), after §9 gates. #354 is then rebased onto the new `main`, re-qualified (targeted + full CI), and merged the same way. Final integration qualification happens on the integrated head with recorded ancestry (owner addenda). Publication follows the owner's rc-on-`next` → install + smoke → stable sequence already decided for the 0.98.7 train, applied to 0.98.8 by the conductor; this spec does not re-decide release mechanics. `[PROPOSITION]` on sequencing details only.
8. **Abort conditions.** A conflict whose resolution would change released `main` behaviour, weaken a guard, or require touching `.track/`, another owner's worktree, or files outside the lot's exact list stops the rebase/lot. State is left clean (`git rebase --abort` if mid-rebase) and the blocker is reported with the file and both sides' intents.

## 9. Gates and evidence rules

### 9.1 Standing constraints (every lot, no exceptions)

- Confinement: never reach the real native host, `/run/user/*/h2a-nt`, `~/.config/sentropic/h2a`, `~/.local/state/h2a`, the installed dist, or any process the agent did not start. Never run the installed `h2a` binary. Stop only own PIDs; no pattern kills.
- Tests: temporary dirs only; a silently skipped test counts as failed; targeted files only locally; full suites in CI only (conductor runs them once at integration).
- Commits: conventional English subjects, zero attribution trailers; no Python anywhere (including one-off local scripting — Node/`jq`/file tools only); own branch only; rebase updates with `--force-with-lease`; merge commits to `main`, never squash.
- Track: read-only from lane worktrees. `.track/` is append-only, single-writer, owned by its designated writer in the main checkout. Lots record progress in their reports and PR bodies; the conductor imports to Track. Never configure a second Track MCP host endpoint.
- Claims: no green without the command and its output; red-before/green-after per regression; estimates labelled as estimates.

### 9.2 Merge gates (all required, in order)

| Gate | Criterion |
|---|---|
| G-1 Findings | F-01..F-11 each closed by its lot's RED→green proof on a public path, or explicitly carried in §10 with an owner-visible reason. P1 findings (F-01..F-04) admit no carry-over under the current PR claims. |
| G-2 Qualification | LOT-2B outcome recorded. Merging while `clients` is empty is allowed only under decision D-01's reduced-claim option, with PR/release wording that names the shared MCP as not admitted for real clients. |
| G-3 Targeted suites | Every lot's targeted files green on Node 22 and 24 on the final heads, zero skips in the new tests, zero leftover child processes in the receipts. |
| G-4 Neighbours | The neighbour files named per lot green; no existing test deleted, skipped or weakened anywhere in the combined diff (diff-audited). |
| G-5 Types/build | `tsc -b` clean on both heads; generated entries check green; public contract (verbs, 60-tool MCP surface) stable or separately decided. |
| G-6 Full CI | Fresh full CI green on #355, then on #354 rebased onto it, then (after #355 lands) on #354 rebased onto new `main`. Every job named with its result; cancelled ≠ green. |
| G-7 Double code review | Two independent max-effort code reviews of the remediated heads (the same pairing discipline as the reviews that produced §5), with every P1/P2 they raise either fixed or carried into §10 by name. Reviewers re-run the §5 reproductions against the new heads. |
| G-8 Spec conformance | Double spec review of this document before code (owner "Spec d'abord" chain: spec → two GO-CODE → code). Any spec change after GO-CODE re-enters review for the changed sections. |
| G-9 Hygiene | No Python added; no attribution trailers; no `.track/` diff on lane branches; no owner-state access; nothing left running; reports (French, short tables) filed per lot: commits pushed, tests with results, NOT-covered remainder, deviations. |

## 10. What is NOT covered

Explicit non-goals of this remediation. Each item names where it lives instead. A lot that touches one of these by accident has exceeded its scope.

| # | Not covered | Where it belongs |
|---|---|---|
| NC-1 | Non-Claude central adapters (codex, agy, muse, vibe) for `shared-central` — R5-CA. They stay typed refusals (`missing_binding`) with no fallback. Native host qualification on real builds (R7b): plugin/TOML pickup, session isolation, exact host versions. | R5-CA / R7b lots after this remediation; registry v8 §7.2, §10.1. |
| NC-2 | Sentropic platform lots R2 (remote-bound routing + generic bridge), R7a (`sentropic-registry` bin, `sentropic.registry-lock/v1`, five-format installer), R3 (SKILLS registry). Includes the final lock format and bin name. This lane keeps its interim h2a-owned equivalents (RQ-16). | Sentropic, single later writer after immo #679 + gateway PR1, per registry v8 §10.1 chain. |
| NC-3 | Focus skill publication in the skills registry and the `ui://` MCP renderer module (MCP Apps / A2UI) beyond keeping the single-endpoint seam intact. | R4/R6-UI per registry v8 §4, §5.3, after R3 + R5. Owner demand recorded in `01M51R4ZFXJVPVFFWM1RABQ8YP`; only the h2a/Track MCP entries are remediated here. |
| NC-4 | Live switch of the hosted HTTP service onto the registry composition (`mcp-http/app.ts`), its deployment, and claude.ai connector go-live proof. LOT-5 fixes lock admission only. | Deployment decision + owner GO (builder estimate 3–5 h + GO, historical). |
| NC-5 | Filtered MCP server for partial (subset) lock selections. Subset locks keep the typed refusal. | Later increment (builder estimate 4–6 h, historical). |
| NC-6 | MH remainders declared by the builder: B2-3 legacy closure observers + M18 producer/activation, E2b3 native entries, E3b2b packaging/backfills, E3c .6 freeze + U07/U11 real relaunches, F-depth beyond LOT-1 wiring (U01/U05/U08), M17 load/endurance, MH-L7 gateway transaction. PTY ownership and live PTY exec (0.99.x train) are untouched. | Their own MH lots / later releases per spec v7 §12 and owner version decisions. |
| NC-7 | Automatic MCP reconnection triggers and `h2a restore` refresh semantics beyond what the central + shim already provide (`01M0KMX0N8HYQPA74PENBR90QF`, D-013 ad-hoc runtime instruction surface). Remediation restores the stable central they depend on; it does not build the trigger layer. | WP2.2 follow-on spec after the centralised server is qualified. |
| NC-8 | WP12 neighbours: third-party MCP connector brokering (x4 beyond h2a's own entries), Sentropic workspace alignment (x5), dossiers/UAT/remote-control/Track-report in Sentropic, enrollment entry point (`01KYQWKM5DJF3GTD1E6TFVYB7T`), D-058 jev/`judge` (explicitly after the first cluster-mesh version), EVO-12 gateway broker. | WP12 / Sentropic programmes. |
| NC-9 | Platforms and profiles outside the qualified domain: macOS/Windows central routes, unqualified libc/arch/ABI profiles, real-machine diagnostics on those profiles. Linux + Node 22/24 is the remediation qualification domain. | Later qualification (VM reference per owner isolation decisions). |
| NC-10 | Registry contract v9 adoption (SG-4), Track registry text corrections (SG-3), WP restructuring items, version bump to 0.98.8, npm publication, owner-machine install and reboot test. | D-03 decision; Track designated writer; conductor release sequence. |
| NC-11 | Any change to Immo's twelve-tool baseline, endpoints, OAuth audience/scopes, or Sentropic configuration approvals. Remediation is h2a-side only. | Registry v8 §6 (preserved Immo API). |

## 11. Open decisions (need owner or conductor ruling before the named lot)

| ID | Decision | Options (this spec's recommendation first, marked) | Blocks |
|---|---|---|---|
| D-01 | May inert-but-correct machinery merge before LOT-2B qualifies a real Claude, under explicitly reduced claims? | **Recommended `[PROPOSITION]`: no.** Keep both PRs unmerged until LOT-2B admits ≥ 1 real Claude; the PRs' stated purpose is the working shared MCP, and F-01/F-03 are purpose failures, not polish. Alternative: merge #355/#354 after LOT-1/3/4/5/6 with PR + release wording "shared MCP not admitted for real clients yet", and LOT-2B as the immediate follow-up on `main`. | LOT-2B sequencing; G-2. Owner ruling needed (decision-dossier level: it changes what a merged lane promises). |
| D-02 | Which Claude build(s) does LOT-2B qualify first, and with which seats/quota cap? | **Recommended `[PROPOSITION]`:** the exact Claude build the owner currently runs (reviewers used `2.1.296` as the probe), Linux, one Node major at a time (22 then 24), existing enrolled seats under the 2026-10-18 shared-quota campaign rules. | LOT-2B protocol commit. Conductor + owner seat policy. |
| D-03 | Remediate against registry contract v8 (reviewed baseline) or v9 (newer, unreviewed delta)? | **Recommended `[PROPOSITION]`:** v8 for every finding in §5; treat v9 delta as a separate spec amendment with its own double review before any lot cites it. | LOT-3..LOT-6 citations. Conductor ruling suffices if v8 is kept. |
| D-04 | CI-01: if producer timings prove the 230 s internal budget is structurally too small on CI runners, is a budget change acceptable? | **Recommended `[PROPOSITION]`:** only with the timing table attached, the tarball assertions untouched, and double code review calling it out explicitly; otherwise fix producer cost. Never raise the 35-minute job budget as part of this lane. | LOT-7. |
| D-05 | Branch/PR naming: keep `feat/0.98.7-*` names for a 0.98.8 delivery? | **Recommended `[PROPOSITION]`:** keep names and PRs [#355](https://github.com/rhanka/h2a/pull/355)/[#354](https://github.com/rhanka/h2a/pull/354); fix titles/bodies/docs to 0.98.8. Renaming buys nothing and breaks history links. | LOT-0 docs touch. Conductor ruling. |

No other owner decision is required by this spec. In particular, remediation does not ask to widen host support, change the Immo baseline, adopt WebAuthn/FIDO material, or alter release mechanics.

## 12. Traceability

### 12.1 Owner phrase → requirement → lot → proof

| Owner source | Requirements | Lots | Primary proof |
|---|---|---|---|
| « mcp unique sera quand dans quelle version ? » + no-drop-at-upgrade (`01M515FVQC1M8D17BADRTH8Z6Z`) | RQ-01, RQ-02, RQ-03 | LOT-2A, LOT-2B, LOT-3 | LOT-2B campaign oracles; LOT-3 (a)–(d). Answer: 0.98.8 (§8, G-2). |
| Startup / installed-version / manual-reconnect complaints (D-040) | RQ-04, RQ-05 | LOT-1, LOT-2B | LOT-1 (a)–(d); LOT-2B upgrade-survival scenario. |
| Ad-hoc MCP reconnection via runtime (D-013) | RQ-01 (precondition only) | LOT-3 | LOT-3 (b) typed-refusal surface the future trigger will drive. Trigger itself: NC-7. |
| Automatic reconnection + `h2a restore` (`01M0KMX0N8HYQPA74PENBR90QF`) | RQ-01, RQ-03 (preconditions) | LOT-2B, LOT-3 | Central qualified first, per the item's own dependency note. Trigger layer: NC-7. |
| « tous les mcp de h2a devraient passer pareil par le mcp registry » (`01M51R4ZFXJVPVFFWM1RABQ8YP`) | RQ-08..RQ-17 | LOT-3..LOT-6 | LOT-4 format matrix + RQ-12 test; LOT-6 packed-layout gate. Focus skill + `ui://`: NC-3. |
| Register MCP connectors to CLIs (x4) | RQ-08 (h2a's own entries) | LOT-4 | One `h2a` entry per host. Third-party brokering: NC-8. |
| H4 single upgrade command; never restart native host (DECISIONS) | RQ-05, RQ-06, RQ-07 | LOT-1 | LOT-1 (a)–(j) incl. call-count zero proofs. |
| Off-`latest` until real-Claude tested (item body + QC decision) | RQ-02 | LOT-2B, §8 step 7 | Campaign evidence gates promotion. |

### 12.2 Review finding → lot → gate

| Finding | Lot | Gate evidence |
|---|---|---|
| F-01 | LOT-2A + LOT-2B | Mechanism tests; campaign protocol + earned manifest entries (G-1, G-2). |
| F-02 | LOT-1 | `upgrade-h4-cli-wiring` RED→green incl. zero-install call counts. |
| F-03 | LOT-3 | `registry-bridge-central` SDK-wire tests (attachment, refusal, identity, two-repo Track). |
| F-04 | LOT-4 | Concurrent-edit bytes preserved exactly. |
| F-05 | LOT-4 | Failed-receipt install restores exact pre-install bytes. |
| F-06 | LOT-4 | Codex TOML install/reject matrix. |
| F-07 | LOT-5 | Mutated-plan activation refused; excluded tool never dispatches. |
| F-08 | LOT-5 | Unbound draft unactivatable via API and CLI. |
| F-09 | LOT-6 | Real published definition compiles; loader evaluated once, post-selection. |
| F-10 | LOT-6 | Both packed layouts pass preflight; typed error on missing asset. |
| F-11 | LOT-5 | Refused compile leaves generation + dispatch bit-identical. |
| CI-01 | LOT-7 | Timing-evidenced fix; fresh-push CI `npm test` completes. |
| CI-02 | LOT-7 | Fragmented-chunk oracle RED→green; product assertions unchanged. |
| CI-03 | LOT-7 + §8 | Fresh-event runs only; per-job report with run URLs. |

## Appendix A — Track inventory read for this spec (WP2.2, WP12)

Read-only enumeration (`item ls --format json`, 415 items total) filtered to `wpLabel` WP2.2 (8 items) and WP12 (10 items), plus `item show` on all 18 and both containers. Reader caveats: SG-1, SG-2 (§1.5). States below are `bucket/realization` at read time.

WP2.2 container `01KTST4ASW2DYD2R76VM1DBF37` — "WP-F MCP-disconnect / false-live remediation", role `workpackage`.

- `01KTT31AZVYPVH9VGRN7PVAYDF` AWAITED/done — Phase 2a observability.
- `01KTST53F1CNBDXTWKPGDF0YAJ` DROPPED/cancelled — Phase 2 degraded sub-state.
- `01KTST4Y13EEVZWN2GXC071D4W` DONE/done — false-live root-cause analysis.
- `01KV41H39HE2220KYGJ9NMMF5R` DONE/done — `discover --live` presence-first.
- `01M0KMX0N8HYQPA74PENBR90QF` TO-DO/to-do — automatic MCP reconnection + `h2a restore`.
- `01M515FVQC1M8D17BADRTH8Z6Z` TO-DO/in-progress — single shared MCP, no drop at upgrade.
- `01M53PPTH6EAPPFKZRF78V7T6Q` TO-DO/to-do — D-013 ad-hoc reconnection.
- `01M53PQ5C10XEV6M7W0ZWBMTBX` TO-DO/to-do — D-040 startup / installed version.

WP12 container `01KXDPBQY1X66M7ZRK72D34S56` — "MCP connector brokering & sharing — h2a as connector hub", code `WP12`.

- `01KTQC2JK2Y3T7R8GQ6EQNHSJ5` TO-DO/to-do — EVO-12 gateway broker go-live.
- `01KWVM4Z972ZAFK6TKW753ZBR1` TO-DO/to-do — x4 register MCP connectors to CLIs.
- `01KWVM4ZD4ADJQ70J1NEH7R6W1` TO-DO/to-do — x5 Sentropic integration / workspaces.
- `01KYQ5KJWXFBRK2M2ZC8T1E221` TO-DO/to-do — dossiers/UAT through Sentropic.
- `01KYQ5KK3Z8ZGN4Q1VSMKXWJGR` TO-DO/to-do — remote control through Sentropic.
- `01KYQ5KKTDWJZN270VYPK19C4Y` TO-DO/to-do — Track report in Sentropic.
- `01KYQWKM5DJF3GTD1E6TFVYB7T` TO-DO/to-do — enrollment client inert (bug).
- `01M38WT0XG2KVRJ4HN28XETYNE` TO-DO/to-do — diagram frame nature mechanism.
- `01M51R4ZFXJVPVFFWM1RABQ8YP` TO-DO/to-do — all h2a MCPs + Focus skill via cluster-mesh registries.
- `01M53PQCDA68QTYXY4Q6D6JB0S` TO-DO/to-do — D-058 jev/rtk + `judge` MCP skill.

Acceptance on every listed item read as `unknown` ("recette non évaluée") in the list projection. No acceptance claim is made anywhere in this spec on that basis.

## Appendix B — Exact file index (union of lot scopes)

Any file outside this index needs a spec amendment before a lot edits it. Generated files are regenerated, never hand-edited.

**#355 product:** `packages/h2a/src/cli.ts`; `packages/h2a/src/cli-contract.ts`; `packages/h2a/src/cli-command-map.ts`; `packages/h2a/src/bin.ts`; `packages/h2a/src/runtime/upgrade/upgrade-cli.js`; `packages/h2a/src/runtime/upgrade/upgrade-dispatch.js` (+ the H4 store/orchestrator modules they already import, inventoried at code time); `packages/h2a/src/runtime/mcp-central-qualification.ts`; `packages/h2a/src/runtime/mcp-central-policy.ts`; `packages/h2a/src/runtime/mcp-central-shim.ts`; `packages/h2a/src/runtime/mcp-central-client.ts`; `packages/h2a/src/runtime/handover/shim-bridge.js`.

**#354 product (additionally):** `packages/h2a/src/registry/cli-registry.ts`; `packages/h2a/src/registry/host-bootstrap.ts`; `packages/h2a/src/registry/vibe-toml.ts` (+ at most one sibling Codex-TOML adapter, LOT-4); `packages/h2a/src/registry/registry.ts`; `packages/h2a/src/registry/hosted.ts`; `packages/h2a/src/registry/definitions.ts`; `packages/h2a/src/registry/bridge-lock.ts`; `packages/h2a/src/runtime/mcp/handlers.ts` (LOT-6 conditional); `packages/h2a/package.json`; `packages/track/package.json`; generated: `packages/h2a/registry/*.json`, `packages/track/registry/*.json`, `docs/contracts/golden/*` (via their generators).

**Tests (new `[PROPOSITION]` names starred):** `packages/h2a/test/upgrade-h4-cli-wiring.test.js`*, `packages/h2a/test/mcp-central-qualification.test.js`*, `packages/h2a/test/registry-bridge-central.test.js`*, `packages/h2a/test/registry-host-tool-identities.test.js` (name fixed by registry v8 §7.3), `packages/h2a/test/registry-packed-layout.test.js`*, plus extensions to `packages/h2a/test/registry-r5-host-bootstrap.test.js`, `packages/h2a/test/registry-r5-lifecycle.test.js`, `packages/h2a/test/registry-r6-hosted.test.js`, `packages/h2a/test/registry-r5-descriptors.test.js`, `packages/h2a/test/registry-r5-cli.test.js`, `packages/track/src/mcp/registry-contract.test.ts`. LOT-7 only: `packages/h2a/test/candidate-artifacts.test.js`, `scripts/pack-candidate.mjs`, `packages/h2a-runtime/src/native-terminal/drive.functional.test.ts`, `.github/workflows/ci.yml` (conditional).

**Never edited by any lot:** `.track/**`; `main` or any other branch; Sentropic/Immo repositories; owner live config under any real HOME; version numbers in `package.json` files (conductor release act); the qualification manifest's production entries (LOT-2B earned entries excepted, by definition).

---

*End of spec. Next step per owner decision "Spec d'abord": two independent spec reviews (max effort), reconciliation of their findings into this document, owner GO-CODE on D-01..D-05 as applicable, then LOT-0.*







