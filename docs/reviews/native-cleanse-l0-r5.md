# PR #396 — L0, correction round 5

Lot L0 « Baseline witnesses », spec SHA-256
`bb04ea7385588cd2421fd1f5e3b64fc50ef5bd417c94c05de6811aec2ce22d08`.
Réconciliation des deux P2 des revues Astra/Sol sur `f38a98626`.

| Constat | Correction |
|---|---|
| Vibe désactivé ou transport HTTP sans URL accepté GREEN | Vérifier le transport stdio et la sélection initiale avant le cache de protocole partagé entre hôtes. Une désactivation imprévue échoue ; une entrée initialement désactivée conserve son choix et sa cible actuelle, sans être lancée. |
| ENOENT intermittent pendant le témoin sockets | Observer chaque fichier dans la frontière de disparition du parcours : un seul stat, métadonnées des sockets non canoniques et contenu des seuls JSON/JSONL. Les assertions consomment ces observations, sans relire les chemins volatils. ENOENT est traité aussi pour les répertoires et lectures ; toute autre erreur remonte. Aucun retry. |

Les quatre nouveaux contrôles sont découverts par `scripts/run-tests.mjs`,
obligatoires dans `scripts/test-inventory.json` et protégés par la trust root
indépendante. Le ledger commité de 42 contrats reste inchangé.

## Preuves RED → GREEN

Commandes sous TMPDIR privé et `H2A_TEST_QUALIFICATION_ROOT=$TMPDIR`.
Prérequis : `npm run build -w @sentropic/track`, puis `npm run build:h2a`, exit 0.

| Commande / reproduction | Résultat |
|---|---|
| `node --test --test-name-pattern='L0 Vibe:' packages/h2a/test/native-cleanse-oracle.test.js`, avant correction | 0/2 PASS, `true !== false` pour disabled et HTTP : faux GREEN reproduits. |
| Quatre nouveaux contrôles d'oracle, helpers de `f38a98626` (`fix-native-cleanse.r5-regressions-red.log`) | 0/4 PASS, exit 1 ; contrôle disabled initial et parcours ajoutés. |
| Reproduction exacte Sol : créer `review-vanishing.lock`, l'énumérer puis l'effacer avant les stat du témoin sockets ; baseline via le vrai `runGates` et son vérificateur `tests` | 43 PASS / 5 FAIL, gate 1 ; ENOENT du verrou et quatre observations sockets manquantes. |
| Même disparition déterministe après correction, injectée juste avant le premier stat du verrou énuméré | 48/48 PASS, gate 0, mêmes 42 résultats contractuels. |
| `node --test packages/h2a/test/native-cleanse-oracle.test.js` | 13/13 PASS. |
| Baseline + oracle, reporters TAP/npm et vérificateur réel du step `tests` | 61/61 PASS, gate 0, 42 RED exacts. |
| Baseline seule sur copies de main `912dd3035` et rc.7 `8d588db05`, même driver npm | Chacune : 48/48 PASS, gate 0, mêmes 42 RED exacts. |
| `node --test packages/h2a/test/run-test-gates.test.js packages/h2a/test/gate-execution-evidence.test.js packages/h2a/test/prepared-npm-cache.test.js` | 120/120 PASS, dont mutations a/b/c : GREEN→RED, RED→signature différente, RED→GREEN non déclaré. |
| `node --import ./packages/h2a/test/helpers/native-isolation.js --test packages/h2a/test/native-host-crash-recovery.test.js packages/h2a/test/identity-binding-contention.test.js` | 19/19 PASS ; cleanup et contention du round 4 conservés. |

Zéro skip/todo dans ces campagnes. Les quatre contrats sockets restent bien RED
produit ; l'injection de disparition ne modifie aucune signature du ledger.

Le probe d'artefacts permanent efface un fichier entre énumération et stat,
puis un JSON entre stat et lecture, et un répertoire après énumération.
Il conserve le contenu du reçu restant et vérifie qu'EACCES reste bloquant.
Les contrôles Vibe refusent les transports HTTP/streamable-http ou absents,
la désactivation imprévue, la réactivation d'un choix désactivé et une cible
périmée. Le transport stdio sain reste accepté, avec `disabled=false` explicite
ou implicite et les options MCP déjà couvertes au round 3.

Rejeux rounds 1–4 : formats legacy rc.7, prepare/prepack/pack/install des cinq
tarballs, vrais run/reprise sur deux endpoints, restore des vingt UUID via
dispatcher/flock et acquittements PTY ; lock-id et lignes humaines/inconnues
préservés. Les neuf anciens oracles rejouent MCP version/echo/protocole,
hooks fictifs/désactivés/doublonnés, helpers/ressources/cache Codex, activation
Agy, MCP du plugin actif et collisions binaires. La trust root rejoue les
transitions et les observations absentes/doublonnées/inconnues/avalées.

Commandes des parcours empaquetés :

```sh
node --require "$TMPDIR/precompiled.cjs" \
  --import ./packages/h2a/test/helpers/native-isolation.js --test \
  --test-reporter=tap --test-reporter=./scripts/node-evidence-reporter.mjs \
  --test-reporter-destination=<tap> --test-reporter-destination=<report.json> \
  packages/h2a/test/native-cleanse-baseline.test.js \
  packages/h2a/test/native-cleanse-oracle.test.js
```

Le driver privé appelle `runGates` avec le vrai step `tests`, son reporter et
son vérificateur, en limitant les fichiers exécutés aux témoins demandés.
Il ne remplace pas la gate npm complète de CI. Logs conservés sous
`tmp/h-cond/fix-native-cleanse.r5-*.log`.

Les 42 RED décrivent les contrats encore manquants : L1 récupération, L3 paquet,
L3/L4 intégrations ; les autres lots restent séparés. La disponibilité réussit
sur rc.7, sans prouver la panne exacte du 28/10. Binding node-pty précompilé
fourni par preload privé pour respecter l'interdiction de Python ; lifecycle
npm produit actif, recompilation native locale non qualifiée. Suite complète
locale et nouveau consensus de pairs non revendiqués : MCP h2a absent et
dispatch installé interdit par le confinement propriétaire.

TMPDIR privé : `/home/antoinefa/.cache-tmp/h2a-test/run-gVodW4`, supprimé après
le suivi CI et vérifié absent à la livraison. Aucun merge, tag ni trailer.

## Correction du blocage CI après le premier push

CI de `5e53f0b4d` : **18/19 succès**, dont npm Node 22 et trust root.
Node 24 échoue dans `terminal-reset.functional.test.ts` : `ENOENT open
'/proc/70049'`, lors de `driver.pin()`. La fixture annonce le processus raw
prêt avant son `spawnSync(stty)`. Le parcours des descendants peut donc
énumérer ce helper bref puis tenter de l'épingler après sa disparition.

Un wrapper privé appelle le vrai `/usr/bin/stty` et émet
`treset-stty-applied` dans le même PTY après sa réussite. L'assertion d'ordre
est déterministe : ancien helper **5/6 PASS**, exit 1, « expected 0 to be
greater than 30 » ; correction **6/6 PASS** sur Node 22.22.1 et 24.22.0,
exit 0, zéro skip/todo.
Le signal ready suit maintenant la réussite et le retour de stty. Le délai
fixe de 500 ms disparaît ; aucun timeout, retry, garde d'isolation ou contrat
produit n'est modifié. Les assertions des modes, des codes de sortie et du
termios avant/après restent actives.

```sh
H2A_TEST_REPORT_PATH="$TMPDIR/terminal-full-green.json" \
  node node_modules/vitest/vitest.mjs run \
  --config packages/h2a-runtime/vitest.config.ts \
  packages/h2a-runtime/src/terminal-reset.functional.test.ts
```

Logs : `fix-native-cleanse.r5-ci-node24-first.log`,
`fix-native-cleanse.r5-terminal-full-red.log` et
`fix-native-cleanse.r5-terminal-full-green.log` dans `tmp/h-cond`.
La portée supplémentaire est limitée à cette fixture directement bloquante.
