# Réserves Argon — fermeture de réalisation MH-L5

Revue reçue : `revmhl5.md`, tête `4a4ca76c`, verdict
`FUSIONNABLE-AVEC-RÉSERVES`. Autorité : demande owner du 16 octobre 2026,
spec v7 §§6.3/10.8/12. Aucun nouveau verdict de revue ou de release n'est émis
par le builder ; la relecture indépendante appartient au conducteur.

| Finding | Traitement et preuve |
|---|---|
| 1 — M17, huit surfaces et réentrance | Le verrou de lot est supprimé du driver. L'oracle court observe les acquisitions réelles flock ; l'ancien driver échoue avec **1** acquisition par itération, le corrigé en exerce au moins **10**. Les acteurs sont nommés `backend1..8`, et le reçu déclare `coverage: backend-only`. Les payloads vivants restent lisibles pendant les sweeps ; des refs déjà expirées distinctes sont collectées à temps réel. |
| 1 — manque protocolaire restant | Selon l'alternative explicitement autorisée, la campagne simultanée normative est affectée à [MH-L8](../mh-l8/BRANCH.md), avec responsable, dépendance MH-L6, sept domaines à 10 000 mutations, huit vrais processus, refus hérités et tous les oracles concomitants. **M17 reste non qualifié ; cette gate bloque la release.** Aucune réserve non affectée ne reste à arbitrer en MH-L5. |
| 2 — diagnostic T9 | `recover()` classe immédiatement un marqueur v1 observé avant le backoff, y compris après perte SSE ; la supervision vérifie aussi la version lorsque la génération est identique. Les erreurs transitoires ne remplacent plus un diagnostic hérité. Une connexion v2 réussie le remet à zéro. Le polling d'offres conserve son ordre pour les publications v2. |
| 3 — information M18 | La preuve H4 réelle et l'activation après arrêt froid v1 sont suivies explicitement dans [MH-L6](../mh-l6/BRANCH.md). Sans provenance durable : `owner_liveness_unknown`, toujours testé pour .5/.6. |

`mh-l5-shim-recovery.test.js` utilise le shim compilé, un vrai serveur HTTP
authentifié de fixture et de vrais fichiers marqueurs. Seules l'horloge et
l'invocation du tick de supervision sont pilotées pour observer précisément le
premier backoff ; aucun délai ajouté ni garde élargie. Ses quatre scénarios
échouent par `ERR_ASSERTION` sur le produit initial : remplacement à génération
différente, remplacement à génération identique, perte SSE avant supervision,
ENOENT/marqueur malformé puis connexion v2 et nouvelle perte.

`mh-l5-concurrency-oracles.test.js` reste une campagne backend courte. Son
instrumentation compte les succès des appels au vrai util-linux flock sans
substituer le verrou. Elle détecte la réintroduction du verrou englobant et
continue à détecter la perte d'écritures des sept domaines. Le nombre de flocks
n'est pas présenté comme une preuve des huit surfaces protocolaires.

## Reproduction ciblée

Construire une copie privée par `scripts/mh-l3-qualification-copy.mjs` sous
umask 022 ; artefacts v1 privés préparés et vérifiés par les helpers MH-L5.
Dans cette copie, pour chacun des deux binaires Node 22/24 :

```sh
node scripts/mh-l5-argon-check.mjs
node scripts/mh-l5-mutate.mjs argon
node scripts/mh-l5-mutate.mjs oracles
```

Le premier script énumère douze fichiers ciblés, et chacun utilise
`node --test <fichier>` via le runner isolé. Les mutations sont confinées à
la copie privée et restaurent source/compilé en `finally`. Aucun script de
suite globale n'est appelé. L'état HOME/XDG/store de chaque test est temporaire ;
le runner vérifie les seuls PID qu'il a créés.

Exécuter les profils en série : le fichier attachments conserve un port fixe
de fixture commun à l'UID. Les deux tentatives initiales parallèles ont échoué
avec `EADDRINUSE` ; le même fichier inchangé a ensuite passé **33/33** en série
sur chaque profil. Ces échecs restent dans les index `*-initial.json` et dans
`initialAttempt` des reçus finaux ; ils ne sont pas comptés comme verts.

## Résultats vérifiés

Copie privée : `/tmp/mh-l3-qualification-AogyQv/source`. Node 22.22.1 :
`/usr/bin/node` ; Node 24.21.0 privé :
`/tmp/mh-l5-artifacts-shD7Sf/node-v24.21.0-linux-x64/bin/node`.

| Commande et sortie archivée | Node 22 | Node 24 |
|---|---:|---:|
| `node scripts/mh-l5-test.mjs packages/h2a/test/mh-l5-shim-recovery.test.js argon-before`, puis `argon-after` | 4/4 rouges par assertion, puis 4/4 verts | Gardes vérifiées par les mutations ci-dessous |
| Même runner, `mh-l5-concurrency-oracles.test.js`, `argon-before` puis `argon-after` | Rouge : 1 flock/itération ; vert : minimum 10 | Réintroduction du verrou tuée par mutation |
| `node scripts/mh-l5-argon-check.mjs` | 11 fichiers verts ; attachments en échec de port fixe | Idem |
| `node scripts/mh-l5-test.mjs packages/h2a/test/mcp-central-attachments.test.js argon-serial-before` (22), `argon-serial-qualified` (24) | 33/33, exit 0 | 33/33, exit 0 |
| `node scripts/mh-l5-mutate.mjs argon` | 5 rouges par assertion / 5 restaurations vertes | 5 / 5 |
| `node scripts/mh-l5-mutate.mjs oracles` | 7 rouges par assertion / 7 restaurations vertes | 7 / 7 |
| `node node_modules/typescript/bin/tsc -b --pretty false` | exit 0, aucun diagnostic | Même émission testée sous Node 24 |

`node scripts/mh-l5-argon-audit.mjs /tmp/mh-l3-qualification-AogyQv/source`
retourne exit 0 : **12 fichiers, 72 tests, 12 paires par profil**, zéro
skip/annulation/enfant restant ; neuf fichiers exécutés et un module compilé
hashés. Les sources de la copie correspondent au worktree ; le compilé possède
son propre SHA-256, l'émission TypeScript en changeant le formatage.
Reçus détaillés : [audit](argon-proof-audit.json),
[Node 22](argon-check-node22.json), [Node 24](argon-check-node24.json).

## Limites maintenues

La campagne longue backend après suppression du verrou englobant n'est pas
réexécutée dans cette fermeture : le rouge/vert ciblé et les paires de mutation
qualifient ce correctif. Les anciennes charges restent archivées, sans valeur
d'acceptation M17. La campagne complète, son volume normatif et les artefacts
convergés sont explicitement dus en MH-L8. Aucun vrai Claude, M20b, packaging
final, coupure électrique ou vraie .7 → .8 n'est ajouté à la couverture.

Le présent dossier complète le `proof-audit.json` historique ; il ne réattribue
pas ses reçus aux nouveaux octets. Les index et logs Argon distinguent les
échecs initiaux, les restaurations et les exécutions finales.
