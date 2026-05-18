# Vocabulaire — V1.7 (FIGÉ 2026-05-17)

> **Statut** : §1-5 (Acteurs, substrat, flux par défaut, flux exceptionnels, non-acteurs) **FIGÉS V1.7** suite à validation utilisateur (DEC-007 à DEC-009), précision MANDATAIRE (DEC-013), routing `alert` (DEC-014), cadrage multi-humain/EXECUTIF/POLICY (DEC-015/016), EXECUTIF rôle séparé (DEC-017), CONTRACT/POLICY/ENGAGEMENT (DEC-018), REGISTRY/NEGOTIATION (DEC-019), signature par autorité mandatée (DEC-021), stabilisation sans médiateur (DEC-022), distinction CONTROL/ENFORCEMENT_PLAN (DEC-023), et escalade vers autorité de scope (DEC-024). §7 (Pile contractuelle) **RÉVISÉ V1.2** (DEC-018/023). §6 reste ouvert par construction (questions volontairement non tranchées, traitées au fur et à mesure).
>
> **Pourquoi ce document existe** : pendant le brainstorming, j'avais conflé plusieurs concepts (notamment "consultation" entre agents, agent→conductor, agent→humain). Cette page repart de `INTENTION.md` pour poser un glossaire propre, support de toutes les specs aval.
>
> **Convention pour la suite** : toute spec produite doit référencer les acteurs/concepts par leur nom canonique défini ici. Toute proposition de renommage ou modification sémantique = nouvelle DEC dans `DECISIONS.md` + bump V1.x.

---

## 0. Re-fondations issues de l'intention initiale

Trois phrases du verbatim utilisateur dictent toute la suite :

1. *« Le rôle conductor est essentiel : il permettra à **l'humain de piloter** un cheptel d'agents sous supervision / responsabilité d'un conductor. »*
   → **L'humain est le pilote**. Le conductor est l'**instrument** par lequel il pilote.
   → Le conductor **supervise** le cheptel et en **porte la responsabilité** (face à l'humain).

2. *« Une collab entre CLI de façon flexible. »*
   → Les agents collaborent **entre pairs** — pas tout n'a vocation à remonter au conductor.

3. *« Un humain peut prendre le contrôle d'un agent, ou d'un des conductors. »*
   → Le **takeover** est explicitement nommé comme un cas distinct du fonctionnement normal.

**Conclusion** : l'humain n'est pas un "expert externe qu'on consulte". Il est résident dans la boucle **au-dessus du conductor par défaut** ; il descend dans la boucle (takeover) ou répond à des **escalades** quand le conductor ne peut/veut pas trancher.

---

## 1. Acteurs primaires

Six types d'acteurs. Chacun a une **présence par défaut** (où il vit dans la boucle) et un **mode d'activation** (quand il intervient).

### 1.1 PRINCIPAL — l'humain en fonction exécutive (DEC-009)

- **Qui** : l'humain (ou les humains) qui exerce la **fonction exécutive** sur l'engagement : possède l'objectif, autorise, ratifie, accepte. Pas un consultant externe — un décideur ultime.
- **Présence par défaut** : **au-dessus** du conductor, **hors** de la boucle opérationnelle.
- **Interventions natives** :
  - Brief initial (rédige ou valide le charter de l'engagement).
  - Répond aux **escalades** remontées par le conductor (ou plus rarement par un agent ou un control).
  - **Takeover** ponctuel d'un agent ou d'un conductor (REQ-013/014).
  - Accepte le livrable final (clôture).
- **Synonymes envisagés** : `human-principal`, `commanditaire`, `owner`, `executive`. **Question ouverte** : un seul PRINCIPAL par engagement, ou plusieurs (copropriété d'engagement) ?

### 1.2 CONDUCTOR — le délégué qui pilote au nom du PRINCIPAL

- **Qui** : l'instrument de pilotage de l'engagement. Souvent un agent CLI ; **peut être un humain** si le PRINCIPAL choisit de conduire lui-même.
- **Présence par défaut** : **dans la boucle**, sommet de l'arbre de l'engagement.
- **Responsabilités** :
  - Décompose le goal en assignments pour les agents.
  - Supervise l'exécution, consolide les outputs.
  - Tranche les décisions opérationnelles.
  - **Channel par défaut** PRINCIPAL ↔ cheptel : tout ce qui vient du PRINCIPAL atterrit au conductor, et c'est le conductor qui remonte au PRINCIPAL.
  - Propose la plupart des amendements ordinaires (DEC-004).
- **Synonymes envisagés** : `conductor`, `chef-d-orchestre`, `lead`, `pilot-delegate`. **Question ouverte** : un seul conductor par engagement, ou plusieurs (co-conduction) ?

### 1.2.bis EXECUTIF — le responsable de l'activité d'ensemble (DEC-016)

- **Qui** : rôle canonique séparé de PRINCIPAL (DEC-017), humain ou agentique, responsable d'un scope supérieur couvrant plusieurs PRINCIPAUX, leurs mini-organisations, leurs CONDUCTORS, leurs AGENTS et leurs CONTROL.
- **Présence par défaut** : **au-dessus ou autour** des mini-organisations fédérées. L'EXECUTIF porte l'accountability du scope d'ensemble, sans supprimer l'autorité locale des PRINCIPAUX.
- **Interventions natives** :
  - Définit ou ratifie l'intention d'ensemble.
  - Crée ou ratifie des engagements d'ensemble.
  - Arbitre les conflits entre PRINCIPAUX, mini-organisations, policies ou CONTROL.
  - Ratifie les policies globales et les exceptions majeures.
  - Reçoit des escalades d'ensemble quand le PRINCIPAL local n'est pas l'autorité suffisante.
- **Ne fait pas par défaut** : piloter le travail quotidien de chaque mini-organisation. Ce pilotage reste au PRINCIPAL local et à ses CONDUCTORS, sauf engagement ou takeover explicite.
- **Synonymes envisagés** : `executive`, `sponsor`, `portfolio-owner`, `program-owner`. **Règle schema** : toujours représenter `{instance, role, scope}` ; une même INSTANCE peut être PRINCIPAL sur un scope et EXECUTIF sur un autre.

### 1.3 AGENTS — les opérateurs (DEC-008)

- **Qui** : acteurs (CLI tier — Claude Code, Codex, Gemini, … — ou humain en mode operator) qui **exécutent** le travail dans le cadre de leurs slots de rôle. Pluriel par convention : on raisonne sur le cheptel, pas sur l'individu.
- **Présence par défaut** : **dans la boucle**, chacun lié à un slot pour la durée de son binding.
- **Flux natifs** :
  - Reçoivent des assignments du conductor (vertical).
  - **Collaborent entre pairs** (horizontal) — c'est explicitement la "collab entre CLI" de l'intention.
  - Reportent au conductor (status, livrable, blocage).
  - Peuvent, dans des cas définis, demander une décision au PRINCIPAL via escalade.

#### 1.3.bis SUBAGENTS — la profondeur réservée (DEC-008)

- **Qui** : agents enfants opérant à l'intérieur du scope d'un AGENT (ex. l'Agent tool de Claude Code, les subagents de Codex, …).
- **Statut V1** : **internes à l'AGENT**, non adressables par le protocole, non visibles individuellement par CONTROL ou MANDATAIRE. L'AGENT consolide.
- **Statut V2 anticipé** : first-class — slots, bindings, audit et takeover à la granularité subagent.
- **Pourquoi cette réserve** : ne pas bloater V1, mais éviter de se peindre dans un coin (le protocole V1 doit pouvoir évoluer vers V2 sans break).
- **Question ouverte** (différée) : à quel moment on bascule en V2 ? Critère d'activation à définir.

### 1.4 CONTROL — les fonctions de contrôle cross-tree (DEC-007)

- **Qui** : rôles **non subordonnés** au conductor. Exemples canoniques : **cyber, finance, éthique, legal, qualité**. Tenu par un agent CLI ou un humain.
- **Pourquoi ce nom** : DEC-007 — toutes les fonctions transverses observées sont des fonctions de contrôle ; nommer par la fonction (CONTROL) plutôt que par la topologie ("transverse"). La propriété cross-tree reste vraie.
- **Présence par défaut** : **dans la boucle**, attaché au scope de l'engagement, **hors de l'arbre de subordination**.
- **Droits natifs** :
  - Observation / audit cross-tree selon les droits de disclosure du scope. Un CONTROL ne lit pas automatiquement tout : il peut recevoir vues redigées, hashes, attestations ou evidence packages.
  - Ajout de contraintes au charter (auto-signé pour son propre domaine — DEC-004).
  - Veto sur certaines actions (à définir par convention de chaque CONTROL).
  - Alerte/notification vers le conductor ou le PRINCIPAL (via `alert`, avec court-circuit contrôlé possible — DEC-014).
- **Synonymes envisagés** : `control`, `control-role`, `oversight`. **Question ouverte** : un CONTROL parle-t-il aux agents directement, ou seulement via le conductor ?

### 1.5 MANDATAIRE — le présentateur neutre

- **Qui** : rôle **built-in du protocole** (pas tenu par un humain en général ; rendu par un sous-agent dédié, possiblement l'implémentation de référence).
- **Présence par défaut** : **inactif**, instancié à la demande quand une décision nécessite une présentation neutre.
- **Interventions** :
  - Met en forme et présente les options sans biais pour les escalades `decide` et `alert` vers le PRINCIPAL (DEC-013).
  - N'est pas requis sur `advise`, qui reste un chemin léger non bloquant (DEC-013).
  - Conduit les votes de quorum (DEC-004).
  - Mène la session de signature pour les takeovers humains.
- **Ne fait jamais** : voter, décider, choisir le wording d'une question dans un sens favorable à un acteur.
- **Ne fait pas non plus** : médiation, arbitrage, jugement, résolution de deadlock. Ces décisions appartiennent à l'autorité compétente du scope (DEC-024).
- **Synonymes envisagés** : `mandataire`, `notary`, `clerk`, `arbiter`. **Question ouverte** : faut-il un mandataire dédié par engagement, ou un mandataire global "de service" qui sert plusieurs engagements ?

---

## 2. Substrat : INSTANCE, SCOPE, PARTY, AUTHORITY, MANDATE, SLOT, BINDING, CONTRACT, POLICY, REGISTRY, NEGOTIATION

Concepts à ne pas confondre :

- **INSTANCE** — une entité concrète (ex. `claude-code:session-42`, ou `human:alice@org`). Stable, identifiable.
- **SCOPE** — périmètre d'application : mini-organisation, engagement, fédération, programme, territoire, contrat, domaine réglementaire. Un scope ne signe jamais.
- **PARTY** — partie engagée par un artefact contractuel : humain, organisation, fédération, administration, fournisseur, client, etc.
- **AUTHORITY** — INSTANCE ou quorum habilité à décider/signifier pour une PARTY ou un SCOPE.
- **MANDATE** — délégation explicite qui lie `{instance, role, scope, rights}` et précise ce que l'autorité peut négocier, signer, refuser ou escalader.
- **RÔLE** (template) — un contrat réutilisable défini hors engagement (ex. *Conductor*, *Reviewer*, *Cyber*). Décrit responsabilités, droits de signature, format des outputs attendus.
- **SLOT** — un placeholder dans un engagement (ex. dans l'engagement `ship-v1`, le slot `Conductor` existe).
- **BINDING** — l'attachement d'une INSTANCE à un SLOT pour une durée (ex. `alice` est bind à `Conductor` jusqu'à la clôture). Un binding peut être amendé (changement, takeover humain temporaire, etc.).
- **CONTRACT** — un conteneur normatif applicable à des parties/scopes et signé par les autorités mandatées. Il peut contenir policies, obligations, droits, clauses, références externes, et instancier un ou plusieurs engagements.
- **POLICY** — une règle durable, versionnée et applicable à un scope. Une policy contraint les contracts, engagements et actions ; elle peut être autonome ou clause d'un CONTRACT. Elle déclare `sourceAuthority` et `adoptionMode` (`ratified`, `contractual`, `imposed`, `acknowledged`).
- **REGISTRY** — répertoire runtime des INSTANCE, rôles, scopes, endpoints, capabilities, clés et policies acceptées. Il sert à la découverte et à l'adressage ; il ne décide rien.
- **NEGOTIATION** — session transitoire de proposition/contre-proposition/signature pour stabiliser un CONTRACT, une POLICY, un ENGAGEMENT ou un amendement. Elle suit un ledger append-only et n'est applicable qu'une fois l'artefact signé stabilisé.
- **OBLIGATION** — devoir imposé ou accepté : livrer, payer, déclarer, ne pas faire, maintenir une preuve, respecter une échéance. Peut être ponctuel ou récurrent.
- **RIGHT** — droit ou permission : audit, accès, veto, usage, paiement, décision réservée, recours.
- **CLAUSE** — fragment normatif dans un CONTRACT/POLICY/ENGAGEMENT : obligation, droit, condition, exception, confidentialité, escalade, termination.
- **EVIDENCE_PACKAGE** — paquet de preuve partageable avec disclosure contrôlée : documents, hashes, attestations, logs, signatures, redactions.

Une même instance peut tenir plusieurs slots dans plusieurs engagements, ou (à valider) plusieurs slots dans le même engagement.

---

## 3. Flux par défaut (sans escalade, sans takeover)

```
EXECUTIF ──┐ (intention d'ensemble / policy globale / arbitrage inter-périmètres)
           │
PRINCIPAL ─┤ (brief / amendement / réponse-d'escalade)
           ▼
      CONDUCTOR ◄──────► CONTROL  (audit, contrainte, veto)
      │   ▲
      │   │ (status, report, demande d'arbitrage)
      ▼   │
     AGENTS ◄──► AGENTS            (collab "entre CLI")
     │
     └─► SUBAGENTS (internes à chaque AGENT en V1)
```

Trois flux "normaux" :
1. **Vertical descendant** : PRINCIPAL → CONDUCTOR → AGENTS (assignment).
2. **Vertical montant** : AGENTS → CONDUCTOR → (selon besoin) PRINCIPAL (report).
3. **Latéral** : AGENT ↔ AGENT (collab) ; CONTROL ↔ tout acteur (observation + contrainte).
4. **Fédéré** : EXECUTIF ↔ PRINCIPAUX/CONDUCTORS/CONTROL quand un scope d'ensemble existe.

**Aucune "consultation à l'humain" n'existe dans le flux par défaut** : si un agent a besoin d'une décision, il la demande à son conductor, qui décide ou escalade.

---

## 4. Flux exceptionnels

### 4.1 Escalade
Un acteur demande explicitement l'arbitrage de l'**autorité compétente du scope** parce qu'il ne peut/veut pas trancher dans son mandat.
- AGENT → CONDUCTOR : pas une "escalade" — c'est le flux normal montant. Pas besoin de mandataire.
- CONDUCTOR → PRINCIPAL : cas mono-humain par défaut, via `advise`, `decide` ou `alert` (DEC-012). MANDATAIRE requis sur `decide`/`alert`, pas sur `advise` (DEC-013).
- CONDUCTOR/CONTROL/AGENT → EXECUTIF, quorum, autorité externe ou recours : cas fédéré, contractuel ou gouvernemental (DEC-024).
- AGENT → PRINCIPAL ou CONTROL → PRINCIPAL : **escalade exceptionnelle**, conditionnée (ex. CONTROL cyber détecte un acte conducteur problématique). `alert` peut court-circuiter le CONDUCTOR de façon contrôlée : copie par défaut, exclusion possible avec raison tracée (DEC-014).

### 4.2 Takeover
Le PRINCIPAL substitue son INSTANCE à un binding existant.
- **takeover-agent** : PRINCIPAL devient l'agent sur un slot le temps de N actions ou d'une durée.
- **takeover-conductor** : PRINCIPAL pilote directement, le conductor délégué est suspendu.
- Régi par **amendement signé** (DEC-004) ; mandataire mène la session.

---

## 5. Ce qui n'est PAS un acteur du protocole

À ne pas confondre avec les acteurs :

- **CLI hôte** (Claude Code, Codex, Gemini, autre) — c'est le *substrat technique* qui héberge un agent, pas l'agent lui-même.
- **WORKSPACE** — le répertoire local d'un agent (utile pour le transport local-files), pas un acteur.
- **TRANSPORT** (local-files, MCP central, remote) — couche basse, transparente pour le vocabulaire des acteurs.
- **ENGAGEMENT** — c'est un artefact opérationnel qui a un scope, pas un acteur et pas le scope lui-même.
- **CHARTER** — c'est le *document* qui décrit l'engagement, pas un acteur.
- **CONTRACT** — c'est un *artefact normatif*, pas un acteur. Il peut contenir ou référencer policies et engagements.
- **POLICY** — c'est une *règle durable de scope*, pas un acteur et pas un engagement. Elle est appliquée, auditée ou proposée par des acteurs, souvent CONTROL ou EXECUTIF.
- **REGISTRY** — c'est un service ou dossier de découverte, pas une autorité. Le fait d'être inscrit ne vaut pas droit d'agir.
- **NEGOTIATION** — c'est une session de convergence, pas un contrat. Elle produit éventuellement un artefact signé stabilisé.
- **MEDIATOR inter-contrat** — absent de la V1. Les conflits globaux entre contrats sont détectés/tracés puis escaladés, pas résolus automatiquement par un acteur caché.
- **ENFORCEMENT_PLAN** — c'est le plan d'application des règles, pas un acteur. Des acteurs CONTROL peuvent l'exécuter ou l'auditer.

---

## 6. Questions ouvertes (à trancher dans les prochaines passes)

1. **Unicité** : un PRINCIPAL et un CONDUCTOR uniques par engagement, ou pluralité possible ?
2. **Humain-comme-agent** : le PRINCIPAL en mode operator est-il indistinguable d'un agent CLI au niveau du protocole, ou il y a une marque "this is human" sur le binding ?
3. **CONTROL → AGENTS directement** : oui (cohérent avec audit cross-tree), ou seulement via le conductor (cohérent avec une seule chaîne de commandement) ?
4. **Mandataire** : par engagement ou de service ? Si built-in, comment garantir/vérifier sa neutralité ?
5. **AGENT ↔ AGENT en collab** : la collaboration latérale est-elle libre ou doit-elle être déclarée au conductor (a posteriori ? a priori ?) ?
6. **SUBAGENTS V2** : critère/déclencheur du passage SUBAGENTS internes → first-class ? (Différée, V1 reste avec subagents internes.)
7. **Multi-humain pair-à-pair** : règles exactes de passage de PRINCIPAL ↔ PRINCIPAL vers CONDUCTOR ↔ CONDUCTOR puis ENGAGEMENT partagé.
8. **Humain multi-rôle** : comment représenter un même humain tenant simultanément PRINCIPAL local, rôle opérationnel, CONTROL ou EXECUTIF ?
9. **CONTRACT** : schema minimal, signatures, parties, droits, obligations, policies, engagements dérivés.
10. **POLICY** : cycle de vie, signature, héritage, précédence et résolution de conflit entre scopes.
11. **CONTROL ↔ POLICY/CONTRACT** : quels droits minimaux par domaine (proposer, imposer, auditer, veto, alerter) ?
12. **REGISTRY** : central MCP, local-files, remote, ou plusieurs registries synchronisables ?
13. **NEGOTIATION** : format minimal d'offer/counteroffer, délais, expiration, quorum, hash canonical.
14. **Sans médiateur inter-contrat** : quels conflits doivent seulement être signalés, et lesquels doivent bloquer une signature ?
15. **Adjudication/recours** : faut-il un rôle canonique séparé pour tribunal/arbitre, ou une autorité externe suffit-elle en V1 ?
16. **Disclosure CONTROL** : quels niveaux standards de redaction/preuve faut-il imposer dans les contracts cross-organisation ?

---

## 7. Pile contractuelle (V1.2 — révisée DEC-018/023)

> **Motivation** : un contrat réel mélange souvent règles durables, obligations, droits, missions exécutables, preuves et mécanismes d'application. La pile ne doit donc pas faire de `POLICY` une cinquième couche linéaire. Elle distingue les artefacts normatifs (`CONTRACT`, `POLICY`, `ENGAGEMENT`) du plan d'application (`ENFORCEMENT_PLAN`).

### 7.1 INTENTION — le pourquoi

- **Définition** : objectif de haut niveau, value-driven, possiblement peu structuré. Énonce une finalité, pas une exécution.
- **Source** : PRINCIPAL ou EXECUTIF selon le scope.
- **Exemples** : *"livrer la v1 produit avant fin Q3"*, *"remédier à l'incident sécurité du 12 mai"*, *"atteindre conformité RGPD"*, *"piloter un cheptel d'agents CLI" (← notre cas)*.
- **Propriétés** : narrative, persistante, peut survivre à plusieurs specs, contracts et engagements.
- **Pas exécutable directement** — c'est l'amont de la chaîne.

### 7.2 SPÉCIFICATION — le quoi mesurable

- **Définition** : traduction d'une intention en **exigences vérifiables**, classées (fonctionnelles, non-fonctionnelles, contraintes de CONTROL).
- **Source** : draft par PRINCIPAL, EXECUTIF ou CONDUCTOR ; revue par CONTROL pour les contraintes de domaine ; ratifiée par l'autorité appropriée.
- **Propriétés** : numérotée, traçable, validable, idéalement testable.
- **Pas exécutable directement**, mais sert de critère d'acceptance et de référence aux artefacts contractuels.

### 7.3 Artefacts contractuels — ce qui lie les parties

#### 7.3.1 CONTRACT — le conteneur normatif signé (DEC-018/021)

- **Définition** : conteneur normatif applicable à des parties/scopes et signé par les autorités mandatées.
- **Contenu possible** : policies, obligations, droits, parties, rôles, clauses de contrôle/escalade, preuves, références externes, modalités d'amendement.
- **Relation aux engagements** : un contract peut instancier un ou plusieurs engagements, ou définir des conditions sous lesquelles des engagements seront créés.
- **Exemples** : contrat fournisseur, contrat client, contrat employé, pacte d'actionnaires, contrat-cadre, convention de partenariat, règlement d'une plateforme.

#### 7.3.2 POLICY — la règle durable de scope (DEC-016/018)

- **Définition** : règle durable, versionnée et applicable à un scope organisationnel.
- **Source** : PRINCIPAL local, EXECUTIF, CONTROL, contract, autorité externe ou engagement de gouvernance selon le scope.
- **Portée** : mini-organisation, engagement, contract, fédération, activité d'ensemble, territoire, domaine réglementaire.
- **Deux formes** : autonome (ex. policy interne, loi, règlement) ou clause/règle contenue dans un CONTRACT.
- **Adoption** : `ratified` (ratifiée localement), `contractual` (acceptée par contrat), `imposed` (loi/taxe/règlement), ou `acknowledged` (reconnue sans consentement normatif local).
- **Relation aux engagements** : un engagement référence les policies applicables ; une violation ou dérogation déclenche trace, contrôle, veto ou escalade selon le domaine.

#### 7.3.3 ENGAGEMENT — le contrat opérationnel exécutable (DEC-003/018/021)

- **Définition** : artefact opérationnel exécutable qui a un scope concret, un charter, des role bindings, des controls attachés, des policies applicables, des success criteria et un journal.
- **Source** : CONDUCTOR ou EXECUTIF/PRINCIPAL selon le scope ; signataires selon table de gouvernance.
- **Lifecycle** : charter vivant + amendements signés.
- **Relation aux contracts** : peut être autonome ou dérivé d'un CONTRACT plus large.
- **Exécutable** : c'est ici que les acteurs travaillent et que les preuves d'exécution s'accumulent.

### 7.4 ENFORCEMENT_PLAN / ESCALADE — le plan d'application

- **Définition** : plan transversal qui applique et vérifie INTENTION, SPEC, CONTRACT, POLICY et ENGAGEMENT.
- **Ce que ce n'est pas** : pas un contrat, pas une policy, pas un engagement ; c'est la gestion de leur application.
- **Mode normal** : observation, audit, validation, veto, contrôle de conformité, preuve, disclosure minimisée.
- **Mode exception** : `advise`, `decide`, `alert`; MANDATAIRE requis sur `decide`/`alert`, pas sur `advise`; `alert` autorise un court-circuit contrôlé du CONDUCTOR.
- **Boucles de correction** : peut provoquer amendement d'engagement, exception de policy, révision de contract, révision de spec ou clarification d'intention.

### 7.5 Relations entre couches et artefacts

```
[INTENTION]                         ← pourquoi / direction
     │ raffinée en
     ▼
[SPÉCIFICATION]                     ← quoi vérifiable
     │ contractualisée par
     ▼
[CONTRACT / POLICY / ENGAGEMENT]    ← ce qui lie, contraint, engage
     │ exécuté dans
     ▼
[ACTIONS + JOURNAUX + PREUVES]      ← travail observable

[ENFORCEMENT_PLAN / ESCALADE]       ← applique, audite, alerte, route l'arbitrage
     ▲             │
     └─────────────┴── peut corriger contract, policy, engagement, spec ou intention
```

- 1 INTENTION → N SPÉCIFICATIONS.
- 1 SPÉCIFICATION → N CONTRACTS/POLICIES/ENGAGEMENTS.
- 1 CONTRACT → N POLICIES et/ou N ENGAGEMENTS.
- 1 POLICY → N scopes et N engagements contraints.
- 1 ENGAGEMENT → N actions, journaux et preuves.
- ENFORCEMENT_PLAN/ESCALADE s'attache à n'importe quel niveau contrôlable.
- REGISTRY permet aux acteurs de se découvrir ; NEGOTIATION permet de produire ou amender les artefacts contractuels.

### 7.6 Questions ouvertes pile contractuelle

1. **Numérotation et identité** : standardiser `INT-NNN` / `SPEC-NNN` / `CONTRACT-NNN` / `POLICY-NNN` / `ENG-NNN` ?
2. **Versioning** : quels artefacts sont immuables + amendements signés, et lesquels restent éditables par leur autorité ?
3. **CONTRACT minimal** : parties, scopes, policies, engagements, clauses d'escalade, signatures, preuves, amendements.
4. **Contrat-cadre** : un master agreement est-il un CONTRACT sans engagement immédiat, ou un CONTRACT avec engagement-template ?
5. **Autorité externe** : comment représenter loi/règlement/taxe imposés sans consentement contractuel local ?
6. **Précédence** : règle de conflit entre policy interne, contractuelle, fédérée et publique.
