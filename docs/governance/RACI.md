# RACI des cinq rôles durables h2a

WP4 · Gouvernance et RACI. **Statut : décidé par l'owner le 2026-09-19 ; bascule coordonnée
en attente des prérequis (D4=B).** Ce fichier décrit l'organisation cible retenue. Tant que
la bascule n'est pas prononcée, les sessions actuelles continuent de porter leurs sujets et
aucun droit n'est accordé par ce document (voir *Où ce document s'arrête*). Les prérequis de
la bascule sont listés dans [`migration-cinq-roles.md`](./migration-cinq-roles.md).

Décision : dossier « Rôles h2a : cinq, six ou sept responsables » (révision r2), option A
« Cinq rôles · regroupement fort », reçue le 2026-09-19 dans la conversation du conducteur
h-cond. Réponses de l'owner : D1=A (cinq rôles, « sous réserve des contrôles indépendants
décrits »), D2=A (délégation systématique), D3=B (qualification séparée avant toute évolution
de la politique des modèles), D4=B (bascule coordonnée après validation de tous les
prérequis). Pièces : [`docs/decisions/2026-09-19-roles-h2a/`](../decisions/2026-09-19-roles-h2a/)
— `owner-decision.md`, `dossier.md`, `migration.md`, `index.html`.

Auteur : `cond` (CONDUCTOR), qui **définit** le RACI sur avis de l'architecte (décision
`01KYQ89WANWD257Y3GCW7YM8BZ`, 2026-07-29). **L'avis de h-arch sur cette réécriture reste à
obtenir** : c'est le premier prérequis de la bascule, et la règle « l'avis de l'architecte
n'est pas omissible » ci-dessous s'applique à ce document comme aux précédents.

Forme machine : [`org.h2a.yaml`](../../org.h2a.yaml) à la racine — `h2a org show`,
`h2a org validate`, `h2a org diff`. La liste des cinq instances et la carte des WP sont
tenues par `packages/h2a/test/org-manifest-committed.test.js`.

---

## Ce que signifient les lettres

| lettre | sens dans ce dépôt |
|---|---|
| **A** — répond du résultat | Un seul acteur par acte ou par WP. Ne se partage pas. Peut déléguer le travail, jamais sa responsabilité finale. |
| **R** — réalise | Fait le travail. Peut être plusieurs. Peut être l'acteur A, ou un constructeur délégué. |
| **C** — consulté | Doit être sollicité **avant** l'acte ; son objection est traitée au registre. Bloquant. |
| **I** — informé | Prévenu **après**, sans veto. |

Deux règles priment sur les tableaux lorsqu'elles entrent en conflit avec eux :

1. **L'owner seul accepte.** Aucun acteur ne déclare un sujet `done` sur une suite verte.
   Une clôture sans recette de l'owner est le défaut que ce dépôt répète — six sujets ont été
   clos sur une affirmation que l'owner a ensuite observée fausse (`REF-01`).
2. **Le constructeur n'est jamais une jambe de relecture.** Toute fusion exige un test *et*
   deux jambes de relecture, dont aucune n'est l'auteur — y compris lorsque l'auteur est un
   constructeur délégué, et y compris lorsque le rôle durable possède à la fois la conception
   et le contrôle (cas de `arch`, ci-dessous).

---

## Les cinq rôles

L'owner (`fabien`, PRINCIPAL) ne compte pas parmi les cinq rôles. Un contact principal :
`cond`. Les alertes de sécurité et l'avis architectural gardent un accès direct à l'owner.
Les constructeurs et relecteurs temporaires ne sont pas des rôles durables : ils agissent
sous le mandat du rôle qui les délègue.

| Rôle · instance · session | Mission | WP | Décide seul | Consulte ou demande |
|---|---|---|---|---|
| Conduite · `cond` · h-cond | Ordonne le travail, délègue construction et intégration, pilote et débloque, présente les décisions à l'owner. | WP4 | Ordre des lots dans les priorités fixées, délégation, reprise, désignation d'un remplaçant. | `arch` sur le RACI ; owner pour priorités, acceptation et actes irréversibles. |
| Cadre et assurance · `arch` · h-arch | Réunit architecture, méthode, Track et contrôle de sécurité dans un même rôle durable. | WP8, WP9 (+ périmètre sécurité) | Contrats internes et méthode, sous les mandats existants. | Deux relecteurs indépendants pour ses propres productions ; owner pour RACI, droits et dérogations. |
| Moteur · `runtime` · h-runtime | Rend les sessions, la coordination et les agents utilisables de bout en bout — y compris MCP au démarrage, `--gw`/`--bare`, RTK et JEV natifs. | WP1, WP2, WP3, WP5, WP11, WP13, WP14 | Réparations et choix internes du cycle de vie, dans les contrats approuvés. | `arch` pour interfaces et sécurité ; `portal` pour les effets visibles. |
| Expérience · `portal` · h-portal | Porte Focus, les diagrammes et les interfaces utilisables par l'owner. | WP12 | Conception et réalisation dans les parcours et contrats approuvés. | DS pour les composants partagés ; `arch` pour les contrats ; owner pour recette et changement visible. |
| Plateforme · `infra` · h-infra | Livre les services, identités, plugins et versions nécessaires aux autres rôles. | WP6, WP7, WP10 | Construction, empaquetage et préparation des livraisons dans les mandats existants. | `arch` pour identité et audit ; `cond` pour le calendrier ; owner pour la publication. |

Les modèles utilisés par chaque rôle suivent [`model-assignment.md`](./model-assignment.md)
(politique owner du 2026-09-19). Les profils « Sol » et « Terra » cités dans le dossier sont
remplacés par cette politique.

### Correspondance avec les acteurs précédents

Le RACI précédent (`c0b9e863:docs/governance/RACI.md`) nommait douze acteurs. Chaque ancien
acteur est rattaché à un seul rôle ; un ancien nom devient une correspondance de transition,
jamais un second A.

| Ancien acteur ou session | Rôle de rattachement |
|---|---|
| `cond` · h-cond | Conduite (`cond`) |
| `arch` · h-arch | Cadre et assurance (`arch`) |
| `harness` · h-harness | Cadre et assurance (`arch`) — session retirée à la bascule |
| `track` · session track | Cadre et assurance (`arch`) |
| `cyber` | Cadre et assurance (`arch`) — audit ; la correction reste au rôle du composant |
| `coop` | Moteur (`runtime`) |
| `runtime` · h-runtime | Moteur (`runtime`) |
| `memory` | Moteur (`runtime`) |
| `agents` · h-agents | Moteur (`runtime`) — session retirée à la bascule |
| `gateway` | Moteur (`runtime`) |
| `portal` · h-portal | Expérience (`portal`) |
| `plugins` · h-plugins | Plateforme (`infra`) — session retirée à la bascule |
| h-infra (décision owner du 2026-08-08, `43002a77`, hors `main`) | Plateforme (`infra`) |

---

## A · Propriété par WP

Un seul acteur A par WP ; le WP est le périmètre propre de cet acteur au sens des conflits
d'intérêts. Le test du manifeste lit **cette table** : la colonne 3 donne l'acteur A (premier
nom entre accents graves) et doit concorder, dans les deux sens, avec les scopes
`org:h2a/wpN` de `org.h2a.yaml`.

| WP | intitulé | A | C | I |
|---|---|---|---|---|
| WP1 | Protocole et enveloppes | `runtime` | `arch` (contrats) | `cond` |
| WP2 | Adressage et présence | `runtime` | `arch` | `cond` |
| WP3 | Coordination et boucle | `runtime` | `cond` | `arch` |
| WP4 | Gouvernance et RACI | `cond` | `arch` (obligatoire, non omissible) | owner |
| WP5 | Exécution et runtime | `runtime` | `arch` (politique de bac à sable), `infra` (distribution des réglages) | `cond` |
| WP6 | Identité, authentification et NHI | `infra` | `arch` (conception, audit) | `cond` |
| WP7 | Infrastructure, déploiement et MCP | `infra` | `arch` (audit indépendant ; portée fixée par `cond` ou l'owner), `runtime` | `cond` |
| WP8 | Suivi et registre (Track) | `arch` | `cond` | tous |
| WP9 | Méthode et harnais | `arch` | deux relecteurs indépendants (voir l'exclusion ci-dessous) | tous |
| WP10 | Distribution, CLI et empaquetage | `infra` | `arch` (porte de contrôle), `cond` (calendrier) | tous |
| WP11 | Mémoire et contexte | `runtime` | `arch` (contrat Graphify) | tous |
| WP12 | Intégration sentropic, Focus et courtage MCP | `portal` | `arch` (contrats), `runtime`, DS pour les composants partagés | `cond` |
| WP13 | CLI natif et moteur des agents | `runtime` | `arch` | `cond` |
| WP14 | Passerelle — routage, pools, boucle | `runtime` | `arch` (matrice `--gw`/`--bare`) | `cond` |
| — | politique de sécurité, registre des vulnérabilités, audit | `arch` | rôle propriétaire du composant | `cond`, owner |

**WP7 reçoit un responsable.** Sur `main`, WP7 était absent de cette table et du manifeste
(dissolution sélectionnée le 2026-07-29, conteneur vide et non annulé). La décision owner du
2026-08-08 (`43002a77`, jamais fusionnée) l'avait rendu à h-infra ; l'option A retenue le
2026-09-19 le confirme : `infra` en est A. Les sujets déjà reclassés hors de WP7 ne sont pas
déplacés implicitement.

**Pourquoi la table et le manifeste changent dans le même commit.** Le test dérive la table A
au lieu de la recopier et vérifie la concordance des deux ensembles de WP dans les deux sens.
Changer l'un sans l'autre fait échouer la suite, à juste titre : ce que le test refuse, c'est
la dérive.

**Conteneurs WP15 à WP23 et flux S1 à S8.** Track contient des conteneurs postérieurs à WP14.
Ils n'appartiennent pas à la décision du 2026-09-19 ; leur rattachement est proposé dans
`migration.md` § 6.1 et reste un prérequis de la bascule. Ils ne figurent pas ici tant qu'il
n'est pas confirmé.

---

## B · Sujet → A

| Sujet | A | Interfaces |
|---|---|---|
| MCP au lancement et reprise | Moteur (`runtime`) | Plateforme pour service et identité ; Expérience pour les connecteurs visibles. |
| `--gw`, `--bare` et joignabilité | Moteur (`runtime`) | Plateforme distribue ; Cadre et assurance vérifie la matrice des modes. |
| Focus et diagrammes | Expérience (`portal`) | Le DS garde ses bibliothèques ; Cadre et assurance arbitre les contrats. |
| Cluster mesh : intégration de service | Plateforme (`infra`) | Moteur porte le consommateur h2a ; fournisseur externe consulté. |
| Track, journal et projection | Cadre et assurance (`arch`) | Conduite utilise les états ; Expérience présente les dossiers. |
| Plugins et installation des skills | Plateforme (`infra`) | Cadre et assurance possède la doctrine des skills ; le rôle métier possède leur contenu spécialisé. |
| Infrastructure et release | Plateforme (`infra`) | Conduite fixe le calendrier ; l'owner autorise la publication. |
| Sécurité et audit | Cadre et assurance (`arch`) | Le rôle concerné livre le correctif ; aucun déployeur ne valide son propre audit. |
| Mémoire et agents natifs | Moteur (`runtime`) | Architecture du contrat Graphify consultée ; aucun engagement externe implicite. |
| Permissions d'une session | Moteur (`runtime`) | Plateforme distribue les réglages ; Cadre et assurance examine la politique. |
| Outils natifs de la passerelle : RTK et JEV | Moteur (`runtime`) | Plateforme distribue par le plugin ; Cadre et assurance vérifie la matrice `--gw`/`--bare` et le contrat des outils ; llm-mesh consulté pour le juge. |
| Politique des modèles et pratique de lancement (S6, S8) | Cadre et assurance (`arch`) | Toute évolution passe par une qualification séparée puis une décision owner (D3=B). |

---

## C · RACI des actes

Cette table arbitre. Lorsqu'un acte traverse plusieurs rôles, l'acteur A nommé ici l'emporte.
Les quatorze premières lignes viennent de l'option A du dossier ; les suivantes reprennent
des actes du RACI précédent, l'ancien acteur étant remplacé par son rôle de rattachement.

| Acte | A | R | C | I |
|---|---|---|---|---|
| Priorités et acceptation utilisateur | owner | owner | `cond` | tous |
| Ordre des lots et reprise d'un sujet | `cond` | `cond` | rôle concerné | owner au bilan |
| Proposer ou amender ce RACI, la carte rôle→WP ou l'autorité du conducteur | `cond` | `cond` | `arch` — obligatoire et non omissible ; rôles concernés | tous, owner |
| Ratifier le manifeste, accorder de nouveaux droits | owner | `cond` prépare | `arch` | tous |
| Architecture et frontières : arbitrer une frontière, découper un WP, départager deux rôles | `arch` | `arch` | rôles concernés ; DS si touché | `cond`, owner |
| Livraison d'un WP | rôle A du WP (table A) | constructeur délégué | `arch` | `cond` |
| Recette technique et revue | `arch` | deux relecteurs indépendants | rôle concerné | `cond` |
| Modification d'un contrôle requis | `arch` | constructeur distinct | deux jambes indépendantes du lot (voir l'exclusion) | tous |
| Audit de sécurité | `arch` | auditeur indépendant | rôle audité ; portée fixée par `cond` ou l'owner | `cond`, owner |
| Correction de sécurité, montée d'une dépendance vulnérable | rôle propriétaire du composant | constructeur délégué | `arch` | `cond` |
| Préparation d'une version | `infra` | constructeur ou intégrateur délégué | `arch`, `cond` | tous |
| Autorisation de publication | owner | `infra` exécute | `arch`, `cond` | tous |
| Écriture du journal Track | `arch` | écrivain unique désigné | rôle du sujet ; `cond` | tous |
| Engagement entre projets | `cond` pour h2a | rôle technique concerné | autre conducteur ; `arch` | propriétaires concernés |
| Fusionner une branche | rôle propriétaire | intégrateur délégué (D2=A) | `arch` (porte), deux relecteurs ≠ auteur | `cond` |
| Déclarer un sujet `done` | owner (recette) | rôle propriétaire | — | `cond`, `arch` |
| Renoncer à un critère d'acceptation (`track accept waive`) | owner | `arch` (mécanisme Track) | rôle propriétaire | `cond` |
| Rouvrir un sujet clos sans validation | rôle propriétaire | `arch` (mécanisme Track) | — | `cond`, owner |
| Annuler un sujet | rôle propriétaire | rôle propriétaire | `cond` | owner, `arch` |
| Réveiller, relancer ou remplacer une session | `cond` | `runtime` (mécanisme) | — | session concernée |
| Escalader après N relances infructueuses | `cond` | `cond` | — | owner |
| Commander une session distante : canal retour, cycle de vie, option de lancement | `runtime` | `runtime` | `portal` | `cond` |
| Exposer une session, une UAT ou un dossier de décision à sentropic ; parler au dépôt sentropic | `portal` | `portal` | `runtime`, `arch` | `cond` |
| Fixer la politique de bac à sable (greywall) | `arch` | `arch` | `runtime` (l'exécute), `infra` (distribue) | `cond` |
| Retirer une NHI : révoquer clés et sous-agents, écrire la pierre tombale | `infra` | `infra` | `arch` (audit), acteur concerné, owner | `cond` |
| Choisir un modèle, un pool de comptes, une cible de routage à l'exécution | `runtime` | `runtime` | `arch` (politique des modèles) | `cond` |
| Faire évoluer la politique des modèles | owner | `arch` (qualification séparée, D3=B) | `cond` | tous |
| Définir ce qu'un acteur doit se rappeler au réveil | `runtime` | `runtime` | tous | `cond` |
| Déclarer un conflit d'intérêts, demander une levée | acteur déclarant | `cond` | `arch` | owner |

Chaîne d'escalade, inchangée (`docs/drumbeat.md`) : `AGENTS ← CONDUCTOR ← PRINCIPAL`. L'owner
est le point final de l'escalade.

### L'avis de l'architecte n'est pas omissible

Tout amendement de ce RACI, de la carte rôle→WP ou de l'autorité du conducteur porte **une
décision Track dont le dossier référence l'artefact d'avis de h-arch**. L'owner peut **refuser**
cet avis ; personne ne peut le **sauter**. Un conducteur qui amende sa propre gouvernance sans
cette référence a produit un document, pas un amendement.

La présente réécriture ne fait pas exception : la décision de l'owner est acquise, l'avis de
h-arch ne l'est pas encore, et la bascule attend cet avis (prérequis n° 1 de
`migration-cinq-roles.md`).

### Contrôles indépendants du rôle Cadre et assurance

L'option A réunit dans `arch` ce qui était séparé entre `arch`, `harness`, `track` et `cyber`.
L'owner l'a retenue « sous réserve des contrôles indépendants décrits ». Ces contrôles sont :

- **`arch` ne certifie pas ses propres productions.** Quand `arch` conçoit ou fait construire
  un changement de Track, de la méthode, d'une porte requise ou de la politique de sécurité,
  `arch` ne compte pas parmi les jambes de relecture ni comme vérificateur. Deux relecteurs
  indépendants, de familles de modèles différentes de celle de l'auteur
  ([`model-assignment.md`](./model-assignment.md)), rendent le verdict ; `cond` vérifie leur
  indépendance.
- **Le déployeur ne clôt pas seul une alerte de sécurité.** La sécurité peut interrompre un
  lot par une alerte motivée ; la portée d'un audit est fixée par `cond` ou l'owner, jamais par
  le rôle audité (avis de l'architecte (a) du 2026-08-08).
- **Le contrepoids sur le RACI reste une consultation.** `arch` est consulté sur le RACI ; il
  n'en devient pas propriétaire. WP4 reste à `cond`, comme l'owner l'a décidé le 2026-07-29.

### Exclusion — le propriétaire d'une porte n'est pas le relecteur de sa réparation

Quand `arch` livre un changement de la porte de tests requise, `arch` n'est **ni l'une des
deux jambes de relecture ni le vérificateur** de ce changement, et une suite verte produite
par `arch` n'est pas la preuve. C'est la règle 2 appliquée à la porte elle-même. Avant la
fusion des rôles, les deux jambes nommées étaient `cyber` et `arch` ; toutes deux sont
désormais dans le même rôle, d'où l'exigence de deux relecteurs extérieurs au lot ci-dessus.
Nommer deux jambes plutôt qu'une garde l'exclusion applicable le jour où l'une est
indisponible.

---

## Désaccord consigné sur WP4

Les deux jambes du double consensus de 2026-07-29 concluaient que WP4 devait appartenir à
`arch`, au motif qu'un opérateur ne doit pas posséder les règles qui fondent sa propre
autorité. L'owner a décidé autrement le 2026-07-29 et retenu l'avis de l'architecte comme
contrepoids : *la séparation passe par l'avis, pas par la propriété*. La décision du
2026-09-19 conserve WP4 à `cond`. Tout conflit futur sur l'autorité du conducteur se relit à
la lumière de ce signalement : un amendement de ce RACI que `arch` n'a pas vu n'est pas valide,
quel que soit son auteur.

---

## Où ce document s'arrête

Sur l'échelle d'opposabilité — **structurel > test > ligne de spécification > habitude** — ce
fichier est une **ligne de spécification**, et la liste des rôles se trouve un barreau au-dessus,
au niveau **test**.

- **Ce que le test tient.** `packages/h2a/test/org-manifest-committed.test.js` vérifie : les
  cinq instances et elles seules (plus le PRINCIPAL), un seul CONDUCTOR, un seul PRINCIPAL, un
  seul A par WP, la concordance de la table A avec le manifeste dans les deux sens, l'absence de
  WP nommé deux fois, l'appartenance de chaque instance au scope racine et une arête de
  `cond` vers chaque instance. `validateOrgManifest` seul ne vérifie aucune de ces propriétés.
- **Ce que rien ne tient.** Les affectations A/R/C/I des tables B et C : aucun code ne refuse un
  acte accompli par le mauvais rôle.
- **Rien n'est provisionné.** `h2a org provision` n'a pas été exécuté pour ce manifeste. Mesuré
  le 2026-07-29 : il accepte tout fichier qui passe `validateOrgManifest`, sans vérifier de
  ratification, et échoue sur le registre partagé avec `TypeError: r.roles is not iterable`
  sur une ligne héritée. Ces deux constats n'ont pas été re-mesurés pour cette réécriture ;
  les droits restent à l'owner et à la bascule.

Mesures de la version précédente (2026-07-29), toujours valables tant qu'elles ne sont pas
re-mesurées :

1. **Aucun acteur ne détient son rôle dans le registre** : les agents vivants étaient tous
   enregistrés `roles: ["AGENTS"]`, et `h2a_conductor` répondait `conductor: null`.
2. **Le résolveur du conducteur n'est pas atteignable par chemin** : appelé avec le chemin du
   dépôt, il dérive un identifiant d'espace de travail sans candidat.
3. **Le RACI par sujet ne se rétro-applique pas** : `track` n'enregistre `accountable` et
   `responsible` qu'à la création (sujet `01KYQXJG77DQC368F4G2B2VGD8`). Le transfert des sujets
   à la bascule passe donc par un registre de transfert tant que ce manque subsiste.
4. **Le routage vers un acteur reste une convention** (DOC-03 décidé, non câblé) : chaque C de
   ces tables dépend de l'arrivée effective du message.
5. **Le journal Track est réparti sur deux identifiants d'espace de travail** (deux commits
   racine depuis l'absorption de `@sentropic/track`). **Consigne intérimaire, en vigueur pour
   tous les rôles jusqu'à correction : passer explicitement
   `--workspace ws:89c45cc3e040949f1a1a034529722ee877150fd2a0e3da16a7f6e9d8e27f495d` et ne pas
   utiliser `track workspace-id` dans ce dépôt.**

Ce qui ferait passer les tables B et C du barreau « spécification » au barreau « structurel »,
par coût croissant : réparer le provisionnement et y faire respecter la frontière de
ratification ; permettre à `track` de fixer `accountable`/`responsible` sur un sujet existant ;
puis conditionner les actes de la table C au rôle enregistré de l'acteur.

Le détail historique de ces mesures, l'avis de l'architecte du 2026-07-29 (COUNTER, trois
conditions) et le RACI des douze acteurs restent consultables dans l'historique Git
(`c0b9e863:docs/governance/RACI.md`).
