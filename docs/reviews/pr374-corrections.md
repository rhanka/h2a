# PR #374 — preuves du tour de correction

Base relue : `dbf06214a`. Branche : `feat/track-report-stage-status`.
Les deux revues `rev374a-last.md` (A) et `rev374s-last.md` (S) sont
réconciliées ci-dessous. Aucun accès à l'état h2a réel, aucun binaire h2a
installé, aucune écriture Track du dépôt, aucun processus tiers arrêté.

| Finding | Correction / commit | Preuve rouge → verte |
|---|---|---|
| A1 / S8 : résolution sans contexte | `e73bfe9` : horloge, baseline complète, scope, sous-WP, acceptation et révision dans la commande imprimée | R1 : commande obsolète acceptée et `--now` absent → résolution stable puis refus après changement du journal |
| A3 / S1 : audit lexical, origine perdue | `e73bfe9` : métadonnées d'instruction et d'origine conservées, codes de gate séparés | R2 : 5 cas rouges → traductions FR/ES/JA/AR équivalentes, action instruite reconnue |
| A2 / S3 : ancienne proposition absente du servi | `e73bfe9` : proposition instruite par item, présence dans action et recommandation, aucun certificat issu du stocké | R3 : 3 cas rouges → ancien/absent/à-instruire refusés ; 5 contrôles supplémentaires des deux sections et des doublons |
| A4 / S4 : retraits après `--until` | `e73bfe9` : même fenêtre résolue que FAIT et le payload `period` | R4 : 2 cas rouges, avec et sans `--now` → retrait hors borne omis |
| A5 / S5 : recommandation confondue avec choix | `e73bfe9` : motif lu depuis `selectedOptionId` | R5 : motif « conserver » au lieu de « retirer » → résumé de l'option choisie |
| S6 : retrait avec gate sans motif | `e73bfe9` : enrichir toutes les projections existantes du retrait | R6 : 2 cas rouges → motif ou absence visible ; cas parent/sous-WP rouge séparé → motif dans les deux projections |
| A6 / S7 : contrat perdu sans WP | `e73bfe9` : quatre sections, sept colonnes et `outside-wp`, même avec forêt vide | R7 : 3 formats rouges → verts ; cas bibliothèque sans options WP rouge séparé → item présent |
| A7 / S9 : recette antérieure au même instant | `e73bfe9` : ordre du journal pour chaque run courant | R8 : ancien pass requalifiait à tort → seuls les runs postérieurs à la réouverture requalifient |
| A8 : texte de demande perdu | `e73bfe9` : source immutable + provenance `demand-raw` / `legacy-title` | R9 : 3 langues rouges → source et promotion 1→N préservées |
| A9 / S2 : installation multi-hôtes rouge | `7dded1d` : quatre skills Track, rapport canonique dans harness | `4 !== 5`, 16/17 → 17/17, zéro saut |
| A10 : exemple brut et compte rendu tronqué | commit des artefacts de ce rapport : fixture reproductible, quatre synthèses contextualisées, preuve complète | exemple : `5 !== 0` et troncature → 2/2 ; acceptation froide indépendante et jugement humain **restent à faire** |

Les cas R1–R9 résident dans
`packages/track/src/read/report-review-regressions.test.ts`.

## Commandes et sorties observées

Les tests ont tourné sur Node `22.22.1`, avec HOME et XDG temporaires,
et chaque journal dans un `mkdtemp`. Les logs locaux complets sont sous
`tmp/rev374/` (ignoré par Git). Les erreurs de bootstrap sans dépendances
ne sont pas comptées comme preuves rouges.

| Commande exécutée | Sortie significative / code |
|---|---|
| `node node_modules/vitest/vitest.mjs run --root packages/track src/read/report-review-regressions.test.ts` avant correction | `22 failed (22)`, code 1, zéro saut |
| même fichier, ajout du cas bibliothèque avant son correctif | `1 failed`, code 1 ; filtre explicite sur ce seul cas |
| même fichier, ajout du cas retrait sous-WP avant son correctif | `1 failed / 28 passed`, code 1, zéro saut |
| `node --test packages/h2a/test/install-skills-hosts.test.js` avant correction | `pass 16 / fail 1 / skipped 0`, `4 !== 5`, code 1 |
| même commande après correction et build du checkout | `pass 17 / fail 0 / skipped 0`, code 0 |
| `node --test scripts/track-report-stage-status-example.test.mjs` avant correction des artefacts | `pass 0 / fail 2 / skipped 0`, `5 !== 0` et troncature, code 1 |
| même commande après génération | `pass 2 / fail 0 / skipped 0`, code 0 |
| `node scripts/uat-track-report-stage-status.mjs docs/specs/examples` | `6 period cases; fr/es/ja/pt: actions=0 owed, proposals=OK; journal mutations=0`, code 0 |
| `npm run build` | `vendor-engram-live mirror OK`, code 0 |
| `npm run typecheck` | code 0 |
| `npm run typecheck -w @sentropic/track` | code 0 |

Commande verte ciblée, exécutée depuis `packages/track` :

```bash
node ../../node_modules/vitest/vitest.mjs run \
  src/read/report-review-regressions.test.ts src/read/owner-report-contract.test.ts \
  src/read/commands.period.test.ts src/read/commands.scope.test.ts \
  src/report/validated-report-shape.test.ts src/report/audit.test.ts \
  src/report/stage-status.test.ts src/report/owner-report-language.test.ts \
  src/report/stage-status-lexicon.test.ts src/report/status-by-level.test.ts \
  src/report/report-modes.test.ts src/report.test.ts src/wp-codes-golden.test.ts \
  src/report/friendly-snapshot.test.ts src/report/directive.test.ts \
  src/cli/install-skills.test.ts
```

Sortie : `Test Files 16 passed (16)`, `Tests 269 passed (269)`, code 0,
zéro saut. Dont 29 cas dans le fichier des régressions de revue.

## Préservation, écarts et non-couvert

- Aucun golden ni snapshot régénéré ; les deux exemples historiques restent
  byte-identiques. L'ancien test de golden lancé depuis la racine avait créé
  une copie non suivie ; elle a été retirée et la vérification relancée depuis
  `packages/track`, contre le golden réellement suivi.
- Adaptations déclarées de tests protégés : commande imprimée désormais
  complète (`commands.scope`, `validated-report-shape`), certificat de
  proposition sur le servi (`audit`, `owner-report-contract`). Les assertions
  de résultat sont conservées ou renforcées. Quatre erreurs de types de tests
  ont été corrigées : options du présentateur inline et accès potentiellement
  absents ; elles ne sont pas comptées comme régressions rouge/verte.
- Aucun nouveau périmètre fonctionnel. Les nouveaux scripts et traductions
  servent uniquement l'exemple et la qualification du lot 6.
- L'exercice contextualisé est écrit par l'agent de correction : il ne prouve
  ni une acceptation par un agent froid indépendant ni le jugement humain de
  la proposition/traduction. A10 est amélioré et vérifiable, **pas déclaré clos
  pour ces deux gates**. Le confinement interdit le lancement du mesh installé ;
  aucun consensus indépendant additionnel n'est revendiqué.
- Non couvert localement : suite complète, Node 24, état owner réel,
  vérification de fournisseur/déploiement et nettoyage de skills sur les hôtes.
  La suite complète appartient au conducteur d'intégration ; la CI vérifie
  les jobs Node 22/24 sur la tête poussée. L'état CI final est rapporté avec
  le SHA et les checks effectivement observés, jamais extrapolé du local.
