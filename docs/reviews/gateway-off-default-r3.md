# PR #395 — corrections du round 3

Les deux revues fournies ciblent `aedc3fccbdbd4a190770a4268f74b5eceb121fd2`.
Leurs six lignes représentent quatre défauts distincts, tous reproduits avant
correction. Aucun commit précédent ni gate n'est supprimé ou affaibli.

| Constat | Cause au HEAD reçu et correction |
| --- | --- |
| Astra P1 : flags ignorés avec `claude --local` | `index.ts:863` appelait `run()` sans résoudre le choix ; `run.ts:106` copiait l'environnement pollué. Acquisition explicite avant le PTY, échec avant spawn si indisponible, purge directe au dernier point de création. Les deux alias positifs/négatifs, défaut direct, auth native et restauration du parent sont testés. |
| Sol P1 : consentement repris depuis un autre workspace | `index.ts:5636` ne comparait que convId avant de copier les pins vers une entrée explicite. Comparaison convId/cwd/tool avant toute acquisition ; contrôles même identité, autre cwd/tool et `--no-gw`. |
| Astra/Sol P2 : consentement perdu au renommage | `index.ts:7007` n'enrôlait que le choix CLI, perdant le pin résolu d'une même conversation. Copie mode/provenance prouvés vers la nouvelle ligne. Conserver également l'absence de choix bare : matérialiser ce seul défaut sur la nouvelle ligne créait un conflit à la reprise suivante. Deux reprises successives testées en gateway/direct, bare absent/false/true. |
| Astra/Sol P2 : nouveau bearer jeté lors du retype | `index.ts:9366` acquérait puis restaurait l'environnement sans le transmettre au shell existant. Commande `env` avec URL/bearer fraîchement acquis, valeurs protégées par quotes shell et clé API native retirée uniquement pour cet enfant gateway. Vrais enfants factices : shells propre/pollué, gateway redémarrée, token avec quote/substitution/backticks et échec fermé. |

## RED puis GREEN

Tous les tests durables vivent dans `src/**/*.test.ts`, découverts par le gate
**h2a-runtime** de `scripts/run-test-gates.mjs`, appelé par `npm test`.
Les deux fichiers modifiés sont `gateway-off-default.test.ts` et `run.test.ts`.

Commande ciblée, avec `TMPDIR` et `H2A_TEST_QUALIFICATION_ROOT` privés :

```sh
rtk env -i PATH=/usr/bin:/bin TMPDIR="$TMPDIR" \
  H2A_TEST_QUALIFICATION_ROOT="$TMPDIR" \
  H2A_TEST_REPORT_PATH="$TMPDIR/round3.json" \
  node_modules/.bin/vitest run --config packages/h2a-runtime/vitest.config.ts \
  packages/h2a-runtime/src/gateway-off-default.test.ts \
  packages/h2a-runtime/src/run.test.ts
```

| Exécution observée | Résultat, zéro skip |
| --- | --- |
| RED avant modification produit, première matrice valide | 14 FAIL / 36 PASS, exit 1. |
| Extension bare absent, avant son correctif | 2 FAIL / 47 PASS, exit 1. |
| Matrice finale, sources produit de `aedc3fccb` rétablies temporairement | 17 FAIL / 37 PASS, exit 1 ; sources courantes restaurées dans `finally`. |
| GREEN final : 13 fichiers ciblés ci-dessous | 505 PASS / 0 FAIL, exit 0. |
| Contrats des gates, inventaire et boucle | 52 PASS / 0 FAIL, exit 0. |
| TypeScript runtime | `rtk node_modules/.bin/tsc -b packages/h2a-runtime --pretty false`, exit 0. |

Le GREEN emploie exactement la configuration du gate et les fichiers
gateway-off-default, structured-gateway, tmux-wrapper-scrub,
remote-gateway-consent, soft-refresh, registry, tmux, conv-guard-wiring, attach,
restore, crash-log, run et relaunch, tous sous `packages/h2a-runtime/src/`.
Contrats/boucle : `rtk node --test packages/h2a/test/run-test-gates.test.js
packages/h2a/test/test-inventory.test.js packages/h2a/test/loop-launch.test.js`.
Aucune suite complète locale exécutée.

## Correctif du gate de sécurité après le premier push

Au head `58197aae6`, le job [security-debt](https://github.com/rhanka/h2a/actions/runs/40781964219/job/123162338469)
échoue sur `@hono/node-server@moderate: unregistered security debt`.
L'audit npm reproduit **GHSA-rmxm-3fg6-px4f**, double décodage dans serveStatic,
plage affectée `>=1.19.10 <2.1.3` ; le lock résolvait `2.1.1`.

RED : `rtk node scripts/audit-security-debt.mjs`, exit 1, même diagnostic.
Correctif directement bloquant : `rtk npm update @hono/node-server
--package-lock-only --ignore-scripts --no-audit --no-fund` résout `2.1.5` dans
les plages déjà déclarées. Seule l'entrée existante du lock change (version,
URL, intégrité et peerDependencies publiés) ; aucun manifeste, registre
d'exceptions ou seuil modifié. Mise à jour locale du module avec scripts
désactivés avant le replay des tests.

GREEN : `rtk npm run audit:security`, exit 0 : **0 moderate+ finding** sur
l'arbre racine, puis audit Focus réussi au seuil existant. Les findings low
restent rapportés. Cette preuve couvre les arbres npm scannés par ces deux
gates, pas les images, OS ou artefacts vendored. Compilation runtime et toutes
les reproductions ci-dessous rejouées avant le nouveau push.

Le workflow CI du premier push a été relancé une fois au même SHA après plus
de 40 minutes en file sans runner ; aucun gate n'a été modifié pour cela.

## Correction des identités de tests après le contrôle CI

Le job [npm-test-trust-root](https://github.com/rhanka/h2a/actions/runs/40781964219/job/123162337900)
exécute les assertions mais refuse le rapport : deux cas no-gw interpolent des
cwd longs, tronqués au même préfixe par Vitest. Le doublon est présent aussi
dans le rapport local à 505 assertions réussies ; vérifier les seules
assertions ne suffisait donc pas à prouver l'exécution au sens du gate.

RED reproduit localement en appliquant **verifyRuntimeExecution**, exporté du
vrai runner, au rapport ciblé : `duplicate test identity`, exit 1.
Correction : cinq libellés de cas explicites (workspace identique/autre,
profil différent, deux contrôles no-gw), sans interpolation de chemin.
Toutes les assertions restent identiques, sans modifier le validateur.
GREEN : rapport ciblé **505 PASS / 0 FAIL / 0 skip**, puis validateur du gate
sur ces 13 fichiers : aucune erreur, exit 0. Les replays des deux rounds et
les 52 contrats sont relancés avant le push.

```js
import { readFileSync } from 'node:fs';
import { verifyRuntimeExecution } from './scripts/run-test-gates.mjs';
const report = JSON.parse(readFileSync(process.env.H2A_TEST_REPORT_PATH, 'utf8'));
const failures = verifyRuntimeExecution(report, report.testResults.map(file => file.name));
if (failures.length) throw new Error(failures.join('\n'));
```

## Replays des deux rounds avant push

| Reproductions fournies | Résultat |
| --- | --- |
| Script original R1 Astra `verify.cjs` récupéré dans r1-rv395a.log | Base 912dd3035 : 5 PASS / 11 FAIL ; branche : 16 PASS / 0 FAIL / 0 skip. Matrice restore absent/auto/direct × dry-run, opt-in disponible/indisponible et maintenance start/restart/stop. |
| Sonde shell R1 récupérée dans r2-rv395a.log | Serveur pollué et init fictive réexportant la route : deux enfants propres, clé native préservée. Les huit tests permanents de wrappers couvrent les trois wrappers et leurs contrôles gateway. |
| Quatre sondes Astra R2, avec les ajustements finaux du journal (bare=false, redémarrage, oracle modes) | 4 PASS / 0 FAIL / 0 skip sur les sources corrigées. |
| Neuf scénarios Sol R1/R2 rejoués | 9 PASS, avec les 49 tests durables : 58 PASS / 0 FAIL / 0 skip. Bearer acquis dans shells propre/pollué, pin renommé, identité cwd et contrôle no-gw, nouvelle conversation même/autre cwd, run frais. |
| Tous les constats R1 communs | Suites permanentes vertes : retype legacy direct, réemploi du nom/convId, purge après init, flotte gateway→direct avec auth native, provisioning/refresh distants et opt-in indisponible. |

Les scripts récupérés et overlays restent uniquement dans le TMPDIR privé.
La comparaison RED/GREEN des sources anciennes complète les vrais RED exécutés
avant les nouveaux correctifs ; elle ne réécrit pas l'historique des rounds 1/2.

## Limites et revue

HTTP en mémoire, k8s simulé, faux CLI et vrais enfants shell ; aucun fournisseur,
gateway, cluster réel, état personnel ou binaire h2a installé utilisé.
TMPDIR : `/home/antoinefa/.cache-tmp/h2a-test/run-eXwwhg`, supprimé en fin de tâche.

Nouvelle sélection de revue selon le skill harness/review :

```yaml
status: selection-failed
review-author: {host: unknown, model: unknown, effort: unknown}
target-ref: working-tree on aedc3fccb (four source/test files, before documentation)
target-diff-sha256: b04c00de24e7dce28b0e537309e7871f7f54d6fd2e20c06160fae73cebff40d7
observed-failure: exact inherited author metadata unavailable; installed h2a forbidden, h2a_run MCP unavailable
```

Aucun nouveau consensus indépendant revendiqué ; les deux revues fournies sont
traitées par reproduction et test. La CI du nouveau head est suivie jusqu'à
l'état terminal et consignée dans le corps de la PR.
