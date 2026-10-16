# MH-L3 — consommateur .7, sur amendement MH-L2 ratifié

Autorité : spec-v7-astra §5, §10.2–10.4 ; décision A du 15/10 ; revue
`revl2amend-r2.md` de `513312b8` déclarée FUSIONNABLE par le propriétaire.
La source .7 accepte une cession conduite de l’extérieur. Elle ne la lance pas.

| Contrat livré | Vérification ciblée |
|---|---|
| `initialize` local, version MCP négociée, catalogue embarqué conservé, stdio stable en découverte absente/invalide | `mh-l3-network`, graphe C02 de `mh-l1-routing` |
| Version/build capturés depuis l’image chargée ; descripteur généré depuis les définitions serveur et vérifié au build ; digests complets/contrat/outil et projection versionnée ; données `default`/`enum` et propriétés homonymes préservées | `mh-l3-state`, `mh-l3-ownership`, `generate-mcp-descriptor --check` |
| 32 mappings actifs, IDs typés, espaces amont uniques, deadline initiale conservée, progression traduite, annulation visant l’ancien propriétaire, aucun rejeu applicatif incertain | `mh-l3-state`, `mh-l3-network`, `mh-l3-transport`, M21 |
| Contrôle distinct : agents HTTP indépendants, capacité réservée de challenge et de nonce ; refus de non-admission signés avec UID/nonce/digest/méthode/publication | `mh-l3-control`, `mh-l3-state`, `mh-l2-auth`, `mh-l2-live-central` |
| Activation logique indépendante du transport ; reprise idempotente sous contexte immuable, epoch et identité attendus ; ancien POST admis conservé ; ancien DELETE fencé | `mh-l3-central`, `mh-l3-recovery`, `mcp-central-attachments` |
| Bail expiré sans preuve de mort : activation conservée ; liveness inconnue : quarantaine comptée ; déconnexion courante ou mort prouvée suivie du drain avant fermeture | `mh-l3-state`, `mh-l3-central`, `mcp-central-attachments` |
| Nouvelle baseline seulement après mort prouvée ou fin de génération authentifiée ; ancien token fencé et travaux antérieurs conservés ; gap explicite | `mh-l3-ownership`, `mcp-central-attachments` |
| Vue servie conservée en panne ; aucune admission d’outil sans contrat individuel démontré pour l’amont courant ; pagination bornée et curseur lié au digest | `mh-l3-state`, `mh-l3-network`, M21 |
| Lecteur de verdict compatible futur : MAC/nonce, source/cible, inventaire, transaction, délégation H4/ticket/reçu et rapport ; cache borné d’acceptation exacte | `mh-l3-evidence`, `mh-l0-peer`, sept refus sur le vrai G0 de M21 |
| ACK d’acceptation durable et authentifié avant exposition au conducteur ; réconciliation après ACK perdu ; attestation catalogue sans droit de cession | `mh-l3-evidence`, `mh-l3-source-offer`, M21 |
| `attach-transfer` consommateur : publication et transaction concordantes, acquisition par le pair, catalogue cible relu avant installation/admission ; G0 continue ses opérations | M21 sur vrai shim compilé, vrai central ancien, pair réseau distinct |

La conservation des notifications utilise au plus 3 MiB et 256 événements par
attachment ; les résultats de reprise disposent de 1 MiB cumulé avec gap explicite
si la conservation exacte ne tient plus. Au plus 128 tentatives de reprise sont
retenues par attachment/génération. Le plafond global vient du manifeste vérifié
(`maxAttachments`, 64 dans les images de qualification), sinon 256 dans le payload
non adopté. La saturation refuse une nouvelle admission et ne détruit pas un
propriétaire. Les acceptations sont bornées à 128 par shim et 256 à la source.

Si la première réponse est perdue avant que le shim connaisse l’identité attendue,
`GET /_h2a-central/shim/:id/status` permet de la relire sous authentification,
contexte immuable et epoch concordants. Cette lecture ne renouvelle aucun bail,
ne reprend aucun transport et ne crée aucune activation. La reprise conserve son
contrôle strict de l’identité attendue.

Une reprise authentifiée redirige la progression des requêtes vivantes vers son
transport courant. Le mapping conserve séparément le propriétaire du POST admis
pour ses réponses, sa progression et son annulation ; il n’accepte que ce
propriétaire exact ou le transport de notification explicitement repris. Un
ancien transport de notification intermédiaire et un jeton déjà réglé sont refusés.

M21 injecte des verdicts de fixture et simule le successeur ; le code d’injection,
ses commandes et ses clés restent dans les tests. Ce test ne qualifie ni un
vérificateur sémantique produit ni l’interopérabilité d’une release .8. Il vérifie
aussi l’ajout d’un outil, son installation avant `listChanged`, son invocation sur
G1, un catalogue cible discordant, l’ACK perdu et l’annulation d’un appel G0.

Décision propriétaire du 16/10 : tous les MCP h2a doivent passer par le registre
MCP cluster-mesh. La découverte du registre attend le contrat sentropic et reste
hors de ce lot. La sélection est concentrée à la frontière de découverte ; aucun
endpoint fixe ni inventaire fermé de futurs builds n’est ajouté. Le futur registre
devra fournir une publication validable et préserver les preuves d’autorité,
de sélection et d’authentification ; son intégration ne doit pas contourner ces
gardes. Les deux digests de registration source restent obligatoires.

La campagne accélérée de 32 shims prouve vingt reprises de transport avec G0
vivant ; elle ne remplace pas M09 complet (75 secondes d’absence, vingt cycles
froids avec dix secondes de service sain) ni les mesures de ressources REL.

Les gates REL avec un vrai Claude, les mesures RSS/FD/endurance de release, les
artefacts convergés et la découverte du registre appartiennent aux lots suivants.
La revue indépendante MH-L3 est remise au conducteur : le confinement interdit
le dispatch via le h2a installé. Les scripts de ce lot n’appellent que des fichiers
de tests explicites et enregistrent les PID/naissances de leurs propres enfants.
