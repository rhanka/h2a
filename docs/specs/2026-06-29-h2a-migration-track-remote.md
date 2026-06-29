# Migration track + remote → h2a — spec & plan

Status: PLAN ACTIF (autonome). Date: 2026-06-29. PRINCIPAL: Fabien.
Double consensus Opus-4-8max + Codex-5.5xhigh = **convergent**. Décisions tech tranchées en autonomie ; décisions **irréversibles-produit** réservées à Fabien (§Décisions, groupées en fin de migration).
Lié : `2026-06-28-h2a-finalites-spec.md` (modèle), `2026-06-29-h2a-mapping-validation-notes.md` (mapping figé), artefact `docs/focus/h2a-mapping.html`.

## Objectif
Consolider en **une CLI unique `h2a`** : `remote` (CLI ~93 cmds, runtime k8s/sandbox + bridge Pod) **mergé dans `@sentropic/h2a-cli`** ; `track` (record-only) **absorbé sous gouvernance h2a** (surface `h2a decision/report/...`). Libs LLM (gateway/mesh) + runtime k8s = **libs sentropic consommées**, jamais ré-écrites.

## Principes (consensus)
1. **track d'abord, remote ensuite** — track = record-only, risque quasi-nul, et fournit le **journal de décision/provenance pour piloter la migration de remote** (dogfooding). remote = pièce vivante haut-risque → en second, sur base stable + garde-fous.
2. **Ce n'est PAS un renommage CLI — c'est une migration de CONTRAT PUBLIC.** Bus live (clé `"h2a"`), enveloppes, MCP, sessions : compat garantie.
3. **PIÈGE N°1 = le cycle de dépendance.** L'enveloppe/protocole reste une **lib FEUILLE neutre** consommée par tous (cli, runtime, gateway/mesh). Interdiction absolue qu'une lib protocole dépende en retour de `h2a-cli`/runtime → sinon bus cassé + libs non-buildables.
4. **Pas de big-bang** : chaque phase atomique et réversible, gatée par un **smoke live-bus**.
5. **Sessions remote en cours = intouchées** : elles tournent dans les Pods ; seul le front CLI bascule. Anciens `remote` et nouveaux `h2a` doivent **lister/attacher/reprendre les MÊMES sessions** (canary).
6. **record-only préservé** : append-only strict, pas de rewrite, pas de « migration intelligente » des preuves ; toute nouvelle surface h2a écrit **via l'API track**.

## Phases
- **P1 — Figer les contrats.** Mapping 255→h2a (fait, `docs/focus/`), clé bus `"h2a"`, enveloppes, exit codes, formats JSON, politique de dépréciation. Capturer les **golden-fixtures du bus** (trafic MCP réel rejoué en CI, diff=échec) = baseline.
- **P2 — Tests de compat.** Contract-tests CLI↔lib ; version-matrix `h2a-cli` ↔ gateway/mesh/k8s/track ↔ image bridge ; smoke live-bus (un vrai agent connecte, send/receive, assert no-break) gatant chaque release.
- **P3 — track re-owné.** Republier `@sentropic/track` re-owned tel quel ; façade `h2a decision/report/...` déléguant à la lib (record-only intact) ; binaire `track` = shim transitoire.
- **P4 — record-only verrouillé.** Append-only strict ; toute écriture h2a passe par l'API track ; tests de non-rewrite.
- **P5 — remote préparé (sans bascule).** Intégrer les handlers dans `@sentropic/h2a-cli` en délégation vers libs sentropic existantes ; gateway/mesh/k8s restent neutres, consommés, sans dépendre de h2a. Extraire/confirmer l'enveloppe-protocole en **lib feuille** (anti-cycle).
- **P6 — compat remote.** Binaire `remote` = shim → `h2a ...` ; alias maintenus ; warning doux **seulement après stabilité mesurée**.
- **P7 — canary runtime.** Anciens `remote` + nouveaux `h2a` listent/attachent/reprennent les mêmes sessions ; bridge Pod versionné séparément, rollout progressif.
- **P8 — dépréciation par fenêtre explicite.** Retrait des shims `remote`/`track` UNIQUEMENT après matrice verte **+ décision humaine** (cf §Décisions).

## Stratégie de test (P2, transverse)
(a) golden-fixtures du bus (enveloppes MCP réelles rejouées) ; (b) contract-tests CLI↔lib par sous-commande ; (c) version-matrix en CI (libs épinglées + plage de compat) ; (d) smoke live-bus gatant chaque release.

## DÉCISIONS IRRÉVERSIBLES-PRODUIT — réservées à Fabien (groupées, à trancher en fin)
1. Identité publique : `@sentropic/h2a-cli` = LA cli (+ cadence/support des packages `h2a-cli`/`track`).
2. **Suppression** des binaires publics `remote` et `track` + **calendrier** de dépréciation.
3. Mapping figé **255→h2a comme contrat public**.
4. Garantie de compat du **bus live** : clé `"h2a"`, enveloppes, MCP, sessions (toute évolution sémantique).
5. Sémantique **record-only** de track : provenance, rétention, append-only, identité du décideur.
6. **Politique de reprise** des sessions remote existantes.
7. Frontière produit **CLI unique h2a ↔ libs sentropic**.
8. Modèle **sécurité/IAM** du bridge Pod et des runtimes distants.
9. Tout **GC / canonical-root destructeur de données**.

→ Ces 9 ne sont PAS exécutées en autonomie. Tout le reste (frontières internes, shim, layout monorepo, wiring alias, fixtures, version-matrix) = réversible-tech, tranché en autonomie (double consensus si délicat).

## Suivi
Workpackage track `WP-MIG` + spec-phases P1..P8. `/loop` jusqu'à finalisation. Avancement journalisé dans track (dogfooding).
