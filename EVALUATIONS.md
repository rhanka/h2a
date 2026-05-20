# Évaluations de compatibilité — modèles organisationnels

> **Rôle** : tester le modèle `h2a` contre des organisations réelles avant de figer la spec détaillée.
> **Méthode** : pour chaque modèle, mapper acteurs, contrats, policies, controls, engagements, flux d'escalade et gaps.
> **Statut** : tracks lancés le 2026-05-17. Les conclusions ci-dessous sont des hypothèses de travail à valider pendant le brainstorming.

## Grille commune

Chaque évaluation doit répondre aux mêmes questions :

1. **Acteurs** : quelles INSTANCE tiennent quels rôles (`PRINCIPAL`, `EXECUTIF`, `CONDUCTOR`, `AGENTS`, `CONTROL`, `MANDATAIRE`) ?
2. **Scopes** : où sont les frontières entre mini-organisation, engagement, fédération, activité d'ensemble ?
3. **Autorité / mandat / signature** : qui peut signer, pour quelle partie, sur quel scope, avec quel mandat ?
4. **Contrats** : quels éléments sont des `CONTRACT`, lesquels sont des `ENGAGEMENT`, lesquels sont des `POLICY`, lesquels sont des artefacts externes référencés ?
5. **Obligations / droits / clauses** : quelles obligations, droits réservés, clauses de disclosure, clauses de recours ou clauses de termination doivent être représentés ?
6. **Controls / enforcement** : quels domaines imposent des contraintes ou audits cross-tree, et avec quel niveau de disclosure ?
7. **Escalades / recours** : qui peut déclencher `advise`, `decide`, `alert`, vers quelle autorité de scope, avec quel routing ?
8. **Audit** : quelles traces doivent prouver responsabilité, consentement, conformité, exceptions, taxes, décisions et preuves redigées ?
9. **Deadlocks / précédence** : quelles règles s'appliquent quand deux policies, contracts ou autorités sont incompatibles ?
10. **Gaps protocole** : quels concepts manquent ou doivent être renforcés ?

## Recherche Q9 — CONTRACT / POLICY / ENGAGEMENT

Hypothèse retenue après comparaison des modèles entreprise, écosystème et gouvernement :

- **CONTRACT** est le conteneur normatif applicable à des parties/scopes et signé par les autorités mandatées. Il peut mélanger clauses durables, obligations, droits, policies, preuves, signatures, clauses de contrôle/escalade et engagements dérivés.
- **POLICY** est une règle durable applicable à un scope. Elle peut être autonome (règlement interne, loi, policy publique) ou être une clause dans un CONTRACT.
- **ENGAGEMENT** est le contrat opérationnel exécutable. Il décrit une mission, un service, une déclaration, une livraison ou une action concrète avec charter, rôles, critères de succès et journal.
- **ENFORCEMENT_PLAN / ESCALADE** est le plan d'application : il vérifie que contracts, policies et engagements sont respectés, détecte les violations, produit la preuve, bloque, alerte ou escalade.

Conséquence : `POLICY` ne devient pas une cinquième couche linéaire. La pile sépare plutôt les artefacts normatifs (`CONTRACT`, `POLICY`, `ENGAGEMENT`) du plan d'application (`ENFORCEMENT_PLAN`).

## Contre-audit 2026-05-17

Points retenus et intégrés dans `SPEC.md`, `VOCABULARY.md` et `DECISIONS.md` :

- Un `SCOPE` ne signe jamais ; une INSTANCE mandatée signe pour une PARTY ou un SCOPE.
- `ENGAGEMENT` n'est pas le scope : il a un scope.
- `CONTROL` est un rôle ; le plan d'application est `ENFORCEMENT_PLAN`.
- `MANDATAIRE` n'est ni médiateur, ni arbitre, ni tribunal.
- L'escalade doit cibler l'autorité compétente du scope, pas seulement le PRINCIPAL local.
- Sans médiateur inter-contrat, une négociation doit avoir ledger, états terminaux, base hash, signatures et règles de stale proposal.
- Le droit d'audit cross-organisation doit être minimisé : redaction, evidence packages, attestations et hashes.
- Les modèles A/B/C exigent obligations récurrentes, droits réservés, recours, précédence et disclosure contrôlée.

---

## Track A — Entreprise traditionnelle

### Modèle à tester

Entreprise avec contrats fournisseurs, contrats employés, contrats clients, investisseurs, actionnaires, réglementation, administrations et taxes.

### Mapping initial

| Élément réel | Mapping `h2a` | Remarques |
|---|---|---|
| Société / entreprise | Mini-organisation ou activité d'ensemble | Peut avoir un EXECUTIF global et plusieurs PRINCIPAUX de domaines. |
| CEO / direction générale | `EXECUTIF` | Porte la responsabilité d'ensemble, arbitre entre domaines. |
| Dirigeant de BU / owner produit | `PRINCIPAL` local | Responsable d'un périmètre, avec ses engagements et agents. |
| Managers opérationnels | `CONDUCTOR` ou `PRINCIPAL` local selon autorité | Le manager qui pilote une équipe est souvent conductor ; celui qui possède le budget/scope est principal. |
| Employés | `AGENTS` humains liés par `BINDING` à des slots | Le contrat de travail est une policy/contrainte durable + engagements de mission. |
| Fournisseurs | Mini-organisations externes | Le contrat fournisseur devient un CONTRACT cadre, souvent avec ENGAGEMENTS dérivés. |
| Clients | Mini-organisations externes ou PRINCIPAUX externes | Le contrat client devient un CONTRACT client, avec ENGAGEMENTS de service/livraison. |
| Investisseurs | PARTY avec RIGHTS réservés, parfois AUTHORITY de gouvernance | Ne pas leur donner une autorité opérationnelle implicite. |
| Actionnaires | PARTY capitalistique + AUTHORITY sur décisions réservées | Peuvent nommer/contraindre l'EXECUTIF via statuts/pacte, sans piloter les engagements quotidiens. |
| Régulateurs / administrations | CONTROL externe ou EXECUTIF public selon contexte | Imposent policies et obligations ; peuvent recevoir alertes ou rapports. |
| Taxes | POLICY légale imposée + OBLIGATION récurrente + CONTROL fiscal | Déclarations/paiements sont engagements récurrents avec preuves. |

### Contrats vs policies

- **Contrat fournisseur** : CONTRACT cadre entre entreprise et fournisseur ; contient policies sécurité/qualité/paiement/confidentialité et instancie des ENGAGEMENTS (SOW, commandes, livraisons).
- **Contrat employé** : CONTRACT d'emploi ; contient policies durables (droits, obligations, confidentialité, temps de travail), bindings de rôle et engagements de mission.
- **Contrat client** : CONTRACT client ; contient SLA, droits, responsabilités, policies applicables et engagements de livraison/service.
- **Investissement/actionnariat** : CONTRACT ou POLICY de gouvernance + droits de décision, plus engagements ponctuels (levée, reporting, board meeting).
- **Réglementation/taxes** : POLICY externe imposée, contrôlée par CONTROL legal/fiscal/compliance ; exécution via engagements de déclaration, paiement, audit.

### Mapping du cas 15 CONDUCTORS

Dans une entreprise traditionnelle, le cas "1 PRINCIPAL / 15 CONDUCTORS" ressemble à un owner exécutif pilotant 15 responsables opérationnels :

- Chaque CONDUCTOR doit avoir un MANDATE borné : budget, domaine, droits de signature, policies acceptées.
- Les contrats entre conductors sont plutôt des ENGAGEMENTS internes ou des CONTRACTS internes de service.
- Le PRINCIPAL ne doit pas recevoir 105 conflits bilatéraux : les policies communes, seuils de signature et controls de domaine doivent filtrer les escalades.
- Les obligations périodiques (taxes, reporting, conformité) doivent être modélisées comme OBLIGATIONS récurrentes, pas seulement comme tâches.

### Gaps à évaluer

- Représenter un acteur externe qui impose une policy sans être membre de l'organisation.
- Distinguer contrat-cadre durable et engagement opérationnel.
- Modéliser budget, paiement, fiscalité et obligations périodiques.
- Gérer conflit entre policy interne et réglementation externe.
- Définir comment les actionnaires/investisseurs influencent EXECUTIF sans piloter les engagements quotidiens.
- Représenter termination, confidentialité, IP et compensation dans les contracts employés.

### Hypothèse de compatibilité

Le modèle tient si `POLICY` devient first-class et si un `ENGAGEMENT` peut référencer des policies internes, contractuelles et externes. L'entreprise traditionnelle n'est pas un seul arbre : c'est un ensemble de scopes gouvernés par EXECUTIF, PRINCIPAUX locaux, CONTROL internes et CONTROL externes.

---

## Track B — Écosystème multi-entreprises

### Modèle à tester

Écosystème client-fournisseur, partenaires, compétiteurs, coopétition, plateformes, consortiums et chaînes de valeur.

### Modèles d'écosystème

| Modèle | Mapping `h2a` | Point critique |
|---|---|---|
| Client ↔ fournisseur | CONTRACT inter-organisation + ENGAGEMENTS dérivés | SLA, qualité, facturation, confidentialité, escalades. |
| Partenariat bilatéral | CONTRACT de partenariat + policies communes + engagements | Gouvernance conjointe et responsabilités distribuées. |
| Consortium | Fédération avec EXECUTIF ou comité d'ensemble | Plusieurs PRINCIPAUX locaux, policies communes, votes/quorum. |
| Marketplace / plateforme | EXECUTIF de plateforme + policies d'accès | Participants gardent leur mini-organisation ; plateforme impose règles. |
| Coopétition | CONTRACT limité entre compétiteurs + engagements cloisonnés | Cloisonnement d'information et CONTROL legal/antitrust forts. |
| Supply chain multi-niveaux | Chaîne d'engagements liés | Besoin de propagation de policy et audit de dépendances. |
| Joint venture | Nouvelle mini-organisation partagée | EXECUTIF propre, PRINCIPAUX participants, policies fondatrices. |
| Sous-traitance en cascade | Engagement principal + engagements dérivés | Qui porte la responsabilité finale ? Comment tracer les sous-engagements ? |

### Mapping initial

- Chaque entreprise est une **mini-organisation** avec PRINCIPAL(s), CONDUCTOR(s), AGENTS, CONTROL et policies propres.
- L'écosystème peut rester **pair-à-pair** ou devenir une **fédération** avec EXECUTIF, comité, ou governance policy.
- Les contrats inter-entreprises sont des **CONTRACTS** ; ils peuvent contenir des **POLICY** et instancier des **ENGAGEMENTS partagés**.
- Les contrôles critiques sont legal, compliance, cyber, finance, qualité, confidentialité, antitrust, export control.

### Gaps à évaluer

- Héritage de policy entre fédération, entreprise et engagement.
- Cloisonnement d'information entre partenaires et compétiteurs.
- Autorité d'un EXECUTIF de plateforme sur des PRINCIPAUX indépendants.
- Droit d'audit cross-organisation sans accès complet à tout.
- Résolution de conflit quand deux organisations ont des policies incompatibles.
- State machine de négociation : offre, contre-offre, retrait, expiration, ratification, stabilisation.
- Propagation transitive de policies dans supply chain sans divulguer tout le graphe.
- Garde-fous antitrust en coopétition : ce que les conductors ont le droit d'échanger doit être contractualisé.

### Mapping du cas 15 CONDUCTORS

Dans un écosystème multi-entreprises, les 15 CONDUCTORS correspondent à 15 organisations ou équipes autonomes négociant sans médiateur :

- Topologie potentielle : 105 liens pair-à-pair. Le protocole doit limiter la divergence par registry, negotiation ledger, hashes et evidence packages.
- Les CONTRACTS inter-conductors doivent déclarer disclosure, confidentialité, audit rights, antitrust/export-control si applicable.
- Sans EXECUTIF commun, chaque conflit de précédence doit soit bloquer la signature, soit produire une escalade explicite vers les PRINCIPAUX concernés.
- Un MCP central peut être un bus, pas une autorité. Une plateforme avec pouvoir normatif devient un scope fédéré avec EXECUTIF/policies propres.

### Hypothèse de compatibilité

Le modèle tient si les scopes sont explicites et si `POLICY` supporte héritage, précédence et exception. Les écosystèmes ne doivent pas être forcés dans une hiérarchie unique : le protocole doit supporter pair-à-pair, fédération, plateforme et consortium comme topologies distinctes.

---

## Track C — Écosystèmes gouvernementaux / citoyens

### Modèle à tester

Relations entre citoyens, administrations, agences publiques, élus, régulateurs, services publics, obligations légales, fiscalité, droits et recours.

### Mapping initial

| Élément réel | Mapping `h2a` | Remarques |
|---|---|---|
| Citoyen | PRINCIPAL de sa mini-organisation personnelle | Peut déléguer à agents, représentants ou services. |
| Foyer / famille / association | Mini-organisation citoyenne | Plusieurs humains avec rôles et policies internes. |
| Administration | Organisation avec EXECUTIF public + CONDUCTORS de service | Exécute policies publiques et engagements de service. |
| Élus / gouvernement | EXECUTIF public ou PRINCIPAUX de mandat démocratique | Portent intention publique et arbitrages globaux. |
| Régulateur | CONTROL externe ou organisation de CONTROL | Implique audit, veto, alerte, sanction. |
| Loi / règlement | POLICY publique externe | S'applique par scope territorial, sectoriel ou personnel. |
| Impôt / taxe | POLICY fiscale + engagements de déclaration/paiement | Le citoyen/entreprise exécute, administration contrôle. |
| Service public | ENGAGEMENT de service ou workflow administratif | Demande, instruction, décision, recours, trace. |
| Recours / tribunal | AUTHORITY externe / adjudication explicite | Le MANDATAIRE présente la question, mais ne juge pas. |

### Patterns à tester

- **Citoyen ↔ administration** : engagement de service administratif sous policies publiques.
- **Entreprise ↔ administration** : déclaration, taxe, conformité, licence, inspection.
- **Régulateur ↔ entreprise/citoyen** : control externe avec droit d'audit, sanction, injonction.
- **Élu/gouvernement ↔ administration** : EXECUTIF public définit policies, administration conduit engagements.
- **Citoyen ↔ citoyen sous droit commun** : mini-organisations personnelles liées par contrat, médiation ou recours.

### Gaps à évaluer

- Représenter une policy publique obligatoire sans consentement contractuel individuel.
- Distinguer droit, règlement, procédure administrative et engagement de service.
- Modéliser recours, appel, preuve contradictoire et neutralité du MANDATAIRE.
- Gérer temporalité : mandat politique, validité des lois, prescription, obligations périodiques.
- Gérer asymétrie de pouvoir entre administration et citoyen.
- Représenter juridiction, recours, appel et validité temporelle sans consentement contractuel local.

### Mapping du cas 15 CONDUCTORS

Dans un modèle gouvernement/citoyen, les 15 CONDUCTORS ressemblent à 15 services ou guichets opérant sous un PRINCIPAL citoyen, entreprise ou administration :

- Les policies publiques sont souvent `imposed`, pas signées localement.
- Les conductors doivent négocier des engagements de service ou conformité, mais certaines obligations viennent d'une autorité externe.
- Les escalades peuvent viser PRINCIPAL, EXECUTIF public, régulateur, recours ou tribunal selon le scope.
- Les preuves doivent être minimisées : l'administration peut demander une preuve, pas forcément tout le journal interne du citoyen/entreprise.

### Hypothèse de compatibilité

Le modèle tient si `POLICY` peut être externe, obligatoire et territorialisée, et si le protocole distingue engagement contractuel volontaire, obligation réglementaire et recours. Le citoyen reste PRINCIPAL de son périmètre, mais l'administration peut imposer des policies et engagements de conformité via une autorité publique explicite.

---

## Track D — 1 PRINCIPAL / 15 CONDUCTORS / sans médiateur inter-contrat

### Modèle à tester

Un humain est PRINCIPAL de 15 CONDUCTORS. Chaque conductor peut négocier avec les autres pour stabiliser des CONTRACTS, POLICIES, ENGAGEMENTS ou amendements. Il n'existe pas encore de médiateur inter-contrat.

### Mapping initial

| Élément réel | Mapping `h2a` | Risque |
|---|---|---|
| Humain owner | PRINCIPAL du scope racine | Devient goulot d'escalade si tout remonte. |
| 15 conductors | INSTANCE tenant rôle CONDUCTOR avec MANDATE borné | Mandats trop larges = signatures incohérentes. |
| Découverte | REGISTRY local/MCP | Inscription ne vaut pas droit d'agir. |
| Négociation | NEGOTIATION ledger par sujet | Divergence si pas de base hash/état terminal. |
| Accord stabilisé | CONTRACT/POLICY/ENGAGEMENT signé | Stable seulement si hash identique + signatures requises. |
| Conflit inter-contrat | ENFORCEMENT_PLAN + escalade | Pas de résolution automatique en V1. |
| Audit | Journaux append-only + evidence packages | Trop de logs bruts crée fuite d'information. |

### Règles V1 proposées

- Chaque CONDUCTOR déclare `mandate.rights`: `negotiate`, `propose`, `accept`, `sign`, `escalate`, `audit`, avec scopes autorisés.
- Une proposition référence toujours `baseArtifactHash`; si la base change, la proposition devient stale.
- Une négociation se termine uniquement par `stabilized`, `rejected`, `withdrawn`, `expired` ou `abandoned`.
- Une signature inclut `{instance, role, scope, mandate, artifactHash}`.
- Un conflit policy/contract peut bloquer la signature si la policy déclare `blocking: true`; sinon il est tracé et escaladé.
- Le PRINCIPAL reçoit des escalades agrégées : par conflit, par domaine CONTROL, ou par batch de décisions, pas un flux non filtré de toutes les contre-propositions.

### Compatibilité ABC

- **A entreprise** : correspond à 15 responsables internes. Besoin principal : mandats, budget, policies communes, obligations récurrentes et controls de domaine.
- **B écosystème** : correspond à 15 organisations ou partenaires. Besoin principal : disclosure contrôlée, antitrust/confidentialité, registry non autoritaire, deadlock explicite.
- **C gouvernement/citoyen** : correspond à 15 services/guichets/agents sous obligations publiques. Besoin principal : policies imposées, juridiction, recours, preuves minimisées.

Depuis DEC-041, ce mapping est aussi exposé en machine-readable par
`H2A_ABC_MODEL_PROFILES` et vérifié par
`auditAbcModelCompatibility(modelId)`. Les profils intégrés sont stables
contre le vocabulaire V1 (`ok:true`) mais conservent des gaps explicites
(`ready:false`) pour ne pas confondre compatibilité de mapping et moteur
complet de précédence/disclosure/recours.

### Gaps restants

- Priorité entre policies en cas de conflit bloquant.
- Format exact de MANDATE et signature.
- Règle de batching des escalades pour éviter saturation du PRINCIPAL.
- Limites de disclosure standard par type de CONTROL.
- Passage éventuel à un médiateur inter-contrat V2.

---

## Synthèse des besoins transverses

Ces trois tracks font émerger les mêmes besoins de protocole :

- **Scope first-class** : chaque rôle, policy, engagement et trace doit être attaché à un scope explicite.
- **Policy first-class** : durable, versionnée, applicable par scope, avec source authority et adoption mode, distincte de l'engagement.
- **External authority** : un acteur externe peut imposer une policy sans être subordonné à l'organisation.
- **Controls forts mais minimisés** : CONTROL doit couvrir audit, veto, alerte, validation de policy, exception et preuve sans accès excessif aux données brutes.
- **Contracts-cadres vs engagements** : un CONTRACT durable peut générer plusieurs engagements opérationnels.
- **Héritage et conflit** : policies locales, fédérées, contractuelles et publiques peuvent se contredire.
- **Accountability multi-niveaux** : PRINCIPAL local, EXECUTIF global, CONTROL et autorité externe doivent être auditables simultanément.
- **Mandat et signature** : un scope ne signe pas ; une instance mandatée signe pour une partie ou un scope.
- **Négociation déterministe** : sans médiateur, il faut ledger, états, hashes, signatures et règles de stale proposal.

## Questions à instruire ensuite

1. Quel schema minimal pour `CONTRACT` : parties, scopes, policies, obligations, droits, engagements dérivés, signatures, preuves, amendements ?
2. Un contrat-cadre durable est-il un `CONTRACT` sans engagement immédiat, ou doit-il contenir des templates d'engagement ?
3. Comment représenter une autorité externe obligatoire : CONTROL externe, EXECUTIF public, ou rôle dédié ?
4. Quelle règle de précédence entre policy interne, policy contractuelle, policy fédérée et policy publique ?
5. Quel niveau minimal d'audit pour taxes, régulation, actionnaires et investisseurs ?
6. Quel schema minimal pour `MANDATE` et `SIGNATURE` ?
7. Quels conflits doivent bloquer une signature en V1 ?
8. Faut-il un rôle d'adjudication/recours canonique, ou une AUTHORITY externe suffit-elle ?
