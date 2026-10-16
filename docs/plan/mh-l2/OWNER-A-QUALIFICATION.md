# Amendement MH-L2 — décision A du 15 octobre 2026

Qualification historique, conservée avec ses échecs. La correction des six
findings du 16 octobre et ses nouvelles preuves sont dans
[OWNER-A-FINDING-CLOSURE.md](OWNER-A-FINDING-CLOSURE.md).

L'amendement permet au central .7 de recevoir un passage à chaud conduit par
un pair externe autorisé. Il n'ajoute aucun initiateur produit. La re-review
indépendante exigée par le propriétaire précède toute réalisation MH-L3 ; voir
`OWNER-A-REVIEW.md`. Aucun consensus ni résultat M21 n'est revendiqué ici.

## Cible et environnement

La cible produit est `9f34f124593f43c9025ed73f8b6be8b4a10aba0e`, depuis
`642a82f9`, sur `feat/0.98.7-mh-l3`. Le contrat est dans un commit distinct.
Les ajustements finaux des runners imposent umask 022 et retirent un supplément
sans référence au code modifié ; ils ne modifient aucun octet produit.

La qualification s'exécute dans `/tmp/mh-l2-owner-A-final-Tcelt2/source`, créé
par `git archive`, `npm ci --ignore-scripts --no-audit --no-fund`, build Track,
puis `node node_modules/typescript/bin/tsc -b --force --pretty false`, sous
umask 022. Le journal `evidence/owner-A-exact-build.log` contient commandes,
versions et sorties. Aucun dist installé n'est utilisé. Chaque fichier de test
dispose de HOME, XDG_RUNTIME_DIR, répertoires XDG et racine h2a temporaires privés.

| Profil | Exécutable |
|---|---|
| Node 22.22.1 | `/usr/bin/node` |
| Node 24.21.0 | `/home/antoinefa/.npm/_npx/387698761821791d/node_modules/node/bin/node` |

## Résultats

La campagne des références est **non verte**. Les tests MH-L2/MH-L4 et nouveaux
tests source réussissent, mais le fichier d'attachments présente des échecs
intermittents conservés ci-dessous. L'audit des mutations valide 154/154 paires,
avec deux rejeux froids bornés et leurs échecs initiaux conservés.

| Périmètre | Node 22.22.1 | Node 24.21.0 |
|---|---:|---:|
| Nouveau fichier live | 59/59, code 0 | 59/59, code 0 |
| Nouveau central source réel | 1/1, code 0 | 1/1, code 0 |
| 7 fichiers existants MH-L2 | 15/15, code 0 | 15/15, code 0 |
| 10 fichiers existants MH-L4 | 29/29, code 0 | 29/29, code 0 |
| Formats MH-L0, avec historique Git | 4/4, code 0 | 4/4, code 0 |
| Mutations live, rouge assertion puis vert | 63/63, code 0 | 63/63, code 0 |
| Mutations central réel, rouge assertion puis vert | 2/2, code 0 | 2/2, code 0 |
| Mutations froides, rouge assertion puis vert | 12/12 après rejeu precheck | 12/12 après rejeu owner-record |
| Références finales : 20 fichiers hors attachments | 134 tests, code 0 par fichier | 134 tests, code 0 par fichier |
| Attachments, dernière exécution 022 | 30 réussites, 2 échecs, 1 annulation, code 1 | 32/33, code 1 |

Zéro skip sur ces fichiers. Les reçus `owner-A-node*-initial-tests-result.json`,
`owner-A-node*-reference-result.json` et les logs par fichier donnent les
commandes et sorties. Le succès initial Node 22 à 33/33 est conservé séparément ;
il ne remplace pas les échecs suivants et ne constitue pas une stabilité prouvée.
Les deux campagnes initiales de mutations conservent code 1 : restauration
precheck Node 22 en `precheck_failed`, et phases owner-record Node 24 en
`successor_startup_failed`. Un seul rejeu ciblé de chaque cas donne code 0,
rouge `ERR_ASSERTION` puis vert 1/1, zéro skip. Les reçus de rejeu et
`evidence/owner-A-final-proof-audit.json` vérifient les 154 paires sans réécrire
les campagnes initiales. Leur succès ne démontre pas la cause des intermittences.

`evidence/owner-A-qualified-source-integrity.json` atteste l'égalité SHA-256 des
20 fichiers source/test/runner/schéma/contrat entre copie qualifiée et worktree,
après restauration de toutes les mutations. Les copies redondantes de logs
reproduites par suffixe entre profils sont exclues de la collecte et listées
dans ce reçu ; chaque preuve utilise son journal canonique avec sa version Node.
Le contrôle Git de format brut retourne code 2 uniquement pour les espaces et
lignes vides émis par Node dans les logs conservés à l'identique. Le même
contrôle sur code, scripts, JSON et documentation, hors ces logs bruts, retourne
code 0 ; reçu `evidence/owner-A-format-check.json`. Aucun attribut Git ni garde
produit n'est modifié pour masquer ces octets de preuve.

Les commandes sont toujours ciblées : `node scripts/mh-l2-test.mjs <fichier>
<label> [vitest]`, qui lance `node --test <fichier>` ou `vitest run <fichier>`.
`scripts/mh-l2-live-regressions.mjs` énumère les références par `rg`, puis lance
chaque fichier séparément. Le pilote conservé dans
`evidence/owner-A-qualify-driver.mjs` ajoute uniquement les fichiers existants
MH-L2 et MH-L4 absents de cette liste, sans suite globale.

## Preuves de régression et de mutation

Les journaux rouges puis verts sont conservés pour l'acceptation nominale,
la possession du ticket, la reprise du stepId de retire, le drain limité à G0
après acquisition G1, la réconciliation d'un fencing incertain et les contrôles
répétés cible/entrée/precheck avant publication. Chaque mutant doit échouer
avec code 1 et `ERR_ASSERTION`, puis le même oracle doit réussir après
restauration. Zéro test ou un skip fait échouer la campagne.

Le test réel utilise le central source empaqueté de ce checkout et un processus
pair distinct créé par le test. Il exerce publication concordante, checkpoint,
acquisition G1, ouverture du writer sous autorité exacte et nouveau travail G1
pendant la réponse G0 volumineuse ; le retrait G0 préserve marker, présence,
contrôle et appel G1. Ce pair de conformité n'est pas un produit .8 restauré.

`evidence/owner-A-frozen-schemas.json` vérifie les 33 définitions gelées
inchangées ; seules `delegationReceipt`, `liveSourceAuthorization` et
`liveSourcePublication` sont ajoutées.

## Échecs observés et limites

Les échecs de diagnostic restent conservés, distincts des reçus finaux :

- La première recherche trop large incluait des noms de commandes. Elle a
  exposé une déclaration dupliquée dans `dispatch-characterization-goldens`
  et un mock obsolète dans `central-mcp.test.ts`. Ces fichiers ne référencent
  aucun module modifié ; le second est restauré exactement à la base. Seul le
  mock du fichier directement référent `central-mcp-0980.test.ts` est adapté,
  avec ses assertions de contenu, métadonnées et statut Git préservées.
- Le supplément facultatif `mcp-central.test.js` ne référence aucun module
  modifié (`rg` : code 1) et conserve un oracle v1 de reprise par HTTP contraire
  au contrat L2 gelé. Son worker bloqué a été arrêté uniquement après vérification
  de son PID/PPID/startTime ; le runner parent a enregistré l'échec. Le reçu
  `owner-A-supplement-worker-stop.json` et la sortie initiale sont conservés.
  Aucun garde v2 n'a été affaibli pour cet ancien supplément.
- Plusieurs exécutions d'attachments ont atteint une attente de démarrage ou
  retourné une erreur de disponibilité. Node 22 a passé 33/33 au commit cible ;
  la première exécution finale Node 24 a passé 32/33, avec
  `central did not start` dans le test SIGTERM. Aucun délai n'est augmenté.
- La répétition finale 022 Node 22 donne 30 réussites, 2 échecs et 1 annulation :
  R19 natif, timeout deux repos et worker d'identité sans résultat. Node 24
  répété sous 022 donne 32/33 : R19 natif échoue avec
  `identity_worker_failed: mutation_lock_unavailable`. SIGTERM y réussit.
- Une répétition a été lancée avant le constat que le shell avait repris umask
  002. Elle reste un diagnostic ; les runners imposent ensuite 022 et le fichier
  requis est rejoué sous ce profil. Les artefacts produit restent ceux de la
  copie propre construite sous 022.
- Le worker propre de la répétition live Node 22 a été observé en
  `jbd2_log_wait_commit` dans son répertoire privé, avec compteurs d'écriture
  croissants, puis a terminé 59/59. Le reçu de diagnostic reste conservé ; il
  n'établit pas à lui seul la cause des échecs d'attachments. Aucun fsync retiré.
- Les deux restaurations froides initialement échouées restent dans les logs
  `owner-A-node22-initial-failed-cold-*` et
  `owner-A-node24-initial-failed-cold-*`, ainsi que les sorties complètes des
  campagnes. Les rejeux réussis ont leurs propres noms `retry-cold-*`.

La suite globale reste au conducteur. Endurance/charge, clients Claude réels,
shim logique MH-L3, resume/quarantaine, corrélation/progrès/annulation, catalogue,
consommation des preuves, transfert complet et M21 ne sont pas qualifiés par cet
amendement. La transition de release réelle .7→.8 et la clôture de ses preuves
writer restent à démontrer après la re-review.
