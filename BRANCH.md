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
des dépendances ou des versions. Pas de PR ni de fusion vers main.

## Actualisation demandée par h-cond

`origin/main` à `4a314f785ba9d590db4ad626fd88bcc37a9435ab` a été mergée
dans 2d. Le conflit de `BRANCH.md` conserve le plan de 2d ; le delta produit
de 2d est inchangé. Les fichiers ajoutés sur main, dont
`scripts/uat-h2a-run-launch.mjs`, sont conservés. Le journal Track est identique
sur les deux parents et le résultat ; aucune écriture Track n'est effectuée.

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

## Campagne après actualisation

- `npm run build` et `npm run typecheck` : réussis.
- Ciblés upgrade et succession-lock : 124 tests, 123 réussites,
  1 ignoré, 0 échec, 0 annulation, 0 TODO.
- `pty-native-messaging.test.js` : 5 tests, 5 réussites, 0 échec.
- Première campagne `npm test` : code 124. Node interrompu à la borne
  existante de 600 000 ms, sans décompte final ; `loop-tick-cli.test.js`
  reste actif dans les sondes du registre des sessions locales.
  Signature : `Node test suite HUNG — the test run exceeded 600000ms and was killed`.
  Track : 87 fichiers, 1 193 tests, 1 192 réussites, 1 échec :
  `track focus > renders the decision dossier to the terminal (default format) — contains the title + outcome`,
  dans `packages/track/src/cli/focus.test.ts:61`, signature
  `Test timed out in 5000ms.`
- Reproductions de `loop-tick-cli.test.js` : 9/9 avec un registre isolé,
  puis 9/9 avec le registre et la socket isolés, sans modification des assertions.
- Deuxième campagne `npm test`, registre et socket isolés : code 124,
  même signature de borne Node à 600 000 ms ; aucun décompte final Node.
  `m02-drive-characterization.test.js` reste actif avec son hôte natif de fixture,
  dont la socket existe mais pas les fichiers de l'observateur.
  Track : 87 fichiers, 1 193/1 193 réussites.
- Reproduction M02 isolée avec un reporter de progression : les 4 tests
  exécutables passent ; 6 scénarios TODO demeurent. Aucun blocage reproduit
  hors campagne complète. Le journal de la campagne n'émet pas de verdict
  individuel pour le fichier bloqué ; aucun nom d'assertion en échec n'est inventé.
- 269 fichiers Node et 87 fichiers Vitest découverts dans chaque campagne.
  Aucun changement du runner, des délais, de la concurrence ou des assertions.
- Journaux : `tmp/h-cond-refresh/` (`results.json`, `full.log`,
  `full-isolated.log`, `full-isolated-result.json`, reproductions de boucle).

## Limites après actualisation

CI distante et revue indépendante non exécutées. macOS réel, isolation PID de
la flotte et transition multi-versions non vérifiés ; limites de §9 conservées.
