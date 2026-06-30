# h2a unified CLI — command mapping v5 MODULES (ancien réel · module aujourd'hui → demain · par finalité)

**Status: mapping-for-validation v5. Read-only sur toutes les sources.** Re-grounde le « ancien » de [v4 exhaustif](2026-06-28-h2a-command-mapping-v4-exhaustif.md) sur ce qui **existe vraiment** (le plumbing interne est marqué ⚙, pas compté comme commande user-facing) et **ajoute deux colonnes module** (package *aujourd'hui* → lib cible *demain* v1.1). Jumeau HTML : `…/scratchpad/semantic-focus/mapping.html`.

> **Le « ancien » est le RÉEL, pas du fantasme.** Sources de vérité : `packages/h2a-cli/src/cli-contract.ts` (les ~90 verbes dispatchables, dispatch dans `cli.ts`) · `packages/remote-cli/src/index.ts` (les `.command(...)`) · `track --help` · skills `~/.claude/skills/harness-*`. Le plumbing (transport / daemon / hook / wiring) **reste listé** (il existe) mais marqué ⚙ pour ne pas gonfler le compte « commandes ».

## Colonnes (7, dans l'ordre demandé)

`ancien (cli) | ancien (plugin) | nouveau (cli) | module aujourd'hui | module demain | hermes | finalité`

- **ancien (cli)** — la commande réelle ; préfixe **⚙** = plumbing interne (PAS user-facing).
- **ancien (plugin)** — forme MCP `h2a_*`/`track_*` ou skill actuelle, ou `—` (CLI-only).
- **nouveau (cli)** — la cible alias-court (reprise de v4).
- **module aujourd'hui** — le package/lib qui porte la commande AUJOURD'HUI (`@sentropic/h2a-cli` + core `@sentropic/h2a` · `@sentropic/remote-cli` + 7 libs remote · `@sentropic/track` · `@sentropic/harness` · `@sentropic/design-system-skills` · `graphify` · `@sentropic/agent-stats`).
- **module demain** — la lib cible v1.1 (`@sentropic/h2a-core` · `@sentropic/agent` · `@sentropic/loop` · `@sentropic/identity` · `@sentropic/runtime` · `@sentropic/track` · `@sentropic/harness` · `h2a-cli` · `additif` · `@sentropic/llm-gateway` · `@sentropic/llm-mesh`). **gras** = migration de module (aujourd'hui ≠ demain).
- **hermes** — équivalent NousResearch Hermes ou `—`.
- **finalité** — une des 5 : Coordinate · Run · Track · Admin · Extend.

## KPI — total RÉEL (pas « 90 commandes »)

- **Total mappé : 255** commandes réelles — dont **224 user-facing** + **31 plumbing ⚙**.
- **Migrations de module (aujourd'hui ≠ demain) : 172** · stables : 83.
- **Équivalent hermes : 12** (toutes en Run) · **OPEN : 2** (`remote agents ls`, `remote check`). `agent-stats web` est **résolu** → finalité Track.

### User-facing vs plumbing — par CLI (le vrai compte)

| CLI (package aujourd'hui) | total | user-facing | plumbing ⚙ |
|---|---|---|---|
| `h2a-cli` | 90 | 71 | 19 |
| `remote-cli` | 93 | 83 | 10 |
| `track` | 34 | 33 | 1 |
| `harness` | 14 | 13 | 1 |
| `design-system-skills` | 11 | 11 | 0 |
| `graphify` | 6 | 6 | 0 |
| `agent-stats` | 7 | 7 | 0 |
| **TOTAL** | **255** | **224** | **31** |

> **Lecture :** `h2a-cli` n'est PAS « 90 commandes user » — c'est **71 user-facing + 19 plumbing** (mcp-serve, host setup/plugin, install-skills, store migrate, drumbeat×6, drive×3, remote serve/send, sysml verify, keepalive, conductor-launch-check). De même `remote-cli` = 83 user / 10 plumbing (wake/relaunch/ping/bridge, lineage, enroll, plugin sync).

---

## Finalité — Coordinate (81 commandes)

*Concern : qui parle / décide / conduit — le bus (coordination PURE). Libs demain : @sentropic/h2a-core · @sentropic/loop · @sentropic/runtime (wake) · @sentropic/track.*

**KPI section :** 81 cmds · user-facing **62** / plumbing ⚙ **19** · migrations module **75** · plugin ancien **28** · hermes **0** · OPEN **1**.

| ancien (cli) | ancien (plugin) | nouveau (cli) | module aujourd'hui | module demain | hermes | finalité |
|---|---|---|---|---|---|---|
| `h2a discover` | h2a_discover_instances · /h2a discover | `h2a find` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a subagent register` | — | `h2a sub register` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a subagent list` | — | `h2a sub ls` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a subagent route` | — | `h2a sub route` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a subagent inbox` | — | `h2a sub inbox` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a subagent audit` | — | `h2a sub audit` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a subagent revoke` | — | `h2a sub revoke` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a negotiate open` | h2a_open_negotiation | `h2a nego open` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a negotiate status` | — | `h2a nego status` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a negotiate event` | h2a_append_journal | `h2a nego event` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a negotiate offer` | h2a_offer | `h2a nego offer` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a negotiate counter` | h2a_counteroffer | `h2a nego counter` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a negotiate sign` | h2a_sign | `h2a nego sign` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a negotiate stabilize` | h2a_stabilize | `h2a nego stabilize` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a negotiate journal` | — | `h2a nego ls` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a declare-interest` | h2a_declare_conflit_interet | `h2a nego interest` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a conflict-posture` | h2a_conflict_posture | `h2a nego conflict` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a dossier` | — | `h2a nego dossier` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a confiance` | — | `h2a nego trust` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a attest-comprehension` | h2a_attest_comprehension | `h2a nego attest` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a comprehension list` | — | `h2a nego comp ls` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a comprehension verify` | — | `h2a nego comp verify` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a inbox put` | h2a_inbox {put} · /h2a send | `h2a send` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a inbox read` | h2a_inbox {read} · /h2a receive | `h2a inbox` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a inbox pop` | h2a_inbox {pop} | `h2a inbox pop` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a outbox put` | — | `h2a msg out send` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a outbox read` | — | `h2a msg out ls` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `⚙ h2a remote serve` | — | `h2a serve` | `@sentropic/h2a-cli` | **@sentropic/runtime** | — | Coordinate |
| `⚙ h2a sysml verify` | — | `h2a sysml verify` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a status` | /h2a status | `h2a status` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a sessions` | h2a_discover_sessions | `h2a ls` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a org validate` | — | `h2a org validate` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a org show` | — | `h2a org show` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a org diff` | — | `h2a org diff` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a org provision` | — | `h2a org apply` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a coach propose` | — | `h2a org propose` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a coach ratify` | — | `h2a org ratify` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a blockage raise` | h2a_blockage_raise | `h2a block raise` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a blockage list` | h2a_blockage_list | `h2a block ls` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a blockage resolve` | h2a_blockage_resolve | `h2a block resolve` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `⚙ h2a keepalive` | — | `h2a keepalive` | `@sentropic/h2a-cli` | **@sentropic/runtime** | — | Coordinate |
| `h2a thread` | — | `h2a msg thread` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a conductor` | h2a_conductor · /h2a conductor | `h2a cond` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a conductor claim` | h2a_conductor_claim | `h2a cond claim` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a conductor release` | h2a_conductor_release | `h2a cond release` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `⚙ h2a conductor-launch-check` | h2a_conductor_launch_check | `h2a cond launch --check` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a conductor-launch` | h2a_conductor_launch | `h2a cond launch --confirm` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `remote ls [url]` | — | `h2a ls` | `@sentropic/remote-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `⚠ remote agents ls **OPEN**` | — | `h2a ls / h2a find` | `@sentropic/remote-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `remote agents inspect` | — | `h2a inspect` | `@sentropic/remote-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `remote conductor-launch` | — | `h2a cond launch` | `@sentropic/remote-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `remote status` | — | `h2a status` | `@sentropic/remote-cli` | **@sentropic/h2a-core** | — | Coordinate |
| `h2a loop create` | — | `h2a loop create` | `@sentropic/h2a-cli` | **@sentropic/loop** | — | Coordinate |
| `h2a loop list` | — | `h2a loop ls` | `@sentropic/h2a-cli` | **@sentropic/loop** | — | Coordinate |
| `h2a loop status` | — | `h2a loop status` | `@sentropic/h2a-cli` | **@sentropic/loop** | — | Coordinate |
| `h2a loop agents` | — | `h2a loop agents` | `@sentropic/h2a-cli` | **@sentropic/loop** | — | Coordinate |
| `h2a loop attach` | — | `h2a loop attach` | `@sentropic/h2a-cli` | **@sentropic/loop** | — | Coordinate |
| `h2a loop logs` | — | `h2a loop logs` | `@sentropic/h2a-cli` | **@sentropic/loop** | — | Coordinate |
| `h2a loop tick` | — | `h2a loop tick` | `@sentropic/h2a-cli` | **@sentropic/loop** | — | Coordinate |
| `h2a loop watch` | — | `h2a loop watch` | `@sentropic/h2a-cli` | **@sentropic/loop** | — | Coordinate |
| `⚙ h2a drumbeat record` | — | `h2a drum record` | `@sentropic/h2a-cli` | **@sentropic/runtime** | — | Coordinate |
| `⚙ h2a drumbeat scan` | — | `h2a drum ls` | `@sentropic/h2a-cli` | **@sentropic/runtime** | — | Coordinate |
| `⚙ h2a drumbeat clear` | — | `h2a drum clear` | `@sentropic/h2a-cli` | **@sentropic/runtime** | — | Coordinate |
| `⚙ h2a drumbeat escalations` | — | `h2a drum escalations` | `@sentropic/h2a-cli` | **@sentropic/runtime** | — | Coordinate |
| `⚙ h2a drumbeat relance-inbox` | — | `h2a drum relance` | `@sentropic/h2a-cli` | **@sentropic/runtime** | — | Coordinate |
| `⚙ h2a drumbeat watch` | — | `h2a drum watch` | `@sentropic/h2a-cli` | **@sentropic/runtime** | — | Coordinate |
| `⚙ h2a remote send` | — | `h2a relay send` | `@sentropic/h2a-cli` | **@sentropic/runtime** | — | Coordinate |
| `⚙ h2a drive` | — | `h2a wake` | `@sentropic/h2a-cli` | **@sentropic/runtime** | — | Coordinate |
| `⚙ h2a drive receive` | — | `h2a wake verify` | `@sentropic/h2a-cli` | **@sentropic/runtime** | — | Coordinate |
| `⚙ h2a drive serve` | — | `h2a wake serve` | `@sentropic/h2a-cli` | **@sentropic/runtime** | — | Coordinate |
| `⚙ remote wake-request` | — | `h2a wake` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Coordinate |
| `⚙ remote relaunch [filter]` | — | `h2a wake --relaunch` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Coordinate |
| `⚙ remote resume-throttled [f]` | — | `h2a wake --throttled` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Coordinate |
| `⚙ remote h2a ping <instance>` | — | `h2a relay ping` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Coordinate |
| `⚙ remote h2a bridge [id]` | — | `h2a relay bridge` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Coordinate |
| `track decision new` | claude: present-decision / codex: /decision | `h2a decision new` | `@sentropic/track` | @sentropic/track | — | Coordinate |
| `track decision outcome <id>` | present-decision / /decision | `h2a decision outcome` | `@sentropic/track` | @sentropic/track | — | Coordinate |
| `track decision dossier <id>` | present-decision / /decision · track_canevas (read) | `h2a decision dossier` | `@sentropic/track` | @sentropic/track | — | Coordinate |
| `track decision disposition <id>` | present-decision / /decision | `h2a decision disposition` | `@sentropic/track` | @sentropic/track | — | Coordinate |
| `track decision add-artifact <id>` | present-decision / /decision | `h2a decision add-artifact` | `@sentropic/track` | @sentropic/track | — | Coordinate |
| `track focus <decision-id>` | — | `h2a track focus` | `@sentropic/track` | @sentropic/track | — | Coordinate |

---

## Finalité — Run (46 commandes)

*Concern : lancer / piloter un agent, où qu'il tourne. Libs demain : @sentropic/agent · @sentropic/runtime · h2a-cli.*

**KPI section :** 46 cmds · user-facing **44** / plumbing ⚙ **2** · migrations module **46** · plugin ancien **0** · hermes **12** · OPEN **1**.

| ancien (cli) | ancien (plugin) | nouveau (cli) | module aujourd'hui | module demain | hermes | finalité |
|---|---|---|---|---|---|---|
| `remote run <profile> [path]` | — | `h2a <profile> run` | `@sentropic/remote-cli` | **@sentropic/agent** | hermes run --agent <profile> | Run |
| `remote resume [slug]` | — | `h2a resume` | `@sentropic/remote-cli` | **@sentropic/agent** | hermes run --resume | Run |
| `remote codex` | — | `h2a codex run` | `@sentropic/remote-cli` | **@sentropic/agent** | hermes run --agent codex | Run |
| `remote claude (claude-code)` | — | `h2a claude run` | `@sentropic/remote-cli` | **@sentropic/agent** | hermes run --agent claude | Run |
| `remote agy (antigravity)` | — | `h2a agy run` | `@sentropic/remote-cli` | **@sentropic/agent** | hermes run --agent agy | Run |
| `remote gemini (gemini-cli)` | — | `h2a gemini run` | `@sentropic/remote-cli` | **@sentropic/agent** | hermes run --agent gemini | Run |
| `remote mistral (mistralcli)` | — | `h2a mistral run` | `@sentropic/remote-cli` | **@sentropic/agent** | hermes run --agent mistral | Run |
| `remote opencode` | — | `h2a opencode run` | `@sentropic/remote-cli` | **@sentropic/agent** | hermes run --agent opencode | Run |
| `remote rename <id> <name>` | — | `h2a rename` | `@sentropic/remote-cli` | **@sentropic/agent** | — | Run |
| `remote shell` | — | `h2a shell run` | `@sentropic/remote-cli` | **@sentropic/agent** | — | Run |
| `remote attach <url|id>` | — | `h2a attach` | `@sentropic/remote-cli` | **@sentropic/agent** | — | Run |
| `remote stop <url|id>` | — | `h2a stop` | `@sentropic/remote-cli` | **@sentropic/agent** | — | Run |
| `remote delegate <type> <task>` | — | `h2a delegate <profile>` | `@sentropic/remote-cli` | **@sentropic/agent** | hermes run | Run |
| `remote jobs ls` | — | `h2a job ls` | `@sentropic/remote-cli` | **@sentropic/runtime** | hermes job ls | Run |
| `remote jobs status <id>` | — | `h2a job status` | `@sentropic/remote-cli` | **@sentropic/runtime** | hermes job status | Run |
| `remote jobs attach <id>` | — | `h2a job attach` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote jobs logs <id>` | — | `h2a job logs` | `@sentropic/remote-cli` | **@sentropic/runtime** | hermes job logs | Run |
| `remote jobs decisions` | — | `h2a job decisions` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote jobs decide <id> <a>` | — | `h2a job decide` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote jobs conduct` | — | `h2a job conduct` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote connect` | — | `h2a connect --tunnel` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote disconnect` | — | `h2a host disconnect` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `⚠ remote check <profile> (smoke) **OPEN**` | — | `h2a host check / h2a <profile> check` | `@sentropic/remote-cli` | **@sentropic/agent** | — | Run |
| `remote workspace link` | — | `h2a host workspace link` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote workspace list [url]` | — | `h2a host workspace ls` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote workspace status` | — | `h2a host workspace status` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote workspace push` | — | `h2a host workspace push` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote workspace pull` | — | `h2a host workspace pull` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote workspace rm [id]` | — | `h2a host workspace rm` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote workspace gc` | — | `h2a host workspace gc` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote diff [id]` | — | `h2a host diff` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote sync <id>` | — | `h2a host sync` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote sync-status` | — | `h2a host sync-status` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote sync-files` | — | `h2a host sync-files` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote forward <id> <port>` | — | `h2a host forward` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote browser open <id>` | — | `h2a host browser open` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote migrate forward <p>` | — | `h2a host migrate forward` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote migrate ls` | — | `h2a host migrate ls` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote migrate pick` | — | `h2a host migrate pick` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote migrate back` | — | `h2a host migrate back` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote migrate to-remote [p]` | — | `h2a host migrate to-remote` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote migrate to-local` | — | `h2a host migrate to-local` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote restore [group]` | — | `h2a host restore` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `remote layout show` | — | `h2a host layout show` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `⚙ remote lineage suspend <id>` | — | `h2a host lineage suspend` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |
| `⚙ remote lineage resume <id>` | — | `h2a host lineage resume` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Run |

---

## Finalité — Track (28 commandes)

*Concern : l'état / le record du travail. Libs demain : @sentropic/track (+ additif agent-stats).*

**KPI section :** 28 cmds · user-facing **28** / plumbing ⚙ **0** · migrations module **0** · plugin ancien **5** · hermes **0** · OPEN **0**.

| ancien (cli) | ancien (plugin) | nouveau (cli) | module aujourd'hui | module demain | hermes | finalité |
|---|---|---|---|---|---|---|
| `track init` | — | `h2a track init` | `@sentropic/track` | @sentropic/track | — | Track |
| `track item new` | — | `h2a track item new` | `@sentropic/track` | @sentropic/track | — | Track |
| `track item reparent <id>` | — | `h2a track item reparent` | `@sentropic/track` | @sentropic/track | — | Track |
| `track item scope-declare <id>` | — | `h2a track item scope-declare` | `@sentropic/track` | @sentropic/track | — | Track |
| `track item spec-amend <id>` | — | `h2a track item spec-amend` | `@sentropic/track` | @sentropic/track | — | Track |
| `track item spec <id>` | — | `h2a track item spec` | `@sentropic/track` | @sentropic/track | — | Track |
| `track item realize <id>` | — | `h2a track item realize` | `@sentropic/track` | @sentropic/track | — | Track |
| `track item show <id>` | — | `h2a track item show` | `@sentropic/track` | @sentropic/track | — | Track |
| `track item ls` | — | `h2a track item ls` | `@sentropic/track` | @sentropic/track | — | Track |
| `track blocker raise` | — | `h2a track blocker raise` | `@sentropic/track` | @sentropic/track | — | Track |
| `track blocker resolve <id>` | — | `h2a track blocker resolve` | `@sentropic/track` | @sentropic/track | — | Track |
| `track blocker resolve-external` | — | `h2a track blocker resolve-external` | `@sentropic/track` | @sentropic/track | — | Track |
| `track accept criterion <id>` | — | `h2a track accept criterion` | `@sentropic/track` | @sentropic/track | — | Track |
| `track accept link <id>` | — | `h2a track accept link` | `@sentropic/track` | @sentropic/track | — | Track |
| `track accept run <evId>` | — | `h2a track accept run` | `@sentropic/track` | @sentropic/track | — | Track |
| `track accept waive <id>` | — | `h2a track accept waive` | `@sentropic/track` | @sentropic/track | — | Track |
| `track consolidate` | — | `h2a track consolidate` | `@sentropic/track` | @sentropic/track | — | Track |
| `track priority assess <id>` | — | `h2a track priority assess` | `@sentropic/track` | @sentropic/track | — | Track |
| `track report` | track_report (read) | `h2a report` | `@sentropic/track` | @sentropic/track | — | Track |
| `track query` | track_query (read) | `h2a track query` | `@sentropic/track` | @sentropic/track | — | Track |
| `track export-graph` | — | `h2a track export` | `@sentropic/track` | @sentropic/track | — | Track |
| `track workspace-activity` | track_workspace_activity (read) | `h2a track activity` | `@sentropic/track` | @sentropic/track | — | Track |
| `track scope validate` | track_scope_validate (read) | `h2a track scope validate` | `@sentropic/track` | @sentropic/track | — | Track |
| `track validate` | track_validate (read) | `h2a track validate` | `@sentropic/track` | @sentropic/track | — | Track |
| `track branch import <BRANCH.md>` | — | `h2a track import` | `@sentropic/track` | @sentropic/track | — | Track |
| `track ingest <file.jsonl>` | — | `h2a track ingest` | `@sentropic/track` | @sentropic/track | — | Track |
| `track workspace-id` | — | `h2a track workspace-id` | `@sentropic/track` | @sentropic/track | — | Track |
| `agent-stats web (estate-wide)` | — | `h2a agent stats --all / h2a track agents-web` | `@sentropic/agent-stats` | additif | — | Track |

---

## Finalité — Admin (64 commandes)

*Concern : identité, auth, clés, NHI, hosts, deploy, MCP, comptes LLM, liveness. Libs demain : @sentropic/identity · h2a-cli · @sentropic/h2a-core · @sentropic/runtime · @sentropic/llm-gateway · @sentropic/llm-mesh.*

**KPI section :** 64 cmds · user-facing **54** / plumbing ⚙ **10** · migrations module **51** · plugin ancien **7** · hermes **0** · OPEN **0**.

| ancien (cli) | ancien (plugin) | nouveau (cli) | module aujourd'hui | module demain | hermes | finalité |
|---|---|---|---|---|---|---|
| `h2a register` | h2a_register_instance | `h2a register` | `@sentropic/h2a-cli` | **@sentropic/identity** | — | Admin |
| `⚙ h2a mcp-serve` | — | `h2a mcp serve` | `@sentropic/h2a-cli` | **@sentropic/runtime** | — | Admin |
| `h2a keys generate` | — | `h2a key gen` | `@sentropic/h2a-cli` | **@sentropic/identity** | — | Admin |
| `h2a keys add` | — | `h2a key add` | `@sentropic/h2a-cli` | **@sentropic/identity** | — | Admin |
| `h2a keys list` | — | `h2a key ls` | `@sentropic/h2a-cli` | **@sentropic/identity** | — | Admin |
| `h2a keys revoke` | — | `h2a key revoke` | `@sentropic/h2a-cli` | **@sentropic/identity** | — | Admin |
| `h2a nhi report` | h2a_nhi_report | `h2a nhi report` | `@sentropic/h2a-cli` | **@sentropic/identity** | — | Admin |
| `h2a nhi inventory` | h2a_nhi_inventory | `h2a nhi ls` | `@sentropic/h2a-cli` | **@sentropic/identity** | — | Admin |
| `h2a nhi export` | h2a_nhi_export | `h2a nhi export` | `@sentropic/h2a-cli` | **@sentropic/identity** | — | Admin |
| `h2a nhi attest` | h2a_nhi_attest | `h2a nhi attest` | `@sentropic/h2a-cli` | **@sentropic/identity** | — | Admin |
| `h2a nhi offboard` | h2a_nhi_offboard | `h2a nhi offboard` | `@sentropic/h2a-cli` | **@sentropic/identity** | — | Admin |
| `remote auth status [profile]` | — | `h2a host auth status` | `@sentropic/remote-cli` | **@sentropic/identity** | — | Admin |
| `remote auth login <profile>` | — | `h2a host auth login` | `@sentropic/remote-cli` | **@sentropic/identity** | — | Admin |
| `remote auth push <url|id>` | — | `h2a host auth push` | `@sentropic/remote-cli` | **@sentropic/identity** | — | Admin |
| `remote refresh [url|id]` | — | `h2a host auth refresh` | `@sentropic/remote-cli` | **@sentropic/identity** | — | Admin |
| `remote secrets status [id]` | — | `h2a host secrets status` | `@sentropic/remote-cli` | **@sentropic/identity** | — | Admin |
| `⚙ remote enroll` | — | `h2a host enroll` | `@sentropic/remote-cli` | **@sentropic/identity** | — | Admin |
| `h2a --help` | — | `h2a --help / h2a help` | `@sentropic/h2a-cli` | h2a-cli | — | Admin |
| `h2a hosts` | — | `h2a host ls` | `@sentropic/h2a-cli` | h2a-cli | — | Admin |
| `h2a mcp-tools` | — | `h2a mcp tools` | `@sentropic/h2a-cli` | h2a-cli | — | Admin |
| `h2a init` | — | `h2a init` | `@sentropic/h2a-cli` | h2a-cli | — | Admin |
| `h2a upgrade` | — | `h2a up` | `@sentropic/h2a-cli` | h2a-cli | — | Admin |
| `⚙ h2a host setup` | — | `h2a host setup` | `@sentropic/h2a-cli` | h2a-cli | — | Admin |
| `⚙ h2a host plugin` | — | `h2a host plugin` | `@sentropic/h2a-cli` | h2a-cli | — | Admin |
| `h2a host status` | — | `h2a host status` | `@sentropic/h2a-cli` | h2a-cli | — | Admin |
| `h2a connect` | /h2a connect (skill -> h2a_session_open) | `h2a connect` | `@sentropic/h2a-cli` | h2a-cli | — | Admin |
| `h2a doctor` | — | `h2a doctor` | `@sentropic/h2a-cli` | h2a-cli | — | Admin |
| `⚙ h2a install-skills` | — | `h2a host skills` | `@sentropic/h2a-cli` | h2a-cli | — | Admin |
| `h2a deploy k8s-sidecar` | — | `h2a deploy sidecar` | `@sentropic/h2a-cli` | **@sentropic/runtime** | — | Admin |
| `h2a deploy k8s-tenant` | — | `h2a deploy tenant` | `@sentropic/h2a-cli` | **@sentropic/runtime** | — | Admin |
| `remote install <url>` | — | `h2a host install` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Admin |
| `remote config set <url>` | — | `h2a host config set` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Admin |
| `remote config token <v>` | — | `h2a host config token` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Admin |
| `remote config target <t>` | — | `h2a host config target` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Admin |
| `remote config tools <list>` | — | `h2a host config tools` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Admin |
| `remote config tmux-profile` | — | `h2a host config tmux-profile` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Admin |
| `remote config clear` | — | `h2a host config clear` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Admin |
| `remote config show` | — | `h2a host config show` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Admin |
| `remote config tunnel` | — | `h2a host config tunnel` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Admin |
| `remote plugin add <pkg>` | — | `h2a host plugin add` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Admin |
| `remote plugin ls` | — | `h2a host plugin ls` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Admin |
| `⚙ remote plugin sync` | — | `h2a host plugin sync` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Admin |
| `⚙ remote plugin sync-skills` | — | `h2a host plugin sync-skills` | `@sentropic/remote-cli` | **@sentropic/runtime** | — | Admin |
| `⚙ track install-skills` | — | `h2a host skills --of track` | `@sentropic/track` | @sentropic/track | — | Admin |
| `⚙ harness skills install` | — | `h2a host skills --of dev` | `@sentropic/harness` | @sentropic/harness | — | Admin |
| `⚙ h2a store migrate` | — | `h2a store migrate` | `@sentropic/h2a-cli` | **@sentropic/h2a-core** | — | Admin |
| `remote llm-mesh start` | — | `h2a gateway start` | `@sentropic/remote-cli` | **@sentropic/llm-gateway** | — | Admin |
| `remote llm-mesh stop` | — | `h2a gateway stop` | `@sentropic/remote-cli` | **@sentropic/llm-gateway** | — | Admin |
| `remote llm-mesh restart` | — | `h2a gateway restart` | `@sentropic/remote-cli` | **@sentropic/llm-gateway** | — | Admin |
| `remote llm-mesh status` | — | `h2a gateway status` | `@sentropic/remote-cli` | **@sentropic/llm-gateway** | — | Admin |
| `remote llm-mesh logs` | — | `h2a gateway logs` | `@sentropic/remote-cli` | **@sentropic/llm-gateway** | — | Admin |
| `remote account enroll` | — | `h2a host account enroll` | `@sentropic/remote-cli` | **@sentropic/llm-mesh** | — | Admin |
| `remote account ls` | — | `h2a host account ls` | `@sentropic/remote-cli` | **@sentropic/llm-mesh** | — | Admin |
| `remote account rm <id>` | — | `h2a host account rm` | `@sentropic/remote-cli` | **@sentropic/llm-mesh** | — | Admin |
| `remote account exhausted <id>` | — | `h2a host account exhausted` | `@sentropic/remote-cli` | **@sentropic/llm-mesh** | — | Admin |
| `remote account clear-quota <id>` | — | `h2a host account clear-quota` | `@sentropic/remote-cli` | **@sentropic/llm-mesh** | — | Admin |
| `remote account select` | — | `h2a host account select` | `@sentropic/remote-cli` | **@sentropic/llm-mesh** | — | Admin |
| `remote account log` | — | `h2a host account log` | `@sentropic/remote-cli` | **@sentropic/llm-mesh** | — | Admin |
| `remote account rm-binding <k>` | — | `h2a host account rm-binding` | `@sentropic/remote-cli` | **@sentropic/llm-mesh** | — | Admin |
| `remote account bindings` | — | `h2a host account bindings` | `@sentropic/remote-cli` | **@sentropic/llm-mesh** | — | Admin |
| `remote account push-cluster` | — | `h2a host account push-cluster` | `@sentropic/remote-cli` | **@sentropic/llm-mesh** | — | Admin |
| `remote llm-mesh enroll <prov>` | — | `h2a mesh enroll` | `@sentropic/remote-cli` | **@sentropic/llm-mesh** | — | Admin |
| `remote llm-mesh enable` | — | `h2a mesh enable` | `@sentropic/remote-cli` | **@sentropic/llm-mesh** | — | Admin |
| `remote llm-mesh disable` | — | `h2a mesh disable` | `@sentropic/remote-cli` | **@sentropic/llm-mesh** | — | Admin |

---

## Finalité — Extend (36 commandes)

*Concern : extensions additives (gardent leur package). Libs demain : @sentropic/harness · additif (design-system · graphify · agent-stats).*

**KPI section :** 36 cmds · user-facing **36** / plumbing ⚙ **0** · migrations module **0** · plugin ancien **23** · hermes **0** · OPEN **0**.

| ancien (cli) | ancien (plugin) | nouveau (cli) | module aujourd'hui | module demain | hermes | finalité |
|---|---|---|---|---|---|---|
| `harness check scope` | claude: harness / codex: /cmd | `h2a dev check scope` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| `harness check branch` | claude: harness / codex: /cmd | `h2a dev check branch` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| `harness verify --category` | claude: harness / codex: /cmd | `h2a dev verify --category` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| `harness audit` | claude: harness / codex: /cmd | `h2a dev audit` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| `harness init` | claude: harness / codex: /cmd | `h2a dev init` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| `harness brainstorm` | claude: harness-brainstorm / codex: /cmd | `h2a dev brainstorm` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| `harness plan` | claude: harness-plan / codex: /cmd | `h2a dev plan` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| `harness test` | claude: harness-test / codex: /cmd | `h2a dev test` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| `harness debug` | claude: harness-debug / codex: /cmd | `h2a dev debug` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| `harness review` | claude: harness-review / codex: /cmd | `h2a dev review` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| `harness branch init` | claude: harness / codex: /cmd | `h2a dev branch open` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| `harness branch close` | claude: harness / codex: /cmd | `h2a dev branch close` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| `harness adopt` | claude: harness-adopt / codex: /cmd | `h2a dev adopt` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| `design audit` | claude: sent-tech-design | `h2a design lint` | `@sentropic/design-system-skills` | additif | — | Extend |
| `design audit:visual` | claude: sent-tech-design | `h2a design lint --visual` | `@sentropic/design-system-skills` | additif | — | Extend |
| `design audit:parity` | claude: sent-tech-design | `h2a design fidelity` | `@sentropic/design-system-skills` | additif | — | Extend |
| `design check` | — | `h2a design check` | `@sentropic/design-system-skills` | additif | — | Extend |
| `design build` | — | `h2a design build` | `@sentropic/design-system-skills` | additif | — | Extend |
| `design align` | — | `h2a design align` | `@sentropic/design-system-skills` | additif | — | Extend |
| `design polish` | — | `h2a design polish` | `@sentropic/design-system-skills` | additif | — | Extend |
| `design init` | — | `h2a design init` | `@sentropic/design-system-skills` | additif | — | Extend |
| `design init --extract` | — | `h2a design tokens` | `@sentropic/design-system-skills` | additif | — | Extend |
| `ds-theme-clone (skill)` | claude: ds-theme-clone | `h2a design theme clone <id>` | `@sentropic/design-system-skills` | additif | — | Extend |
| `embeddable-view (pkg)` | — | `h2a design views` | `@sentropic/design-system-skills` | additif | — | Extend |
| `graphify . build (--update/deep)` | /graphify | `h2a knowledge ingest <path>` | `graphify` | additif | — | Extend |
| `graphify query (path/explain)` | /graphify | `h2a knowledge query <q>` | `graphify` | additif | — | Extend |
| `graphify serve/watch/clone/merge` | /graphify | `h2a knowledge graph` | `graphify` | additif | — | Extend |
| `graphify profile / ontology` | /graphify | `h2a knowledge ontology` | `graphify` | additif | — | Extend |
| `graphify studio export` | /graphify | `h2a knowledge export` | `graphify` | additif | — | Extend |
| `graphify agent-stats {sync,..}` | /graphify | `h2a knowledge agents` | `graphify` | additif | — | Extend |
| `@sentropic/agent-stats-core (lib)` | — | `consommé par h2a (dep optionnelle)` | `@sentropic/agent-stats` | additif | — | Extend |
| `agent-stats stats <id>` | — | `h2a agent stats <id>` | `@sentropic/agent-stats` | additif | — | Extend |
| `agent-stats report` | — | `h2a agent stats <id> --report` | `@sentropic/agent-stats` | additif | — | Extend |
| `agent-stats anomalies` | — | `h2a agent stats <id> --anomalies` | `@sentropic/agent-stats` | additif | — | Extend |
| `agent-stats clean` | — | `h2a agent stats … --clean` | `@sentropic/agent-stats` | additif | — | Extend |
| `agent-stats analyze` | — | `h2a agent stats <id> --analyze` | `@sentropic/agent-stats` | additif | — | Extend |

---

## Synthèse

- **Total réel : 255** = **224 user-facing** + **31 plumbing ⚙**.
- **User-facing vs plumbing par CLI :** `h2a-cli` 71u/19p · `remote-cli` 83u/10p · `track` 33u/1p · `harness` 13u/1p · `design-system-skills` 11u/0p · `graphify` 6u/0p · `agent-stats` 7u/0p.
- **Migrations de module (aujourd'hui ≠ demain) : 172** (le gros : `h2a-cli` éclaté en h2a-core/identity/runtime/loop ; `remote-cli` éclaté en agent/runtime/identity/llm-*). Stables : 83 (thin CLI `h2a-cli`, `track`, `harness`, additifs).
- **Par finalité :** Coordinate 81 · Run 46 · Track 28 · Admin 64 · Extend 36.
- **hermes : 12** · **OPEN : 2** (`remote agents ls`, `remote check`).

### Récap par finalité

| Finalité | total | user-facing | plumbing ⚙ | migrations | plugin ancien | hermes | OPEN |
|---|---|---|---|---|---|---|---|
| Coordinate | 81 | 62 | 19 | 75 | 28 | 0 | 1 |
| Run | 46 | 44 | 2 | 46 | 0 | 12 | 1 |
| Track | 28 | 28 | 0 | 0 | 5 | 0 | 0 |
| Admin | 64 | 54 | 10 | 51 | 7 | 0 | 0 |
| Extend | 36 | 36 | 0 | 0 | 23 | 0 | 0 |
| **TOTAL** | **255** | **224** | **31** | **172** | **63** | **12** | **2** |

### Chemins de sortie

- `docs/specs/2026-06-28-h2a-command-mapping-v5-modules.md`
- `…/scratchpad/semantic-focus/mapping.html`
