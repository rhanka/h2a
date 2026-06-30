# Refactoring h2a — proposition à scopes bornés (double consensus Opus-4-8 max + Codex 5.5 xhigh)

Status: PROPOSAL réconciliée (2026-06-28). Brainstorm STUDY réversible. Intègre les 7 retours Fabien.
Convergence forte des deux pairs ; divergences adjugées notées.

## R5 — Définitions & principes (le point confus, résolu) — 3 axes orthogonaux + accès LLM

| Terme | En une phrase | Owne | Lib |
|---|---|---|---|
| **SERVER** | **Où vit l'état** : bus du workspace — présence, inbox, sessions, élection conductor, gouvernance/RACI/NHI. **Pas de LLM.** | la vérité du workspace | `@sentropic/h2a-core` |
| **RELAY** | **Comment ça circule** : transport bête A→B quand pas de chemin direct (wake local-tmux, forward). **Stateless, ne décide rien.** | la livraison | `@sentropic/relay` |
| **LOOP** | **Quand/pourquoi un agent agit** : maintient *un* agent en action vers un objectif à travers les cycles de réveil (drumbeat). | la cadence d'un agent | `@sentropic/loop` |
| **GATEWAY** | **Data-plane LLM** : endpoint HTTP qui proxy N comptes, traduit formats & mappe modèles, *par requête*. | l'abstraction provider | `@sentropic/llm-gateway` |
| **LLM-MESH** | **Control-plane LLM** au-dessus des gateways : enroll/pool/fallback/lifecycle — *« quel compte, où »*. **Ne proxy pas lui-même.** | le choix de compte | `@sentropic/llm-mesh` |

**Composition :** LOOP fait agir l'agent → l'agent émet via SERVER → SERVER utilise RELAY pour réveiller un pair endormi → les appels LLM du pair passent par MESH→GATEWAY.
**Principe anti-confusion :** SERVER ≠ proxy LLM · RELAY ne décide pas · MESH ne lance pas d'agents · GATEWAY ne choisit pas le compte (c'est MESH).

## R6 — Scopes bornés : 8 modules (frontière en 1 ligne)

1. **`h2a-cli`** — UX SEULE : argv → appel lib, profils-hôtes, alias, mapping, help, compat. **Owne 0 logique.**
2. **`@sentropic/h2a-core`** (SERVER) — état workspace : présence/inbox/sessions/conductor + RACI/NHI. *État, ni transport ni exéc.*
3. **`@sentropic/relay`** (RELAY) — transport wake/message (local-tmux + forward). *Bytes A→B, stateless.*
4. **`@sentropic/runtime`** (EXEC) — **`ExecBackend {local, container, pod}`** : greywall réimplémenté (container) + frontière k8s (pod) + tunnel/sync. *« Où tourne un process ».*
5. **`@sentropic/llm-gateway`** (GATEWAY) — data-plane LLM (proxy/traduction/mapping modèles).
6. **`@sentropic/llm-mesh`** (MESH) — control-plane LLM (comptes/pool/fallback/sélection).
7. **`@sentropic/hosts`** (ADAPTERS) — contrat `HostAdapter` + impls + capability-matrix.
8. **`@sentropic/loop`** (LOOP) — drive objective-loop (stop conditions, resume policy).

Hors périmètre (inchangé) : **track = lib record-only** (surface = `h2a decision` + record) ; design/graphify/agent-stats **additifs** (gardent leur CLI) ; **stp supprimé** (0 caller).

## R2≡R3 — Le pari structurant (sandbox = k8s = local)

**Insight clé (Opus) :** sandbox conteneurisée et exéc-distante NE SONT PAS deux abstractions — c'est juste *où tourne un process*. → **un seul `ExecBackend`** à 3 impls (`local` défaut · `container` = greywall réimplémenté · `pod` = k8s). h2a n'expose qu'un **flag composable `--sandbox[=profile]`** / `--remote` ; il construit une `RunSpec`, sentropic exécute. h2a n'importe **jamais** kubectl.
- **R2 greywall** : pas adopté tel quel ; réimplémenté comme l'impl `container` ; profil = {image, mounts, net-policy, caps, secret-scope}.
- **R3 k8s→sentropic** : Pod orchestration / control-plane / tunnel / workspace-sync / lineage → impl `pod`. Reste UX h2a-cli : les **verbes seuls**.
- **Divergence adjugée** : Codex scindait `runtime-sandbox` + `runtime-k8s` (2 modules) ; Opus unifiait en `runtime` (1 interface). **Retenu : 1 interface `ExecBackend`** (frontière conceptuelle plus nette = scope plus limité), impls `container`/`pod` possibles en sous-packages internes.

## R4 — HostAdapter (un seul contrat, pas un module par hôte)

**Contrat minimal :** `detect()` · `launch(spec)` · `resume(id)` · `headless(spec)` · `installHooks()` · `mcpConfig()` · `capabilities()` · `translateCommand()`. Chaque méthode peut déclarer *none* → h2a **dégrade** (pas de hooks ⇒ wake par polling). Headless-only = adapter valide.
**Plan d'extension (ROI + proximité) :** ① claude/codex (réf, migrer les wrappers) → ② gemini → ③ **opencode + clawcode** (OSS, MCP-natif, friction basse) → ④ agy + **Hermes (headless-only**, API ; sert aussi de host de référence pour la colonne d'équivalence).
**CUT :** pas de parité exigée ; pas de plugin-SDK public V1 ; pas d'auto-discovery complexe.

## R1 — Ergonomie : alias courts + 2 colonnes

**Règle de routage :** `h2a <profil> <verbe>` quand le sujet est un **agent-hôte** ; `h2a <noun> <verbe>` quand le sujet est une **capacité h2a** ; **bare-verbe** quand c'est quotidien ET non ambigu.
- **Profil = top-level** : `h2a codex …` / `h2a claude …` / `h2a gemini …` / `h2a agy …` (`run|resume|headless|hook|mcp`). → **tue `h2a agent run codex`**.
- **Bare** : `h2a decision`, `h2a send`, `h2a inbox`, `h2a wake`, `h2a loop`, `h2a run`, `h2a attach`. → **tue `h2a track decision`**.
- **Namespace** réservé aux familles admin rares : `h2a mesh`, `h2a gateway`, `h2a relay`, `h2a nhi`, `h2a conductor`.

**Le mapping passe à 4 colonnes :** `commande existante | cible h2a (alias court) | per-host | hermes`.
- **per-host** = réalisation native par hôte (ex. `h2a decision` → Claude=skill *present-decision*, Codex=`/decision` ; `h2a claude` → spawn `claude` + hooks + MCP).
- **hermes** = commande NousResearch Hermes équivalente (ex. `h2a codex run` → `hermes run --agent codex`) ou `—` (h2a-natif = cœur irréductible).

## Ce qu'on CUT / DIFFÈRE (rester minimal)
stp supprimé · modes gateway team/cloud **différés** (solo data+control d'abord) · scheduling multi-cluster différé · gouvernance-en-module-séparé différée · bare-alias auto-route (déjà PARKED) · marketplace de policies sandbox / UI sécurité (CUT) · plugin-SDK public (CUT V1).

## Divergences résiduelles à trancher (Fabien)
- **Granularité runtime** : 1 `ExecBackend` (retenu) vs 2 modules `runtime-sandbox`+`runtime-k8s`.
- **gateway/mesh** : gardés **séparés** (2 libs distinctes, définitions nettes) — Opus proposait de les fusionner en `@sentropic/llm` ; **retenu séparés** car c'est précisément la distinction que tu trouvais confuse.
