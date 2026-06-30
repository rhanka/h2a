# h2a unified CLI — EXHAUSTIVE command mapping (for Fabien's validation)

**Status: mapping-for-validation. Read-only on all sources.** Every existing command
(across `h2a`, `remote`, `track`, `harness`, and the additive products `design`/`knowledge`/
`agent-stats`) is mapped to its target in the unified `h2a` CLI, with a status and a note.
Companion to `2026-06-27-h2a-unified-cli-syntax.md` (the grammar) and
`2026-06-27-h2a-design-knowledge-integration.md` / `2026-06-27-h2a-agent-stats-integration.md`
(the additive products). HTML twin: `…/scratchpad/semantic-focus/mapping.html`.

**Targeting grammar applied (per decision):**
- `remote` lifecycle → **`h2a agent …`** (decided: NOT `bus`). `run/ls/attach/logs/stop/wake/inspect`;
  delegation `agent delegate`; delegated supervision `agent decide`/`agent conduct` (or `h2a job …` — noted).
- k8s deport plumbing (workspace/sync/migrate/forward/tunnel/restore/layout/config/auth/account/llm-mesh/
  lineage) → **`h2a host …`**.
- HTTP bus transport (`h2a remote serve/send`, `remote h2a ping/bridge`) → **OPEN — name to settle**
  (`bus` rejected). Candidates below.
- `track` → `h2a track …` + bare `h2a report` + bare `h2a decide`.
- `harness` → `h2a dev …`; `verify` namespace-only, `check` non-bare.
- additives → `h2a design …`, `h2a knowledge …`, `h2a agent stats …`.

**Status legend:** `direct` (same verb) · `renommé` · `namespacé` · `alias-bare` · `fusionné`
(several → one) · `OPEN` (Fabien to settle).

**Counters:** total commands mapped = **255** — h2a 90 · remote 93 · track 34 · harness 14 ·
design 11 · knowledge 6 · agent-stats 7. **OPEN = 9.**

### The HTTP-bus name (OPEN — `bus` rejected)
The HTTP transport that authenticates POSTed signed envelopes and bridges them to/from
session Pods needs a parlant name. Candidates:
- **`h2a serve` / `h2a send` (+ `ping`/`bridge`)** — "the h2a wire": run the listener, post a signed envelope.
- **`h2a relay …`** — emphasises store-and-forward delivery between hosts/Pods.
- **`h2a gateway …`** — emphasises the authenticated front-door (signed-bearer) to the local store.

Note: the frozen `cli-contract.ts` exposes only `remote serve` + `remote send`; the targeting
rule also references `mirror-serve`/`mirror`, which are not in the frozen contract (would join the
same OPEN bucket if added).

---

## 1. `h2a` (current) → unified `h2a`  — 90 verbs (source: `packages/h2a-cli/src/cli-contract.ts`)

| Existing command | h2a target | Status | Note |
|---|---|---|---|
| `h2a --help` | `h2a --help` / `h2a help` | direct | + consensus add-ons `h2a help map`, `h2a explain <cmd>` |
| `h2a hosts` | `h2a host ls` | renommé | hosts list under `host` |
| `h2a mcp-tools` | `h2a mcp tools` | namespacé | |
| `h2a init` | `h2a init` | direct | `--all` opt-in also seeds `.track` + dev profile |
| `h2a register` | `h2a register` | direct | consensus suggests non-bare per object (`key add`/`sub register`/`host register`) |
| `h2a discover` | `h2a find` | renommé | find = resolve/discover (role/scope filters) |
| `h2a loop create` | `h2a loop create` | direct | |
| `h2a loop list` | `h2a loop ls` | renommé | list→ls |
| `h2a loop status` | `h2a loop status` | direct | |
| `h2a loop agents` | `h2a loop agents` | direct | |
| `h2a loop attach` | `h2a loop attach` | direct | |
| `h2a loop logs` | `h2a loop logs` | direct | |
| `h2a loop tick` | `h2a loop tick` | direct | |
| `h2a loop watch` | `h2a loop watch` | direct | (or `loop tick --watch`) |
| `h2a subagent register` | `h2a sub register` | namespacé | |
| `h2a subagent list` | `h2a sub ls` | renommé | list→ls |
| `h2a subagent route` | `h2a sub route` | namespacé | |
| `h2a subagent inbox` | `h2a sub inbox` | namespacé | parent fan-in |
| `h2a subagent audit` | `h2a sub audit` | namespacé | |
| `h2a subagent revoke` | `h2a sub revoke` | namespacé | |
| `h2a negotiate open` | `h2a nego open` | namespacé | |
| `h2a negotiate status` | `h2a nego status` | namespacé | |
| `h2a negotiate event` | `h2a nego event` | namespacé | |
| `h2a negotiate offer` | `h2a nego offer` | namespacé | |
| `h2a negotiate counter` | `h2a nego counter` | namespacé | |
| `h2a negotiate sign` | `h2a nego sign` | namespacé | |
| `h2a negotiate stabilize` | `h2a nego stabilize` | namespacé | |
| `h2a negotiate journal` | `h2a nego ls` | renommé | journal→ls (verified hash-chain) |
| `h2a declare-interest` | `h2a nego interest` | namespacé | trust ledger under `nego` |
| `h2a conflict-posture` | `h2a nego conflict` | namespacé | |
| `h2a dossier` | `h2a nego dossier` | namespacé | |
| `h2a confiance` | `h2a nego trust` | renommé | confiance→trust |
| `h2a attest-comprehension` | `h2a nego attest` | namespacé | |
| `h2a comprehension list` | `h2a nego comp ls` | namespacé | |
| `h2a comprehension verify` | `h2a nego comp verify` | namespacé | `verify` namespace-only ✓ |
| `h2a inbox put` | `h2a send` (= `h2a msg send`) | alias-bare | bare `send` = inbox put; **resolve-before-send + liveness-gate preserved** |
| `h2a inbox read` | `h2a inbox` (= `h2a msg ls`) | alias-bare | bare `inbox` = read my inbox |
| `h2a inbox pop` | `h2a inbox pop` (= `h2a msg pop`) | namespacé | |
| `h2a outbox put` | `h2a msg out send` | namespacé | |
| `h2a outbox read` | `h2a msg out ls` | namespacé | |
| `h2a store migrate` | `h2a store migrate` | direct | |
| `h2a mcp-serve` | `h2a mcp serve` | namespacé | |
| `h2a upgrade` | `h2a up` | renommé | consensus: fold to `h2a host upgrade` — minor naming reserve |
| `h2a remote serve` | `h2a serve` / `relay serve` / `gateway serve` | **OPEN** | HTTP bus listener — name to settle (`bus` rejected) |
| `h2a remote send` | `h2a send --url` / `relay send` / `gateway send` | **OPEN** | signed POST to a peer URL — name to settle; distinct from bare local `send` |
| `h2a drive` | `h2a wake` | renommé | signed nudge into a live peer |
| `h2a drive receive` | `h2a wake verify` | renommé | verify a signed drive before acting (`verify` namespaced) |
| `h2a drive serve` | `h2a wake serve` | renommé | drive injection endpoint |
| `h2a sysml verify` | `h2a sysml verify` | direct | `verify` namespaced ✓ |
| `h2a drumbeat record` | `h2a drum record` | namespacé | |
| `h2a drumbeat scan` | `h2a drum ls` | renommé | scan→ls |
| `h2a drumbeat clear` | `h2a drum clear` | namespacé | |
| `h2a drumbeat escalations` | `h2a drum escalations` | namespacé | |
| `h2a drumbeat relance-inbox` | `h2a drum relance` | renommé | relance-inbox→relance |
| `h2a drumbeat watch` | `h2a drum watch` | namespacé | anti-stall daemon |
| `h2a host setup` | `h2a host setup` | direct | |
| `h2a host plugin` | `h2a host plugin` | direct | |
| `h2a host status` | `h2a host status` | namespacé | `status` namespaced (host variant) |
| `h2a connect` | `h2a connect` | direct | absorbs `host setup`; `--tunnel` for remote reachability |
| `h2a doctor` | `h2a doctor` | direct | merges `remote check` health surface |
| `h2a status` | `h2a status` | direct | bare = agent inventory (merged with `remote status`) |
| `h2a sessions` | `h2a ls` | renommé | bare `ls` = live peers/sessions |
| `h2a keys generate` | `h2a key gen` | renommé | generate→gen |
| `h2a keys add` | `h2a key add` | namespacé | |
| `h2a keys list` | `h2a key ls` | renommé | list→ls |
| `h2a keys revoke` | `h2a key revoke` | namespacé | |
| `h2a nhi report` | `h2a nhi report` | direct | |
| `h2a nhi inventory` | `h2a nhi ls` | renommé | inventory→ls |
| `h2a nhi export` | `h2a nhi export` | direct | SPIFFE/JWKS bundle |
| `h2a nhi attest` | `h2a nhi attest` | direct | |
| `h2a nhi offboard` | `h2a nhi offboard` | direct | |
| `h2a org validate` | `h2a org validate` | direct | |
| `h2a org show` | `h2a org show` | direct | |
| `h2a org diff` | `h2a org diff` | direct | |
| `h2a org provision` | `h2a org apply` | renommé | provision→apply |
| `h2a coach propose` | `h2a org propose` | fusionné | coach folds into `org` |
| `h2a coach ratify` | `h2a org ratify` | fusionné | coach folds into `org` |
| `h2a blockage raise` | `h2a block raise` | renommé | candidate `impediment`; distinct from `track blocker` |
| `h2a blockage list` | `h2a block ls` | renommé | list→ls |
| `h2a blockage resolve` | `h2a block resolve` | renommé | |
| `h2a install-skills` | `h2a host skills` | fusionné | one skills installer (`--of h2a,track,dev`) |
| `h2a keepalive` | `h2a keepalive` | direct | |
| `h2a thread` | `h2a msg thread` | namespacé | |
| `h2a conductor` | `h2a cond` | renommé | resolve live conductor |
| `h2a conductor claim` | `h2a cond claim` | namespacé | |
| `h2a conductor release` | `h2a cond release` | namespacé | |
| `h2a conductor-launch-check` | `h2a cond launch --check` | fusionné | merged into one verb (dry-run flag) |
| `h2a conductor-launch` | `h2a cond launch --confirm` | fusionné | merged into one verb (human gate) |
| `h2a deploy k8s-sidecar` | `h2a deploy sidecar` | renommé | |
| `h2a deploy k8s-tenant` | `h2a deploy tenant` | renommé | |

---

## 2. `remote` → unified `h2a`  — 93 commands (source: `packages/remote-cli/src/index.ts`)

### 2a. Profiles + lifecycle → `h2a agent …`

| Existing command | h2a target | Status | Note |
|---|---|---|---|
| `remote codex` | `h2a agent run codex` (or `--codex`) | fusionné | profile wrappers collapse to `agent run <profile>`. Flags: `-r/--resume`, `-p/--port`, `--remote <url>`, `--local`, `--sync`, `--no-workspace`, `--target`, `--no-auth`, `--no-auth-refresh`, `--count`, `--name`, `--browser`, `--image` |
| `remote claude` (alias `claude-code`) | `h2a agent run claude` (or `--claude`) | fusionné | same flag surface |
| `remote agy` (alias `antigravity`) | `h2a agent run agy` (or `--agy`) | fusionné | |
| `remote gemini` (alias `gemini-cli`) | `h2a agent run gemini` (or `--gemini`) | fusionné | |
| `remote mistral` (alias `mistralcli`) | `h2a agent run mistral` (or `--mistral`) | fusionné | |
| `remote opencode` | `h2a agent run opencode` | fusionné | |
| `remote shell` | `h2a agent run shell` | fusionné | |
| `remote run <profile> [path]` | `h2a agent run <profile>` (bare `h2a run`) | direct | start a LOCAL tmux session |
| `remote resume [slug]` | `h2a agent resume` | renommé | `--claude`/`--codex` resume flows |
| `remote attach <urlOrSessionId>` | `h2a agent attach` (bare `h2a attach`) | direct | resolves local tmux then remote |
| `remote stop <urlOrSessionId>` | `h2a agent stop` (bare `h2a stop`) | direct | |
| `remote ls [url]` | `h2a agent ls` (bare `h2a ls`) | fusionné | local+remote sessions; merged with `h2a sessions` |
| `remote rename <slugOrId> <newName>` | `h2a agent rename` | renommé | reflects host-native name (overlaps `h2a rename`) |
| `remote agents ls` | `h2a agent ls` / `h2a find` | **OPEN** | projection: `agent ls` (mine) vs `find` (bus peers) — taxonomy to settle |
| `remote agents inspect` | `h2a agent inspect` | direct | |

### 2b. Delegation + delegated supervision → `h2a agent …` / `h2a job …`

| Existing command | h2a target | Status | Note |
|---|---|---|---|
| `remote delegate <type> <task>` | `h2a agent delegate <profile> <task>` (bare `h2a delegate`) | direct | Flags: `--remote [url]` (k8s placement), `--cwd`, `--name`, `--headless`, `--on-done`/`--parent`, `--max-concurrent`, `--max-depth` (1–3), `--track <wpId>`, `--model`, `--effort`, `--account` |
| `remote jobs ls` | `h2a job ls` | namespacé | |
| `remote jobs status <id>` | `h2a job status` | namespacé | |
| `remote jobs attach <id>` | `h2a job attach` | namespacé | |
| `remote jobs logs <id>` | `h2a job logs` | namespacé | |
| `remote jobs decisions` | `h2a job decisions` | namespacé | list unanswered `decision.requested` |
| `remote jobs decide <jobId> <answer>` | `h2a job decide` / `h2a agent decide` | **OPEN** | job-answer decide; namespace `job` vs `agent` to settle (bare `decide` = track) |
| `remote jobs conduct` | `h2a job conduct` / `h2a agent conduct` | **OPEN** | drain queue / conductor pass; `job` vs `agent` to settle |
| `remote conductor-launch` | `h2a cond launch` | fusionné | same verb as the h2a side; remote executes the spawn |
| `remote wake-request` | `h2a agent wake` | renommé | wake-request receiver (tmux send-keys); overlaps `h2a wake serve` |
| `remote relaunch [filter]` | `h2a agent wake --relaunch` | renommé | flag on `wake`; relaunch dropped-to-shell sessions |
| `remote resume-throttled [filter]` | `h2a agent wake --throttled` | renommé | flag on `wake`; nudge rate-limited sessions |

### 2c. k8s deport plumbing → `h2a host …`

| Existing command | h2a target | Status | Note |
|---|---|---|---|
| `remote install <url>` | `h2a host install` | namespacé | set default remote URL + managed tmux profile |
| `remote connect` | `h2a connect --tunnel` | fusionné | ensure control-plane reachable (overlaps `h2a connect`) |
| `remote disconnect` | `h2a host disconnect` | namespacé | close managed tunnel |
| `remote status` | `h2a status` | fusionné | unified local+remote inventory (merged with `h2a status`) |
| `remote check <profile>` (alias `smoke`) | `h2a host check` / `h2a agent check` | **OPEN** | e2e session probe; `host` vs `agent`, and collides with `dev check` — to settle |
| `remote config set <url>` | `h2a host config set` | namespacé | |
| `remote config token <value>` | `h2a host config token` | namespacé | |
| `remote config target <target>` | `h2a host config target` | namespacé | |
| `remote config tools <list>` | `h2a host config tools` | namespacé | |
| `remote config tmux-profile <name>` | `h2a host config tmux-profile` | namespacé | |
| `remote config clear` | `h2a host config clear` | namespacé | |
| `remote config show` | `h2a host config show` | namespacé | |
| `remote config tunnel` | `h2a host config tunnel` | namespacé | port-forward config |
| `remote workspace link` | `h2a host workspace link` | namespacé | |
| `remote workspace list [url]` | `h2a host workspace ls` | renommé | list→ls |
| `remote workspace status` | `h2a host workspace status` | namespacé | |
| `remote workspace push` | `h2a host workspace push` | namespacé | |
| `remote workspace pull` | `h2a host workspace pull` | namespacé | |
| `remote workspace rm [workspaceId]` | `h2a host workspace rm` | namespacé | |
| `remote workspace gc` | `h2a host workspace gc` | namespacé | |
| `remote auth status [profile]` | `h2a host auth status` | namespacé | |
| `remote auth login <profile>` | `h2a host auth login` | namespacé | |
| `remote auth push <urlOrSessionId>` | `h2a host auth push` | namespacé | |
| `remote refresh [urlOrSessionId]` | `h2a host auth refresh` | namespacé | re-bundle creds + push to session |
| `remote secrets status [sessionId]` | `h2a host secrets status` | namespacé | audit creds sent to sessions |
| `remote diff [sessionId]` | `h2a host diff` | namespacé | session vs local sync diff |
| `remote sync <sessionId>` | `h2a host sync` | namespacé | copy conversation log |
| `remote sync-status` | `h2a host sync-status` | namespacé | |
| `remote sync-files` | `h2a host sync-files` | namespacé | push git workspace incrementally |
| `remote forward <sessionId> <podPort>` | `h2a host forward` | namespacé | port-forward a Pod port to localhost |
| `remote browser open <sessionId>` | `h2a host browser open` | namespacé | headful noVNC inside Pod |
| `remote migrate forward <profile>` | `h2a host migrate forward` | namespacé | local → remote (lineage) |
| `remote migrate ls` | `h2a host migrate ls` | namespacé | |
| `remote migrate pick` | `h2a host migrate pick` | namespacé | |
| `remote migrate back` | `h2a host migrate back` | namespacé | remote → local |
| `remote migrate to-remote [profile]` | `h2a host migrate to-remote` | namespacé | Phase-A wrapper |
| `remote migrate to-local` | `h2a host migrate to-local` | namespacé | Phase-A wrapper |
| `remote plugin add <pkgOrName>` | `h2a host plugin add` | fusionné | unify with host plugin wiring |
| `remote plugin ls` | `h2a host plugin ls` | fusionné | |
| `remote plugin sync` | `h2a host plugin sync` | fusionné | converge plugins into Pods |
| `remote plugin sync-skills` | `h2a host plugin sync-skills` | fusionné | copy local skills into Pods |
| `remote restore [group]` | `h2a host restore` | namespacé | relance dev sessions in their layout |
| `remote layout show` | `h2a host layout show` | namespacé | last launched layout |
| `remote enroll` | `h2a host enroll` | namespacé | live-session registry plumbing (hooks) |
| `remote account enroll` | `h2a host account enroll` | namespacé | local LLM account pool (WP16) |
| `remote account ls` | `h2a host account ls` | namespacé | |
| `remote account rm <id>` | `h2a host account rm` | namespacé | |
| `remote account exhausted <id>` | `h2a host account exhausted` | namespacé | |
| `remote account clear-quota <id>` | `h2a host account clear-quota` | namespacé | |
| `remote account select` | `h2a host account select` | namespacé | dry-run selection |
| `remote account log` | `h2a host account log` | namespacé | selection log |
| `remote account rm-binding <affinityKey>` | `h2a host account rm-binding` | namespacé | |
| `remote account bindings` | `h2a host account bindings` | namespacé | |
| `remote account push-cluster` | `h2a host account push-cluster` | namespacé | push pool to k8s Secret |
| `remote llm-mesh enroll <provider>` | `h2a host llm-mesh enroll` | namespacé | local LLM gateway |
| `remote llm-mesh start` | `h2a host llm-mesh start` | namespacé | |
| `remote llm-mesh enable` | `h2a host llm-mesh enable` | namespacé | |
| `remote llm-mesh disable` | `h2a host llm-mesh disable` | namespacé | |
| `remote llm-mesh stop` | `h2a host llm-mesh stop` | namespacé | |
| `remote llm-mesh restart` | `h2a host llm-mesh restart` | namespacé | |
| `remote llm-mesh status` | `h2a host llm-mesh status` | namespacé | |
| `remote llm-mesh logs` | `h2a host llm-mesh logs` | namespacé | |
| `remote lineage suspend <id>` | `h2a host lineage suspend` | namespacé | incarnation lifecycle (migration) |
| `remote lineage resume <id>` | `h2a host lineage resume` | namespacé | |

### 2d. HTTP bus bridge → OPEN (name to settle)

| Existing command | h2a target | Status | Note |
|---|---|---|---|
| `remote h2a ping <instance>` | `h2a serve ping` / `relay ping` / `gateway ping` | **OPEN** | drop `h2a.ping` into local inbox; bus name to settle |
| `remote h2a bridge [sessionId]` | `h2a serve bridge` / `relay bridge` / `gateway bridge` | **OPEN** | pull/push envelopes Pod↔local over kubectl exec; bus name to settle |

---

## 3. `track` → `h2a track …`  — 34 commands (source: `track --help`)

| Existing command | h2a target | Status | Note |
|---|---|---|---|
| `track init` | `h2a track init` | namespacé | (or `h2a init --all`) |
| `track item new` | `h2a track item new` | namespacé | `--kind/--title/--workspace [...]` |
| `track item reparent <id>` | `h2a track item reparent` | namespacé | |
| `track item scope-declare <id>` | `h2a track item scope-declare` | namespacé | |
| `track item spec-amend <id>` | `h2a track item spec-amend` | namespacé | |
| `track item spec <id>` | `h2a track item spec` | namespacé | to-specify/specified |
| `track item realize <id>` | `h2a track item realize` | namespacé | in-progress/done/cancelled |
| `track item show <id>` | `h2a track item show` | namespacé | |
| `track item ls` | `h2a track item ls` | namespacé | |
| `track decision new` | `h2a decide` / `h2a track decision new` | alias-bare | bare `decide` = record a track decision (scindé from `job decide`) |
| `track decision outcome <id>` | `h2a track decision outcome` | namespacé | go/no-go/deferred |
| `track decision dossier <id>` | `h2a track decision dossier` | namespacé | |
| `track decision disposition <id>` | `h2a track decision disposition` | namespacé | |
| `track decision add-artifact <id>` | `h2a track decision add-artifact` | namespacé | |
| `track blocker raise` | `h2a track blocker raise` | namespacé | work dependency — distinct from `h2a block` (peer blockage) |
| `track blocker resolve <id>` | `h2a track blocker resolve` | namespacé | |
| `track blocker resolve-external` | `h2a track blocker resolve-external` | namespacé | |
| `track accept criterion <id>` | `h2a track accept criterion` | namespacé | |
| `track accept link <id>` | `h2a track accept link` | namespacé | |
| `track accept run <evidenceId>` (also `--from <report>`) | `h2a track accept run` | namespacé | both forms (single + `--from junit/json`) |
| `track accept waive <id>` | `h2a track accept waive` | namespacé | |
| `track consolidate` | `h2a track consolidate` | namespacé | |
| `track priority assess <id>` | `h2a track priority assess` | namespacé | |
| `track report` | `h2a report` / `h2a track report` | alias-bare | bare `report` = work/realization state |
| `track query` | `h2a track query` | namespacé | (or `h2a report --query`) |
| `track export-graph` | `h2a track export` | renommé | export-graph→export |
| `track workspace-activity` | `h2a track activity` | renommé | workspace-activity→activity |
| `track scope validate` | `h2a track scope validate` | namespacé | scope gate (verify family) |
| `track validate` | `h2a track validate` | namespacé | |
| `track focus <decision-id>` | `h2a track focus` | namespacé | decision focus screen (terminal/md/html) |
| `track branch import <BRANCH.md>` | `h2a track import` | renommé | branch import→import |
| `track ingest <file.jsonl>` | `h2a track ingest` | namespacé | |
| `track install-skills` | `h2a host skills --of track` | fusionné | one skills installer |
| `track workspace-id` | `h2a track workspace-id` | namespacé | |

---

## 4. `harness` → `h2a dev …`  — 14 commands (source: `harness-*` skills + `using-harness`)

| Existing command | h2a target | Status | Note |
|---|---|---|---|
| `harness check scope` | `h2a dev check scope` | namespacé | `check` non-bare (vs `host check`) |
| `harness check branch` | `h2a dev check branch` | namespacé | |
| `harness verify --category` | `h2a dev verify --category` | namespacé | `verify` namespace-only ✓ (no bare verify) |
| `harness audit` | `h2a dev audit` | namespacé | |
| `harness init` | `h2a dev init` | namespacé | repo dev profile (distinct from `h2a init`) |
| `harness brainstorm` | `h2a dev brainstorm` | namespacé | recorder → skill |
| `harness plan` | `h2a dev plan` | namespacé | |
| `harness test` | `h2a dev test` | namespacé | |
| `harness debug` | `h2a dev debug` | namespacé | |
| `harness review` | `h2a dev review` | namespacé | |
| `harness branch init` | `h2a dev branch open` | renommé | init→open |
| `harness branch close` | `h2a dev branch close` | namespacé | |
| `harness skills install` | `h2a host skills --of dev` | fusionné | one skills installer |
| `harness adopt` | `h2a dev adopt` | namespacé | onboard a non-sentropic repo |

---

## 5. Additives (federated, keep their own binary) — 24 commands

### 5a. `design` (`@sentropic/design-system-skills`, bin `design`/`sentech-design`) → `h2a design …`  — 11

| Existing command | h2a target | Status | Note |
|---|---|---|---|
| `design audit` | `h2a design lint` | renommé | bare = static jsdom (7 rules); direct binary dispatch |
| `design audit:visual` | `h2a design lint --visual` | renommé | headless Chromium layout |
| `design audit:parity` | `h2a design fidelity` | alias-bare | edge-by-edge vs DSFR/Carbon (= a11y/WCAG-AA proof) |
| `design check` | `h2a design check` | direct | quality gate 0–100 (`--tech`/`--human`/`--fail-under`) |
| `design build` | `h2a design build` | direct | Svelte 5 skeleton |
| `design align` | `h2a design align` | direct | |
| `design polish` | `h2a design polish` | direct | |
| `design init` | `h2a design init` | direct | namespaced (distinct from `h2a init`) |
| `design init --extract` (tokens) | `h2a design tokens` | renommé | federated wrapper (DESIGN.md from real CSS + tokens/themes pkgs) |
| `ds-theme-clone` skill | `h2a design theme clone <id>` | namespacé | federated wrapper; preserves scope rule (only `packages/theme-<id>`) |
| embeddable-view contract pkg | `h2a design views` | namespacé | federated wrapper; canvas rendering contract |

### 5b. `knowledge` (graphify, bin `graphify`) → `h2a knowledge …`  — 6

| Existing command | h2a target | Status | Note |
|---|---|---|---|
| `graphify .` build (`--update`/`--directed`/`--mode deep`) | `h2a knowledge ingest <path>` | namespacé | build/refresh the graph from a corpus |
| `graphify query` (`path`/`explain`/`summary`) | `h2a knowledge query <q>` | namespacé | read surface |
| `graphify serve`/`watch`/`clone`/`merge-graphs` | `h2a knowledge graph` | namespacé | lifecycle + read-only MCP transport |
| `graphify profile …` / `ontology …` | `h2a knowledge ontology` | namespacé | profiles + reviewable patch lifecycle |
| `graphify studio export` (json/html/svg/graphml/cypher/neo4j/wiki/obsidian) | `h2a knowledge export` | namespacé | renders via DS view contract |
| `graphify agent-stats {sync,sessions,wp}` | `h2a knowledge agents` | namespacé | attributes branches/commits/WPs via h2a identity + Track WP |

### 5c. `agent-stats` (`@sentropic/agent-stats`, bin `agent-stats`) → `h2a agent stats …`  — 7

| Existing command | h2a target | Status | Note |
|---|---|---|---|
| `@sentropic/agent-stats-core` (lib) | (consumed by h2a, optional dep) | direct | lib flows into h2a; no h2a CLI verb; anti-cycle one-way |
| `agent-stats stats <id>` | `h2a agent stats <id>` | namespacé | instance-scoped tokens/cost/quota roll-up |
| `agent-stats report` | `h2a agent stats <id> --report` | namespacé | per-instance report |
| `agent-stats anomalies` | `h2a agent stats <id> --anomalies` | namespacé | frustration / runaway heuristics |
| `agent-stats clean` | `h2a agent stats … --clean` | namespacé | secret redaction (delegates to core) |
| `agent-stats analyze` | `h2a agent stats <id> --analyze` | namespacé | |
| `agent-stats web` (estate-wide dashboard) | `h2a agent stats --all` / `stp agent-stats web` | **OPEN** | estate-wide cross-vendor view is ORPHANED by stp deprecation — roof to settle (`agent stats --all` vs `h2a stats` vs keep `stp agent-stats`) |

---

## Summary

- **Total commands mapped: 255** — h2a 90 · remote 93 · track 34 · harness 14 · design 11 ·
  knowledge 6 · agent-stats 7.
- **OPEN (Fabien to settle): 9**
  1. `h2a remote serve` → HTTP bus name
  2. `h2a remote send` → HTTP bus name
  3. `remote agents ls` → `agent ls` vs `find` (taxonomy)
  4. `remote jobs decide` → `job` vs `agent` namespace
  5. `remote jobs conduct` → `job` vs `agent` namespace
  6. `remote check`/`smoke` → `host check` vs `agent check` (collides with `dev check`)
  7. `remote h2a ping` → HTTP bus name
  8. `remote h2a bridge` → HTTP bus name
  9. `agent-stats web` → estate-wide analytics roof (orphaned)
- **Soft reserves (noted, not blocking):** `h2a upgrade` → `up` vs `host upgrade`; `h2a register`
  bare vs per-object; `h2a blockage` → `block` vs `impediment`.
</content>
</invoke>
