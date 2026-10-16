# Reçus CI cross-CLI

Ces JSON ne contiennent que des témoins de protocole et métadonnées. Aucun
token, RPC brut ou texte complet de modèle. `simulated-OK` ne signifie jamais
`measured-OK` pour une CLI réelle.

| Run / commit | Node 22 et 24 | Réserve |
|---|---|---|
| [38850476146](https://github.com/rhanka/h2a/actions/runs/38850476146), `d62112c8` (`node22/`, `node24/`) | Chaque matrice : 36/36 simulated-OK | Oracles natifs encore rouges |
| [38851219130](https://github.com/rhanka/h2a/actions/runs/38851219130), `6681bb16/` | 36/36 ; oracles 2/2 ; runtime 684 pass | Anciennes fixtures non confinées en PID : écart signalé, pas une preuve d’isolation |
| [38853536274](https://github.com/rhanka/h2a/actions/runs/38853536274), `727c8160/` | 36/36 ; oracles 2/2 ; runtime 684 pass avec init privé | Neuf suites complémentaires : 92 pass, 2 fail, 12 todo déclarés ; CI globale rouge |
| [38854531546](https://github.com/rhanka/h2a/actions/runs/38854531546), `3ef2030e/` | **36/36 ; 13 tests harness, 2 oracles, 684 runtime, 94 source pass par version ; 0 fail** | 16 non-tests déclarés, hors couverture ; workflow ciblé entièrement vert |

Commande des matrices :

```sh
node scripts/qualify-cross-cli.mjs --simulated --timeout-ms 30000 --output "$RUNNER_TEMP/xcli-simulated.json"
node scripts/xcli-ci-check.mjs "$RUNNER_TEMP/xcli-simulated.json"
```

Sorties finales des jobs simulés réussis :

```json
{"simulated-OK":36,"simulated-KO":0,"blocked":0}
{"cells":36,"outcome":"simulated-round-trips-proven"}
```

Les `suites.json` sont extraits des sorties effectives des jobs correspondants,
avec leur URL et commande. Les quatre non-tests runtime et douze todo source
proviennent de la déclaration propriétaire `scripts/test-non-tests-0986.json` ;
ils ne sont pas comptés comme couverture. Aucun skip dû à l’absence d’état ou
de fixture historique n’est admis.

Les entrées globales npm-test/release et les modèles des six CLI réelles restent
hors qualification de ce workflow ciblé. La fixture historique refuse désormais
une exécution sans espace PID privé et init collecteur ; ce changement doit être
intégré aux entrées globales avant merge.
