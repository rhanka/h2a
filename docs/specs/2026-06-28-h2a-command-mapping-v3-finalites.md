# h2a unified CLI — command mapping v3 (organisé PAR FINALITÉ · modèle v1.1)

**Status: mapping-for-validation v3. Read-only sur toutes les sources.** Ré-organisation de `2026-06-28-h2a-command-mapping-v2.md` (255 commandes, énumération + alias courts réutilisés tels quels) selon le **modèle v1.1 — 5 finalités** de `2026-06-28-h2a-finalites-spec.md` (§6). Chaque commande est classée dans **1 finalité + 1 lib**. Jumeau HTML : `…/scratchpad/semantic-focus/mapping.html`.

## Les 5 finalités → libs

| # | Finalité | Concern | Lib(s) |
|---|---|---|---|
| 1 | **Coordonner** | qui parle / décide / conduit — le bus (coordination PURE) | `@sentropic/h2a-core` · `@sentropic/loop` · `transport-wake (h2a)` · `@sentropic/track` |
| 2 | **Exécuter** | lancer / piloter un agent, où qu'il tourne | `@sentropic/agent` · `h2a-cli` · `@sentropic/runtime` |
| 3 | **Suivre** | l'état / le record du travail | `@sentropic/track` |
| 4 | **Administrer** | identité, auth, clés, NHI, hosts, deploy, MCP, comptes LLM, liveness | `@sentropic/identity` · `h2a-cli` · `@sentropic/h2a-core` · `@sentropic/llm-gateway` · `@sentropic/llm-mesh` |
| 5 | **Étendre** | extensions additives (gardent leur CLI) | `@sentropic/harness` · `design-system` · `graphify` · `agent-stats` |

## Extractions (la règle : sans-TTY ⇒ lib réutilisable headless)

- **`@sentropic/agent`** — la boucle agent native (tool-calling, mémoire, resume, sandbox, streaming, appel llm-gateway). cli = shell interactif par-dessus ; `delegate`/`job`/Hermes la réutilisent headless. *(évite la divergence interactif/headless)*
- **`@sentropic/loop`** — moteur objective-loop (relance, convergence, poussée multi-agents, stop conditions) ; consomme core+track ; l'état reste dans track.
- **`@sentropic/identity`** — auth/keys/NHI/DCR/login multi-tenant/per-user-root/sign+revoke+audit. **Sans ça, négociation/anti-COI/wake-remote/delegate-sandbox sont des façades** ; c'est le déblocage h2h2a.
- **`@sentropic/runtime`** — **une** lib, `ExecBackend {local, container, pod, remote}` (greywall=container ; k8s=pod ; tunnel/sync internes). Pas de fragmentation avant interface stable.

## Règles de re-classement v1.1 appliquées

- `h2a decision …` — **un seul verbe**, finalité **Coordonner** (moment humain), lib record = **track** (sémantique core + rendu design-system). Plus de double-listing → noté `core+design→track`.
- `h2a` bare / `h2a --resume` (agent natif) → **Exécuter**, lib **`@sentropic/agent`**.
- `h2a loop …` / drumbeat → **Coordonner**, lib **`@sentropic/loop`**.
- `wake` : la **décision** de réveiller = h2a-core (conductor) ; le **mécanisme** (tmux/pane/human-typing guard) = **transport-wake** h2a-owned ; la surface `h2a wake` reste cli.
- keys/nhi/auth/login/register/secrets/host/plugin/deploy/mcp-serve/config/comptes-LLM → **Administrer** (lib `@sentropic/identity` pour l'identité/auth ; `h2a-cli` pour le pur câblage ; `llm-gateway`/`llm-mesh` pour le substrat LLM).
- remote run/jobs/agents/delegate/profils → **Exécuter** ; remote workspace/sync/migrate/tunnel/k8s → **Exécuter** lib **`@sentropic/runtime`**.

**Compteurs : total = 255 · OPEN = 3.** Par finalité : Coordonner 81 · Exécuter 46 · Suivre 27 · Administrer 64 · Étendre 37.

**Légende statut :** direct · renommé · namespacé · fusionné · OPEN (Fabien à trancher).

---

## 1. Finalité — Coordonner (81 commandes)

*Concern : qui parle / décide / conduit — le bus (coordination PURE).*  
*Lib(s) : `@sentropic/h2a-core` · `@sentropic/loop` · `transport-wake (h2a)` · `@sentropic/track`.*

| Commande existante | Source | Cible h2a (alias court) | Lib | per-host | hermes | Statut |
|---|---|---|---|---|---|---|
| `h2a discover` | h2a | `h2a find` | `@sentropic/h2a-core` | — | — | renommé |
| `h2a subagent register` | h2a | `h2a sub register` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a subagent list` | h2a | `h2a sub ls` | `@sentropic/h2a-core` | — | — | renommé |
| `h2a subagent route` | h2a | `h2a sub route` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a subagent inbox` | h2a | `h2a sub inbox` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a subagent audit` | h2a | `h2a sub audit` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a subagent revoke` | h2a | `h2a sub revoke` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a negotiate open` | h2a | `h2a nego open` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a negotiate status` | h2a | `h2a nego status` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a negotiate event` | h2a | `h2a nego event` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a negotiate offer` | h2a | `h2a nego offer` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a negotiate counter` | h2a | `h2a nego counter` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a negotiate sign` | h2a | `h2a nego sign` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a negotiate stabilize` | h2a | `h2a nego stabilize` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a negotiate journal` | h2a | `h2a nego ls` | `@sentropic/h2a-core` | — | — | renommé |
| `h2a declare-interest` | h2a | `h2a nego interest` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a conflict-posture` | h2a | `h2a nego conflict` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a dossier` | h2a | `h2a nego dossier` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a confiance` | h2a | `h2a nego trust` | `@sentropic/h2a-core` | — | — | renommé |
| `h2a attest-comprehension` | h2a | `h2a nego attest` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a comprehension list` | h2a | `h2a nego comp ls` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a comprehension verify` | h2a | `h2a nego comp verify` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a inbox put` | h2a | `h2a send` | `@sentropic/h2a-core` | — | — | renommé |
| `h2a inbox read` | h2a | `h2a inbox` | `@sentropic/h2a-core` | — | — | renommé |
| `h2a inbox pop` | h2a | `h2a inbox pop` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a outbox put` | h2a | `h2a msg out send` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a outbox read` | h2a | `h2a msg out ls` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a remote serve` | h2a | `h2a serve` | `@sentropic/h2a-core` | — | — | renommé |
| `h2a sysml verify` | h2a | `h2a sysml verify` | `@sentropic/h2a-core` | — | — | direct |
| `h2a status` | h2a | `h2a status` | `@sentropic/h2a-core` | — | — | direct |
| `h2a sessions` | h2a | `h2a ls` | `@sentropic/h2a-core` | — | — | renommé |
| `h2a org validate` | h2a | `h2a org validate` | `@sentropic/h2a-core` | — | — | direct |
| `h2a org show` | h2a | `h2a org show` | `@sentropic/h2a-core` | — | — | direct |
| `h2a org diff` | h2a | `h2a org diff` | `@sentropic/h2a-core` | — | — | direct |
| `h2a org provision` | h2a | `h2a org apply` | `@sentropic/h2a-core` | — | — | renommé |
| `h2a coach propose` | h2a | `h2a org propose` | `@sentropic/h2a-core` | — | — | fusionné |
| `h2a coach ratify` | h2a | `h2a org ratify` | `@sentropic/h2a-core` | — | — | fusionné |
| `h2a blockage raise` | h2a | `h2a block raise` | `@sentropic/h2a-core` | — | — | renommé |
| `h2a blockage list` | h2a | `h2a block ls` | `@sentropic/h2a-core` | — | — | renommé |
| `h2a blockage resolve` | h2a | `h2a block resolve` | `@sentropic/h2a-core` | — | — | renommé |
| `h2a keepalive` | h2a | `h2a keepalive` | `@sentropic/h2a-core` | — | — | direct |
| `h2a thread` | h2a | `h2a msg thread` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a conductor` | h2a | `h2a cond` | `@sentropic/h2a-core` | — | — | renommé |
| `h2a conductor claim` | h2a | `h2a cond claim` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a conductor release` | h2a | `h2a cond release` | `@sentropic/h2a-core` | — | — | namespacé |
| `h2a conductor-launch-check` | h2a | `h2a cond launch --check` | `@sentropic/h2a-core` | — | — | fusionné |
| `h2a conductor-launch` | h2a | `h2a cond launch --confirm` | `@sentropic/h2a-core` | — | — | fusionné |
| `remote ls [url]` | remote | `h2a ls` | `@sentropic/h2a-core` | — | — | fusionné |
| `remote agents ls` | remote | `h2a ls / h2a find` | `@sentropic/h2a-core` | — | — | **OPEN** |
| `remote agents inspect` | remote | `h2a inspect` | `@sentropic/h2a-core` | — | — | direct |
| `remote conductor-launch` | remote | `h2a cond launch` | `@sentropic/h2a-core` | — | — | fusionné |
| `remote status` | remote | `h2a status` | `@sentropic/h2a-core` | — | — | fusionné |
| `h2a loop create` | h2a | `h2a loop create` | `@sentropic/loop` | — | — | direct |
| `h2a loop list` | h2a | `h2a loop ls` | `@sentropic/loop` | — | — | renommé |
| `h2a loop status` | h2a | `h2a loop status` | `@sentropic/loop` | — | — | direct |
| `h2a loop agents` | h2a | `h2a loop agents` | `@sentropic/loop` | — | — | direct |
| `h2a loop attach` | h2a | `h2a loop attach` | `@sentropic/loop` | — | — | direct |
| `h2a loop logs` | h2a | `h2a loop logs` | `@sentropic/loop` | — | — | direct |
| `h2a loop tick` | h2a | `h2a loop tick` | `@sentropic/loop` | — | — | direct |
| `h2a loop watch` | h2a | `h2a loop watch` | `@sentropic/loop` | — | — | direct |
| `h2a drumbeat record` | h2a | `h2a drum record` | `@sentropic/loop` | — | — | namespacé |
| `h2a drumbeat scan` | h2a | `h2a drum ls` | `@sentropic/loop` | — | — | renommé |
| `h2a drumbeat clear` | h2a | `h2a drum clear` | `@sentropic/loop` | — | — | namespacé |
| `h2a drumbeat escalations` | h2a | `h2a drum escalations` | `@sentropic/loop` | — | — | namespacé |
| `h2a drumbeat relance-inbox` | h2a | `h2a drum relance` | `@sentropic/loop` | — | — | renommé |
| `h2a drumbeat watch` | h2a | `h2a drum watch` | `@sentropic/loop` | — | — | namespacé |
| `h2a remote send` | h2a | `h2a relay send` | `transport-wake (h2a)` | — | — | renommé |
| `h2a drive` | h2a | `h2a wake` | `transport-wake (h2a)` | tmux send-keys | — | renommé |
| `h2a drive receive` | h2a | `h2a wake verify` | `transport-wake (h2a)` | — | — | renommé |
| `h2a drive serve` | h2a | `h2a wake serve` | `transport-wake (h2a)` | — | — | renommé |
| `remote wake-request` | remote | `h2a wake` | `transport-wake (h2a)` | tmux send-keys | — | renommé |
| `remote relaunch [filter]` | remote | `h2a wake --relaunch` | `transport-wake (h2a)` | — | — | renommé |
| `remote resume-throttled [f]` | remote | `h2a wake --throttled` | `transport-wake (h2a)` | — | — | renommé |
| `remote h2a ping <instance>` | remote | `h2a relay ping` | `transport-wake (h2a)` | — | — | renommé |
| `remote h2a bridge [id]` | remote | `h2a relay bridge` | `transport-wake (h2a)` | — | — | renommé |
| `track decision new` | track | `h2a decision new` | `@sentropic/track` *(core+design→track)* | claude: present-decision · codex: /decision | — | renommé |
| `track decision outcome <id>` | track | `h2a decision outcome` | `@sentropic/track` *(core+design→track)* | claude: present-decision · codex: /decision | — | renommé |
| `track decision dossier <id>` | track | `h2a decision dossier` | `@sentropic/track` *(core+design→track)* | claude: present-decision · codex: /decision | — | renommé |
| `track decision disposition <id>` | track | `h2a decision disposition` | `@sentropic/track` *(core+design→track)* | claude: present-decision · codex: /decision | — | renommé |
| `track decision add-artifact <id>` | track | `h2a decision add-artifact` | `@sentropic/track` *(core+design→track)* | claude: present-decision · codex: /decision | — | renommé |
| `track focus <decision-id>` | track | `h2a track focus` | `@sentropic/track` *(core+design→track)* | — | — | namespacé |

---

## 2. Finalité — Exécuter (46 commandes)

*Concern : lancer / piloter un agent, où qu'il tourne.*  
*Lib(s) : `@sentropic/agent` · `h2a-cli` · `@sentropic/runtime`.*

| Commande existante | Source | Cible h2a (alias court) | Lib | per-host | hermes | Statut |
|---|---|---|---|---|---|---|
| `remote run <profile> [path]` | remote | `h2a <profile> run (bare h2a run)` | `@sentropic/agent` | — | `hermes run --agent <profile>` | direct |
| `remote resume [slug]` | remote | `h2a resume` | `@sentropic/agent` | claude -c · codex resume | `hermes run --resume` | renommé |
| `remote codex` | remote | `h2a codex run` | `h2a-cli` | codex exec | `hermes run --agent codex` | fusionné |
| `remote claude (claude-code)` | remote | `h2a claude run` | `h2a-cli` | claude -p | `hermes run --agent claude` | fusionné |
| `remote agy (antigravity)` | remote | `h2a agy run` | `h2a-cli` | antigravity | `hermes run --agent agy` | fusionné |
| `remote gemini (gemini-cli)` | remote | `h2a gemini run` | `h2a-cli` | gemini -p | `hermes run --agent gemini` | fusionné |
| `remote mistral (mistralcli)` | remote | `h2a mistral run` | `h2a-cli` | mistral | `hermes run --agent mistral` | fusionné |
| `remote opencode` | remote | `h2a opencode run` | `h2a-cli` | opencode | `hermes run --agent opencode` | fusionné |
| `remote rename <id> <name>` | remote | `h2a rename` | `h2a-cli` | claude customTitle · codex thread_name | — | renommé |
| `remote shell` | remote | `h2a shell run` | `@sentropic/runtime` | bash | — | fusionné |
| `remote attach <url\|id>` | remote | `h2a attach` | `@sentropic/runtime` | tmux attach | — | direct |
| `remote stop <url\|id>` | remote | `h2a stop` | `@sentropic/runtime` | — | — | direct |
| `remote delegate <type> <task>` | remote | `h2a delegate <profile> (bare h2a delegate)` | `@sentropic/runtime` | claude -p · codex exec | `hermes run` | direct |
| `remote jobs ls` | remote | `h2a job ls` | `@sentropic/runtime` | — | `hermes job ls` | namespacé |
| `remote jobs status <id>` | remote | `h2a job status` | `@sentropic/runtime` | — | `hermes job status` | namespacé |
| `remote jobs attach <id>` | remote | `h2a job attach` | `@sentropic/runtime` | — | — | namespacé |
| `remote jobs logs <id>` | remote | `h2a job logs` | `@sentropic/runtime` | — | `hermes job logs` | namespacé |
| `remote jobs decisions` | remote | `h2a job decisions` | `@sentropic/runtime` | — | — | namespacé |
| `remote jobs decide <id> <a>` | remote | `h2a job decide` | `@sentropic/runtime` | — | — | namespacé |
| `remote jobs conduct` | remote | `h2a job conduct` | `@sentropic/runtime` | — | — | namespacé |
| `remote connect` | remote | `h2a connect --tunnel` | `@sentropic/runtime` | — | — | fusionné |
| `remote disconnect` | remote | `h2a host disconnect` | `@sentropic/runtime` | — | — | namespacé |
| `remote check <profile> (smoke)` | remote | `h2a host check / h2a <profile> check` | `@sentropic/runtime` | claude -p · codex exec | — | **OPEN** |
| `remote workspace link` | remote | `h2a host workspace link` | `@sentropic/runtime` | — | — | namespacé |
| `remote workspace list [url]` | remote | `h2a host workspace ls` | `@sentropic/runtime` | — | — | renommé |
| `remote workspace status` | remote | `h2a host workspace status` | `@sentropic/runtime` | — | — | namespacé |
| `remote workspace push` | remote | `h2a host workspace push` | `@sentropic/runtime` | — | — | namespacé |
| `remote workspace pull` | remote | `h2a host workspace pull` | `@sentropic/runtime` | — | — | namespacé |
| `remote workspace rm [id]` | remote | `h2a host workspace rm` | `@sentropic/runtime` | — | — | namespacé |
| `remote workspace gc` | remote | `h2a host workspace gc` | `@sentropic/runtime` | — | — | namespacé |
| `remote diff [id]` | remote | `h2a host diff` | `@sentropic/runtime` | — | — | namespacé |
| `remote sync <id>` | remote | `h2a host sync` | `@sentropic/runtime` | — | — | namespacé |
| `remote sync-status` | remote | `h2a host sync-status` | `@sentropic/runtime` | — | — | namespacé |
| `remote sync-files` | remote | `h2a host sync-files` | `@sentropic/runtime` | — | — | namespacé |
| `remote forward <id> <port>` | remote | `h2a host forward` | `@sentropic/runtime` | — | — | namespacé |
| `remote browser open <id>` | remote | `h2a host browser open` | `@sentropic/runtime` | — | — | namespacé |
| `remote migrate forward <p>` | remote | `h2a host migrate forward` | `@sentropic/runtime` | — | — | namespacé |
| `remote migrate ls` | remote | `h2a host migrate ls` | `@sentropic/runtime` | — | — | namespacé |
| `remote migrate pick` | remote | `h2a host migrate pick` | `@sentropic/runtime` | — | — | namespacé |
| `remote migrate back` | remote | `h2a host migrate back` | `@sentropic/runtime` | — | — | namespacé |
| `remote migrate to-remote [p]` | remote | `h2a host migrate to-remote` | `@sentropic/runtime` | — | — | namespacé |
| `remote migrate to-local` | remote | `h2a host migrate to-local` | `@sentropic/runtime` | — | — | namespacé |
| `remote restore [group]` | remote | `h2a host restore` | `@sentropic/runtime` | — | — | namespacé |
| `remote layout show` | remote | `h2a host layout show` | `@sentropic/runtime` | — | — | namespacé |
| `remote lineage suspend <id>` | remote | `h2a host lineage suspend` | `@sentropic/runtime` | — | — | namespacé |
| `remote lineage resume <id>` | remote | `h2a host lineage resume` | `@sentropic/runtime` | — | — | namespacé |

---

## 3. Finalité — Suivre (27 commandes)

*Concern : l'état / le record du travail.*  
*Lib(s) : `@sentropic/track`.*

| Commande existante | Source | Cible h2a (alias court) | Lib | per-host | hermes | Statut |
|---|---|---|---|---|---|---|
| `track init` | track | `h2a track init` | `@sentropic/track` | — | — | namespacé |
| `track item new` | track | `h2a track item new` | `@sentropic/track` | — | — | namespacé |
| `track item reparent <id>` | track | `h2a track item reparent` | `@sentropic/track` | — | — | namespacé |
| `track item scope-declare <id>` | track | `h2a track item scope-declare` | `@sentropic/track` | — | — | namespacé |
| `track item spec-amend <id>` | track | `h2a track item spec-amend` | `@sentropic/track` | — | — | namespacé |
| `track item spec <id>` | track | `h2a track item spec` | `@sentropic/track` | — | — | namespacé |
| `track item realize <id>` | track | `h2a track item realize` | `@sentropic/track` | — | — | namespacé |
| `track item show <id>` | track | `h2a track item show` | `@sentropic/track` | — | — | namespacé |
| `track item ls` | track | `h2a track item ls` | `@sentropic/track` | — | — | namespacé |
| `track blocker raise` | track | `h2a track blocker raise` | `@sentropic/track` | — | — | namespacé |
| `track blocker resolve <id>` | track | `h2a track blocker resolve` | `@sentropic/track` | — | — | namespacé |
| `track blocker resolve-external` | track | `h2a track blocker resolve-external` | `@sentropic/track` | — | — | namespacé |
| `track accept criterion <id>` | track | `h2a track accept criterion` | `@sentropic/track` | — | — | namespacé |
| `track accept link <id>` | track | `h2a track accept link` | `@sentropic/track` | — | — | namespacé |
| `track accept run <evId>` | track | `h2a track accept run` | `@sentropic/track` | — | — | namespacé |
| `track accept waive <id>` | track | `h2a track accept waive` | `@sentropic/track` | — | — | namespacé |
| `track consolidate` | track | `h2a track consolidate` | `@sentropic/track` | — | — | namespacé |
| `track priority assess <id>` | track | `h2a track priority assess` | `@sentropic/track` | — | — | namespacé |
| `track report` | track | `h2a report` | `@sentropic/track` | — | — | renommé |
| `track query` | track | `h2a track query` | `@sentropic/track` | — | — | namespacé |
| `track export-graph` | track | `h2a track export` | `@sentropic/track` | — | — | renommé |
| `track workspace-activity` | track | `h2a track activity` | `@sentropic/track` | — | — | renommé |
| `track scope validate` | track | `h2a track scope validate` | `@sentropic/track` | — | — | namespacé |
| `track validate` | track | `h2a track validate` | `@sentropic/track` | — | — | namespacé |
| `track branch import <BRANCH.md>` | track | `h2a track import` | `@sentropic/track` | — | — | renommé |
| `track ingest <file.jsonl>` | track | `h2a track ingest` | `@sentropic/track` | — | — | namespacé |
| `track workspace-id` | track | `h2a track workspace-id` | `@sentropic/track` | — | — | namespacé |

---

## 4. Finalité — Administrer (64 commandes)

*Concern : identité, auth, clés, NHI, hosts, deploy, MCP, comptes LLM, liveness.*  
*Lib(s) : `@sentropic/identity` · `h2a-cli` · `@sentropic/h2a-core` · `@sentropic/llm-gateway` · `@sentropic/llm-mesh`.*

| Commande existante | Source | Cible h2a (alias court) | Lib | per-host | hermes | Statut |
|---|---|---|---|---|---|---|
| `h2a register` | h2a | `h2a register` | `@sentropic/identity` | — | — | direct |
| `h2a mcp-serve` | h2a | `h2a mcp serve` | `@sentropic/identity` | claude/codex mcp config | — | namespacé |
| `h2a keys generate` | h2a | `h2a key gen` | `@sentropic/identity` | — | — | renommé |
| `h2a keys add` | h2a | `h2a key add` | `@sentropic/identity` | — | — | namespacé |
| `h2a keys list` | h2a | `h2a key ls` | `@sentropic/identity` | — | — | renommé |
| `h2a keys revoke` | h2a | `h2a key revoke` | `@sentropic/identity` | — | — | namespacé |
| `h2a nhi report` | h2a | `h2a nhi report` | `@sentropic/identity` | — | — | direct |
| `h2a nhi inventory` | h2a | `h2a nhi ls` | `@sentropic/identity` | — | — | renommé |
| `h2a nhi export` | h2a | `h2a nhi export` | `@sentropic/identity` | — | — | direct |
| `h2a nhi attest` | h2a | `h2a nhi attest` | `@sentropic/identity` | — | — | direct |
| `h2a nhi offboard` | h2a | `h2a nhi offboard` | `@sentropic/identity` | — | — | direct |
| `remote auth status [profile]` | remote | `h2a host auth status` | `@sentropic/identity` | — | — | namespacé |
| `remote auth login <profile>` | remote | `h2a host auth login` | `@sentropic/identity` | claude /login · codex login | — | namespacé |
| `remote auth push <url\|id>` | remote | `h2a host auth push` | `@sentropic/identity` | — | — | namespacé |
| `remote refresh [url\|id]` | remote | `h2a host auth refresh` | `@sentropic/identity` | — | — | namespacé |
| `remote secrets status [id]` | remote | `h2a host secrets status` | `@sentropic/identity` | — | — | namespacé |
| `remote enroll` | remote | `h2a host enroll` | `@sentropic/identity` | — | — | namespacé |
| `h2a --help` | h2a | `h2a --help / h2a help` | `h2a-cli` | — | — | direct |
| `h2a hosts` | h2a | `h2a host ls` | `h2a-cli` | — | — | renommé |
| `h2a mcp-tools` | h2a | `h2a mcp tools` | `h2a-cli` | — | — | namespacé |
| `h2a init` | h2a | `h2a init` | `h2a-cli` | — | — | direct |
| `h2a upgrade` | h2a | `h2a up` | `h2a-cli` | — | — | renommé |
| `h2a host setup` | h2a | `h2a host setup` | `h2a-cli` | — | — | direct |
| `h2a host plugin` | h2a | `h2a host plugin` | `h2a-cli` | — | — | direct |
| `h2a host status` | h2a | `h2a host status` | `h2a-cli` | — | — | namespacé |
| `h2a connect` | h2a | `h2a connect` | `h2a-cli` | — | — | direct |
| `h2a doctor` | h2a | `h2a doctor` | `h2a-cli` | — | — | direct |
| `h2a install-skills` | h2a | `h2a host skills` | `h2a-cli` | claude/codex skills dir | — | fusionné |
| `h2a deploy k8s-sidecar` | h2a | `h2a deploy sidecar` | `h2a-cli` | — | — | renommé |
| `h2a deploy k8s-tenant` | h2a | `h2a deploy tenant` | `h2a-cli` | — | — | renommé |
| `remote install <url>` | remote | `h2a host install` | `h2a-cli` | — | — | namespacé |
| `remote config set <url>` | remote | `h2a host config set` | `h2a-cli` | — | — | namespacé |
| `remote config token <v>` | remote | `h2a host config token` | `h2a-cli` | — | — | namespacé |
| `remote config target <t>` | remote | `h2a host config target` | `h2a-cli` | — | — | namespacé |
| `remote config tools <list>` | remote | `h2a host config tools` | `h2a-cli` | — | — | namespacé |
| `remote config tmux-profile` | remote | `h2a host config tmux-profile` | `h2a-cli` | — | — | namespacé |
| `remote config clear` | remote | `h2a host config clear` | `h2a-cli` | — | — | namespacé |
| `remote config show` | remote | `h2a host config show` | `h2a-cli` | — | — | namespacé |
| `remote config tunnel` | remote | `h2a host config tunnel` | `h2a-cli` | — | — | namespacé |
| `remote plugin add <pkg>` | remote | `h2a host plugin add` | `h2a-cli` | — | — | fusionné |
| `remote plugin ls` | remote | `h2a host plugin ls` | `h2a-cli` | — | — | fusionné |
| `remote plugin sync` | remote | `h2a host plugin sync` | `h2a-cli` | — | — | fusionné |
| `remote plugin sync-skills` | remote | `h2a host plugin sync-skills` | `h2a-cli` | — | — | fusionné |
| `track install-skills` | track | `h2a host skills --of track` | `h2a-cli` | claude/codex skills dir | — | fusionné |
| `harness skills install` | harness | `h2a host skills --of dev` | `h2a-cli` | claude/codex skills dir | — | fusionné |
| `h2a store migrate` | h2a | `h2a store migrate` | `@sentropic/h2a-core` | — | — | direct |
| `remote llm-mesh start` | remote | `h2a gateway start` | `@sentropic/llm-gateway` | — | — | renommé |
| `remote llm-mesh stop` | remote | `h2a gateway stop` | `@sentropic/llm-gateway` | — | — | renommé |
| `remote llm-mesh restart` | remote | `h2a gateway restart` | `@sentropic/llm-gateway` | — | — | renommé |
| `remote llm-mesh status` | remote | `h2a gateway status` | `@sentropic/llm-gateway` | — | — | renommé |
| `remote llm-mesh logs` | remote | `h2a gateway logs` | `@sentropic/llm-gateway` | — | — | renommé |
| `remote account enroll` | remote | `h2a host account enroll` | `@sentropic/llm-mesh` | — | — | namespacé |
| `remote account ls` | remote | `h2a host account ls` | `@sentropic/llm-mesh` | — | — | namespacé |
| `remote account rm <id>` | remote | `h2a host account rm` | `@sentropic/llm-mesh` | — | — | namespacé |
| `remote account exhausted <id>` | remote | `h2a host account exhausted` | `@sentropic/llm-mesh` | — | — | namespacé |
| `remote account clear-quota <id>` | remote | `h2a host account clear-quota` | `@sentropic/llm-mesh` | — | — | namespacé |
| `remote account select` | remote | `h2a host account select` | `@sentropic/llm-mesh` | — | — | namespacé |
| `remote account log` | remote | `h2a host account log` | `@sentropic/llm-mesh` | — | — | namespacé |
| `remote account rm-binding <k>` | remote | `h2a host account rm-binding` | `@sentropic/llm-mesh` | — | — | namespacé |
| `remote account bindings` | remote | `h2a host account bindings` | `@sentropic/llm-mesh` | — | — | namespacé |
| `remote account push-cluster` | remote | `h2a host account push-cluster` | `@sentropic/llm-mesh` | — | — | namespacé |
| `remote llm-mesh enroll <prov>` | remote | `h2a mesh enroll` | `@sentropic/llm-mesh` | — | — | renommé |
| `remote llm-mesh enable` | remote | `h2a mesh enable` | `@sentropic/llm-mesh` | — | — | renommé |
| `remote llm-mesh disable` | remote | `h2a mesh disable` | `@sentropic/llm-mesh` | — | — | renommé |

---

## 5. Finalité — Étendre (37 commandes)

*Concern : extensions additives (gardent leur CLI).*  
*Lib(s) : `@sentropic/harness` · `design-system` · `graphify` · `agent-stats`.*

| Commande existante | Source | Cible h2a (alias court) | Lib | per-host | hermes | Statut |
|---|---|---|---|---|---|---|
| `harness check scope` | harness | `h2a dev check scope` | `@sentropic/harness` | claude: harness skill · codex: /cmd | — | namespacé |
| `harness check branch` | harness | `h2a dev check branch` | `@sentropic/harness` | claude: harness skill · codex: /cmd | — | namespacé |
| `harness verify --category` | harness | `h2a dev verify --category` | `@sentropic/harness` | claude: harness skill · codex: /cmd | — | namespacé |
| `harness audit` | harness | `h2a dev audit` | `@sentropic/harness` | claude: harness skill · codex: /cmd | — | namespacé |
| `harness init` | harness | `h2a dev init` | `@sentropic/harness` | claude: harness skill · codex: /cmd | — | namespacé |
| `harness brainstorm` | harness | `h2a dev brainstorm` | `@sentropic/harness` | claude: harness-brainstorm · codex: /cmd | — | namespacé |
| `harness plan` | harness | `h2a dev plan` | `@sentropic/harness` | claude: harness-plan · codex: /cmd | — | namespacé |
| `harness test` | harness | `h2a dev test` | `@sentropic/harness` | claude: harness-test · codex: /cmd | — | namespacé |
| `harness debug` | harness | `h2a dev debug` | `@sentropic/harness` | claude: harness-debug · codex: /cmd | — | namespacé |
| `harness review` | harness | `h2a dev review` | `@sentropic/harness` | claude: harness-review · codex: /cmd | — | namespacé |
| `harness branch init` | harness | `h2a dev branch open` | `@sentropic/harness` | claude: harness skill · codex: /cmd | — | renommé |
| `harness branch close` | harness | `h2a dev branch close` | `@sentropic/harness` | claude: harness skill · codex: /cmd | — | namespacé |
| `harness adopt` | harness | `h2a dev adopt` | `@sentropic/harness` | claude: harness skill · codex: /cmd | — | namespacé |
| `design audit` | design | `h2a design lint` | `design-system` | — | — | renommé |
| `design audit:visual` | design | `h2a design lint --visual` | `design-system` | — | — | renommé |
| `design audit:parity` | design | `h2a design fidelity` | `design-system` | — | — | renommé |
| `design check` | design | `h2a design check` | `design-system` | — | — | direct |
| `design build` | design | `h2a design build` | `design-system` | — | — | direct |
| `design align` | design | `h2a design align` | `design-system` | — | — | direct |
| `design polish` | design | `h2a design polish` | `design-system` | — | — | direct |
| `design init` | design | `h2a design init` | `design-system` | — | — | direct |
| `design init --extract` | design | `h2a design tokens` | `design-system` | — | — | renommé |
| `ds-theme-clone (skill)` | design | `h2a design theme clone <id>` | `design-system` | claude: ds-theme-clone | — | namespacé |
| `embeddable-view (pkg)` | design | `h2a design views` | `design-system` | — | — | namespacé |
| `graphify . build (--update/--mode deep)` | knowledge | `h2a knowledge ingest <path>` | `graphify` | — | — | namespacé |
| `graphify query (path/explain/summary)` | knowledge | `h2a knowledge query <q>` | `graphify` | — | — | namespacé |
| `graphify serve/watch/clone/merge-graphs` | knowledge | `h2a knowledge graph` | `graphify` | — | — | namespacé |
| `graphify profile / ontology` | knowledge | `h2a knowledge ontology` | `graphify` | — | — | namespacé |
| `graphify studio export` | knowledge | `h2a knowledge export` | `graphify` | — | — | namespacé |
| `graphify agent-stats {sync,sessions,wp}` | knowledge | `h2a knowledge agents` | `graphify` | — | — | namespacé |
| `@sentropic/agent-stats-core (lib)` | agent-stats | `consommé par h2a (dep optionnelle)` | `agent-stats` | — | — | direct |
| `agent-stats stats <id>` | agent-stats | `h2a agent stats <id>` | `agent-stats` | — | — | namespacé |
| `agent-stats report` | agent-stats | `h2a agent stats <id> --report` | `agent-stats` | — | — | namespacé |
| `agent-stats anomalies` | agent-stats | `h2a agent stats <id> --anomalies` | `agent-stats` | — | — | namespacé |
| `agent-stats clean` | agent-stats | `h2a agent stats … --clean` | `agent-stats` | — | — | namespacé |
| `agent-stats analyze` | agent-stats | `h2a agent stats <id> --analyze` | `agent-stats` | — | — | namespacé |
| `agent-stats web (estate-wide)` | agent-stats | `h2a agent stats --all / stp agent-stats web` | `agent-stats` | — | — | **OPEN** |

---

## Synthèse

- **Total commandes mappées : 255** — par finalité : Coordonner 81 · Exécuter 46 · Suivre 27 · Administrer 64 · Étendre 37.
- **OPEN (Fabien à trancher) : 3**
  1. `remote agents ls` → `h2a ls` (mes instances) vs `h2a find` (pairs du bus) — taxonomie. *(Coordonner / `@sentropic/h2a-core`)*
  2. `remote check`/`smoke` → `h2a host check` vs `h2a <profile> check` (collision avec `dev check`). *(Exécuter / `@sentropic/runtime`)*
  3. `agent-stats web` → toit estate-wide cross-vendor orphelin (stp déprécié). *(Étendre / `agent-stats`)*
- **Par lib :** `@sentropic/h2a-core` 53 · `@sentropic/loop` 14 · `transport-wake (h2a)` 9 · `@sentropic/agent` 2 · `h2a-cli` 35 · `@sentropic/runtime` 37 · `@sentropic/track` 33 · `@sentropic/identity` 17 · `@sentropic/llm-gateway` 5 · `@sentropic/llm-mesh` 13 · `@sentropic/harness` 13 · `design-system` 11 · `graphify` 6 · `agent-stats` 7.

Chemins de sortie :
- `docs/specs/2026-06-28-h2a-command-mapping-v3-finalites.md`
- `…/scratchpad/semantic-focus/mapping.html`
