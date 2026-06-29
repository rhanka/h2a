# h2a — Sémantique par finalité (spec v1, à challenger)

Status: SPEC pour double consensus (Opus-4-8 max + Codex 5.5 xhigh). Date: 2026-06-28. PRINCIPAL: Fabien.
Remplace la découpe « 8 libs » jugée confuse. Principe : organiser **par finalité**, et dire **quelle fonction → quelle lib**.

## 0. Principe directeur — h2a est PETIT
h2a ne possède que **2 briques** ; tout le reste = **libs sentropic existantes** qu'il **consomme** (pas de recréation, pas de cycle).
- **`h2a-cli`** *(déployé, ce qu'on construit)* — les verbes + l'UX + **l'agent h2a natif** + le lancement des hosts.
- **`@sentropic/h2a-core`** *(le bus, existe déjà)* — présence, inbox, sessions, négociation, conductor, **objective-loop**, gouvernance.
- **`@sentropic/track`** *(existe déjà)* — le record du travail (record-only).
- **Libs consommées (existent, jamais recréées)** : `@sentropic/llm-gateway`, `@sentropic/llm-mesh`, le **runtime d'exécution** (ex-remote : k8s / conteneur / tunnel / sync), `@sentropic/harness`, design-system, graphify, agent-stats.

## 1. Terminologie (lever l'ambiguïté « la cli »)
- **`h2a` = la CLI** : l'outil + le cadre d'organisation centré humain.
- **l'agent h2a** = l'agent natif que la CLI lance, au **même rang** que `claude`/`codex` :
  - **`h2a`** (sans argument) → **nouvelle session** chat/code (l'agent h2a, ≈ Claude Code / Hermes).
  - **`h2a --resume`** → reprend la session de l'agent h2a.
  - h2a sait lancer **SON** agent **et** les autres hosts.

## 2. Les 4 finalités — fonction → surface → lib

### Finalité 1 — COORDONNER (humains ↔ agents)
| Fonction | Surface h2a | Lib |
|---|---|---|
| qui est là — **connectés + gérés** (lancés via h2a) | `h2a ls` | h2a-core |
| messagerie / boîte | `h2a send` · `h2a inbox` | h2a-core |
| négociation inter-agent + signatures | `h2a nego …` | h2a-core |
| **décision humaine** (canevas / focus) | `h2a decision` · canevas | h2a-core *(sémantique)* + design-system *(rendu)* |
| conducteur (élection) + réveil/relance | `h2a conductor` · `h2a wake` | h2a-core |
| **objective-loop** — pousser un/des agents vers un objectif | `h2a loop …` | **h2a-core** *(moteur)* **+ track** *(l'objectif = refs track)* |
| gouvernance RACI / anti-COI | `h2a org` · nego | h2a-core |

### Finalité 2 — EXÉCUTER des agents
| Fonction | Surface h2a | Lib |
|---|---|---|
| **l'agent h2a natif** (code + tâches tout-type) | **`h2a`** (bare) · **`h2a --resume`** | **h2a-cli** |
| lancer un autre host | `h2a codex` · `claude` · `gemini` · `agy` · `opencode` · `clawcode` · `hermes` | h2a-cli *(host-adapters)* |
| attacher / réveiller / stopper / reprendre | `h2a attach` · `wake` · `stop` · `resume` | h2a-cli (+ h2a-core pour wake) |
| déléguer une tâche headless | `h2a delegate` · `h2a job …` | h2a-cli → runtime |
| **où ça tourne** : local / conteneur / k8s | flags `--sandbox` · `--remote` | **runtime** *(lib sentropic, ex-remote)* |

### Finalité 3 — SUIVRE le travail
| Fonction | Surface h2a | Lib |
|---|---|---|
| décisions / état / acceptation / blockers | `h2a decision` · `report` · `accept` · `blocker` | **track** *(record-only)* |

### Finalité 4 — OUTILLER
| Fonction | Surface h2a | Lib |
|---|---|---|
| méthode dev | `h2a dev …` (brainstorm/plan/review/test/verify) | **harness** |
| connaissance | `h2a knowledge …` | graphify *(additif, garde sa CLI)* |
| design | `h2a design …` | design-system *(additif)* |
| stats d'agents | `h2a agent stats …` | agent-stats *(additif)* |

**Substrat consommé (pas une finalité)** : llm-gateway, llm-mesh, transport, k8s, identité/crypto/NHI = libs sentropic existantes. h2a est un *caller*, jamais un importeur cyclique.

## 3. Placements clés (les points soulevés par Fabien)
- **objective-loop** : pas une lib à part. Moteur = `h2a-core` (coordination/relance) ; l'objectif = des **refs track**. → « track-en-mouvement piloté par la coordination », mais le moteur reste dans core, track ne fait que porter l'état.
- **agent h2a natif** : `h2a` bare ouvre une session (chat/code) comme `claude`/`codex` ; `h2a --resume` reprend. Vit dans `h2a-cli`. C'est l'« agent offert » de la décision B.
- **`h2a ls`** : par défaut **vue unifiée** des agents **connectés** (sur le bus) ET **gérés** (lancés via h2a, agent h2a ou host). Un seul `ls`.

## 4. Ergonomie du mapping (rappel, pour la régénération HTML ensuite)
- Profil **top-level** : `h2a codex|claude|gemini|…` (✗ `h2a agent run codex`).
- Bare pour le quotidien : `h2a decision` (✗ `h2a track decision`), `h2a send`, `h2a ls`, `h2a wake`, `h2a loop`.
- Mapping = 4 colonnes utiles : **commande existante → cible h2a (alias court) → per-host (claude/codex/…) → hermes (équiv. NousResearch)**.

## 5. Questions ouvertes (pour le challenge)
- Q1. La réduction « h2a = cli + core ; tout le reste = libs consommées » tient-elle, ou un concept manque-t-il un home clair (ex. le wake/transport : core, ou lib dédiée) ?
- Q2. objective-loop dans core+track : est-ce le bon partage (moteur core / état track), ou le moteur doit-il être une lib `@sentropic/loop` séparée ?
- Q3. L'agent h2a natif dans `h2a-cli` : ou doit-il être une lib `@sentropic/agent` réutilisable (pour Hermes/headless) ?
- Q4. Les 4 finalités couvrent-elles tout le mapping 255-commandes, ou une finalité manque (ex. « administrer » : keys/nhi/host/deploy/mcp) ?
- Q5. Le runtime (sandbox+k8s) : une lib unique (ExecBackend local/container/pod) ou deux ?
- Q6. Frontière anti-cycle : où exactement h2a-cli s'arrête et la lib commence, par finalité.

---

## 6. Réconciliation challenge (Opus-4-8 max + Codex 5.5 xhigh — 2026-06-28) — modèle v1.1

Verdict des deux = **AMEND** (convergent). « h2a = cli + core » était trop réductif : il laissait orphelins l'auth/identité, l'agent natif, le moteur de boucle, et le mécanisme de wake. Correction : **5 finalités**, et les libs émergent de chaque finalité (cli = surface mince ; le réutilisable-headless = lib).

### 5 finalités (ajout d'ADMINISTRER ; OUTILLER → ÉTENDRE)
| Finalité | Concern | Lib(s) |
|---|---|---|
| **1 · Coordonner** | qui parle/décide/conduit (le bus) | **`@sentropic/h2a-core`** (coordination PURE) + **`@sentropic/loop`** (moteur objectif) + transport-wake h2a |
| **2 · Exécuter** | lancer/piloter un agent, où qu'il tourne | **`@sentropic/agent`** (agent natif réutilisable) + host-adapters *(cli)* + **`@sentropic/runtime`** (ExecBackend) |
| **3 · Suivre** | l'état/record du travail | **`@sentropic/track`** |
| **4 · Administrer** ⭐ NOUVEAU | identité, auth, clés, NHI, hosts, deploy, MCP, liveness | **`@sentropic/identity`** (auth/keys/NHI/DCR/per-user-root/sign — **le déblocage h2h2a**) + admin host/deploy/mcp |
| **5 · Étendre** | extensions additives | harness · design-system · graphify · agent-stats *(gardent leur CLI)* |

### Extractions (ce qui sort de cli/core — règle : sans-TTY ⇒ lib)
- **`@sentropic/agent`** — la boucle agent (tool-calling, mémoire, resume, sandbox, streaming, appel llm-gateway). cli = shell interactif par-dessus ; `delegate`/`job`/Hermes la réutilisent headless. *(évite la divergence interactif/headless)*
- **`@sentropic/loop`** — moteur objective-loop (relance, convergence, poussée multi-agents, stop conditions) ; consomme core+track ; l'état reste dans track.
- **`@sentropic/identity`** — auth/keys/NHI/DCR/login multi-tenant/per-user-root/sign+revoke+audit. **Sans ça, négociation/anti-COI/wake-remote/delegate-sandbox sont des façades.**
- **`@sentropic/runtime`** — **une** lib, `ExecBackend {local, container, pod, remote}` (greywall=container ; k8s=pod ; tunnel/sync = internes). Pas de fragmentation avant interface stable.

### Frontières strictes (anti-cycle, Q6)
- **`h2a-cli`** = parsing + UX + rendu + config locale + invocation + spawn de process host + câblage tmux/pane. Rien de réutilisable-headless.
- **`@sentropic/h2a-core`** = coordination PURE (présence/inbox/sessions/conductor/négociation). **N'exécute pas, ne stocke pas durablement, ne gère pas l'identité, ne connaît pas k8s. Ne dépend jamais de cli/runtime, ni de track comme moteur** (référence des IDs track, n'importe pas sa logique).

### `decision` — double-listing résolu
**Un seul verbe** `h2a decision` = le **moment de décision humaine** (sémantique core + rendu design-system) qui **enregistre** vers track. *Décision active = coordination ; record/audit/acceptance = track.* Collaboration, pas deux entrées.

### `wake` — explicité en 3
- **décision** de réveiller (conductor) = `h2a-core`.
- **mécanisme** (local-tmux, pane-detect, **human-typing guard**) = code h2a-PROPRE (pas un substrat générique) → lib transport-wake h2a-owned.
- **surface** = `h2a wake` *(cli)*.

### gouvernance / anti-COI
Une **couche** (élection conductor, missionnement, conflit-intérêt, gatekeeper des wakes) à frontière propre — **pas diluée dans core** (sinon core gonfle). Candidate : module `governance` consommant core+identity.

**Statut : modèle v1.1 — 5 finalités, libs par concern.** À régénérer dans le mapping HTML.
