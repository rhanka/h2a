# E2a — préchargement autonome des descendants d'image

Le lanceur lie désormais son image à un préchargeur builtin-only, immuable et
nommé par son SHA dans `I/bootstrap`. Son SHA est incorporé au bundle du
lanceur : aucun digest circulaire dans le manifeste d'image. Le lanceur vérifie
le fichier avant le premier import ; chaque lancement interne le revérifie.
Le préchargeur valide le préfixe physique, l'installation et le manifeste avant
l'entrée de chaque processus ou Worker. Le contexte public ne porte aucun
secret et ne confère aucun droit H4.

Les appels builtin à child_process et Worker sont liés avant l'entrée choisie,
avec synchronisation des exports ESM. Les lancements Node explicites vers une
image du même I reçoivent son propre contexte, y compris un candidat d'une
autre image. Le parent ne charge jamais le candidat. Les fork/Worker ne peuvent
supprimer cette garde avec `execArgv: []`. Un Worker eval/data/externe est refusé
comme entrée non qualifiée. Le fork externe perd uniquement le préchargeur h2a
hérité ; les applications extérieures ne sont pas soumises au manifeste h2a.
Aucune liste de MCP, endpoint ou build n'est introduite.

La mémoire autorisée reste bornée : Node refuse les flags V8 mémoire dans les
execArgv explicites d'un Worker. Le rouge observé sur 22/24 est conservé ; la
limite est transmise via resourceLimits et le test observe réellement 128 MiB.

| Commandes ciblées, Node 22.22.1 et 24.21.0 | Résultat par profil |
|---|---:|
| `node scripts/mh-l6-test.mjs packages/h2a/test/mh-l6-launcher.test.js final-E2a-25` | 25/25, exit 0 |
| `node scripts/mh-l6-test.mjs packages/h2a/test/mh-l6-image-policy.test.js final-E2a-25` | 12/12, exit 0 ; probe PTY/addon réel |
| Régressions avant correction spawnSync/fork/Worker, puis mémoire Worker | 4 rouges ERR_ASSERTION conservés ; verts dans les 25 tests |
| `node scripts/mh-l6-execution-mutate.mjs` | 10 paires rouges ERR_ASSERTION / restaurations vertes, 9 points de faute |
| `node node_modules/typescript/bin/tsc -b packages/h2a --pretty false` | exit 0, aucun diagnostic |
| `node scripts/mh-l6-e2a-audit.mjs /tmp/mh-l3-qualification-YeHHOv/source` | 21 fichiers identiques, 5 émissions, 37 tests et 10 paires/profil, exit 0 |
| Skips / annulations / enfants restants | 0 / 0 / 0 |

Les tests joignent explicitement leurs enfants ; les spawnSync sont synchrones.
Le runner contrôle en outre les PID dont son hook connaît la naissance. Les
lanceurs de fixture retirent NODE_OPTIONS : le compteur du runner ne prétend
pas inventorier ces petits-enfants ; leur fin est attendue dans les fixtures.
Aucun host natif h2a n'est démarré ni signalé. Aucun fichier natif source n'est
modifié ; cela ne remplace pas le gel comparatif du payload publié .6.

Un premier mutant Worker faisait écrire la fixture worker dans le stdout du
parent : son diagnostic JSON, non une assertion, était invalide comme preuve.
Il est conservé sous `execution-worker-loader-flags-shared-stdout-diagnostic`.
La fixture ne produit plus ce stdout et le mutant est maintenant tué par
l'assertion `rejectedBeforeSpawn`. Ce diagnostic est exclu des dix paires.

| Artefacts reproduits depuis deux copies sources | SHA-256 |
|---|---|
| `artifacts/h2a-launcher-E2a.mjs` | `d326e610e05f2b43e7a246fcbb08e691b018860104332863734da85264fa0bcf` |
| `artifacts/image-loader-f8666555468eeb5af9ee12c75ff37fecd9acb3bc2b0dcbb89f70da1e6219d360.mjs` | `f8666555468eeb5af9ee12c75ff37fecd9acb3bc2b0dcbb89f70da1e6219d360` |

| NOT covered / suite obligatoire | Lot |
|---|---|
| Installation physique de ces deux artefacts, bootstrap/adoption/lien et npm | C2/D |
| Chaque vraie entrée directe de composant et de natif, journal writer + Worker, identity worker, precheck, contrôleur, tous imports tardifs | E2b/F ; mini-images ne qualifient pas ces vrais chemins |
| Départ externe direct dans une image sans passer par lanceur/préchargeur | E2b ; pas encore de fermeture de cette entrée |
| Workers eval d'upgrade actuels ; spawn/execFile asynchrones et overloads non exercés directement ici ; Node sous alias personnalisé | E2b/F ; aucune couverture déduite des seuls wrappers |
| Tarball/shrinkwrap/runtime exact, chaîne native précompilée épinglée, reproductibilité et gel .6 | E3/MH-L8 |
| Exclusion héritée maintenue et preuve M18, CLI commune, indépendante revue | B2/F/conducteur |

Décision VOL réversible dans le design déjà ratifié : préchargeur de bootstrap
adressé par contenu, wrappers au lancement avant le code d'image, aucun
changement des octets natifs. Installation/release ne sont pas déclarées
qualifiées. Aucun amendement ni retrait d'exigence de la spec.
