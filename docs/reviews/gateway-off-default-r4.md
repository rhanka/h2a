# PR #395 — corrections du round 4

Deux P2 des revues Sol/Astra sur `d170a4b83203c580be71504e05b4466e283a5013`,
reproduits avant toute modification produit.

| Cause | Correction |
| --- | --- |
| `index.ts:9385` construisait une commande contenant le bearer, saisie par `tmux.ts:2434`. | `prepareGatewayRetypeCommand` dans `relaunch.ts` écrit la route dans un fichier JSON 0600, sous un répertoire 0700. La ligne saisie contient seulement le lecteur et le chemin ; lecture puis suppression avant le lancement du CLI, route passée par son environnement. Un retype refusé ou une exception supprime aussi le fichier. |
| `index.ts:6559` prenait la première ligne des pins équivalents, même sans provenance. | Après la résolution existante des conflits et de la liveness, préférer la ligne portant la provenance explicite. Même identité convId/cwd/tool, indépendance de l'ordre, priorité de `--no-gw` conservée. Aucun changement du résolveur de conflits. |

## Régressions dans npm test

Sept cas supplémentaires dans `packages/h2a-runtime/src/gateway-off-default.test.ts`,
découverts par le gate h2a-runtime de `scripts/run-test-gates.mjs` : transition
legacy → opt-in → reprise, deux ordres avec/sans `--no-gw`, confidentialité sous
vrai PTY/Bash interactif, nettoyage après refus du pane.

Le faux CLI vérifie que le fichier est déjà absent à son démarrage. Le test
vérifie aussi l'URL/bearer reçus, l'absence de clé native en gateway, les modes
0700/0600 et l'absence de bearer dans la commande, le terminal, HISTFILE et les logs.
Les tests précédents conservent les tokens avec quotes/substitutions/backticks,
les shells propres/pollués et l'échec avant enfant si gateway indisponible.

Avec `T=/home/antoinefa/.cache-tmp/h2a-test/run-UouKtU`, préfixe commun :

```sh
rtk env -i PATH=/usr/bin:/bin TMPDIR="$T" H2A_TEST_QUALIFICATION_ROOT="$T" \
  H2A_TEST_REPORT_PATH="$T/report.json" node_modules/.bin/vitest run \
  --config packages/h2a-runtime/vitest.config.ts \
  packages/h2a-runtime/src/gateway-off-default.test.ts
```

| Commande / preuve observée | Résultat |
| --- | --- |
| Commande ci-dessus, avant modification produit | **3 FAIL / 52 PASS / 0 skip**, exit 1. Deux pertes d'opt-in ; confidentialité : `{line:true, terminal:true, history:true, log:false}` au lieu de quatre false. |
| Même commande après correction, avant le dernier cas de nettoyage | **55 PASS / 0 FAIL / 0 skip**, exit 0. |
| Configuration exacte du gate, 13 fichiers ciblés ci-dessous | **512 PASS / 0 FAIL / 0 skip / 0 todo**, exit 0. |
| `verifyRuntimeExecution(report, report.testResults.map(file => file.name))`, vrai export du runner | `executionProofErrors: []`, exit 0. |
| `rtk env -i PATH=/usr/bin:/bin TMPDIR="$T" H2A_TEST_QUALIFICATION_ROOT="$T" node --test packages/h2a/test/run-test-gates.test.js packages/h2a/test/test-inventory.test.js packages/h2a/test/loop-launch.test.js` | **52 PASS / 0 FAIL / 0 skip / 0 todo**, exit 0. |
| `rtk env TMPDIR="$T" node_modules/.bin/tsc -b packages/h2a-runtime --pretty false` | exit 0. |

Les 13 fichiers runtime sont gateway-off-default, structured-gateway,
tmux-wrapper-scrub, remote-gateway-consent, soft-refresh, registry, tmux,
conv-guard-wiring, attach, restore, crash-log, run et relaunch, tous sous
`packages/h2a-runtime/src/` avec le suffixe `.test.ts`. Aucun gate affaibli,
aucune suite complète locale.

## Replays de tous les tours

Scripts et patches récupérés dans les journaux fournis, placés uniquement sous
`$T`. Les quatre sondes Astra R2 reprennent leurs corrections finales déjà
présentes dans les journaux (bare=false, bootstrap simulé, oracle des modes).
Les overlays utilisent la configuration du gate et restent en mémoire.

| Commande avec environnement privé | Résultat, zéro skip |
| --- | --- |
| `rtk env -i PATH=/usr/bin:/bin TMPDIR="$T" node "$T/r1-verify.cjs"` | Base 912dd3035 : **5 PASS / 11 FAIL** ; sources courantes : **16 PASS / 0 FAIL**. Restore absent/auto/direct × dry-run, opt-in et maintenance start/restart/stop. |
| `rtk env -i PATH=/usr/bin:/bin TMPDIR="$T" node "$T/r1-shell.cjs"` | Deux enfants : `url:null`, `bearerPresent:false`, `nativeKeyPreserved:true`, exit 0 ; serveur pollué puis réexport dans l'init fictive. |
| `rtk env -i PATH=/usr/bin:/bin TMPDIR="$T" H2A_TEST_QUALIFICATION_ROOT="$T" H2A_TEST_REPORT_PATH="$T/replays.json" node "$T/replays.mjs"` | **18 PASS / 0 FAIL / 0 skip / 0 todo**, exit 0 : 4 sondes Astra R2, 9 Sol R1/R2, 3 transitions Astra R3, historique Astra et confidentialité PTY Sol. |

Les 512 tests durables rejouent aussi les reproductions locales, flotte mixte,
provisioning et refresh distant des tours précédents. Liveness/conflits restent
couverts par conv-guard-wiring ; aucune permission de reprise n'est déduite
d'une ligne d'une autre conversation ou d'un autre workspace.

## Limites

Faux CLI, vrais shells et PTY ; HTTP/k8s simulés. Aucun gateway, fournisseur,
cluster réel, état personnel ou binaire h2a installé exercé. Pas de nouvelle
double revue indépendante revendiquée : les revues fournies sont traitées par
reproduction et tests, le lancement des fournisseurs réels est interdit.

TMPDIR privé : `/home/antoinefa/.cache-tmp/h2a-test/run-UouKtU`, à supprimer
après livraison ; son retrait est confirmé dans le rapport final.
Rebase sur origin/main, push avec lease ; état terminal de la CI et SHA final
consignés dans le corps de la PR. Aucun merge, tag ou trailer d'attribution.
