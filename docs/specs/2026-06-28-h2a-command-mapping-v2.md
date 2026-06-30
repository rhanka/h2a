# h2a unified CLI — command mapping v2 (alias courts · per-host · hermes · modules R6)

**Status: mapping-for-validation v2. Read-only sur toutes les sources.** Régénération de `2026-06-27-h2a-command-mapping.md` (255 commandes, énumération réelle réutilisée) avec la grammaire refactorée de `2026-06-28-h2a-refactoring-scoped-proposal.md` (R1 alias courts · R5 définitions · R6 8 modules). Jumeau HTML : `…/scratchpad/semantic-focus/mapping.html`.

## Glossaire R5 (1 ligne)

- **SERVER** (`@sentropic/h2a-core`) — où vit l'état : présence/inbox/sessions/conductor + RACI/NHI. Pas de LLM.
- **RELAY** (`@sentropic/relay`) — comment ça circule : transport bête A→B (wake local-tmux, forward). Stateless.
- **LOOP** (`@sentropic/loop`) — quand/pourquoi un agent agit : cadence drumbeat vers un objectif.
- **GATEWAY** (`@sentropic/llm-gateway`) — data-plane LLM : proxy N comptes, traduit formats, mappe modèles, par requête.
- **LLM-MESH** (`@sentropic/llm-mesh`) — control-plane LLM : enroll/pool/fallback/sélection (« quel compte, où »). Ne proxy pas.

## 8 modules R6

`h2a-cli` (UX seule) · `@sentropic/h2a-core` (SERVER) · `@sentropic/relay` (RELAY) · `@sentropic/runtime` (EXEC — ExecBackend local/container/pod) · `@sentropic/llm-gateway` (GATEWAY) · `@sentropic/llm-mesh` (MESH) · `@sentropic/hosts` (HostAdapter) · `@sentropic/loop` (LOOP). Hors périmètre mais cibles de module : **track** (lib record-only) · **additif** (design/graphify/agent-stats).

## Règles de ciblage appliquées (v2)

- Profil top-level : `remote claude|codex|gemini|agy …` et `agent run <profile>` → **`h2a <profile> run|resume|headless|hook|mcp`** (tue `h2a agent run <profile>`).
- `track decision …` → **`h2a decision …`** (bare) · `track report` → **`h2a report`** · autres track → `h2a track …`.
- Sandbox/container/k8s/remote-exec → flag **`--sandbox`/`--remote`** sur `h2a <profile>` / `h2a job` ; module **`@sentropic/runtime`** (ExecBackend local/container/pod).
- Plus de « bus » : transport HTTP ex-remote → **`h2a relay …`** (livraison/forward/wake) OU **`h2a serve`** (exposer l'état h2a), tranché par ligne.
- Présence/inbox/sessions/conductor/negotiate/nhi/keys → module **`h2a-core`** (SERVER), surface `h2a <noun>`.
- llm-gateway/llm-mesh → modules **`llm-gateway`** / **`llm-mesh`** ; hosts/plugin/enroll/hooks → module **`hosts`** ; objective-loop/drumbeat → **`loop`**.

**Compteurs : total = 255 · OPEN = 3.** Par module : cli 16 · h2a-core 66 · relay 9 · runtime 48 · llm-gateway 5 · llm-mesh 13 · hosts 27 · loop 14 · track 33 · additif 24.

**Légende statut :** direct · renommé · namespacé · fusionné · OPEN (Fabien à trancher).

---

## 1. `h2a` → unifié — 90 commandes (source : `cli-contract.ts`)

| Commande existante | Cible h2a (alias court) | Module R6 | per-host | hermes | Statut |
|---|---|---|---|---|---|
| `h2a --help` | `h2a --help / h2a help` | `cli` | — | — | direct |
| `h2a hosts` | `h2a host ls` | `hosts` | — | — | renommé |
| `h2a mcp-tools` | `h2a mcp tools` | `h2a-core` | — | — | namespacé |
| `h2a init` | `h2a init` | `h2a-core` | — | — | direct |
| `h2a register` | `h2a register` | `h2a-core` | — | — | direct |
| `h2a discover` | `h2a find` | `h2a-core` | — | — | renommé |
| `h2a loop create` | `h2a loop create` | `loop` | — | — | direct |
| `h2a loop list` | `h2a loop ls` | `loop` | — | — | renommé |
| `h2a loop status` | `h2a loop status` | `loop` | — | — | direct |
| `h2a loop agents` | `h2a loop agents` | `loop` | — | — | direct |
| `h2a loop attach` | `h2a loop attach` | `loop` | — | — | direct |
| `h2a loop logs` | `h2a loop logs` | `loop` | — | — | direct |
| `h2a loop tick` | `h2a loop tick` | `loop` | — | — | direct |
| `h2a loop watch` | `h2a loop watch` | `loop` | — | — | direct |
| `h2a subagent register` | `h2a sub register` | `h2a-core` | — | — | namespacé |
| `h2a subagent list` | `h2a sub ls` | `h2a-core` | — | — | renommé |
| `h2a subagent route` | `h2a sub route` | `h2a-core` | — | — | namespacé |
| `h2a subagent inbox` | `h2a sub inbox` | `h2a-core` | — | — | namespacé |
| `h2a subagent audit` | `h2a sub audit` | `h2a-core` | — | — | namespacé |
| `h2a subagent revoke` | `h2a sub revoke` | `h2a-core` | — | — | namespacé |
| `h2a negotiate open` | `h2a nego open` | `h2a-core` | — | — | namespacé |
| `h2a negotiate status` | `h2a nego status` | `h2a-core` | — | — | namespacé |
| `h2a negotiate event` | `h2a nego event` | `h2a-core` | — | — | namespacé |
| `h2a negotiate offer` | `h2a nego offer` | `h2a-core` | — | — | namespacé |
| `h2a negotiate counter` | `h2a nego counter` | `h2a-core` | — | — | namespacé |
| `h2a negotiate sign` | `h2a nego sign` | `h2a-core` | — | — | namespacé |
| `h2a negotiate stabilize` | `h2a nego stabilize` | `h2a-core` | — | — | namespacé |
| `h2a negotiate journal` | `h2a nego ls` | `h2a-core` | — | — | renommé |
| `h2a declare-interest` | `h2a nego interest` | `h2a-core` | — | — | namespacé |
| `h2a conflict-posture` | `h2a nego conflict` | `h2a-core` | — | — | namespacé |
| `h2a dossier` | `h2a nego dossier` | `h2a-core` | — | — | namespacé |
| `h2a confiance` | `h2a nego trust` | `h2a-core` | — | — | renommé |
| `h2a attest-comprehension` | `h2a nego attest` | `h2a-core` | — | — | namespacé |
| `h2a comprehension list` | `h2a nego comp ls` | `h2a-core` | — | — | namespacé |
| `h2a comprehension verify` | `h2a nego comp verify` | `h2a-core` | — | — | namespacé |
| `h2a inbox put` | `h2a send` | `h2a-core` | — | — | renommé |
| `h2a inbox read` | `h2a inbox` | `h2a-core` | — | — | renommé |
| `h2a inbox pop` | `h2a inbox pop` | `h2a-core` | — | — | namespacé |
| `h2a outbox put` | `h2a msg out send` | `h2a-core` | — | — | namespacé |
| `h2a outbox read` | `h2a msg out ls` | `h2a-core` | — | — | namespacé |
| `h2a store migrate` | `h2a store migrate` | `h2a-core` | — | — | direct |
| `h2a mcp-serve` | `h2a mcp serve` | `h2a-core` | claude/codex mcp config | — | namespacé |
| `h2a upgrade` | `h2a up` | `cli` | — | — | renommé |
| `h2a remote serve` | `h2a serve` | `h2a-core` | — | — | renommé |
| `h2a remote send` | `h2a relay send` | `relay` | — | — | renommé |
| `h2a drive` | `h2a wake` | `relay` | tmux send-keys | — | renommé |
| `h2a drive receive` | `h2a wake verify` | `relay` | — | — | renommé |
| `h2a drive serve` | `h2a wake serve` | `relay` | — | — | renommé |
| `h2a sysml verify` | `h2a sysml verify` | `h2a-core` | — | — | direct |
| `h2a drumbeat record` | `h2a drum record` | `loop` | — | — | namespacé |
| `h2a drumbeat scan` | `h2a drum ls` | `loop` | — | — | renommé |
| `h2a drumbeat clear` | `h2a drum clear` | `loop` | — | — | namespacé |
| `h2a drumbeat escalations` | `h2a drum escalations` | `loop` | — | — | namespacé |
| `h2a drumbeat relance-inbox` | `h2a drum relance` | `loop` | — | — | renommé |
| `h2a drumbeat watch` | `h2a drum watch` | `loop` | — | — | namespacé |
| `h2a host setup` | `h2a host setup` | `hosts` | — | — | direct |
| `h2a host plugin` | `h2a host plugin` | `hosts` | — | — | direct |
| `h2a host status` | `h2a host status` | `hosts` | — | — | namespacé |
| `h2a connect` | `h2a connect` | `hosts` | — | — | direct |
| `h2a doctor` | `h2a doctor` | `cli` | — | — | direct |
| `h2a status` | `h2a status` | `h2a-core` | — | — | direct |
| `h2a sessions` | `h2a ls` | `h2a-core` | — | — | renommé |
| `h2a keys generate` | `h2a key gen` | `h2a-core` | — | — | renommé |
| `h2a keys add` | `h2a key add` | `h2a-core` | — | — | namespacé |
| `h2a keys list` | `h2a key ls` | `h2a-core` | — | — | renommé |
| `h2a keys revoke` | `h2a key revoke` | `h2a-core` | — | — | namespacé |
| `h2a nhi report` | `h2a nhi report` | `h2a-core` | — | — | direct |
| `h2a nhi inventory` | `h2a nhi ls` | `h2a-core` | — | — | renommé |
| `h2a nhi export` | `h2a nhi export` | `h2a-core` | — | — | direct |
| `h2a nhi attest` | `h2a nhi attest` | `h2a-core` | — | — | direct |
| `h2a nhi offboard` | `h2a nhi offboard` | `h2a-core` | — | — | direct |
| `h2a org validate` | `h2a org validate` | `h2a-core` | — | — | direct |
| `h2a org show` | `h2a org show` | `h2a-core` | — | — | direct |
| `h2a org diff` | `h2a org diff` | `h2a-core` | — | — | direct |
| `h2a org provision` | `h2a org apply` | `h2a-core` | — | — | renommé |
| `h2a coach propose` | `h2a org propose` | `h2a-core` | — | — | fusionné |
| `h2a coach ratify` | `h2a org ratify` | `h2a-core` | — | — | fusionné |
| `h2a blockage raise` | `h2a block raise` | `h2a-core` | — | — | renommé |
| `h2a blockage list` | `h2a block ls` | `h2a-core` | — | — | renommé |
| `h2a blockage resolve` | `h2a block resolve` | `h2a-core` | — | — | renommé |
| `h2a install-skills` | `h2a host skills` | `hosts` | claude/codex skills dir | — | fusionné |
| `h2a keepalive` | `h2a keepalive` | `h2a-core` | — | — | direct |
| `h2a thread` | `h2a msg thread` | `h2a-core` | — | — | namespacé |
| `h2a conductor` | `h2a cond` | `h2a-core` | — | — | renommé |
| `h2a conductor claim` | `h2a cond claim` | `h2a-core` | — | — | namespacé |
| `h2a conductor release` | `h2a cond release` | `h2a-core` | — | — | namespacé |
| `h2a conductor-launch-check` | `h2a cond launch --check` | `h2a-core` | — | — | fusionné |
| `h2a conductor-launch` | `h2a cond launch --confirm` | `h2a-core` | — | — | fusionné |
| `h2a deploy k8s-sidecar` | `h2a deploy sidecar` | `runtime` | — | — | renommé |
| `h2a deploy k8s-tenant` | `h2a deploy tenant` | `runtime` | — | — | renommé |

---

## 2. `remote` → unifié — 93 commandes (source : `remote-cli/src/index.ts`)

### 2a · Profils + lifecycle → h2a <profile> run / bare

| Commande existante | Cible h2a (alias court) | Module R6 | per-host | hermes | Statut |
|---|---|---|---|---|---|
| `remote codex` | `h2a codex run` | `hosts` | codex exec | `hermes run --agent codex` | fusionné |
| `remote claude (claude-code)` | `h2a claude run` | `hosts` | claude -p | `hermes run --agent claude` | fusionné |
| `remote agy (antigravity)` | `h2a agy run` | `hosts` | antigravity | `hermes run --agent agy` | fusionné |
| `remote gemini (gemini-cli)` | `h2a gemini run` | `hosts` | gemini -p | `hermes run --agent gemini` | fusionné |
| `remote mistral (mistralcli)` | `h2a mistral run` | `hosts` | mistral | `hermes run --agent mistral` | fusionné |
| `remote opencode` | `h2a opencode run` | `hosts` | opencode | `hermes run --agent opencode` | fusionné |
| `remote shell` | `h2a shell run` | `runtime` | bash | — | fusionné |
| `remote run <profile> [path]` | `h2a <profile> run (bare h2a run)` | `hosts` | — | `hermes run --agent <profile>` | direct |
| `remote resume [slug]` | `h2a resume` | `hosts` | claude -c · codex resume | `hermes run --resume` | renommé |
| `remote attach <url\|id>` | `h2a attach` | `runtime` | tmux attach | — | direct |
| `remote stop <url\|id>` | `h2a stop` | `runtime` | — | — | direct |
| `remote ls [url]` | `h2a ls` | `h2a-core` | — | — | fusionné |
| `remote rename <id> <name>` | `h2a rename` | `hosts` | claude customTitle · codex thread_name | — | renommé |
| `remote agents ls` | `h2a ls / h2a find` | `h2a-core` | — | — | **OPEN** |
| `remote agents inspect` | `h2a inspect` | `h2a-core` | — | — | direct |

### 2b · Délégation + supervision déléguée → h2a job / h2a delegate

| Commande existante | Cible h2a (alias court) | Module R6 | per-host | hermes | Statut |
|---|---|---|---|---|---|
| `remote delegate <type> <task>` | `h2a delegate <profile> (bare h2a delegate)` | `runtime` | claude -p · codex exec | `hermes run` | direct |
| `remote jobs ls` | `h2a job ls` | `runtime` | — | `hermes job ls` | namespacé |
| `remote jobs status <id>` | `h2a job status` | `runtime` | — | `hermes job status` | namespacé |
| `remote jobs attach <id>` | `h2a job attach` | `runtime` | — | — | namespacé |
| `remote jobs logs <id>` | `h2a job logs` | `runtime` | — | `hermes job logs` | namespacé |
| `remote jobs decisions` | `h2a job decisions` | `runtime` | — | — | namespacé |
| `remote jobs decide <id> <a>` | `h2a job decide` | `runtime` | — | — | namespacé |
| `remote jobs conduct` | `h2a job conduct` | `runtime` | — | — | namespacé |
| `remote conductor-launch` | `h2a cond launch` | `h2a-core` | — | — | fusionné |
| `remote wake-request` | `h2a wake` | `relay` | tmux send-keys | — | renommé |
| `remote relaunch [filter]` | `h2a wake --relaunch` | `relay` | — | — | renommé |
| `remote resume-throttled [f]` | `h2a wake --throttled` | `relay` | — | — | renommé |

### 2c · Déport k8s / remote-exec → runtime · hosts · mesh · gateway

| Commande existante | Cible h2a (alias court) | Module R6 | per-host | hermes | Statut |
|---|---|---|---|---|---|
| `remote install <url>` | `h2a host install` | `hosts` | — | — | namespacé |
| `remote connect` | `h2a connect --tunnel` | `runtime` | — | — | fusionné |
| `remote disconnect` | `h2a host disconnect` | `runtime` | — | — | namespacé |
| `remote status` | `h2a status` | `h2a-core` | — | — | fusionné |
| `remote check <profile> (smoke)` | `h2a host check / h2a <profile> check` | `runtime` | claude -p · codex exec | — | **OPEN** |
| `remote config set <url>` | `h2a host config set` | `runtime` | — | — | namespacé |
| `remote config token <v>` | `h2a host config token` | `runtime` | — | — | namespacé |
| `remote config target <t>` | `h2a host config target` | `runtime` | — | — | namespacé |
| `remote config tools <list>` | `h2a host config tools` | `hosts` | — | — | namespacé |
| `remote config tmux-profile` | `h2a host config tmux-profile` | `hosts` | — | — | namespacé |
| `remote config clear` | `h2a host config clear` | `runtime` | — | — | namespacé |
| `remote config show` | `h2a host config show` | `runtime` | — | — | namespacé |
| `remote config tunnel` | `h2a host config tunnel` | `runtime` | — | — | namespacé |
| `remote workspace link` | `h2a host workspace link` | `runtime` | — | — | namespacé |
| `remote workspace list [url]` | `h2a host workspace ls` | `runtime` | — | — | renommé |
| `remote workspace status` | `h2a host workspace status` | `runtime` | — | — | namespacé |
| `remote workspace push` | `h2a host workspace push` | `runtime` | — | — | namespacé |
| `remote workspace pull` | `h2a host workspace pull` | `runtime` | — | — | namespacé |
| `remote workspace rm [id]` | `h2a host workspace rm` | `runtime` | — | — | namespacé |
| `remote workspace gc` | `h2a host workspace gc` | `runtime` | — | — | namespacé |
| `remote auth status [profile]` | `h2a host auth status` | `hosts` | — | — | namespacé |
| `remote auth login <profile>` | `h2a host auth login` | `hosts` | claude /login · codex login | — | namespacé |
| `remote auth push <url\|id>` | `h2a host auth push` | `runtime` | — | — | namespacé |
| `remote refresh [url\|id]` | `h2a host auth refresh` | `runtime` | — | — | namespacé |
| `remote secrets status [id]` | `h2a host secrets status` | `runtime` | — | — | namespacé |
| `remote diff [id]` | `h2a host diff` | `runtime` | — | — | namespacé |
| `remote sync <id>` | `h2a host sync` | `runtime` | — | — | namespacé |
| `remote sync-status` | `h2a host sync-status` | `runtime` | — | — | namespacé |
| `remote sync-files` | `h2a host sync-files` | `runtime` | — | — | namespacé |
| `remote forward <id> <port>` | `h2a host forward` | `runtime` | — | — | namespacé |
| `remote browser open <id>` | `h2a host browser open` | `runtime` | — | — | namespacé |
| `remote migrate forward <p>` | `h2a host migrate forward` | `runtime` | — | — | namespacé |
| `remote migrate ls` | `h2a host migrate ls` | `runtime` | — | — | namespacé |
| `remote migrate pick` | `h2a host migrate pick` | `runtime` | — | — | namespacé |
| `remote migrate back` | `h2a host migrate back` | `runtime` | — | — | namespacé |
| `remote migrate to-remote [p]` | `h2a host migrate to-remote` | `runtime` | — | — | namespacé |
| `remote migrate to-local` | `h2a host migrate to-local` | `runtime` | — | — | namespacé |
| `remote plugin add <pkg>` | `h2a host plugin add` | `hosts` | — | — | fusionné |
| `remote plugin ls` | `h2a host plugin ls` | `hosts` | — | — | fusionné |
| `remote plugin sync` | `h2a host plugin sync` | `hosts` | — | — | fusionné |
| `remote plugin sync-skills` | `h2a host plugin sync-skills` | `hosts` | — | — | fusionné |
| `remote restore [group]` | `h2a host restore` | `runtime` | — | — | namespacé |
| `remote layout show` | `h2a host layout show` | `runtime` | — | — | namespacé |
| `remote enroll` | `h2a host enroll` | `hosts` | — | — | namespacé |
| `remote account enroll` | `h2a host account enroll` | `llm-mesh` | — | — | namespacé |
| `remote account ls` | `h2a host account ls` | `llm-mesh` | — | — | namespacé |
| `remote account rm <id>` | `h2a host account rm` | `llm-mesh` | — | — | namespacé |
| `remote account exhausted <id>` | `h2a host account exhausted` | `llm-mesh` | — | — | namespacé |
| `remote account clear-quota <id>` | `h2a host account clear-quota` | `llm-mesh` | — | — | namespacé |
| `remote account select` | `h2a host account select` | `llm-mesh` | — | — | namespacé |
| `remote account log` | `h2a host account log` | `llm-mesh` | — | — | namespacé |
| `remote account rm-binding <k>` | `h2a host account rm-binding` | `llm-mesh` | — | — | namespacé |
| `remote account bindings` | `h2a host account bindings` | `llm-mesh` | — | — | namespacé |
| `remote account push-cluster` | `h2a host account push-cluster` | `llm-mesh` | — | — | namespacé |
| `remote llm-mesh enroll <prov>` | `h2a mesh enroll` | `llm-mesh` | — | — | renommé |
| `remote llm-mesh start` | `h2a gateway start` | `llm-gateway` | — | — | renommé |
| `remote llm-mesh enable` | `h2a mesh enable` | `llm-mesh` | — | — | renommé |
| `remote llm-mesh disable` | `h2a mesh disable` | `llm-mesh` | — | — | renommé |
| `remote llm-mesh stop` | `h2a gateway stop` | `llm-gateway` | — | — | renommé |
| `remote llm-mesh restart` | `h2a gateway restart` | `llm-gateway` | — | — | renommé |
| `remote llm-mesh status` | `h2a gateway status` | `llm-gateway` | — | — | renommé |
| `remote llm-mesh logs` | `h2a gateway logs` | `llm-gateway` | — | — | renommé |
| `remote lineage suspend <id>` | `h2a host lineage suspend` | `runtime` | — | — | namespacé |
| `remote lineage resume <id>` | `h2a host lineage resume` | `runtime` | — | — | namespacé |

### 2d · Transport HTTP ex-bus → h2a relay

| Commande existante | Cible h2a (alias court) | Module R6 | per-host | hermes | Statut |
|---|---|---|---|---|---|
| `remote h2a ping <instance>` | `h2a relay ping` | `relay` | — | — | renommé |
| `remote h2a bridge [id]` | `h2a relay bridge` | `relay` | — | — | renommé |

---

## 3. `track` → unifié — 34 commandes (source : `track --help`)

| Commande existante | Cible h2a (alias court) | Module R6 | per-host | hermes | Statut |
|---|---|---|---|---|---|
| `track init` | `h2a track init` | `track` | — | — | namespacé |
| `track item new` | `h2a track item new` | `track` | — | — | namespacé |
| `track item reparent <id>` | `h2a track item reparent` | `track` | — | — | namespacé |
| `track item scope-declare <id>` | `h2a track item scope-declare` | `track` | — | — | namespacé |
| `track item spec-amend <id>` | `h2a track item spec-amend` | `track` | — | — | namespacé |
| `track item spec <id>` | `h2a track item spec` | `track` | — | — | namespacé |
| `track item realize <id>` | `h2a track item realize` | `track` | — | — | namespacé |
| `track item show <id>` | `h2a track item show` | `track` | — | — | namespacé |
| `track item ls` | `h2a track item ls` | `track` | — | — | namespacé |
| `track decision new` | `h2a decision new` | `track` | claude: present-decision · codex: /decision | — | renommé |
| `track decision outcome <id>` | `h2a decision outcome` | `track` | claude: present-decision · codex: /decision | — | renommé |
| `track decision dossier <id>` | `h2a decision dossier` | `track` | claude: present-decision · codex: /decision | — | renommé |
| `track decision disposition <id>` | `h2a decision disposition` | `track` | claude: present-decision · codex: /decision | — | renommé |
| `track decision add-artifact <id>` | `h2a decision add-artifact` | `track` | claude: present-decision · codex: /decision | — | renommé |
| `track blocker raise` | `h2a track blocker raise` | `track` | — | — | namespacé |
| `track blocker resolve <id>` | `h2a track blocker resolve` | `track` | — | — | namespacé |
| `track blocker resolve-external` | `h2a track blocker resolve-external` | `track` | — | — | namespacé |
| `track accept criterion <id>` | `h2a track accept criterion` | `track` | — | — | namespacé |
| `track accept link <id>` | `h2a track accept link` | `track` | — | — | namespacé |
| `track accept run <evId>` | `h2a track accept run` | `track` | — | — | namespacé |
| `track accept waive <id>` | `h2a track accept waive` | `track` | — | — | namespacé |
| `track consolidate` | `h2a track consolidate` | `track` | — | — | namespacé |
| `track priority assess <id>` | `h2a track priority assess` | `track` | — | — | namespacé |
| `track report` | `h2a report` | `track` | — | — | renommé |
| `track query` | `h2a track query` | `track` | — | — | namespacé |
| `track export-graph` | `h2a track export` | `track` | — | — | renommé |
| `track workspace-activity` | `h2a track activity` | `track` | — | — | renommé |
| `track scope validate` | `h2a track scope validate` | `track` | — | — | namespacé |
| `track validate` | `h2a track validate` | `track` | — | — | namespacé |
| `track focus <decision-id>` | `h2a track focus` | `track` | — | — | namespacé |
| `track branch import <BRANCH.md>` | `h2a track import` | `track` | — | — | renommé |
| `track ingest <file.jsonl>` | `h2a track ingest` | `track` | — | — | namespacé |
| `track install-skills` | `h2a host skills --of track` | `hosts` | claude/codex skills dir | — | fusionné |
| `track workspace-id` | `h2a track workspace-id` | `track` | — | — | namespacé |

---

## 4. `harness` → unifié — 14 commandes (source : `harness-* skills`)

| Commande existante | Cible h2a (alias court) | Module R6 | per-host | hermes | Statut |
|---|---|---|---|---|---|
| `harness check scope` | `h2a dev check scope` | `cli` | claude: harness skill · codex: /cmd | — | namespacé |
| `harness check branch` | `h2a dev check branch` | `cli` | claude: harness skill · codex: /cmd | — | namespacé |
| `harness verify --category` | `h2a dev verify --category` | `cli` | claude: harness skill · codex: /cmd | — | namespacé |
| `harness audit` | `h2a dev audit` | `cli` | claude: harness skill · codex: /cmd | — | namespacé |
| `harness init` | `h2a dev init` | `cli` | claude: harness skill · codex: /cmd | — | namespacé |
| `harness brainstorm` | `h2a dev brainstorm` | `cli` | claude: harness-brainstorm · codex: /cmd | — | namespacé |
| `harness plan` | `h2a dev plan` | `cli` | claude: harness-plan · codex: /cmd | — | namespacé |
| `harness test` | `h2a dev test` | `cli` | claude: harness-test · codex: /cmd | — | namespacé |
| `harness debug` | `h2a dev debug` | `cli` | claude: harness-debug · codex: /cmd | — | namespacé |
| `harness review` | `h2a dev review` | `cli` | claude: harness-review · codex: /cmd | — | namespacé |
| `harness branch init` | `h2a dev branch open` | `cli` | claude: harness skill · codex: /cmd | — | renommé |
| `harness branch close` | `h2a dev branch close` | `cli` | claude: harness skill · codex: /cmd | — | namespacé |
| `harness skills install` | `h2a host skills --of dev` | `hosts` | claude/codex skills dir | — | fusionné |
| `harness adopt` | `h2a dev adopt` | `cli` | claude: harness skill · codex: /cmd | — | namespacé |

---

## 5. `additifs` → unifié — 24 commandes (source : `design · graphify · agent-stats`)

### design (@sentropic/design-system-skills) → h2a design

| Commande existante | Cible h2a (alias court) | Module R6 | per-host | hermes | Statut |
|---|---|---|---|---|---|
| `design audit` | `h2a design lint` | `additif` | — | — | renommé |
| `design audit:visual` | `h2a design lint --visual` | `additif` | — | — | renommé |
| `design audit:parity` | `h2a design fidelity` | `additif` | — | — | renommé |
| `design check` | `h2a design check` | `additif` | — | — | direct |
| `design build` | `h2a design build` | `additif` | — | — | direct |
| `design align` | `h2a design align` | `additif` | — | — | direct |
| `design polish` | `h2a design polish` | `additif` | — | — | direct |
| `design init` | `h2a design init` | `additif` | — | — | direct |
| `design init --extract` | `h2a design tokens` | `additif` | — | — | renommé |
| `ds-theme-clone (skill)` | `h2a design theme clone <id>` | `additif` | claude: ds-theme-clone | — | namespacé |
| `embeddable-view (pkg)` | `h2a design views` | `additif` | — | — | namespacé |

### knowledge (graphify) → h2a knowledge

| Commande existante | Cible h2a (alias court) | Module R6 | per-host | hermes | Statut |
|---|---|---|---|---|---|
| `graphify . build (--update/--mode deep)` | `h2a knowledge ingest <path>` | `additif` | — | — | namespacé |
| `graphify query (path/explain/summary)` | `h2a knowledge query <q>` | `additif` | — | — | namespacé |
| `graphify serve/watch/clone/merge-graphs` | `h2a knowledge graph` | `additif` | — | — | namespacé |
| `graphify profile / ontology` | `h2a knowledge ontology` | `additif` | — | — | namespacé |
| `graphify studio export` | `h2a knowledge export` | `additif` | — | — | namespacé |
| `graphify agent-stats {sync,sessions,wp}` | `h2a knowledge agents` | `additif` | — | — | namespacé |

### agent-stats (@sentropic/agent-stats) → h2a agent stats

| Commande existante | Cible h2a (alias court) | Module R6 | per-host | hermes | Statut |
|---|---|---|---|---|---|
| `@sentropic/agent-stats-core (lib)` | `consommé par h2a (dep optionnelle)` | `additif` | — | — | direct |
| `agent-stats stats <id>` | `h2a agent stats <id>` | `additif` | — | — | namespacé |
| `agent-stats report` | `h2a agent stats <id> --report` | `additif` | — | — | namespacé |
| `agent-stats anomalies` | `h2a agent stats <id> --anomalies` | `additif` | — | — | namespacé |
| `agent-stats clean` | `h2a agent stats … --clean` | `additif` | — | — | namespacé |
| `agent-stats analyze` | `h2a agent stats <id> --analyze` | `additif` | — | — | namespacé |
| `agent-stats web (estate-wide)` | `h2a agent stats --all / stp agent-stats web` | `additif` | — | — | **OPEN** |

---

## Synthèse

- **Total commandes mappées : 255** — h2a 90 · remote 93 · track 34 · harness 14 · design 11 · knowledge 6 · agent-stats 7.
- **OPEN (Fabien à trancher) : 3**
  1. `remote agents ls` → `h2a ls` (mes instances) vs `h2a find` (pairs du bus) — taxonomie.
  2. `remote check`/`smoke` → `h2a host check` vs `h2a <profile> check` (collision avec `dev check`).
  3. `agent-stats web` → toit estate-wide cross-vendor orphelin (stp déprécié).
- **Résolus par la nouvelle grammaire (ex-OPEN) :** transport HTTP ex-bus → `h2a serve` (état) / `h2a relay …` (livraison) ; `remote jobs decide`/`conduct` → `h2a job …` (le namespace `agent` disparaît, profils top-level).
- **Par module R6 :** `cli` 16 · `h2a-core` 66 · `relay` 9 · `runtime` 48 · `llm-gateway` 5 · `llm-mesh` 13 · `hosts` 27 · `loop` 14 · `track` 33 · `additif` 24.

Chemins de sortie :
- `docs/specs/2026-06-28-h2a-command-mapping-v2.md`
- `…/scratchpad/semantic-focus/mapping.html`
