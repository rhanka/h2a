# P5-prep — carte de merge remote-cli → h2a-cli (design réversible)

Status: DESIGN (P5-prep, réversible). Date: 2026-06-29. WP-MIG / P5.
Principe (consensus + P5.a vérifié) : h2a-cli **possède le VERBE + l'UX** ; l'exécution (k8s/Pod/tunnel/sync) est **déléguée aux libs sentropic consommées** (neutres, sans dépendance retour → pas de cycle). Les sessions Pod en cours = intouchées.

## Groupes remote → surface h2a-cli → lib déléguée
| Groupe remote-cli | Surface h2a (cible) | Lib déléguée (consommée) |
|---|---|---|
| **lancement/cycle de vie** : run · resume · attach · stop · logs · restart · suspend · start · rename · restore · relaunch · resume-throttled | `h2a run <cli>` · `resume` · `attach` · `stop` · `logs` · `ls` | `@sentropic/remote-k8s-orchestrator` (Pod) + runtime |
| **workspace/sync/migrate** : workspace · sync · sync-status · sync-files · sync-skills · push · pull · forward · tunnel · to-remote · to-local | `h2a workspace` · `sync` · `migrate` · `forward` (`--host`/`--session`) | runtime (k8s/tunnel/sync) |
| **config/host** : set · show · token · target · tools · tmux-profile · refresh | `h2a config …` (global, `--host`) | h2a-cli (config locale) |
| **auth/identité** : enroll · secrets · select · rm-binding · push-cluster · token | `h2a auth …` (enroll/secrets/account/mesh) | module identité de `@sentropic/h2a` + `@sentropic/llm-mesh` |
| **plugin** : plugin · sync-skills | `h2a plugin …` | h2a-cli |
| **LLM gateway/mesh** : (llm-mesh start/stop/logs/status) | `h2a gateway …` / `h2a auth mesh …` | `@sentropic/llm-gateway` · `@sentropic/llm-mesh` |
| **bus bridge** : h2a · wake-request · relaunch · ping | `h2a wake` · `h2a ping <instance>` · `h2a wake --relaunch` | `@sentropic/h2a` (core) + bridge Pod |
| **état** : status · ls | `h2a ls` · `h2a status` | core + runtime |

## Invariants merge (vérifiables)
1. **Anti-cycle** (P5.a) : `remote-cli` ne dépend que de `@sentropic/llm-gateway` aujourd'hui ; en migrant les handlers dans h2a-cli, h2a-cli → libs runtime (sens correct), jamais l'inverse. Garde CI déjà en place.
2. **Sessions intouchées** : les Pods tournent ; seul le front CLI bascule. P7 canary prouvera que `remote` et `h2a` listent/attachent/reprennent les mêmes sessions.
3. **Délégation** : h2a-cli construit une `RunSpec`/intention ; la lib runtime exécute (h2a n'importe jamais kubectl).
4. **Compat** : binaire `remote` = shim → `h2a …` (P6), alias maintenus, warn doux après stabilité.

## Réversibilité
Pure cartographie + routing. L'**intégration effective des handlers**, le **shim `remote`**, le **canary** et l'**IAM bridge Pod** = P5/P6/P7 exécution → décisions irréversibles-produit (réservées Fabien) ou infra. Ici on fige la carte.
