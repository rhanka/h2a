GO-CODE
Reviewer: astra-max

Aucun P1/P2. Le lot couvre le défaut : métadonnées REST, SHA immuables, comparaison des manifests et grant release conservés, périmètre limité aux deux fichiers nécessaires. Les tests existants cités vérifient effectivement bump publié, non-bump et package privé.

- **P3 — `docs/specs/guard-prbump-gh-field/SPEC_EVOL_GUARD_PRBUMP_GH_FIELD.md:48` et `:130` : expliciter le contrôle de type.** Le rejet des SHA non textuels est bien exigé en §2, mais la regex actuelle (`packages/h2a/hooks/workspace-scope-shell.mjs:525`) accepte `["a".repeat(40)]` par coercition. Correction minimale : préciser `typeof sha === 'string'` avant la regex conservée et ajouter ce tableau aux cas `UNVERIFIABLE`.
- **P3 — `docs/specs/guard-prbump-gh-field/SPEC_EVOL_GUARD_PRBUMP_GH_FIELD.md:20` : ordre des grants inexact.** Le grant de scope est évalué à `packages/h2a/hooks/workspace-scope-guard.mjs:259`, avant `prBump` à `:268`. Correction minimale : remplacer « before any grant is evaluated » par « avant l’évaluation du grant release associé au bump, après l’autorisation de scope éventuelle ».

Vérification sur `HEAD = origin/main = dc78dc5f79cb25bbb6012229905ebe9aaa6b58f3` : fonctions exactes exécutées en mémoire avec `spawnSync` simulé. Le faux `gh` rejetant le champ produit `undefined` pour les trois scénarios ; l’assertion non-bump attendu `false` échoue bien avant correction. Le faux `gh` historique donne respectivement `true`, `false`, `false` pour bump publié, non-bump et privé. Conserver l’assertion d’autorisation entre RED et GREEN. GREEN et gate complet restent à exécuter après implémentation. Aucun état réel ni clé consultés.
