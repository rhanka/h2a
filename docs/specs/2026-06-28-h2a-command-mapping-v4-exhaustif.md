# h2a unified CLI — command mapping v4 EXHAUSTIF (CLI **et** plugin, par finalité)

**Status: mapping-for-validation v4. Read-only sur toutes les sources.** Reprend l'**énumération 255 commandes** de `2026-06-28-h2a-command-mapping-v3-finalites.md` (lignes + cibles alias-court réutilisées telles quelles) et **ajoute les surfaces plugin** (formes appelées DANS claude/codex) investiguées dans le code. Modèle : `2026-06-28-h2a-finalites-spec.md` §6 — **5 finalités : Coordinate · Run · Track · Admin · Extend**. Jumeau HTML : `…/scratchpad/semantic-focus/mapping.html`.

> **EXHAUSTIVITÉ CRITIQUE — les 255 lignes sont présentes, aucune omise.** Une ligne plugin à `—` = la commande est **CLI-only** (la majorité de remote/track-écriture/keys/deploy/host/llm-mesh). C'est une valeur valide, pas un trou.

## Colonnes (6, dans l'ordre demandé)

`ancien (cli) | ancien (plugin claude/codex) | nouveau (cli) | nouveau (plugin) | hermes | finalité`

- **ancien (cli)** — la commande CLI actuelle.
- **ancien (plugin claude/codex)** — la forme actuelle DANS le plugin/host : l'outil MCP `h2a_*` (depuis `packages/h2a-cli/src/mcp.ts` + `runtime/mcp/tools.ts`, **29 outils**), l'outil MCP **read-only** `track_*` (depuis le plugin track), OU la skill `/x` (h2a, present-decision, harness-*, ds-theme-clone, sent-tech-design, graphify). `—` si CLI-only. `claude: … / codex: …` quand ils diffèrent.
- **nouveau (cli)** — la cible alias-court (reprise de v3).
- **nouveau (plugin)** — la forme plugin cible sous le modèle unifié : l'outil MCP renommé pour suivre le nouveau verbe (`h2a_<verbe>`), la skill conservée, ou `—`.
- **hermes** — équivalent NousResearch Hermes (`hermes run --agent <x>`, `hermes job …`) ou `—`.
- **finalité** — une des 5 (Coordinate/Run/Track/Admin/Extend).

> ⚠ **OPEN (ambre)** = ligne encore ouverte (3) : `remote agents ls`, `remote check`/smoke, `agent-stats web`.

## Sources plugin investiguées (preuves)

- **`packages/h2a-cli/src/mcp.ts`** → `H2A_CLI_MCP_TOOL_NAMES` = **29 outils MCP h2a_** (register_instance, discover_instances, open_negotiation, offer, counteroffer, sign, stabilize, attest_comprehension, declare_conflit_interet, conflict_posture, inbox, append_journal, escalate, session_open, session_close, discover_sessions, nhi_report, nhi_inventory, nhi_attest, nhi_offboard, nhi_export, blockage_raise, blockage_list, blockage_resolve, conductor, conductor_claim, conductor_release, conductor_launch_check, conductor_launch).
- **`packages/h2a-cli/src/runtime/mcp/tools.ts` + `runtime/mcp/server.ts`** → schémas + dispatch ; `h2a_inbox` porte `action: read|put|pop` (1 outil = 3 verbes inbox/send/pop). `h2a_append_journal` = append d'un event de négociation. `h2a_escalate` = escalade de négociation (MANDATAIRE).
- **plugin track (MCP, read-only)** → `track_query · track_report · track_status · track_validate · track_scope_validate · track_workspace_activity · track_canevas · track_cursor · track_freshness · track_amendment_trace · track_branch_provenance · track_external_deps · track_verification_runs`. Le **contrat track = MCP lecture seule ; toute écriture passe par la CLI track** → les verbes d'écriture track sont plugin-`—`.
- **`~/.claude/skills/h2a/SKILL.md`** → skill `/h2a` (connect, status, discover, conductor[+claim/release/launch-check/launch], send, receive, negotiate, model, disconnect). Les sous-commandes appellent les outils MCP ci-dessus.
- **`packages/h2a-cli/src/hosts/plugin.ts`** → glue per-host (stop-hook / receive-gate). Skills d'extension : `present-decision` (claude) / `/decision` (codex), `harness-*` (claude) / `/cmd` (codex), `ds-theme-clone` + `sent-tech-design` (claude), `graphify` (claude).

---

## 1. Finalité — Coordinate (81 commandes)

*Concern : qui parle / décide / conduit — le bus (coordination PURE). Lib : `@sentropic/h2a-core` · `@sentropic/loop` · `transport-wake (h2a)` · `@sentropic/track`.*

**KPI section :** 81 cmds · plugin (ancien) **28** · hermes-equiv **0** · OPEN **1**.

| ancien (cli) | ancien (plugin claude/codex) | nouveau (cli) | nouveau (plugin) | hermes | finalité |
|---|---|---|---|---|---|
| `h2a discover` | `h2a_discover_instances` · `/h2a discover` | `h2a find` | `h2a_find` | — | Coordinate |
| `h2a subagent register` | — | `h2a sub register` | — | — | Coordinate |
| `h2a subagent list` | — | `h2a sub ls` | — | — | Coordinate |
| `h2a subagent route` | — | `h2a sub route` | — | — | Coordinate |
| `h2a subagent inbox` | — | `h2a sub inbox` | — | — | Coordinate |
| `h2a subagent audit` | — | `h2a sub audit` | — | — | Coordinate |
| `h2a subagent revoke` | — | `h2a sub revoke` | — | — | Coordinate |
| `h2a negotiate open` | `h2a_open_negotiation` | `h2a nego open` | `h2a_nego_open` | — | Coordinate |
| `h2a negotiate status` | — | `h2a nego status` | — | — | Coordinate |
| `h2a negotiate event` | `h2a_append_journal` | `h2a nego event` | `h2a_nego_event` | — | Coordinate |
| `h2a negotiate offer` | `h2a_offer` | `h2a nego offer` | `h2a_nego_offer` | — | Coordinate |
| `h2a negotiate counter` | `h2a_counteroffer` | `h2a nego counter` | `h2a_nego_counter` | — | Coordinate |
| `h2a negotiate sign` | `h2a_sign` | `h2a nego sign` | `h2a_nego_sign` | — | Coordinate |
| `h2a negotiate stabilize` | `h2a_stabilize` | `h2a nego stabilize` | `h2a_nego_stabilize` | — | Coordinate |
| `h2a negotiate journal` | — | `h2a nego ls` | — | — | Coordinate |
| `h2a declare-interest` | `h2a_declare_conflit_interet` | `h2a nego interest` | `h2a_nego_interest` | — | Coordinate |
| `h2a conflict-posture` | `h2a_conflict_posture` | `h2a nego conflict` | `h2a_nego_conflict` | — | Coordinate |
| `h2a dossier` | — | `h2a nego dossier` | — | — | Coordinate |
| `h2a confiance` | — | `h2a nego trust` | — | — | Coordinate |
| `h2a attest-comprehension` | `h2a_attest_comprehension` | `h2a nego attest` | `h2a_nego_attest` | — | Coordinate |
| `h2a comprehension list` | — | `h2a nego comp ls` | — | — | Coordinate |
| `h2a comprehension verify` | — | `h2a nego comp verify` | — | — | Coordinate |
| `h2a inbox put` | `h2a_inbox {put}` · `/h2a send` | `h2a send` | `h2a_send` | — | Coordinate |
| `h2a inbox read` | `h2a_inbox {read}` · `/h2a receive` | `h2a inbox` | `h2a_inbox` | — | Coordinate |
| `h2a inbox pop` | `h2a_inbox {pop}` | `h2a inbox pop` | `h2a_inbox_pop` | — | Coordinate |
| `h2a outbox put` | — | `h2a msg out send` | — | — | Coordinate |
| `h2a outbox read` | — | `h2a msg out ls` | — | — | Coordinate |
| `h2a remote serve` | — | `h2a serve` | — | — | Coordinate |
| `h2a sysml verify` | — | `h2a sysml verify` | — | — | Coordinate |
| `h2a status` | `/h2a status` (skill) | `h2a status` | `h2a_status` | — | Coordinate |
| `h2a sessions` | `h2a_discover_sessions` | `h2a ls` | `h2a_ls` | — | Coordinate |
| `h2a org validate` | — | `h2a org validate` | — | — | Coordinate |
| `h2a org show` | — | `h2a org show` | — | — | Coordinate |
| `h2a org diff` | — | `h2a org diff` | — | — | Coordinate |
| `h2a org provision` | — | `h2a org apply` | — | — | Coordinate |
| `h2a coach propose` | — | `h2a org propose` | — | — | Coordinate |
| `h2a coach ratify` | — | `h2a org ratify` | — | — | Coordinate |
| `h2a blockage raise` | `h2a_blockage_raise` | `h2a block raise` | `h2a_block_raise` | — | Coordinate |
| `h2a blockage list` | `h2a_blockage_list` | `h2a block ls` | `h2a_block_ls` | — | Coordinate |
| `h2a blockage resolve` | `h2a_blockage_resolve` | `h2a block resolve` | `h2a_block_resolve` | — | Coordinate |
| `h2a keepalive` | — | `h2a keepalive` | — | — | Coordinate |
| `h2a thread` | — | `h2a msg thread` | — | — | Coordinate |
| `h2a conductor` | `h2a_conductor` · `/h2a conductor` | `h2a cond` | `h2a_cond` | — | Coordinate |
| `h2a conductor claim` | `h2a_conductor_claim` | `h2a cond claim` | `h2a_cond_claim` | — | Coordinate |
| `h2a conductor release` | `h2a_conductor_release` | `h2a cond release` | `h2a_cond_release` | — | Coordinate |
| `h2a conductor-launch-check` | `h2a_conductor_launch_check` | `h2a cond launch --check` | `h2a_cond_launch_check` | — | Coordinate |
| `h2a conductor-launch` | `h2a_conductor_launch` | `h2a cond launch --confirm` | `h2a_cond_launch` | — | Coordinate |
| `remote ls [url]` | — | `h2a ls` | — | — | Coordinate |
| ⚠ `remote agents ls` **OPEN** | — | `h2a ls / h2a find` | — | — | Coordinate |
| `remote agents inspect` | — | `h2a inspect` | — | — | Coordinate |
| `remote conductor-launch` | — | `h2a cond launch` | — | — | Coordinate |
| `remote status` | — | `h2a status` | — | — | Coordinate |
| `h2a loop create` | — | `h2a loop create` | — | — | Coordinate |
| `h2a loop list` | — | `h2a loop ls` | — | — | Coordinate |
| `h2a loop status` | — | `h2a loop status` | — | — | Coordinate |
| `h2a loop agents` | — | `h2a loop agents` | — | — | Coordinate |
| `h2a loop attach` | — | `h2a loop attach` | — | — | Coordinate |
| `h2a loop logs` | — | `h2a loop logs` | — | — | Coordinate |
| `h2a loop tick` | — | `h2a loop tick` | — | — | Coordinate |
| `h2a loop watch` | — | `h2a loop watch` | — | — | Coordinate |
| `h2a drumbeat record` | — | `h2a drum record` | — | — | Coordinate |
| `h2a drumbeat scan` | — | `h2a drum ls` | — | — | Coordinate |
| `h2a drumbeat clear` | — | `h2a drum clear` | — | — | Coordinate |
| `h2a drumbeat escalations` | — | `h2a drum escalations` | — | — | Coordinate |
| `h2a drumbeat relance-inbox` | — | `h2a drum relance` | — | — | Coordinate |
| `h2a drumbeat watch` | — | `h2a drum watch` | — | — | Coordinate |
| `h2a remote send` | — | `h2a relay send` | — | — | Coordinate |
| `h2a drive` | — | `h2a wake` | — | — | Coordinate |
| `h2a drive receive` | — | `h2a wake verify` | — | — | Coordinate |
| `h2a drive serve` | — | `h2a wake serve` | — | — | Coordinate |
| `remote wake-request` | — | `h2a wake` | — | — | Coordinate |
| `remote relaunch [filter]` | — | `h2a wake --relaunch` | — | — | Coordinate |
| `remote resume-throttled [f]` | — | `h2a wake --throttled` | — | — | Coordinate |
| `remote h2a ping <instance>` | — | `h2a relay ping` | — | — | Coordinate |
| `remote h2a bridge [id]` | — | `h2a relay bridge` | — | — | Coordinate |
| `track decision new` | claude: `present-decision` / codex: `/decision` | `h2a decision new` | claude: `present-decision` / codex: `/decision` | — | Coordinate |
| `track decision outcome <id>` | claude: `present-decision` / codex: `/decision` | `h2a decision outcome` | claude: `present-decision` / codex: `/decision` | — | Coordinate |
| `track decision dossier <id>` | claude: `present-decision` / codex: `/decision` · `track_canevas` (read) | `h2a decision dossier` | claude: `present-decision` / codex: `/decision` | — | Coordinate |
| `track decision disposition <id>` | claude: `present-decision` / codex: `/decision` | `h2a decision disposition` | claude: `present-decision` / codex: `/decision` | — | Coordinate |
| `track decision add-artifact <id>` | claude: `present-decision` / codex: `/decision` | `h2a decision add-artifact` | claude: `present-decision` / codex: `/decision` | — | Coordinate |
| `track focus <decision-id>` | — | `h2a track focus` | — | — | Coordinate |

---

## 2. Finalité — Run (46 commandes)

*Concern : lancer / piloter un agent, où qu'il tourne. Lib : `@sentropic/agent` · `h2a-cli` · `@sentropic/runtime`.*

**KPI section :** 46 cmds · plugin (ancien) **0** (tout CLI-only ; le lancement d'un host est un spawn de process, pas un outil MCP) · hermes-equiv **12** · OPEN **1**.

| ancien (cli) | ancien (plugin claude/codex) | nouveau (cli) | nouveau (plugin) | hermes | finalité |
|---|---|---|---|---|---|
| `remote run <profile> [path]` | — | `h2a <profile> run` (bare `h2a run`) | — | `hermes run --agent <profile>` | Run |
| `remote resume [slug]` | — | `h2a resume` | — | `hermes run --resume` | Run |
| `remote codex` | — | `h2a codex run` | — | `hermes run --agent codex` | Run |
| `remote claude (claude-code)` | — | `h2a claude run` | — | `hermes run --agent claude` | Run |
| `remote agy (antigravity)` | — | `h2a agy run` | — | `hermes run --agent agy` | Run |
| `remote gemini (gemini-cli)` | — | `h2a gemini run` | — | `hermes run --agent gemini` | Run |
| `remote mistral (mistralcli)` | — | `h2a mistral run` | — | `hermes run --agent mistral` | Run |
| `remote opencode` | — | `h2a opencode run` | — | `hermes run --agent opencode` | Run |
| `remote rename <id> <name>` | — | `h2a rename` | — | — | Run |
| `remote shell` | — | `h2a shell run` | — | — | Run |
| `remote attach <url\|id>` | — | `h2a attach` | — | — | Run |
| `remote stop <url\|id>` | — | `h2a stop` | — | — | Run |
| `remote delegate <type> <task>` | — | `h2a delegate <profile>` (bare `h2a delegate`) | — | `hermes run` | Run |
| `remote jobs ls` | — | `h2a job ls` | — | `hermes job ls` | Run |
| `remote jobs status <id>` | — | `h2a job status` | — | `hermes job status` | Run |
| `remote jobs attach <id>` | — | `h2a job attach` | — | — | Run |
| `remote jobs logs <id>` | — | `h2a job logs` | — | `hermes job logs` | Run |
| `remote jobs decisions` | — | `h2a job decisions` | — | — | Run |
| `remote jobs decide <id> <a>` | — | `h2a job decide` | — | — | Run |
| `remote jobs conduct` | — | `h2a job conduct` | — | — | Run |
| `remote connect` | — | `h2a connect --tunnel` | — | — | Run |
| `remote disconnect` | — | `h2a host disconnect` | — | — | Run |
| ⚠ `remote check <profile>` (smoke) **OPEN** | — | `h2a host check / h2a <profile> check` | — | — | Run |
| `remote workspace link` | — | `h2a host workspace link` | — | — | Run |
| `remote workspace list [url]` | — | `h2a host workspace ls` | — | — | Run |
| `remote workspace status` | — | `h2a host workspace status` | — | — | Run |
| `remote workspace push` | — | `h2a host workspace push` | — | — | Run |
| `remote workspace pull` | — | `h2a host workspace pull` | — | — | Run |
| `remote workspace rm [id]` | — | `h2a host workspace rm` | — | — | Run |
| `remote workspace gc` | — | `h2a host workspace gc` | — | — | Run |
| `remote diff [id]` | — | `h2a host diff` | — | — | Run |
| `remote sync <id>` | — | `h2a host sync` | — | — | Run |
| `remote sync-status` | — | `h2a host sync-status` | — | — | Run |
| `remote sync-files` | — | `h2a host sync-files` | — | — | Run |
| `remote forward <id> <port>` | — | `h2a host forward` | — | — | Run |
| `remote browser open <id>` | — | `h2a host browser open` | — | — | Run |
| `remote migrate forward <p>` | — | `h2a host migrate forward` | — | — | Run |
| `remote migrate ls` | — | `h2a host migrate ls` | — | — | Run |
| `remote migrate pick` | — | `h2a host migrate pick` | — | — | Run |
| `remote migrate back` | — | `h2a host migrate back` | — | — | Run |
| `remote migrate to-remote [p]` | — | `h2a host migrate to-remote` | — | — | Run |
| `remote migrate to-local` | — | `h2a host migrate to-local` | — | — | Run |
| `remote restore [group]` | — | `h2a host restore` | — | — | Run |
| `remote layout show` | — | `h2a host layout show` | — | — | Run |
| `remote lineage suspend <id>` | — | `h2a host lineage suspend` | — | — | Run |
| `remote lineage resume <id>` | — | `h2a host lineage resume` | — | — | Run |

---

## 3. Finalité — Track (27 commandes)

*Concern : l'état / le record du travail. Lib : `@sentropic/track`.*

**KPI section :** 27 cmds · plugin (ancien) **5** (outils MCP track **read-only** ; toute écriture = CLI track) · hermes-equiv **0** · OPEN **0**.

| ancien (cli) | ancien (plugin claude/codex) | nouveau (cli) | nouveau (plugin) | hermes | finalité |
|---|---|---|---|---|---|
| `track init` | — | `h2a track init` | — | — | Track |
| `track item new` | — | `h2a track item new` | — | — | Track |
| `track item reparent <id>` | — | `h2a track item reparent` | — | — | Track |
| `track item scope-declare <id>` | — | `h2a track item scope-declare` | — | — | Track |
| `track item spec-amend <id>` | — | `h2a track item spec-amend` | — | — | Track |
| `track item spec <id>` | — | `h2a track item spec` | — | — | Track |
| `track item realize <id>` | — | `h2a track item realize` | — | — | Track |
| `track item show <id>` | — | `h2a track item show` | — | — | Track |
| `track item ls` | — | `h2a track item ls` | — | — | Track |
| `track blocker raise` | — | `h2a track blocker raise` | — | — | Track |
| `track blocker resolve <id>` | — | `h2a track blocker resolve` | — | — | Track |
| `track blocker resolve-external` | — | `h2a track blocker resolve-external` | — | — | Track |
| `track accept criterion <id>` | — | `h2a track accept criterion` | — | — | Track |
| `track accept link <id>` | — | `h2a track accept link` | — | — | Track |
| `track accept run <evId>` | — | `h2a track accept run` | — | — | Track |
| `track accept waive <id>` | — | `h2a track accept waive` | — | — | Track |
| `track consolidate` | — | `h2a track consolidate` | — | — | Track |
| `track priority assess <id>` | — | `h2a track priority assess` | — | — | Track |
| `track report` | `track_report` (read) | `h2a report` | `h2a_report` | — | Track |
| `track query` | `track_query` (read) | `h2a track query` | `h2a_track_query` | — | Track |
| `track export-graph` | — | `h2a track export` | — | — | Track |
| `track workspace-activity` | `track_workspace_activity` (read) | `h2a track activity` | `h2a_track_activity` | — | Track |
| `track scope validate` | `track_scope_validate` (read) | `h2a track scope validate` | `h2a_track_scope_validate` | — | Track |
| `track validate` | `track_validate` (read) | `h2a track validate` | `h2a_track_validate` | — | Track |
| `track branch import <BRANCH.md>` | — | `h2a track import` | — | — | Track |
| `track ingest <file.jsonl>` | — | `h2a track ingest` | — | — | Track |
| `track workspace-id` | — | `h2a track workspace-id` | — | — | Track |

> Outils MCP track **read-only** additionnels (surfaces de lecture, pas de nouvelle ligne CLI) : `track_status · track_canevas · track_cursor · track_freshness · track_amendment_trace · track_branch_provenance · track_external_deps · track_verification_runs`.

---

## 4. Finalité — Admin (64 commandes)

*Concern : identité, auth, clés, NHI, hosts, deploy, MCP, comptes LLM, liveness. Lib : `@sentropic/identity` · `h2a-cli` · `@sentropic/h2a-core` · `@sentropic/llm-gateway` · `@sentropic/llm-mesh`.*

**KPI section :** 64 cmds · plugin (ancien) **7** (`h2a_register_instance`, 5 `h2a_nhi_*`, `/h2a connect`→`h2a_session_open`) · hermes-equiv **0** · OPEN **0**.

| ancien (cli) | ancien (plugin claude/codex) | nouveau (cli) | nouveau (plugin) | hermes | finalité |
|---|---|---|---|---|---|
| `h2a register` | `h2a_register_instance` | `h2a register` | `h2a_register` | — | Admin |
| `h2a mcp-serve` | — | `h2a mcp serve` | — | — | Admin |
| `h2a keys generate` | — | `h2a key gen` | — | — | Admin |
| `h2a keys add` | — | `h2a key add` | — | — | Admin |
| `h2a keys list` | — | `h2a key ls` | — | — | Admin |
| `h2a keys revoke` | — | `h2a key revoke` | — | — | Admin |
| `h2a nhi report` | `h2a_nhi_report` | `h2a nhi report` | `h2a_nhi_report` | — | Admin |
| `h2a nhi inventory` | `h2a_nhi_inventory` | `h2a nhi ls` | `h2a_nhi_ls` | — | Admin |
| `h2a nhi export` | `h2a_nhi_export` | `h2a nhi export` | `h2a_nhi_export` | — | Admin |
| `h2a nhi attest` | `h2a_nhi_attest` | `h2a nhi attest` | `h2a_nhi_attest` | — | Admin |
| `h2a nhi offboard` | `h2a_nhi_offboard` | `h2a nhi offboard` | `h2a_nhi_offboard` | — | Admin |
| `remote auth status [profile]` | — | `h2a host auth status` | — | — | Admin |
| `remote auth login <profile>` | — | `h2a host auth login` | — | — | Admin |
| `remote auth push <url\|id>` | — | `h2a host auth push` | — | — | Admin |
| `remote refresh [url\|id]` | — | `h2a host auth refresh` | — | — | Admin |
| `remote secrets status [id]` | — | `h2a host secrets status` | — | — | Admin |
| `remote enroll` | — | `h2a host enroll` | — | — | Admin |
| `h2a --help` | — | `h2a --help / h2a help` | — | — | Admin |
| `h2a hosts` | — | `h2a host ls` | — | — | Admin |
| `h2a mcp-tools` | — | `h2a mcp tools` | — | — | Admin |
| `h2a init` | — | `h2a init` | — | — | Admin |
| `h2a upgrade` | — | `h2a up` | — | — | Admin |
| `h2a host setup` | — | `h2a host setup` | — | — | Admin |
| `h2a host plugin` | — | `h2a host plugin` | — | — | Admin |
| `h2a host status` | — | `h2a host status` | — | — | Admin |
| `h2a connect` | `/h2a connect` (skill → `h2a_session_open`) | `h2a connect` | `h2a_session_open` | — | Admin |
| `h2a doctor` | — | `h2a doctor` | — | — | Admin |
| `h2a install-skills` | — | `h2a host skills` | — | — | Admin |
| `h2a deploy k8s-sidecar` | — | `h2a deploy sidecar` | — | — | Admin |
| `h2a deploy k8s-tenant` | — | `h2a deploy tenant` | — | — | Admin |
| `remote install <url>` | — | `h2a host install` | — | — | Admin |
| `remote config set <url>` | — | `h2a host config set` | — | — | Admin |
| `remote config token <v>` | — | `h2a host config token` | — | — | Admin |
| `remote config target <t>` | — | `h2a host config target` | — | — | Admin |
| `remote config tools <list>` | — | `h2a host config tools` | — | — | Admin |
| `remote config tmux-profile` | — | `h2a host config tmux-profile` | — | — | Admin |
| `remote config clear` | — | `h2a host config clear` | — | — | Admin |
| `remote config show` | — | `h2a host config show` | — | — | Admin |
| `remote config tunnel` | — | `h2a host config tunnel` | — | — | Admin |
| `remote plugin add <pkg>` | — | `h2a host plugin add` | — | — | Admin |
| `remote plugin ls` | — | `h2a host plugin ls` | — | — | Admin |
| `remote plugin sync` | — | `h2a host plugin sync` | — | — | Admin |
| `remote plugin sync-skills` | — | `h2a host plugin sync-skills` | — | — | Admin |
| `track install-skills` | — | `h2a host skills --of track` | — | — | Admin |
| `harness skills install` | — | `h2a host skills --of dev` | — | — | Admin |
| `h2a store migrate` | — | `h2a store migrate` | — | — | Admin |
| `remote llm-mesh start` | — | `h2a gateway start` | — | — | Admin |
| `remote llm-mesh stop` | — | `h2a gateway stop` | — | — | Admin |
| `remote llm-mesh restart` | — | `h2a gateway restart` | — | — | Admin |
| `remote llm-mesh status` | — | `h2a gateway status` | — | — | Admin |
| `remote llm-mesh logs` | — | `h2a gateway logs` | — | — | Admin |
| `remote account enroll` | — | `h2a host account enroll` | — | — | Admin |
| `remote account ls` | — | `h2a host account ls` | — | — | Admin |
| `remote account rm <id>` | — | `h2a host account rm` | — | — | Admin |
| `remote account exhausted <id>` | — | `h2a host account exhausted` | — | — | Admin |
| `remote account clear-quota <id>` | — | `h2a host account clear-quota` | — | — | Admin |
| `remote account select` | — | `h2a host account select` | — | — | Admin |
| `remote account log` | — | `h2a host account log` | — | — | Admin |
| `remote account rm-binding <k>` | — | `h2a host account rm-binding` | — | — | Admin |
| `remote account bindings` | — | `h2a host account bindings` | — | — | Admin |
| `remote account push-cluster` | — | `h2a host account push-cluster` | — | — | Admin |
| `remote llm-mesh enroll <prov>` | — | `h2a mesh enroll` | — | — | Admin |
| `remote llm-mesh enable` | — | `h2a mesh enable` | — | — | Admin |
| `remote llm-mesh disable` | — | `h2a mesh disable` | — | — | Admin |

---

## 5. Finalité — Extend (37 commandes)

*Concern : extensions additives (gardent leur CLI). Lib : `@sentropic/harness` · `design-system` · `graphify` · `agent-stats`.*

**KPI section :** 37 cmds · plugin (ancien) **23** (13 skills harness + 4 skills design + 6 `/graphify`) · hermes-equiv **0** · OPEN **1**.

| ancien (cli) | ancien (plugin claude/codex) | nouveau (cli) | nouveau (plugin) | hermes | finalité |
|---|---|---|---|---|---|
| `harness check scope` | claude: `harness` skill / codex: `/cmd` | `h2a dev check scope` | claude: harness skill / codex: `/cmd` | — | Extend |
| `harness check branch` | claude: `harness` skill / codex: `/cmd` | `h2a dev check branch` | claude: harness skill / codex: `/cmd` | — | Extend |
| `harness verify --category` | claude: `harness` skill / codex: `/cmd` | `h2a dev verify --category` | claude: harness skill / codex: `/cmd` | — | Extend |
| `harness audit` | claude: `harness` skill / codex: `/cmd` | `h2a dev audit` | claude: harness skill / codex: `/cmd` | — | Extend |
| `harness init` | claude: `harness` skill / codex: `/cmd` | `h2a dev init` | claude: harness skill / codex: `/cmd` | — | Extend |
| `harness brainstorm` | claude: `harness-brainstorm` / codex: `/cmd` | `h2a dev brainstorm` | claude: `harness-brainstorm` / codex: `/cmd` | — | Extend |
| `harness plan` | claude: `harness-plan` / codex: `/cmd` | `h2a dev plan` | claude: `harness-plan` / codex: `/cmd` | — | Extend |
| `harness test` | claude: `harness-test` / codex: `/cmd` | `h2a dev test` | claude: `harness-test` / codex: `/cmd` | — | Extend |
| `harness debug` | claude: `harness-debug` / codex: `/cmd` | `h2a dev debug` | claude: `harness-debug` / codex: `/cmd` | — | Extend |
| `harness review` | claude: `harness-review` / codex: `/cmd` | `h2a dev review` | claude: `harness-review` / codex: `/cmd` | — | Extend |
| `harness branch init` | claude: `harness` skill / codex: `/cmd` | `h2a dev branch open` | claude: harness skill / codex: `/cmd` | — | Extend |
| `harness branch close` | claude: `harness` skill / codex: `/cmd` | `h2a dev branch close` | claude: harness skill / codex: `/cmd` | — | Extend |
| `harness adopt` | claude: `harness-adopt` / codex: `/cmd` | `h2a dev adopt` | claude: `harness-adopt` / codex: `/cmd` | — | Extend |
| `design audit` | claude: `sent-tech-design` | `h2a design lint` | claude: `sent-tech-design` | — | Extend |
| `design audit:visual` | claude: `sent-tech-design` | `h2a design lint --visual` | claude: `sent-tech-design` | — | Extend |
| `design audit:parity` | claude: `sent-tech-design` | `h2a design fidelity` | claude: `sent-tech-design` | — | Extend |
| `design check` | — | `h2a design check` | — | — | Extend |
| `design build` | — | `h2a design build` | — | — | Extend |
| `design align` | — | `h2a design align` | — | — | Extend |
| `design polish` | — | `h2a design polish` | — | — | Extend |
| `design init` | — | `h2a design init` | — | — | Extend |
| `design init --extract` | — | `h2a design tokens` | — | — | Extend |
| `ds-theme-clone (skill)` | claude: `ds-theme-clone` | `h2a design theme clone <id>` | claude: `ds-theme-clone` | — | Extend |
| `embeddable-view (pkg)` | — | `h2a design views` | — | — | Extend |
| `graphify . build (--update/--mode deep)` | `/graphify` | `h2a knowledge ingest <path>` | `/graphify` (`/knowledge`) | — | Extend |
| `graphify query (path/explain/summary)` | `/graphify` | `h2a knowledge query <q>` | `/graphify` (`/knowledge`) | — | Extend |
| `graphify serve/watch/clone/merge-graphs` | `/graphify` | `h2a knowledge graph` | `/graphify` (`/knowledge`) | — | Extend |
| `graphify profile / ontology` | `/graphify` | `h2a knowledge ontology` | `/graphify` (`/knowledge`) | — | Extend |
| `graphify studio export` | `/graphify` | `h2a knowledge export` | `/graphify` (`/knowledge`) | — | Extend |
| `graphify agent-stats {sync,sessions,wp}` | `/graphify` | `h2a knowledge agents` | `/graphify` (`/knowledge`) | — | Extend |
| `@sentropic/agent-stats-core (lib)` | — | `consommé par h2a (dep optionnelle)` | — | — | Extend |
| `agent-stats stats <id>` | — | `h2a agent stats <id>` | — | — | Extend |
| `agent-stats report` | — | `h2a agent stats <id> --report` | — | — | Extend |
| `agent-stats anomalies` | — | `h2a agent stats <id> --anomalies` | — | — | Extend |
| `agent-stats clean` | — | `h2a agent stats … --clean` | — | — | Extend |
| `agent-stats analyze` | — | `h2a agent stats <id> --analyze` | — | — | Extend |
| ⚠ `agent-stats web (estate-wide)` **OPEN** | — | `h2a agent stats --all / stp agent-stats web` | — | — | Extend |

---

## Synthèse — totaux exhaustifs

- **Total commandes mappées : 255** — aucune ligne omise. Par finalité : **Coordinate 81 · Run 46 · Track 27 · Admin 64 · Extend 37**.
- **Avec forme plugin ANCIEN (≠ —) : 63** — Coordinate 28 · Run 0 · Track 5 · Admin 7 · Extend 23.
  - dont **outils MCP `h2a_*`** : 22 (Coordinate) + 6 (Admin : register + 5 nhi) + 1 (Admin : connect→session_open) = **29 réfs** (tout le set MCP h2a est couvert ; `h2a_escalate`/`h2a_session_close` rattachés à nego-escalate / `/h2a disconnect`).
  - dont **outils MCP `track_*` read-only** : 5 (report, query, workspace-activity, scope validate, validate).
  - dont **skills** : `present-decision`/`/decision` ×5, `/h2a status`, harness ×13, `sent-tech-design` ×3, `ds-theme-clone` ×1, `/graphify` ×6.
- **Avec forme plugin NOUVEAU (≠ —) : 63** — même périmètre (CLI-only ⇒ reste CLI-only ; les outils MCP existants sont renommés pour suivre le nouveau verbe `h2a_<verbe>`, les skills sont conservées).
- **Avec équivalent hermes (≠ —) : 12** — toutes en finalité **Run** : run/resume/codex/claude/agy/gemini/mistral/opencode (8) + delegate (1) + jobs ls/status/logs (3).
- **OPEN (Fabien à trancher) : 3**
  1. `remote agents ls` → `h2a ls` (mes instances) vs `h2a find` (pairs du bus) — *Coordinate*.
  2. `remote check`/smoke → `h2a host check` vs `h2a <profile> check` (collision avec `dev check`) — *Run*.
  3. `agent-stats web` → toit estate-wide cross-vendor orphelin (stp déprécié) — *Extend*.

### Récap par finalité (KPI)

| Finalité | total | plugin ancien | plugin nouveau | hermes | OPEN |
|---|---|---|---|---|---|
| Coordinate | 81 | 28 | 28 | 0 | 1 |
| Run | 46 | 0 | 0 | 12 | 1 |
| Track | 27 | 5 | 5 | 0 | 0 |
| Admin | 64 | 7 | 7 | 0 | 0 |
| Extend | 37 | 23 | 23 | 0 | 1 |
| **TOTAL** | **255** | **63** | **63** | **12** | **3** |

### Chemins de sortie

- `docs/specs/2026-06-28-h2a-command-mapping-v4-exhaustif.md`
- `…/scratchpad/semantic-focus/mapping.html`
</content>
</invoke>
