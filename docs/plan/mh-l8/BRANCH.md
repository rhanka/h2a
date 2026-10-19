# MH-L8 — qualification des artefacts convergés

## M17 / §10.8 — campagne simultanée obligatoire

Responsable : conducteur MH-L8 (réalisation du harnais et qualification release).
État : **à réaliser ; bloque la qualification release 0.98.8**.
Dépendance : surfaces CLI et preuve H4 de fermeture des admissions de MH-L6.

La cible de livraison de la lane est reportée à **0.98.8** par l'owner.
Les preuves historiques .7 restent des preuves de leurs SHA et artefacts réels ;
elles ne qualifient pas une future release .8. Aucun bump package n'est fait ici.

Rattachement explicite autorisé par la demande owner de fermeture Argon du
16 octobre 2026 : « montrer avec preuves exactement ce qui reste pour MH-L8
selon la spec et le faire déclarer là ». La spec v7 §12 confie à MH-L8 la
qualification des artefacts convergés et la charge/endurance ; §10.8 reste
intégralement exigé. Ce rattachement ne qualifie pas M17 et ne réduit pas son
critère d'acceptation. Le socle MH-L5 livre seulement la concurrence backend.

- [ ] Un fichier de test ciblé lance **simultanément sur le même store** huit
  vrais processus : central HTTP du candidat, pair de conformité G1 préparatoire en
  lecture seule, quatre workers MCP stdio, boucle janitor `reapAllDeadPresence`
  et sous-commandes CLI. Le pair lit réellement ; il ne prend aucune mutation
  ni collecte préparatoire en charge. Un neuvième acteur hérité .5/.6 exerce
  les refus, puis la fermeture prouvée de ses admissions restaure l'éligibilité.
- [ ] Les sept domaines atteignent chacun **au moins 10 000 mutations** :
  registry, inbox, négociations, présence, blockages, payloads et lancements.
  Compter les mutations réellement acquittées par domaine et par surface,
  sans multiplier artificiellement les lectures du pair par des écritures.
- [ ] Aucun verrou de harnais n'englobe plusieurs primitives : les acquisitions
  et libérations sont celles du produit. Entrelacer le sweep et les autres
  writers, y compris entre publication et lecture d'un payload encore vivant.
  Utiliser des refs expirées distinctes ; ne pas avancer le sweep dans le futur
  au point d'expirer les refs vivantes des autres acteurs.
- [ ] Réconcilier les ACK externes avec les fichiers finaux : aucune perte,
  duplication, acceptation d'état partiel ou transition invalide ; chaînes et
  `contentHash` corrects ; réservations de lancement uniques et aucun double effet.
- [ ] En même temps que la charge : ancien epoch incapable de modifier une
  présence reprise, janitor incapable de supprimer un snapshot remplacé,
  refus préalable tant que le writer hérité peut muter, aucun nettoyage
  préparatoire ni migration de schéma par le pair.
- [ ] Sur les SHA et artefacts convergés de la cible 0.98.8, Node 22/24 : commandes et sorties
  conservées, zéro skip/TODO/annulation/enfant restant ; régressions rouges par
  assertion sans chaque garde, puis vertes après restauration. Aucun accès à
  l'état réel de l'owner ; uniquement HOME/XDG/store créés par `mkdtemp`.

## Preuves existantes et manque exact

| Preuve MH-L5 | Ce qu'elle établit | Ce qu'elle n'établit pas |
|---|---|---|
| `mh-l5-concurrency-oracles.test.js` après fermeture Argon | Huit processus backend ; primitives non englobées ; acquisitions flock observées ; ACK et payloads vivants réconciliés | Ni parcours protocolaires réels, ni charge normative de 10 000 sur ces surfaces |
| Ancienne campagne de 80 000 mutations (tête `4a4ca76c`) | Huit drivers bas niveau avec un flock par lot ; chaînes et ACK backend | **Ne vaut pas M17** : réentrance court-circuitant les verrous internes, aucun pair readOnly/janitor/CLI réel |
| `mh-l4-writers.test.js`, `mh-l5-legacy-writer.test.js` | Gardes de writers, snapshot périmé, pureté readOnly et refus/retour d'éligibilité hérités en tests ciblés séparés | Ces scénarios réunis avec les huit surfaces sous charge |
| `mh-l3-transfer.test.js`, `mh-l5-v1.test.js` | Vrais transports/source/shim/pair et distributions v1, séparément ou en paires | Les huit surfaces exécutées ensemble sur les artefacts convergés |

La checklist complète doit être acquittée avant le verdict release MH-L8.
Une exécution backend, même à 10 000 mutations/domaine, ne peut la solder.
