# MH-L1 — intégration sur la base courante

La branche part de `cf690fe2` (MH-L0) et intègre l’historique #316 jusqu’à
`25117303`. Le contrôle distant `git ls-remote --tags origin 'v0.98.6*'`
n’a retourné aucun tag. Le gel sur le dist .6 final appartient au conducteur.

| Livrable §12 | Réalisation / limite |
|---|---|
| #316 | Merge conservant les deux historiques ; seul conflit : BRANCH.md |
| Routage | Lecture de `initialize.clientInfo`, qualification exacte et observations séparées ; replay des octets et du tail dans le même processus |
| Exclusions | Opt-outs, identité explicite, cluster-mesh, racines incompatibles, connecteurs v1, sidecars avec challenge |
| Isolation | Workspaces/conversations distincts, sockets natifs homonymes ; aucune requête au socket du daemon |
| Transport intégré | Source MIT @hono/mcp 0.3.2 dans h2a ; nettoyage JSON avant résolution, 202 vide, nettoyage du mapping sur close |
| Conditionnement | Producteur privé, shrinkwrap publié dans le tarball, versions exactes, bundles, vraie node-pty précompilée et manifeste identique après deux installations |

Le manifeste Claude livré est vide. MH-L8 devra y inscrire les observations des
vrais clients. Les données utilisées par les tests vivent exclusivement dans
une copie temporaire du graphe compilé ; aucune qualification produit ni option
d’injection publiée n’en résulte.

Le premier handshake HTTP est attendu avant l’envoi de son tail : le scénario
nominal passe de deux attachments à un. Aucun mécanisme de bascule vivante,
d’adoption H4, de sélection de version ou de redémarrage natif n’est ajouté.

## Commandes ciblées

`scripts/mh-l1-test.mjs <fichier> <label> [node|vitest] [arguments]` crée un
HOME, XDG, cache et store privés, exécute un seul fichier, enregistre commande,
sortie et code dans [evidence](evidence), puis supprime la fixture. Le cas
h2a_run crée son propre mkdtemp sous `.qual-tmp` : le produit refuse les
workspaces d’agents sous le répertoire temporaire système.

```sh
rtk npm ci --ignore-scripts --no-audit --no-fund
rtk npm run build -w @sentropic/track
rtk node node_modules/typescript/bin/tsc -p packages/h2a --pretty false
rtk node node_modules/typescript/bin/tsc -p packages/h2a-runtime --pretty false
rtk node scripts/mh-l1-test.mjs packages/h2a/test/mh-l1-routing.test.js green
rtk node scripts/mh-l1-test.mjs packages/h2a/test/mh-l1-shim.test.js green
rtk node scripts/mh-l1-test.mjs packages/h2a/test/mh-l1-transport.test.js green
rtk node scripts/mh-l1-test.mjs packages/h2a/test/mh-l1-preservation.test.js green
rtk node scripts/mh-l1-test.mjs packages/h2a/test/mh-l1-package.test.js green
```

Les autres commandes exactes et les sorties sont dans les reçus d’evidence.
Aucune suite globale n’est lancée. Les 38 cas uniques validés ont zéro échec,
zéro skip et zéro todo ; les rouges intentionnels restent conservés.

## Rouge puis vert

| Cas | Rouge constaté | Vert |
|---|---|---|
| C03 | Sur L0, perte des octets étrangers/CRLF | #316 : sauvegarde exacte, octets préservés |
| C01 version/observations | `true !== false` avec client inconnu ou observation insuffisante | Refus avant lecture de config/marker et avant réponse |
| Prélecture | Module absent (nouvelle fonctionnalité) | Message fragmenté et tail restitués exactement une fois |
| Handshake pipeliné | `2 !== 1` attachments avec vrai shim/central | Un attachment |
| Transport HTTP | Réponse `old` dans le batch qui attend `new` | IDs numérique/chaîne et réponse nouvelle exacts |
| R1 de L0 | Garde du digest retirée : exception attendue absente | Garde restaurée, mutation tuée |
| Node minimum | Node 20 accepté : exception attendue absente | Node 20 refusé, ABI 24 reconnue |
| Prototype | Module absent ; puis écarts réels de modes, bins et filtres npm | Deux installations vérifiées contre le manifeste complet |

Les essais du prototype ont aussi identifié la capture npm JSON dépassant
1 MiB, le filtrage d’un paquet imbriqué confondu avec un workspace, et des
modules de test livrés par fast-uri/node-pty. La capture est bornée à 16 MiB,
les workspaces sont identifiés physiquement, les seuls modules de test sont
retirés avant scellement. Aucun écart de payload n’est ignoré.

## Prototype reproductible

`buildPackagingPrototype(root, { buildId })` exige une destination neuve et
Linux glibc x64 avec Node ≥22. Le test couvre Node 22.22.1, ABI 127, npm 11.17.0,
umask processus/npm 022. Les deux builds et les deux installations correspondent
au même manifeste : 12 422 entrées ; le tarball porte 10 677 fichiers.

Le wrapper privé `@sentropic/h2a-mh-l1-prototype@0.98.7-mh-l1.0` embarque le cœur
et runtime du checkout (métadonnées base 0.98.5, sans bump release), des
dépendances réellement résolues puis épinglées, les licences et le transport
intégré. Les scripts d’installation sont supprimés ; le vrai require hérité
`node_modules/node-pty` ouvre une PTY et le batch HTTP corrigé est exercé depuis
chacune des installations. Le manifeste inclut les bins internes reconstruits
par npm ; fichiers, modes et liens sont contrôlés strictement après installation.

Digest natif répété :
`sha256:84d274e35867b33e2223fe676d570f57629708c1d6a69e4d6d070600c97b1a9e`.

`prototype.json` annonce `releaseQualified:false` et
`closureQualification:dependency-snapshot-only`. La fermeture des imports
tardifs avec leurres, la toolchain/sysroot épinglés, les autres profils npm/Node,
le gel natif .6, l’adoption et la publication restent MH-L6/MH-L8. Les tarballs
de test sont temporaires ; le producteur et les preuves sont conservés.

## Contrôles et réserves

Le journal Track a le même objet Git `5a00686e6eccbd112445913b6562e4367f757f21`
dans L0, #316 et le merge. Aucun événement n’est perdu ni écrit par ce lot.
Les chemins native-terminal, launch-guard et proc-identity sont inchangés.

| Réserve L0 | Traitement |
|---|---|
| R1 | Fermée par vecteur négatif et mutation |
| R2 | Reste MH-L3, état de délégation non ACTIVE |
| R3 | QF/QC restent décisions owner avant gel MH-L6 |
| R4 | Voir [dossier de revue](review.md), sélection impossible dans ce confinement |
