GO-CODE
Reviewer: sol-max

Aucun P1/P2. Vérifié contre `HEAD = origin/main = dc78dc5f7` : le chemin REST proposé supprime le champ incompatible, conserve les SHA immuables, la lecture paresseuse via `read()`, les limites existantes et le contrat `true` / `false` / `undefined`. Le bump publié reste soumis au grant release distinct ; aucun changement du guard n’est nécessaire. Les tests existants cités couvrent bien bump publié, package privé et métadonnées imbriquées.

- P3 — `docs/specs/guard-prbump-gh-field/SPEC_EVOL_GUARD_PRBUMP_GH_FIELD.md:101` : l’ordre demande le RED avant la modification du faux `gh`, pourtant nécessaire à sa reproduction. Correction minimale : modifier la fixture d’abord, puis exécuter sur le code actuel le test qui attend l’autorisation du non-bump ; il doit échouer avec `UNVERIFIABLE`, puis passer après le correctif. Ne pas conserver une assertion attendant le refus comme test de régression.
- P3 — `docs/specs/guard-prbump-gh-field/SPEC_EVOL_GUARD_PRBUMP_GH_FIELD.md:20` : « before any grant is evaluated » est inexact pour une requête étrangère : `workspace-scope-guard.mjs:257` évalue son grant de scope avant `prBump`. Correction minimale : écrire « avant l’évaluation du grant release lié au bump ».
- P3 — `docs/specs/guard-prbump-gh-field/SPEC_EVOL_GUARD_PRBUMP_GH_FIELD.md:130` : ajouter un SHA non-string aux cas invalides, par exemple `sha: ['a'.repeat(40)]`. La regex seule accepte ce tableau par coercition ; le test doit imposer le contrôle `typeof sha === 'string'` demandé au §2.

Vérification exécutée en mémoire sur les fonctions actuelles, avec `spawnSync` simulé : champ refusé → `undefined` sans lecture des manifestes ; métadonnées valides → non-bump `false`, bump publié `true`, privé `false`. Aucune exécution de `gh`, aucune lecture d’état réel ou de clés. Suite complète non exécutée ; le GREEN REST reste à réaliser pendant l’implémentation.
