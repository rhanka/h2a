# Lot 4 — étape 2d : stillHeld

## Objectif et base

Branche `lot4/2d-still-held`, depuis `origin/main` à
`dd52059c13c16a62b65b8fe9fc2736bd2b1c8b9a`.
Référence : `docs/specs/2026-09-26-SPEC_lot4-identity-succession-lock.md`, §3, §4 et §8.

## Périmètre

- `packages/h2a/src/runtime/local-files/succession-lock.ts`
- `packages/h2a/src/runtime/upgrade/index.ts` : bail de refus conforme au type.
- `packages/h2a/test/succession-lock-still-held.test.js`
- `packages/h2a/test/upgrade-runtime-hooks-compat.ts` : double de bail conforme.
- `BRANCH.md`

Aucune migration du binding, aucun changement du store réel, de `.track`,
des dépendances ou des versions. Pas de PR ni de fusion.

## Livraison

- [x] Ajouter `stillHeld(): boolean` à tous les baux.
- [x] Confirmer le token par lecture fraîche, sans sonde de vivacité ni écriture.
- [x] Refuser après release, token différent, absence, corruption, legacy ou lecture incertaine.
- [x] Préserver le LOCK gagnant lors d'une release périmée.

## Validation

- RED : 6 tests nouveaux, 0 réussite, 6 échecs (`stillHeld` absent).
- GREEN : 6/6 nouveaux tests réussis.
- Ciblés : `node --test packages/h2a/test/upgrade*.test.js packages/h2a/test/succession-lock*.test.js`
  — 124 tests, 123 réussites, 1 ignoré, 0 échec.
- `npm run build` : réussi.
- `npm run typecheck` : réussi.
- `npm test` : réussi. Node : 267 fichiers, 2 430 tests,
  2 387 réussites, 21 ignorés, 22 TODO, 0 échec.
  Track : 87 fichiers, 1 193/1 193 tests réussis.
- Une campagne ciblée intermédiaire a chevauché le nettoyage de dist par le build
  de `npm test` : 1 échec de démarrage d'enfant. La campagne finale, après la
  reconstruction, passe intégralement sans changement de code.
- Journaux locaux : `tmp/2d-red.log`, `tmp/2d-targeted-final.log`,
  `tmp/2d-build.log`, `tmp/2d-typecheck.log`, `tmp/2d-full.log`.

## Unverified

CI distante et revue indépendante non exécutées. macOS réel, isolation PID de
la flotte et transition multi-versions non vérifiés ; limites de §9 conservées.
