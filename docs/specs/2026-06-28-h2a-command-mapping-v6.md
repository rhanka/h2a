# h2a unified CLI — command mapping v5 MODULES (ancien réel · module aujourd'hui → demain · par finalité)

**Status: mapping-for-validation v5. Read-only sur toutes les sources.** Re-grounde le « ancien » de [v4 exhaustif](2026-06-28-h2a-command-mapping-v4-exhaustif.md) sur ce qui **existe vraiment** (le plumbing interne est marqué ⚙, pas compté comme commande user-facing) et **ajoute deux colonnes module** (package *aujourd'hui* → lib cible *demain* v1.1). Jumeau HTML : `…/scratchpad/semantic-focus/mapping.html`.

> **Le « ancien » est le RÉEL, pas du fantasme.** Sources de vérité : `packages/h2a-cli/src/cli-contract.ts` (les ~90 verbes dispatchables, dispatch dans `cli.ts`) · `packages/remote-cli/src/index.ts` (les `.command(...)`) · `track --help` · skills `~/.claude/skills/harness-*`. Le plumbing (transport / daemon / hook / wiring) **reste listé** (il existe) mais marqué ⚙ pour ne pas gonfler le compte « commandes ».

## Colonnes (8, dans l'ordre demandé)

`ancien (cli) | ancien (plugin) | nouveau (cli) | nouveau (plugin) | module aujourd'hui | module demain | hermes | finalité`

- **ancien (cli)** — la commande réelle ; préfixe **⚙** = plumbing interne (PAS user-facing).
- **ancien (plugin)** — forme MCP `h2a_*`/`track_*` ou skill actuelle, ou `—` (CLI-only).
- **nouveau (cli)** — la cible alias-court.
- **nouveau (plugin)** — l'outil MCP cible aligné sur le nouveau verbe (`h2a_<verbe>`), ou `—` (CLI-only).
- **module aujourd'hui** — le package qui porte la commande AUJOURD'HUI (`@sentropic/h2a-cli` + core `@sentropic/h2a` · `@sentropic/remote-cli` + 7 libs remote · `@sentropic/track` · `@sentropic/harness` · `@sentropic/design-system-skills` · `graphify` · `@sentropic/agent-stats`).
- **module demain (SIMPLIFIÉ — décision Fabien)** — seulement 3 packages que h2a possède : **`@sentropic/h2a`** (core : coordination + loop + identité = modules internes) · **`@sentropic/h2a-cli`** (CLI + agent natif + remote mergé) · **`@sentropic/track`** ; + libs existantes consommées (`@sentropic/llm-gateway` · `@sentropic/llm-mesh`) + additifs. **Pas** de packages `loop`/`agent`/`runtime`/`identity` séparés. **gras** = migration (aujourd'hui ≠ demain).
- **hermes** — équivalent NousResearch Hermes ou `—`.
- **finalité** — une des 5 : Coordinate · Run · Track · Admin · Extend.

## KPI — total RÉEL (pas « 90 commandes »)

- **Total mappé : 258** commandes réelles — dont **234 user-facing** + **24 plumbing ⚙**.
- **Migrations de module (aujourd'hui ≠ demain) : 159** · stables : 99.
- **Équivalent hermes : 14** (toutes en Run) · **OPEN : 1** (`remote agents ls`, `remote check`). `agent-stats web` est **résolu** → finalité Track.

### User-facing vs plumbing — par CLI (le vrai compte)

| CLI (package aujourd'hui) | total | user-facing | plumbing ⚙ |
|---|---|---|---|
| `h2a-cli` | 91 | 78 | 13 |
| `remote-cli` | 95 | 86 | 9 |
| `track` | 34 | 33 | 1 |
| `harness` | 14 | 13 | 1 |
| `design-system-skills` | 11 | 11 | 0 |
| `graphify` | 6 | 6 | 0 |
| `agent-stats` | 7 | 7 | 0 |
| **TOTAL** | **258** | **234** | **24** |

> **Lecture :** `h2a-cli` n'est PAS « 90 commandes user » — c'est **78 user-facing + 13 plumbing** (mcp-serve, host setup/plugin, install-skills, store migrate, drumbeat×6, drive×3, remote serve/send, sysml verify, keepalive, conductor-launch-check). De même `remote-cli` = 86 user / 9 plumbing (wake/relaunch/ping/bridge, lineage, enroll, plugin sync).

---

## Finalité — Coordinate (81 commandes)

*Concern : qui parle / décide / conduit — le bus (coordination PURE). Libs demain : @sentropic/h2a (core : bus, loop, gouvernance — modules) · @sentropic/track.*

**KPI section :** 81 cmds · user-facing **69** / plumbing ⚙ **12** · migrations module **63** · plugin ancien **30** · hermes **0** · OPEN **0**.

| statut | ancien (cli) | description | ancien (plugin) | nouveau (cli) | nouveau (plugin) | module aujourd'hui | module demain | hermes | finalité |
|---|---|---|---|---|---|---|---|---|---|
| ⚪ sans retour | `h2a discover` | résout/localise un pair sur le bus | h2a_discover_instances · /h2a discover | `h2a find` | `h2a_find` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a subagent register` | enregistre un sous-agent délégué | — | `h2a run <cli> --parent <instance>` | — | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a subagent list` | liste les sous-agents | — | `h2a ls --subagents` | `h2a_ls` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a subagent route` | route un message vers un sous-agent | — | `h2a route --target <subagent>` | `h2a_route` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a subagent inbox` | lit l'inbox d'un sous-agent | — | `h2a inbox --subagent <id>` | `h2a_inbox` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a subagent audit` | audite l'activité d'un sous-agent | — | `h2a audit --target <subagent>` | `h2a_audit` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a subagent revoke` | révoque un sous-agent | — | `h2a revoke --target <subagent>` | `h2a_revoke` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a negotiate open` | ouvre une négociation signée | h2a_open_negotiation | `h2a nego open` | `h2a_nego_open` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a negotiate status` | état d'une négociation | — | `h2a nego status` | `h2a_nego_status` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a negotiate event` | journalise un événement de négociation | h2a_append_journal | `h2a nego event` | `h2a_nego_event` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a negotiate offer` | émet une offre | h2a_offer | `h2a nego offer` | `h2a_nego_offer` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a negotiate counter` | émet une contre-offre | h2a_counteroffer | `h2a nego counter` | `h2a_nego_counter` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a negotiate sign` | signe un accord | h2a_sign | `h2a nego sign` | `h2a_nego_sign` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a negotiate stabilize` | stabilise et fige l'accord | h2a_stabilize | `h2a nego stabilize` | `h2a_nego_stabilize` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a negotiate journal` | liste le journal de négociation | — | `h2a nego ls` | `h2a_nego_ls` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a declare-interest` | déclare un conflit d'intérêt | h2a_declare_conflit_interet | `h2a nego interest` | `h2a_nego_interest` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a conflict-posture` | définit la posture de conflit | h2a_conflict_posture | `h2a nego conflict` | `h2a_nego_conflict` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a dossier` | produit le dossier de négociation | — | `h2a nego dossier` | `h2a_nego_dossier` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a confiance` | évalue la confiance d'un pair | — | `h2a nego trust` | `h2a_nego_trust` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a attest-comprehension` | atteste la compréhension partagée | h2a_attest_comprehension | `h2a nego attest` | `h2a_nego_attest` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a comprehension list` | liste les attestations de compréhension | — | `h2a nego comp ls` | `h2a_nego_comp_ls` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a comprehension verify` | vérifie une attestation de compréhension | — | `h2a nego comp verify` | `h2a_nego_comp_verify` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a inbox put` | envoie un message à un pair | h2a_inbox {put} · /h2a send | `h2a send` | `h2a_send` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a inbox read` | lit les messages reçus | h2a_inbox {read} · /h2a receive | `h2a inbox` | `h2a_inbox` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a inbox pop` | retire le prochain message | h2a_inbox {pop} | `h2a inbox pop` | `h2a_inbox_pop` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a outbox put` | dépose un message sortant | — | `h2a msg out send` | `h2a_msg_out_send` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a outbox read` | liste les messages sortants | — | `h2a msg out ls` | `h2a_msg_out_ls` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `⚙ h2a remote serve` | sert le bus aux pairs distants | — | `h2a serve` | — | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Coordinate |
| ⚪ sans retour | `⚙ h2a sysml verify` | vérifie le modèle SysML | — | `h2a sysml verify` | — | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a status` | état de l'instance locale | /h2a status | `h2a status` | `h2a_status` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a sessions` | liste hôtes et sessions | h2a_discover_sessions | `h2a ls` | `h2a_ls` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a org validate` | valide la structure d'organisation | — | `h2a org validate` | `h2a_org_validate` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a org show` | affiche l'organisation | — | `h2a org show` | `h2a_org_show` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a org diff` | compare les versions d'organisation | — | `h2a org diff` | `h2a_org_diff` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a org provision` | applique l'organisation cible | — | `h2a org apply` | `h2a_org_apply` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a coach propose` | propose une évolution d'organisation | — | `h2a org propose` | `h2a_org_propose` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a coach ratify` | ratifie une proposition d'organisation | — | `h2a org ratify` | `h2a_org_ratify` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a blockage raise` | signale un blocage | h2a_blockage_raise | `h2a block raise` | `h2a_block_raise` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a blockage list` | liste les blocages | h2a_blockage_list | `h2a block ls` | `h2a_block_ls` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a blockage resolve` | résout un blocage | h2a_blockage_resolve | `h2a block resolve` | `h2a_block_resolve` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `⚙ h2a keepalive` | maintient la présence active | — | `h2a keepalive` | — | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Coordinate |
| ⚪ sans retour | `h2a thread` | affiche un fil de messages | — | `h2a msg thread` | `h2a_msg_thread` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a conductor` | affiche et pilote le conducteur | h2a_conductor · /h2a conductor | `h2a cond` | `h2a_cond` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a conductor claim` | revendique le rôle de conducteur | h2a_conductor_claim | `h2a cond claim` | `h2a_cond_claim` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a conductor release` | libère le rôle de conducteur | h2a_conductor_release | `h2a cond release` | `h2a_cond_release` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `⚙ h2a conductor-launch-check` | vérifie avant lancement conducteur | h2a_conductor_launch_check | `h2a cond launch --check` | — | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `h2a conductor-launch` | lance un agent via le conducteur | h2a_conductor_launch | `h2a cond launch --confirm` | `h2a_cond_launch` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `remote ls [url]` | liste les agents distants | — | `h2a ls` | `h2a_ls` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Coordinate |
| ✅ validé | `remote agents ls` | liste et résout les agents | — | `h2a ls / h2a find` | `h2a_ls_/_h2a_find` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `remote agents inspect` | inspecte un agent distant | — | `h2a inspect` | `h2a_inspect` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `remote conductor-launch` | lance un agent à distance | — | `h2a cond launch` | `h2a_cond_launch` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `remote status` | état du host distant | — | `h2a status` | `h2a_status` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a loop create` | crée une boucle objectif | — | `h2a loop create` | `h2a_loop_create` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a loop list` | liste les boucles | — | `h2a loop ls` | `h2a_loop_ls` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a loop status` | état d'une boucle | — | `h2a loop status` | `h2a_loop_status` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a loop agents` | liste les agents d'une boucle | — | `h2a loop agents` | `h2a_loop_agents` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a loop attach` | attache un agent à une boucle | — | `h2a loop attach` | `h2a_loop_attach` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a loop logs` | journaux d'une boucle | — | `h2a loop logs` | `h2a_loop_logs` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a loop tick` | avance la boucle d'un pas | — | `h2a loop tick` | `h2a_loop_tick` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a loop watch` | surveille une boucle en continu | — | `h2a loop watch` | `h2a_loop_watch` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Coordinate |
| 🔧 corrigé | `h2a drumbeat record` | enregistre un battement d'activité | — | `h2a drum record` | `h2a_drum_record` | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Coordinate |
| 🔧 corrigé | `h2a drumbeat scan` | liste les battements détectés | — | `h2a drum ls` | `h2a_drum_ls` | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Coordinate |
| 🔧 corrigé | `h2a drumbeat clear` | efface les battements | — | `h2a drum clear` | `h2a_drum_clear` | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Coordinate |
| 🔧 corrigé | `h2a drumbeat escalations` | liste les escalades du drumbeat | — | `h2a drum escalations` | `h2a_drum_escalations` | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Coordinate |
| 🔧 corrigé | `h2a drumbeat relance-inbox` | relance les inbox en attente | — | `h2a drum relance` | `h2a_drum_relance` | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Coordinate |
| 🔧 corrigé | `⚙ h2a drumbeat watch` | daemon de surveillance d'activité | — | `h2a drum watch` | — | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Coordinate |
| ⚪ sans retour | `⚙ h2a remote send` | relaie un message via transport distant | — | `h2a relay send` | — | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Coordinate |
| 🔧 corrigé | `h2a drive` | réveille/pingue un agent via tmux (écrit [h2a from=…] signé) | h2a_wake | `h2a wake` | `h2a_wake` | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Coordinate |
| 🔧 corrigé | `⚙ h2a drive receive` | reçoit et vérifie un réveil | — | `h2a wake verify` | — | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Coordinate |
| 🔧 corrigé | `⚙ h2a drive serve` | daemon de service de réveil | — | `h2a wake serve` | — | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Coordinate |
| ⚪ sans retour | `⚙ remote wake-request` | demande un réveil à distance | — | `h2a wake` | — | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Coordinate |
| ⚪ sans retour | `⚙ remote relaunch [filter]` | relance les agents morts | — | `h2a wake --relaunch` | — | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Coordinate |
| 🔧 corrigé | `⚙ remote resume-throttled [f]` | reprend les agents throttlés | — | `h2a wake --throttled` | — | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Coordinate |
| 🔧 corrigé | `remote h2a ping <instance>` | ping/notifie un agent (envelope h2a.ping ; --bridge pour pousser à distance) | h2a_ping | `h2a ping <instance>` | `h2a_ping` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Coordinate |
| ⚪ sans retour | `⚙ remote h2a bridge [id]` | ouvre un pont vers un agent | — | `h2a relay bridge` | — | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Coordinate |
| ⚪ sans retour | `track decision new` | ouvre une décision à tracer | claude: present-decision / codex: /decision | `h2a decision new` | `h2a_decision_new` | `@sentropic/track` | @sentropic/track | — | Coordinate |
| ⚪ sans retour | `track decision outcome <id>` | enregistre l'issue d'une décision | present-decision / /decision | `h2a decision outcome` | `h2a_decision_outcome` | `@sentropic/track` | @sentropic/track | — | Coordinate |
| ⚪ sans retour | `track decision dossier <id>` | produit le dossier de décision | present-decision / /decision · track_canevas (read) | `h2a decision dossier` | `h2a_decision_dossier` | `@sentropic/track` | @sentropic/track | — | Coordinate |
| ⚪ sans retour | `track decision disposition <id>` | fixe la disposition d'une décision | present-decision / /decision | `h2a decision disposition` | `h2a_decision_disposition` | `@sentropic/track` | @sentropic/track | — | Coordinate |
| ⚪ sans retour | `track decision add-artifact <id>` | attache un artefact à la décision | present-decision / /decision | `h2a decision add-artifact` | `h2a_decision_add-artifact` | `@sentropic/track` | @sentropic/track | — | Coordinate |
| ⚪ sans retour | `track focus <decision-id>` | met une décision au focus | — | `h2a track focus` | `h2a_track_focus` | `@sentropic/track` | @sentropic/track | — | Coordinate |

---

## Finalité — Run (49 commandes)

*Concern : lancer / piloter un agent, où qu'il tourne. Libs demain : @sentropic/h2a-cli (agent natif + lancement hosts + exec ; consomme les libs runtime/k8s existantes).*

**KPI section :** 49 cmds · user-facing **47** / plumbing ⚙ **2** · migrations module **48** · plugin ancien **1** · hermes **14** · OPEN **1**.

| statut | ancien (cli) | description | ancien (plugin) | nouveau (cli) | nouveau (plugin) | module aujourd'hui | module demain | hermes | finalité |
|---|---|---|---|---|---|---|---|---|---|
| 🔧 corrigé | `remote run <profile> [path]` | lance un profil (run implicite) ; pin --gw/--no-gw | — | `h2a run <profile> [path]` | — | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | hermes run --agent <profile> | Run |
| 🔧 corrigé | `remote resume [slug]` | reprend la dernière session ; gestion de profil | — | `h2a resume` | — | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | hermes run --resume | Run |
| 🔧 corrigé | `remote codex` | lance un agent Codex | — | `h2a run codex` | — | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | hermes run --agent codex | Run |
| 🔧 corrigé | `remote claude (claude-code)` | lance un agent Claude Code | — | `h2a run claude` | — | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | hermes run --agent claude | Run |
| 🔧 corrigé | `remote agy (antigravity)` | lance un agent Antigravity | — | `h2a run agy` | — | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | hermes run --agent agy | Run |
| 🔧 corrigé | `remote gemini (gemini-cli)` | lance un agent Gemini | — | `h2a run gemini` | — | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | hermes run --agent gemini | Run |
| 🔧 corrigé | `remote mistral (mistralcli)` | lance un agent Mistral | — | `h2a run mistral` | — | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | hermes run --agent mistral | Run |
| 🔧 corrigé | `remote opencode` | lance un agent OpenCode | — | `h2a run opencode` | — | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | hermes run --agent opencode | Run |
| 🔧 corrigé | `(nouveau) agent h2a natif` | ouvre une session de l'agent h2a natif sur le cwd (interactif) | h2a (skill) | `h2a` | — | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Run |
| 🔧 corrigé | `(nouveau) agent Hermes` | lance un agent Hermes headless (NousResearch) | — | `h2a run hermes` | — | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | hermes run | Run |
| 🔧 corrigé | `(nouveau) logs agent` | journaux d'un agent lancé (cycle de vie) | — | `h2a logs <instance>` | `h2a_logs` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | hermes logs | Run |
| ⚪ sans retour | `remote rename <id> <name>` | renomme un agent | — | `h2a rename` | `h2a_rename` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| ⚪ sans retour | `remote shell` | ouvre un shell sur le host | — | `h2a shell run` | `h2a_shell_run` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| ⚪ sans retour | `remote attach <url|id>` | attache à une session agent | — | `h2a attach` | `h2a_attach` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| ⚪ sans retour | `remote stop <url|id>` | arrête un agent | — | `h2a stop` | `h2a_stop` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| ⚪ sans retour | `remote delegate <type> <task>` | délègue une tâche à un agent | — | `h2a delegate <profile>` | `h2a_delegate` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | hermes run | Run |
| ⚪ sans retour | `remote jobs ls` | liste les jobs | — | `h2a job ls` | `h2a_job_ls` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | hermes job ls | Run |
| ⚪ sans retour | `remote jobs status <id>` | état d'un job | — | `h2a job status` | `h2a_job_status` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | hermes job status | Run |
| ⚪ sans retour | `remote jobs attach <id>` | attache à un job | — | `h2a job attach` | `h2a_job_attach` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| ⚪ sans retour | `remote jobs logs <id>` | journaux d'un job | — | `h2a job logs` | `h2a_job_logs` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | hermes job logs | Run |
| ⚪ sans retour | `remote jobs decisions` | liste les décisions de jobs en attente | — | `h2a job decisions` | `h2a_job_decisions` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| ⚪ sans retour | `remote jobs decide <id> <a>` | tranche une décision de job | — | `h2a job decide` | `h2a_job_decide` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| ⚪ sans retour | `remote jobs conduct` | conduit les jobs en cours | — | `h2a job conduct` | `h2a_job_conduct` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| 🔧 corrigé | `remote connect` | connecte un host via tunnel | — | `h2a connect --tunnel` | `h2a_connect` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| 🔧 corrigé | `remote disconnect` | déconnecte un host | — | `h2a disconnect` | `h2a_disconnect` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| 🔴 à trancher | `⚠ remote check <profile> (smoke) **OPEN**` | smoke-test d'un profil ou host | — | `h2a check --host / h2a <profile> check` | `h2a_check_/_h2a_check` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| 🔧 corrigé | `remote workspace link` | lie un workspace local au host | — | `h2a workspace link` | `h2a_workspace_link` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| 🔧 corrigé | `remote workspace list [url]` | liste les workspaces | — | `h2a workspace ls` | `h2a_workspace_ls` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| 🔧 corrigé | `remote workspace status` | état des workspaces | — | `h2a workspace status` | `h2a_workspace_status` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| 🔧 corrigé | `remote workspace push` | pousse le workspace vers le host | — | `h2a workspace push` | `h2a_workspace_push` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| 🔧 corrigé | `remote workspace pull` | récupère le workspace du host | — | `h2a workspace pull` | `h2a_workspace_pull` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| 🔧 corrigé | `remote workspace rm [id]` | supprime un workspace | — | `h2a workspace rm` | `h2a_workspace_rm` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| 🔧 corrigé | `remote workspace gc` | nettoie les workspaces orphelins | — | `h2a workspace gc` | `h2a_workspace_gc` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| ⚪ sans retour | `remote diff [id]` | diff workspace local et distant | — | `h2a diff` | `h2a_diff` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| 🔧 corrigé | `remote sync <id>` | synchronise un workspace | — | `h2a sync` | `h2a_sync` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| 🔧 corrigé | `remote sync-status` | état de synchronisation | — | `h2a sync-status` | `h2a_sync-status` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| 🔧 corrigé | `remote sync-files` | synchronise les fichiers | — | `h2a sync-files` | `h2a_sync-files` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| ⚪ sans retour | `remote forward <id> <port>` | redirige un port du pod | — | `h2a forward` | `h2a_forward` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| ⚪ sans retour | `remote browser open <id>` | ouvre le navigateur du host | — | `h2a browser open` | `h2a_browser_open` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| 🔧 corrigé | `remote migrate forward <p>` | migre la session vers l'avant | — | `h2a migrate forward` | `h2a_migrate_forward` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| 🔧 corrigé | `remote migrate ls` | liste les migrations | — | `h2a migrate ls` | `h2a_migrate_ls` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| 🔧 corrigé | `remote migrate pick` | choisit une cible de migration | — | `h2a migrate pick` | `h2a_migrate_pick` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| 🔧 corrigé | `remote migrate back` | revient à la session précédente | — | `h2a migrate back` | `h2a_migrate_back` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| 🔧 corrigé | `remote migrate to-remote [p]` | migre la session vers le distant | — | `h2a migrate to-remote` | `h2a_migrate_to-remote` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| 🔧 corrigé | `remote migrate to-local` | rapatrie la session en local | — | `h2a migrate to-local` | `h2a_migrate_to-local` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| ⚪ sans retour | `remote restore [group]` | restaure des sessions | — | `h2a restore` | `h2a_restore` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| ⚪ sans retour | `remote layout show` | affiche la disposition tmux | — | `h2a layout show` | `h2a_layout_show` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| ⚪ sans retour | `⚙ remote lineage suspend <id>` | suspend une lignée d'agent | — | `h2a lineage suspend` | — | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |
| ⚪ sans retour | `⚙ remote lineage resume <id>` | reprend une lignée d'agent | — | `h2a lineage resume` | — | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Run |

---

## Finalité — Track (28 commandes)

*Concern : l'état / le record du travail. Libs demain : @sentropic/track (+ additif agent-stats pour la mesure).*

**KPI section :** 28 cmds · user-facing **28** / plumbing ⚙ **0** · migrations module **0** · plugin ancien **5** · hermes **0** · OPEN **0**.

| statut | ancien (cli) | description | ancien (plugin) | nouveau (cli) | nouveau (plugin) | module aujourd'hui | module demain | hermes | finalité |
|---|---|---|---|---|---|---|---|---|---|
| ✅ validé | `track init` | initialise le suivi du dépôt | — | `h2a track init` | `h2a_track_init` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track item new` | crée un item de travail | — | `h2a track item new` | `h2a_track_item_new` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track item reparent <id>` | rattache un item à un parent | — | `h2a track item reparent` | `h2a_track_item_reparent` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track item scope-declare <id>` | déclare le périmètre d'un item | — | `h2a track item scope-declare` | `h2a_track_item_scope-declare` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track item spec-amend <id>` | amende la spec d'un item | — | `h2a track item spec-amend` | `h2a_track_item_spec-amend` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track item spec <id>` | spécifie un item | — | `h2a track item spec` | `h2a_track_item_spec` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track item realize <id>` | marque un item réalisé | — | `h2a track item realize` | `h2a_track_item_realize` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track item show <id>` | affiche un item | — | `h2a track item show` | `h2a_track_item_show` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track item ls` | liste les items | — | `h2a track item ls` | `h2a_track_item_ls` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track blocker raise` | signale un bloqueur | — | `h2a track blocker raise` | `h2a_track_blocker_raise` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track blocker resolve <id>` | résout un bloqueur | — | `h2a track blocker resolve` | `h2a_track_blocker_resolve` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track blocker resolve-external` | résout un bloqueur externe | — | `h2a track blocker resolve-external` | `h2a_track_blocker_resolve-external` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track accept criterion <id>` | ajoute un critère d'acceptation | — | `h2a track accept criterion` | `h2a_track_accept_criterion` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track accept link <id>` | lie une preuve d'acceptation | — | `h2a track accept link` | `h2a_track_accept_link` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track accept run <evId>` | exécute une vérification d'acceptation | — | `h2a track accept run` | `h2a_track_accept_run` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track accept waive <id>` | déroge à un critère | — | `h2a track accept waive` | `h2a_track_accept_waive` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track consolidate` | consolide l'état du suivi | — | `h2a track consolidate` | `h2a_track_consolidate` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track priority assess <id>` | évalue la priorité d'un item | — | `h2a track priority assess` | `h2a_track_priority_assess` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track report` | rapport d'état du travail | track_report (read) | `h2a report` | `h2a_report` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track query` | interroge le graphe de suivi | track_query (read) | `h2a track query` | `h2a_track_query` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track export-graph` | exporte le graphe de suivi | — | `h2a track export` | `h2a_track_export` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track workspace-activity` | activité récente du workspace | track_workspace_activity (read) | `h2a track activity` | `h2a_track_activity` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track scope validate` | valide le périmètre déclaré | track_scope_validate (read) | `h2a track scope validate` | `h2a_track_scope_validate` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track validate` | valide la cohérence du suivi | track_validate (read) | `h2a track validate` | `h2a_track_validate` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track branch import <BRANCH.md>` | importe un BRANCH.md | — | `h2a track import` | `h2a_track_import` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track ingest <file.jsonl>` | ingère des événements de suivi | — | `h2a track ingest` | `h2a_track_ingest` | `@sentropic/track` | @sentropic/track | — | Track |
| ✅ validé | `track workspace-id` | affiche l'identifiant du workspace | — | `h2a track workspace-id` | `h2a_track_workspace-id` | `@sentropic/track` | @sentropic/track | — | Track |
| 🔧 corrigé | `agent-stats web (estate-wide)` | mesure agrégée de tout le parc | — | `h2a stats --all` | `h2a_stats` | `@sentropic/agent-stats` | additif | — | Track |

---

## Finalité — Admin (64 commandes)

*Concern : identité, auth, clés, NHI, hosts, deploy, MCP, comptes LLM, liveness. Libs demain : @sentropic/h2a (identité/auth/keys/NHI = module core) · @sentropic/h2a-cli · libs consommées @sentropic/llm-gateway · @sentropic/llm-mesh.*

**KPI section :** 64 cmds · user-facing **54** / plumbing ⚙ **10** · migrations module **48** · plugin ancien **7** · hermes **0** · OPEN **0**.

| statut | ancien (cli) | description | ancien (plugin) | nouveau (cli) | nouveau (plugin) | module aujourd'hui | module demain | hermes | finalité |
|---|---|---|---|---|---|---|---|---|---|
| ⚪ sans retour | `h2a register` | enregistre l'instance sur le bus | h2a_register_instance | `h2a register` | `h2a_register` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Admin |
| ⚪ sans retour | `⚙ h2a mcp-serve` | sert l'API MCP | — | `h2a mcp serve` | — | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Admin |
| ⚪ sans retour | `h2a keys generate` | génère une paire de clés | — | `h2a key gen` | `h2a_key_gen` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Admin |
| ⚪ sans retour | `h2a keys add` | ajoute une clé | — | `h2a key add` | `h2a_key_add` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Admin |
| ⚪ sans retour | `h2a keys list` | liste les clés | — | `h2a key ls` | `h2a_key_ls` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Admin |
| ⚪ sans retour | `h2a keys revoke` | révoque une clé | — | `h2a key revoke` | `h2a_key_revoke` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Admin |
| ⚪ sans retour | `h2a nhi report` | rapport des identités non-humaines | h2a_nhi_report | `h2a nhi report` | `h2a_nhi_report` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Admin |
| ⚪ sans retour | `h2a nhi inventory` | inventaire des identités NHI | h2a_nhi_inventory | `h2a nhi ls` | `h2a_nhi_ls` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Admin |
| ⚪ sans retour | `h2a nhi export` | exporte l'inventaire NHI | h2a_nhi_export | `h2a nhi export` | `h2a_nhi_export` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Admin |
| ⚪ sans retour | `h2a nhi attest` | atteste une identité NHI | h2a_nhi_attest | `h2a nhi attest` | `h2a_nhi_attest` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Admin |
| ⚪ sans retour | `h2a nhi offboard` | désenrôle une identité NHI | h2a_nhi_offboard | `h2a nhi offboard` | `h2a_nhi_offboard` | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Admin |
| 🔧 corrigé | `remote auth status [profile]` | état d'authentification (--host) | — | `h2a auth status` | `h2a_auth_status` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Admin |
| 🔧 corrigé | `remote auth login <profile>` | connexion d'un profil (--host) | — | `h2a auth login` | `h2a_auth_login` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Admin |
| 🔧 corrigé | `remote auth push <url|id>` | pousse l'auth vers un host | — | `h2a auth push` | `h2a_auth_push` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Admin |
| 🔧 corrigé | `remote refresh [url|id]` | rafraîchit les jetons d'auth | — | `h2a auth refresh` | `h2a_auth_refresh` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Admin |
| 🔧 corrigé | `remote secrets status [id]` | état des secrets | — | `h2a auth secrets status` | `h2a_auth_secrets_status` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Admin |
| 🔧 corrigé | `⚙ remote enroll` | enrôle un host ou agent | — | `h2a auth enroll` | — | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Admin |
| ⚪ sans retour | `h2a --help` | affiche l'aide | — | `h2a --help / h2a help` | `h2a_/_h2a_help` | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Admin |
| 🔧 corrigé | `h2a hosts` | liste les hôtes connectés | — | `h2a ls` | `h2a_ls` | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Admin |
| ⚪ sans retour | `h2a mcp-tools` | liste les outils MCP exposés | — | `h2a mcp tools` | `h2a_mcp_tools` | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Admin |
| ⚪ sans retour | `h2a init` | initialise la config locale | — | `h2a init` | `h2a_init` | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Admin |
| ⚪ sans retour | `h2a upgrade` | met à jour la CLI | — | `h2a up` | `h2a_up` | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Admin |
| 🔧 corrigé | `⚙ h2a host setup` | assistant de configuration d'un host | — | `h2a setup` | — | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Admin |
| 🔧 corrigé | `⚙ h2a host plugin` | gère les plugins (--host) | — | `h2a plugin` | — | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Admin |
| 🔧 corrigé | `h2a host status` | statut hôte, colonne de h2a ls | — | `h2a ls` | `h2a_ls` | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Admin |
| 🔧 corrigé | `h2a connect` | ouvre une session de coordination | /h2a connect (skill -> h2a_session_open) | `h2a connect` | `h2a_connect` | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Admin |
| ⚪ sans retour | `h2a doctor` | diagnostique l'installation | — | `h2a doctor` | `h2a_doctor` | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Admin |
| ⚪ sans retour | `⚙ h2a install-skills` | installe les skills (--host) | — | `h2a skills` | — | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Admin |
| ⚪ sans retour | `h2a deploy k8s-sidecar` | déploie le sidecar k8s | — | `h2a deploy sidecar` | `h2a_deploy_sidecar` | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Admin |
| ⚪ sans retour | `h2a deploy k8s-tenant` | déploie un tenant k8s | — | `h2a deploy tenant` | `h2a_deploy_tenant` | `@sentropic/h2a-cli` | @sentropic/h2a-cli | — | Admin |
| ⚪ sans retour | `remote install <url>` | installe le runtime sur un host | — | `h2a install` | `h2a_install` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Admin |
| 🔧 corrigé | `remote config set <url>` | définit l'URL du host | — | `h2a config set` | `h2a_config_set` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Admin |
| 🔧 corrigé | `remote config token <v>` | définit le jeton du host | — | `h2a config token` | `h2a_config_token` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Admin |
| 🔧 corrigé | `remote config target <t>` | définit la cible du host | — | `h2a config target` | `h2a_config_target` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Admin |
| 🔧 corrigé | `remote config tools <list>` | configure les outils autorisés | — | `h2a config tools` | `h2a_config_tools` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Admin |
| 🔧 corrigé | `remote config tmux-profile` | configure le profil tmux | — | `h2a config tmux-profile` | `h2a_config_tmux-profile` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Admin |
| 🔧 corrigé | `remote config clear` | efface la config du host | — | `h2a config clear` | `h2a_config_clear` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Admin |
| 🔧 corrigé | `remote config show` | affiche la config | — | `h2a config show` | `h2a_config_show` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Admin |
| 🔧 corrigé | `remote config tunnel` | configure le tunnel | — | `h2a config tunnel` | `h2a_config_tunnel` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Admin |
| 🔧 corrigé | `remote plugin add <pkg>` | ajoute un plugin au host | — | `h2a plugin add` | `h2a_plugin_add` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Admin |
| 🔧 corrigé | `remote plugin ls` | liste les plugins du host | — | `h2a plugin ls` | `h2a_plugin_ls` | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Admin |
| 🔧 corrigé | `⚙ remote plugin sync` | synchronise les plugins | — | `h2a plugin sync` | — | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Admin |
| 🔧 corrigé | `⚙ remote plugin sync-skills` | synchronise les skills des plugins | — | `h2a plugin sync-skills` | — | `@sentropic/remote-cli` | **@sentropic/h2a-cli** | — | Admin |
| ⚪ sans retour | `⚙ track install-skills` | installe les skills track | — | `h2a skills --of track` | — | `@sentropic/track` | @sentropic/track | — | Admin |
| ⚪ sans retour | `⚙ harness skills install` | installe les skills dev/harness | — | `h2a skills --of dev` | — | `@sentropic/harness` | @sentropic/harness | — | Admin |
| ⚪ sans retour | `⚙ h2a store migrate` | migre le store local | — | `h2a store migrate` | — | `@sentropic/h2a-cli` | **@sentropic/h2a** | — | Admin |
| 🔧 corrigé | `remote llm-mesh start` | démarre la gateway LLM | — | `h2a gateway start` | `h2a_gateway_start` | `@sentropic/remote-cli` | **@sentropic/llm-gateway** | — | Admin |
| 🔧 corrigé | `remote llm-mesh stop` | arrête la gateway LLM | — | `h2a gateway stop` | `h2a_gateway_stop` | `@sentropic/remote-cli` | **@sentropic/llm-gateway** | — | Admin |
| 🔧 corrigé | `remote llm-mesh restart` | redémarre la gateway LLM | — | `h2a gateway restart` | `h2a_gateway_restart` | `@sentropic/remote-cli` | **@sentropic/llm-gateway** | — | Admin |
| 🔧 corrigé | `remote llm-mesh status` | état de la gateway LLM | — | `h2a gateway status` | `h2a_gateway_status` | `@sentropic/remote-cli` | **@sentropic/llm-gateway** | — | Admin |
| 🔧 corrigé | `remote llm-mesh logs` | journaux de la gateway LLM | — | `h2a gateway logs` | `h2a_gateway_logs` | `@sentropic/remote-cli` | **@sentropic/llm-gateway** | — | Admin |
| 🔧 corrigé | `remote account enroll` | enrôle un compte LLM | — | `h2a auth account enroll` | `h2a_auth_account_enroll` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Admin |
| 🔧 corrigé | `remote account ls` | liste les comptes LLM | — | `h2a auth account ls` | `h2a_auth_account_ls` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Admin |
| 🔧 corrigé | `remote account rm <id>` | supprime un compte LLM | — | `h2a auth account rm` | `h2a_auth_account_rm` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Admin |
| 🔧 corrigé | `remote account exhausted <id>` | marque un compte épuisé | — | `h2a auth account exhausted` | `h2a_auth_account_exhausted` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Admin |
| 🔧 corrigé | `remote account clear-quota <id>` | réinitialise le quota d'un compte | — | `h2a auth account clear-quota` | `h2a_auth_account_clear-quota` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Admin |
| 🔧 corrigé | `remote account select` | sélectionne un compte actif | — | `h2a auth account select` | `h2a_auth_account_select` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Admin |
| 🔧 corrigé | `remote account log` | journal d'usage des comptes | — | `h2a auth account log` | `h2a_auth_account_log` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Admin |
| 🔧 corrigé | `remote account rm-binding <k>` | supprime un binding de compte | — | `h2a auth account rm-binding` | `h2a_auth_account_rm-binding` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Admin |
| 🔧 corrigé | `remote account bindings` | liste les bindings de comptes | — | `h2a auth account bindings` | `h2a_auth_account_bindings` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Admin |
| 🔧 corrigé | `remote account push-cluster` | pousse les comptes au cluster | — | `h2a auth account push-cluster` | `h2a_auth_account_push-cluster` | `@sentropic/remote-cli` | **@sentropic/h2a** | — | Admin |
| 🔧 corrigé | `remote llm-mesh enroll <prov>` | enrôle un fournisseur LLM | — | `h2a auth mesh enroll` | `h2a_auth_mesh_enroll` | `@sentropic/remote-cli` | **@sentropic/llm-mesh** | — | Admin |
| 🔧 corrigé | `remote llm-mesh enable` | active le mesh LLM | — | `h2a auth mesh enable` | `h2a_auth_mesh_enable` | `@sentropic/remote-cli` | **@sentropic/llm-mesh** | — | Admin |
| 🔧 corrigé | `remote llm-mesh disable` | désactive le mesh LLM | — | `h2a auth mesh disable` | `h2a_auth_mesh_disable` | `@sentropic/remote-cli` | **@sentropic/llm-mesh** | — | Admin |

---

## Finalité — Extend (36 commandes)

*Concern : extensions additives (gardent leur package). Libs demain : @sentropic/harness · additif (design-system · graphify · agent-stats).*

**KPI section :** 36 cmds · user-facing **36** / plumbing ⚙ **0** · migrations module **0** · plugin ancien **23** · hermes **0** · OPEN **0**.

| statut | ancien (cli) | description | ancien (plugin) | nouveau (cli) | nouveau (plugin) | module aujourd'hui | module demain | hermes | finalité |
|---|---|---|---|---|---|---|---|---|---|
| ✅ validé | `harness check scope` | vérifie le périmètre déclaré | claude: harness / codex: /cmd | `h2a dev check scope` | `h2a_dev_check_scope` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| ✅ validé | `harness check branch` | vérifie l'état de la branche | claude: harness / codex: /cmd | `h2a dev check branch` | `h2a_dev_check_branch` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| ✅ validé | `harness verify --category` | exécute les vérifications par catégorie | claude: harness / codex: /cmd | `h2a dev verify --category` | `h2a_dev_verify` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| ✅ validé | `harness audit` | audite la conformité harness | claude: harness / codex: /cmd | `h2a dev audit` | `h2a_dev_audit` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| ✅ validé | `harness init` | initialise le profil harness | claude: harness / codex: /cmd | `h2a dev init` | `h2a_dev_init` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| ✅ validé | `harness brainstorm` | explore l'intention avant conception | claude: harness-brainstorm / codex: /cmd | `h2a dev brainstorm` | `h2a_dev_brainstorm` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| ✅ validé | `harness plan` | écrit un plan exécutable | claude: harness-plan / codex: /cmd | `h2a dev plan` | `h2a_dev_plan` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| ✅ validé | `harness test` | applique la pyramide de tests | claude: harness-test / codex: /cmd | `h2a dev test` | `h2a_dev_test` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| ✅ validé | `harness debug` | diagnostic racine d'un bug | claude: harness-debug / codex: /cmd | `h2a dev debug` | `h2a_dev_debug` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| ✅ validé | `harness review` | revue par consensus de pairs | claude: harness-review / codex: /cmd | `h2a dev review` | `h2a_dev_review` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| ✅ validé | `harness branch init` | ouvre une branche de travail | claude: harness / codex: /cmd | `h2a dev branch open` | `h2a_dev_branch_open` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| ✅ validé | `harness branch close` | clôt une branche de travail | claude: harness / codex: /cmd | `h2a dev branch close` | `h2a_dev_branch_close` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| ✅ validé | `harness adopt` | adapte le harness à un dépôt | claude: harness-adopt / codex: /cmd | `h2a dev adopt` | `h2a_dev_adopt` | `@sentropic/harness` | @sentropic/harness | — | Extend |
| ✅ validé | `design audit` | audite le design system | claude: sent-tech-design | `h2a design lint` | `h2a_design_lint` | `@sentropic/design-system-skills` | additif | — | Extend |
| ✅ validé | `design audit:visual` | audit visuel du design | claude: sent-tech-design | `h2a design lint --visual` | `h2a_design_lint` | `@sentropic/design-system-skills` | additif | — | Extend |
| ✅ validé | `design audit:parity` | vérifie la fidélité au modèle | claude: sent-tech-design | `h2a design fidelity` | `h2a_design_fidelity` | `@sentropic/design-system-skills` | additif | — | Extend |
| ✅ validé | `design check` | contrôle rapide du design | — | `h2a design check` | `h2a_design_check` | `@sentropic/design-system-skills` | additif | — | Extend |
| ✅ validé | `design build` | build le package de thème | — | `h2a design build` | `h2a_design_build` | `@sentropic/design-system-skills` | additif | — | Extend |
| ✅ validé | `design align` | aligne sur les tokens cibles | — | `h2a design align` | `h2a_design_align` | `@sentropic/design-system-skills` | additif | — | Extend |
| ✅ validé | `design polish` | peaufine le rendu du design | — | `h2a design polish` | `h2a_design_polish` | `@sentropic/design-system-skills` | additif | — | Extend |
| ✅ validé | `design init` | initialise un package de thème | — | `h2a design init` | `h2a_design_init` | `@sentropic/design-system-skills` | additif | — | Extend |
| ✅ validé | `design init --extract` | extrait les tokens de design | — | `h2a design tokens` | `h2a_design_tokens` | `@sentropic/design-system-skills` | additif | — | Extend |
| ✅ validé | `ds-theme-clone (skill)` | clone un thème de marque mesuré | claude: ds-theme-clone | `h2a design theme clone <id>` | `h2a_design_theme_clone` | `@sentropic/design-system-skills` | additif | — | Extend |
| ✅ validé | `embeddable-view (pkg)` | vues design embarquables | — | `h2a design views` | `h2a_design_views` | `@sentropic/design-system-skills` | additif | — | Extend |
| ✅ validé | `graphify . build (--update/deep)` | ingère une source dans le graphe | /graphify | `h2a knowledge ingest <path>` | `h2a_knowledge_ingest` | `graphify` | additif | — | Extend |
| ✅ validé | `graphify query (path/explain)` | interroge le graphe de connaissance | /graphify | `h2a knowledge query <q>` | `h2a_knowledge_query` | `graphify` | additif | — | Extend |
| ✅ validé | `graphify serve/watch/clone/merge` | sert et synchronise le graphe | /graphify | `h2a knowledge graph` | `h2a_knowledge_graph` | `graphify` | additif | — | Extend |
| ✅ validé | `graphify profile / ontology` | gère l'ontologie du graphe | /graphify | `h2a knowledge ontology` | `h2a_knowledge_ontology` | `graphify` | additif | — | Extend |
| ✅ validé | `graphify studio export` | exporte le graphe (studio) | /graphify | `h2a knowledge export` | `h2a_knowledge_export` | `graphify` | additif | — | Extend |
| ✅ validé | `graphify agent-stats {sync,..}` | intègre les stats agents au graphe | /graphify | `h2a knowledge agents` | `h2a_knowledge_agents` | `graphify` | additif | — | Extend |
| ⚪ sans retour | `@sentropic/agent-stats-core (lib)` | lib de mesure consommée par h2a | — | `consommé par h2a (dep optionnelle)` | `h2a_consommé_par_(dep_optionnelle)` | `@sentropic/agent-stats` | additif | — | Extend |
| 🔧 corrigé | `agent-stats stats <id>` | stats d'un agent | — | `h2a stats <id>` | `h2a_stats` | `@sentropic/agent-stats` | additif | — | Extend |
| 🔧 corrigé | `agent-stats report` | rapport de stats d'un agent | — | `h2a stats <id> --report` | `h2a_stats` | `@sentropic/agent-stats` | additif | — | Extend |
| 🔧 corrigé | `agent-stats anomalies` | détecte les anomalies d'un agent | — | `h2a stats <id> --anomalies` | `h2a_stats` | `@sentropic/agent-stats` | additif | — | Extend |
| 🔧 corrigé | `agent-stats clean` | nettoie les stats | — | `h2a stats <id> --clean` | `h2a_stats` | `@sentropic/agent-stats` | additif | — | Extend |
| 🔧 corrigé | `agent-stats analyze` | analyse les stats d'un agent | — | `h2a stats <id> --analyze` | `h2a_stats` | `@sentropic/agent-stats` | additif | — | Extend |

---

## Synthèse

- **Total réel : 258** = **234 user-facing** + **24 plumbing ⚙**.
- **User-facing vs plumbing par CLI :** `h2a-cli` 78u/13p · `remote-cli` 86u/9p · `track` 33u/1p · `harness` 13u/1p · `design-system-skills` 11u/0p · `graphify` 6u/0p · `agent-stats` 7u/0p.
- **Migrations de module (aujourd'hui ≠ demain) : 159** (le gros : `h2a-cli` éclaté en h2a-core/identity/runtime/loop ; `remote-cli` éclaté en agent/runtime/identity/llm-*). Stables : 99 (thin CLI `h2a-cli`, `track`, `harness`, additifs).
- **Par finalité :** Coordinate 81 · Run 49 · Track 28 · Admin 64 · Extend 36.
- **hermes : 14** · **OPEN : 1** (`remote agents ls`, `remote check`).

### Récap par finalité

| Finalité | total | user-facing | plumbing ⚙ | migrations | plugin ancien | hermes | OPEN |
|---|---|---|---|---|---|---|---|
| Coordinate | 81 | 69 | 12 | 63 | 30 | 0 | 0 |
| Run | 49 | 47 | 2 | 48 | 1 | 14 | 1 |
| Track | 28 | 28 | 0 | 0 | 5 | 0 | 0 |
| Admin | 64 | 54 | 10 | 48 | 7 | 0 | 0 |
| Extend | 36 | 36 | 0 | 0 | 23 | 0 | 0 |
| **TOTAL** | **258** | **234** | **24** | **159** | **66** | **14** | **1** |

### Chemins de sortie

- `docs/specs/2026-06-28-h2a-command-mapping-v5-modules.md`
- `…/scratchpad/semantic-focus/mapping.html`
