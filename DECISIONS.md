# Journal de décisions de design

> **Rôle dans la pile contractuelle (DEC-010)** : ce fichier trace les **choix** faits pour satisfaire `SPEC.md` à partir de `INTENTION.md`. Ce n'est pas une couche de la pile en soi — c'est l'historique des arbitrages.
> **Convention** : `DEC-NNN`, numérotation continue, append-only. Chaque DEC référence les REQs concernés. Une décision révisée → nouvelle DEC qui révise explicitement l'ancienne (pas d'édition silencieuse).
> **Aval** : référencer ces DEC depuis les specs détaillées (`specs/SPEC-*.md`).

## DEC-001 — Périmètre de la spec n°1
**Date** : 2026-05-16. **Réfère** : REQ-001, REQ-007, REQ-010, REQ-013, REQ-014.

**Décision** : Spec n°1 = **Protocole core + Modèle org/rôles/HITL** (fusion des options A et C du scoping initial). La tranche verticale local-files (option B) sera traitée dans la spec n°2.

**Pourquoi** : le contrat et l'organisation se définissent mutuellement, les figer séparément ferait diverger les deux.

## DEC-002 — Modèle d'organisation
**Date** : 2026-05-16. **Réfère** : REQ-007, REQ-008, REQ-010, REQ-021.

**Décision** : **Rôles-templates + engagements ad-hoc** (option C). Les rôles sont des contrats réutilisables, instanciés dans des engagements (= missions concrètes avec scope défini). Les CONTROLS sont des rôles attachés au scope d'un engagement avec droits cross-tree. **Mappable** vers un org-chart classique pour visualisation (REQ-021).

**Pourquoi** : reflète comment les vraies orgs marchent, accueille nativement les CONTROLS, le HITL devient propre (binding humain ↔ slot de rôle).

## DEC-003 — Lifecycle d'engagement
**Date** : 2026-05-16. **Réfère** : REQ-022, REQ-023, REQ-024.

**Décision** : **Charter vivant + amendements signés**. Tout engagement démarre avec un charter initial (goal, bindings, CONTROLS, success criteria). Toute évolution (scope, bindings, CONTROLS attachés, contraintes, pause/reprise, clôture) passe par un **amendement signé** par l'autorité appropriée. La séquence d'amendements EST l'historique vérifiable de l'engagement.

**Pourquoi** : seul moyen de tenir à la fois REQ-024 (exécutable sans ambiguïté — un charter existe à tout instant), REQ-022 (validable), REQ-023 (changeable de façon contrôlée).

## DEC-004 — Gouvernance des amendements
**Date** : 2026-05-16. **Réfère** : DEC-003, REQ-011.

**Décision** : **Table déclarative typée + quorum M-of-N pour amendements sensibles** (option C). La spec n°1 livre la mécanique des deux ; la classification "ordinaire vs sensible" sera affinée par domaine.

**Pourquoi** : A (CONDUCTOR sole signer) viole REQ-011 et l'autonomie des CONTROLS ; B (table seule) couvre le quotidien mais manque de filet pour les ops vraiment risquées ; C concilie les deux.

## DEC-005 — MANDATAIRE = rôle built-in
**Date** : 2026-05-16. **Réfère** : REQ-027.

**Décision** : Pour tout vote de quorum ET pour toute escalade vers le PRINCIPAL, un rôle dédié — **MANDATAIRE** — formule la question et présente les options aux décideurs sans le biais du proposant. Ne vote pas, ne décide pas.

**Pourquoi** : sans présentation neutre, un proposant manipule la décision par la formulation. Analogue protocolaire du notaire / clerc de séance. À spécifier : qui peut tenir ce rôle, sa relation aux autres rôles, sa neutralité vérifiable.

## DEC-006 — Escalade vers PRINCIPAL = primitive first-class
**Date** : 2026-05-16. **Réfère** : REQ-026.

**Décision** : L'escalade vers le PRINCIPAL est une primitive first-class du protocole, **distincte du mécanisme d'amendement**. N'importe quel rôle peut déclencher une escalade ; le protocole gère canal, attente, timeout, action de repli (REQ-028), trace.

**Pourquoi** : retour utilisateur explicite — l'avoir traité comme un amendement parmi d'autres était une erreur de design qui aurait rendu la moitié des cas d'usage humains forcés dans un format de cosignature inadapté (ex. "agent demande conseil au PRINCIPAL" n'a rien à voir avec "changer le charter").

## DEC-007 — Renommage TRANSVERSE → CONTROL
**Date** : 2026-05-16. **Réfère** : REQ-008, REQ-009.

**Décision** : Renommer le rôle "TRANSVERSE" en **CONTROL**. Toutes les fonctions transverses identifiables sont des fonctions de contrôle (cyber, finance, éthique, legal, qualité). La topologie cross-tree reste vraie mais devient une *propriété* de CONTROL, pas son nom.

**Pourquoi** : nommer une chose par ce qu'elle fait, pas par où elle se trouve.

## DEC-008 — AGENT → AGENTS + couche SUBAGENTS prévue
**Date** : 2026-05-16. **Réfère** : REQ-001, REQ-002.

**Décision** : Pluriel par convention "AGENTS". Prévoir la couche **SUBAGENTS** (les CLI hôtes en ont nativement). **V1 par défaut** : SUBAGENTS internes à l'AGENT (non adressables, non auditables individuellement par le protocole) — l'AGENT consolide. **V2 anticipée** : SUBAGENTS first-class (slots, bindings, audit, takeover possibles à la granularité subagent).

**Pourquoi** : ne pas bloater V1, mais réserver l'espace conceptuel pour ne pas se peindre dans un coin.

## DEC-009 — PRINCIPAL conservé, qualifié "fonction exécutive"
**Date** : 2026-05-16. **Réfère** : REQ-013, REQ-014.

**Décision** : Le nom PRINCIPAL reste, la description précise que l'humain PRINCIPAL exerce une **fonction exécutive** (autorité ultime, fixe direction, ratifie). Aucune décision technique, clarification de description.

**Pourquoi** : retour utilisateur.

## DEC-010 — Pile contractuelle à 4 couches
**Date** : 2026-05-16. **Réfère** : REQ-022, REQ-024.

**Décision** : **INTENTION → SPÉCIFICATION → ENGAGEMENT → CONTRÔLE/ESCALADE**. Définit la chaîne de raffinage depuis l'objectif vague vers l'action mesurable, exécutée et auditée. Matérialisée dans le repo par les fichiers `INTENTION.md`, `SPEC.md`, et `DECISIONS.md` (ce fichier). La couche ENGAGEMENT vit dans les engagements réels (charters + amendements) ; la couche CONTRÔLE/ESCALADE est opérationnelle et tracée dans les journaux d'engagement.

**Pourquoi** : tracer la chaîne du vague vers l'exécuté de façon explicite, lisible et amendable. Détails par couche dans `VOCABULARY.md §7`.

## DEC-012 — 3 primitives d'escalade : `advise` + `decide` + `alert`
**Date** : 2026-05-16. **Réfère** : REQ-026, REQ-028, DEC-006.

**Décision** : Le protocole expose **trois primitives distinctes** pour l'escalade d'un rôle vers le PRINCIPAL :

- **`advise`** — non bloquant. Le rôle demande un avis ; il continue son travail et applique le fallback déclaré au timeout (REQ-028). Latence faible attendue.
- **`decide`** — bloquant. Gate de décision avec timeout + repli déclaré. Le rôle attend la réponse avant d'agir.
- **`alert`** — urgent. Canal prioritaire, notification immédiate, routing potentiellement court-circuit du CONDUCTOR. Surtout utilisé par les CONTROL sur incident (cyber, conformité, etc.). Sémantique d'urgence first-class.

**Périmètre** : ces trois primitives couvrent **uniquement** l'escalade vers le PRINCIPAL. Le takeover (PRINCIPAL prend la place d'un binding) et le vote de quorum sur amendement sensible passent par le mécanisme d'amendement défini en DEC-004, pas par ces primitives.

**Pourquoi** : 
- `advise` vs `decide` ont des sémantiques bloquantes fondamentalement différentes — les confondre serait une source de bugs subtils.
- `alert` mérite d'être first-class plutôt qu'une flag sur `decide` parce que (1) son routing diffère (potentiellement court-circuit), (2) ses garanties de latence sont distinctes, (3) son émetteur typique (CONTROL) a une posture différente de celle d'un AGENT/CONDUCTOR en flux normal.
- Surface API à 3 verbes typés reste petite et lintable, donne des signaux clairs au PRINCIPAL.

**À spécifier en aval** : implication du MANDATAIRE sur chacune (DEC à venir), règles de routing d'`alert` (via CONDUCTOR ou court-circuit), taxonomie des fallbacks de timeout (REQ-028).

## DEC-011 — Split `INTENT.md` en 3 fichiers selon la pile
**Date** : 2026-05-16. **Réfère** : DEC-010.

**Décision** : Séparer l'ancien `INTENT.md` (qui mélangeait les 3 couches narrative+REQs+DECs) en :
- `INTENTION.md` : verbatim utilisateur + reformulation narrative + périmètre projet
- `SPEC.md` : toutes les `REQ-NNN`
- `DECISIONS.md` : toutes les `DEC-NNN` (ce fichier)

`INTENT.md` est ensuite renommé `README.md` pour servir d'index minimal du repo (convention universelle) et lever l'ambiguïté avec `INTENTION.md`.

**Pourquoi** : matérialise DEC-010 dans la structure du repo ; chaque type d'artefact a sa maison ; la lecture cible (intention pour cadrage, spec pour exigences, decisions pour traçabilité) ne mélange plus. Le rename `INTENT.md → README.md` lève la collision visuelle avec `INTENTION.md`.

## DEC-013 — MANDATAIRE requis sur `decide` et `alert`, pas sur `advise`
**Date** : 2026-05-16. **Réfère** : REQ-026, REQ-027, REQ-028, DEC-005, DEC-012.

**Décision** : Dans les trois primitives d'escalade vers le PRINCIPAL définies par DEC-012, le MANDATAIRE est :

- **requis sur `decide`** : la décision bloque l'action et engage le PRINCIPAL sur un choix ; les options doivent être présentées sans biais par le proposant.
- **requis sur `alert`** : l'urgence et le risque de court-circuit du CONDUCTOR augmentent le besoin de neutralité, même si la latence doit rester prioritaire.
- **non requis sur `advise`** : l'avis est non bloquant ; le rôle peut formuler directement sa demande pour garder un chemin léger. Le fallback déclaré au timeout reste obligatoire.

**Révision de DEC-005** : DEC-005 reste vraie pour les votes de quorum et pour les escalades qui demandent une décision ou signalent une alerte. Elle ne s'applique pas automatiquement au cas `advise`.

**Pourquoi** : `advise` doit rester une primitive de faible friction pour demander un avis sans interrompre le travail. `decide` et `alert` portent un enjeu plus fort : décision bloquante ou incident prioritaire. La neutralité du MANDATAIRE y est donc une garantie du protocole, pas une option.

**À spécifier en aval** : format minimal d'une demande `advise`, format de présentation du MANDATAIRE pour `decide`/`alert`, et règles de latence/routing quand `alert` requiert un MANDATAIRE.

## DEC-014 — `alert` autorise un court-circuit contrôlé du CONDUCTOR
**Date** : 2026-05-17. **Réfère** : REQ-026, REQ-027, REQ-028, DEC-012, DEC-013.

**Décision** : Une escalade `alert` peut notifier directement le PRINCIPAL sans attendre le CONDUCTOR. Ce court-circuit est **contrôlé** :

- le CONDUCTOR est copié par défaut dans la trace de l'alerte ;
- le CONDUCTOR peut être exclu du routing immédiat si l'émetteur déclare qu'il est potentiellement partie au problème, indisponible, compromis, ou facteur de ralentissement critique ;
- l'exclusion du CONDUCTOR doit être tracée avec une raison explicite ;
- le MANDATAIRE reste requis sur `alert` selon DEC-013, mais son intervention doit être compatible avec la latence prioritaire de l'alerte.

**Pourquoi** : `alert` existe précisément pour les incidents où la chaîne normale peut être trop lente ou elle-même concernée par le problème. Le court-circuit doit donc être possible, mais pas invisible : l'audit doit reconstruire qui a été notifié, qui a été exclu, et pourquoi.

**À spécifier en aval** : champs exacts de routing d'une `alert`, niveaux d'urgence, garanties de latence, et règles de notification différée du CONDUCTOR quand il est exclu du routing immédiat.

## DEC-015 — Trois canaux multi-humains coexistent
**Date** : 2026-05-17. **Réfère** : REQ-029, REQ-030, REQ-031, REQ-033.

**Décision** : Le mode multi-humain pair-à-pair doit supporter trois canaux complémentaires, sans en choisir un comme unique :

- **PRINCIPAL ↔ PRINCIPAL** : deux humains dialoguent directement comme responsables de leurs mini-organisations respectives.
- **CONDUCTOR ↔ CONDUCTOR** : les humains délèguent la négociation opérationnelle à leurs conductors, qui parlent au nom de leurs périmètres.
- **ENGAGEMENT partagé** : les parties créent un engagement commun avec charter, rôles, bindings, controls, policies applicables, success criteria et journaux propres.

**Pourquoi** : ces trois formes correspondent à trois niveaux de maturité du même échange. La discussion directe est légère, la délégation conductor-conductor réduit la charge humaine, l'engagement partagé devient nécessaire dès qu'il y a scope, responsabilités ou livrables à auditer.

**Règle de cadrage** : un dialogue informel peut rester PRINCIPAL ↔ PRINCIPAL ; une coordination opérationnelle répétée devrait passer par CONDUCTOR ↔ CONDUCTOR ; tout travail commun avec obligations, risques, livrables ou décisions durables doit être instancié comme ENGAGEMENT partagé.

## DEC-016 — EXECUTIF et POLICY complètent l'organisation multi-humaine
**Date** : 2026-05-17. **Réfère** : REQ-008, REQ-010, REQ-011, REQ-020, REQ-029, REQ-032, REQ-033.

**Décision** : Ajouter deux concepts canoniques au modèle :

- **EXECUTIF** : rôle humain ou agentique responsable de l'activité d'ensemble couvrant plusieurs PRINCIPAUX, leurs mini-organisations et leurs AGENTS. L'EXECUTIF n'efface pas les PRINCIPAUX locaux : il porte l'accountability du scope supérieur, arbitre les conflits inter-périmètres, ratifie les policies globales et peut créer des engagements d'ensemble.
- **POLICY** : règle durable et versionnée applicable à un scope organisationnel (mini-organisation, engagement, fédération, activité d'ensemble). Une POLICY n'est pas un ENGAGEMENT : elle contraint des engagements et des actions, mais elle n'est pas le contrat opérationnel d'une mission.

**Relation POLICY ↔ ENGAGEMENT** : un engagement déclare les policies applicables dans son charter. Modifier une policy peut nécessiter un engagement ou un amendement pour gouverner le changement, mais l'artefact policy reste distinct du charter d'engagement.

**Relation CONTROL ↔ POLICY** : les CONTROL sont les propriétaires ou validateurs naturels des policies de leur domaine (cyber, finance, éthique, legal, qualité). Ils peuvent proposer, imposer, auditer, alerter ou veto selon leur domaine et selon les droits attachés à la policy.

**Pourquoi** : sans EXECUTIF, le modèle multi-humain ne sait pas représenter la responsabilité d'ensemble. Sans POLICY, les contraintes transverses se retrouvent forcées dans les engagements, ce qui mélange règles durables et contrats opérationnels.

**À spécifier en aval** : cycle de vie des policies, précédence entre policies de scopes différents, résolution des conflits entre CONTROL, et règles d'escalade depuis une violation de policy.

## DEC-017 — EXECUTIF est un rôle séparé de PRINCIPAL
**Date** : 2026-05-17. **Réfère** : REQ-029, REQ-030, REQ-032, REQ-035, REQ-036, DEC-016.

**Décision** : EXECUTIF est un rôle canonique séparé de PRINCIPAL, même si une même INSTANCE humaine peut tenir les deux rôles sur des scopes différents.

**Pourquoi** : PRINCIPAL porte l'autorité locale sur sa mini-organisation ; EXECUTIF porte la responsabilité d'ensemble sur une activité fédérée. Les confondre rendrait l'audit ambigu dès qu'un humain agit parfois pour son périmètre propre et parfois pour le collectif.

**Conséquence** : les schemas devront représenter explicitement le couple `{instance, role, scope}`. Une INSTANCE peut être `PRINCIPAL` sur `org:alice` et `EXECUTIF` sur `federation:program-x`, mais les droits, traces et escalades ne sont pas interchangeables.

## DEC-018 — CONTRACT comme conteneur normatif ; CONTROL/ESCALADE comme plan d'application
**Date** : 2026-05-17. **Réfère** : REQ-037, REQ-038, REQ-039, REQ-040, REQ-041, REQ-042, REQ-043, REQ-044, REQ-045.

**Décision** : POLICY n'est pas une cinquième couche linéaire de la pile. Le modèle distingue plutôt trois artefacts contractuels et un plan d'application :

- **CONTRACT** : conteneur normatif signé entre parties ou scopes. Il peut contenir des policies, des obligations, des droits, des clauses de contrôle/escalade, des références externes, et instancier un ou plusieurs engagements.
- **ENGAGEMENT** : contrat opérationnel exécutable pour un scope de travail concret, avec charter, rôles, bindings, success criteria, policies applicables, journal et amendements.
- **POLICY** : règle durable, versionnée, applicable à un scope. Elle peut être autonome (ex. règlement public, policy interne) ou être une clause/règle contenue dans un CONTRACT.
- **CONTROL/ESCALADE** : plan d'application et d'enforcement des contracts, engagements et policies. Il observe, audite, détecte les violations, déclenche veto/alertes/escalades, et produit la preuve.

**Pourquoi** : dans les modèles réels (contrat client, contrat fournisseur, contrat employé, réglementation, taxes), un "contrat" mélange règles durables, obligations, droits, missions exécutables et mécanismes d'application. Forcer POLICY dans une 5e couche ou forcer tout contrat dans ENGAGEMENT confondrait le durable, l'exécutable et l'enforcement.

**Conséquence sur la pile** : la pile reste orientée par le flux `INTENTION → SPÉCIFICATION → ARTEFACTS CONTRACTUELS → EXÉCUTION`, tandis que `CONTROL/ESCALADE` opère comme plan transversal d'application. Il peut s'attacher à un CONTRACT, un ENGAGEMENT, une POLICY, une SPEC ou une INTENTION, selon ce qui doit être contrôlé.

**À spécifier en aval** : schema minimal de CONTRACT, relation CONTRACT ↔ POLICY ↔ ENGAGEMENT, statut des contrats-cadres, et règles de preuve/signature/amendement.

## DEC-019 — REGISTRY et NEGOTIATION comme primitives runtime non-acteurs
**Date** : 2026-05-17. **Réfère** : REQ-051, REQ-052, REQ-053, REQ-054, REQ-055.

**Décision** : Ajouter deux primitives runtime qui ne sont pas des acteurs :

- **REGISTRY** : répertoire minimal des INSTANCE, rôles, scopes, endpoints, capabilities, clés de signature et policies acceptées. Il permet à des CONDUCTORS/AGENTS/CONTROL de se découvrir sans imposer une autorité centrale.
- **NEGOTIATION** : session transitoire de proposition, contre-proposition, acceptation et signature visant à stabiliser un CONTRACT, une POLICY, un ENGAGEMENT ou un amendement.

Une NEGOTIATION devient stable quand les parties requises signent le même artefact canonique identifié par version et hash. Tant que ce seuil n'est pas atteint, elle reste un échange de propositions, pas un artefact contractuel applicable.

**Pourquoi** : le cas "1 PRINCIPAL / 15 CONDUCTORS" exige que les conductors puissent se découvrir et contractualiser entre eux sans médiateur inter-contrat. REGISTRY et NEGOTIATION couvrent ce besoin minimal sans ajouter un nouvel acteur de gouvernance.

**Limite V1** : sans médiateur inter-contrat, le protocole ne garantit pas la cohérence globale entre tous les contrats. Il peut détecter et tracer les conflits ; leur résolution passe par ENFORCEMENT_PLAN/ESCALADE et par l'autorité compétente du scope (PRINCIPAL, EXECUTIF, quorum, CONTROL habilité ou autorité externe).

## DEC-020 — Nom recommandé : `a2a-accord`
**Date** : 2026-05-17. **Réfère** : REQ-016, REQ-056, REQ-057, REQ-058, REQ-059.

**Décision** : Recommander `a2a-accord` comme nom de projet/package core, publié sous `@sentropic/a2a-accord`.

Packages complémentaires envisagés :

- `@sentropic/a2a-accord-mcp` — serveur MCP minimal.
- `@sentropic/a2a-accord-codex` — adapter/plugin Codex.
- `@sentropic/a2a-accord-claude` — adapter/plugin Claude.

**Pourquoi** : le coeur du projet n'est pas une CLI mais un langage/runtime d'accords stabilisés entre agents. `a2a-accord` garde le lien avec l'intention A2A sans réduire le package à l'artefact `CONTRACT` : il couvre aussi `POLICY`, `ENGAGEMENT`, négociation, signature, preuve et responsabilité. Les adapters CLI restent secondaires et remplaçables.

**Statut** : recommandé mais non encore ratifié par l'utilisateur. Commit/push à faire seulement après validation du nom et création/vérification d'un vrai dépôt Git.

## DEC-021 — Un scope ne signe pas ; une autorité mandatée signe pour lui
**Date** : 2026-05-17. **Réfère** : REQ-061, REQ-062, REQ-063, REQ-064.

**Décision** : Introduire explicitement `SCOPE`, `PARTY`, `AUTHORITY`, `MANDATE` et `SIGNATURE`.

Règle canonique : un **scope ne signe jamais**. Une `INSTANCE` signe en tenant un rôle autorisé (`PRINCIPAL`, `EXECUTIF`, `CONDUCTOR`, `CONTROL`, quorum, autorité externe) et selon un `MANDATE` qui précise pour quelle `PARTY` ou quel `SCOPE` elle engage sa signature.

**Conséquence** : les formulations "CONTRACT signé entre scopes" doivent être lues comme "CONTRACT applicable à des scopes, signé par les autorités mandatées des parties concernées".

**Pourquoi** : l'audit ABC montre que parties, scopes et autorités se recouvrent mais ne sont pas identiques. Les confondre rendrait les signatures, droits réservés, obligations réglementaires et recours impossibles à auditer correctement.

## DEC-022 — Stabilisation sans médiateur par ledger de négociation
**Date** : 2026-05-17. **Réfère** : REQ-052, REQ-053, REQ-054, REQ-055, REQ-065, REQ-066, REQ-067.

**Décision** : En V1, il n'y a pas de médiateur inter-contrat. La convergence entre conductors passe par une `NEGOTIATION` avec ledger append-only, propositions versionnées, base hash, états explicites et signatures requises.

State machine minimale : `draft`, `proposed`, `countered`, `accepted`, `rejected`, `withdrawn`, `expired`, `stabilized`, `abandoned`.

Une négociation n'est stable que si les signataires requis signent le même artefact canonique. Les conflits entre contrats stabilisés sont détectés et escaladés ; ils ne sont pas résolus automatiquement.

**Pourquoi** : dans le cas 15 CONDUCTORS, il existe jusqu'à 105 canaux bilatéraux. Sans ledger et états terminaux, les conductors peuvent croire avoir convergé alors qu'ils ont signé des versions différentes ou des propositions stale.

## DEC-023 — CONTROL est un rôle ; ENFORCEMENT_PLAN est le plan d'application
**Date** : 2026-05-17. **Réfère** : REQ-008, REQ-049, REQ-070.

**Décision** : Conserver `CONTROL` comme rôle canonique, mais nommer le plan transversal d'application **ENFORCEMENT_PLAN**.

- `CONTROL` / `CONTROL_ROLE` : acteur ou rôle de domaine (cyber, finance, legal, qualité, éthique).
- `ENFORCEMENT_PLAN` : mécanismes d'audit, validation, veto, alerte, preuve, exception, recours et escalade appliqués aux artefacts contractuels.

**Révision de DEC-018** : l'ancien raccourci `CONTROL/ESCALADE` désignait le plan d'application. La terminologie précise devient `ENFORCEMENT_PLAN`, avec `ESCALADE` comme mécanisme de ce plan.

**Pourquoi** : employer `CONTROL` à la fois pour un rôle et pour un plan brouille les droits, surtout en cross-organisation et dans les modèles gouvernementaux. La séparation permet aussi d'imposer la minimisation de disclosure : un CONTROL n'a pas automatiquement accès à tout.

## DEC-024 — Escalade vers l'autorité de scope ; MANDATAIRE non arbitre
**Date** : 2026-05-17. **Réfère** : REQ-026, REQ-027, REQ-028, REQ-068, REQ-069.

**Décision** : Généraliser l'escalade : les primitives `advise`, `decide`, `alert` ciblent l'**autorité compétente du scope**, pas seulement le PRINCIPAL local.

Autorités possibles selon contexte : PRINCIPAL, EXECUTIF, quorum, CONTROL habilité, autorité externe, recours ou adjudication explicitement modélisée. Le PRINCIPAL reste la cible par défaut dans le cas mono-humain, mais les modèles B/C exigent d'autres autorités.

Le **MANDATAIRE** reste un présentateur neutre : il formule, met en forme et trace. Il ne médie pas, n'arbitre pas, ne juge pas et ne résout pas un deadlock.

**Pourquoi** : les entreprises, écosystèmes et administrations ont des décisions qui ne relèvent pas toujours du PRINCIPAL local. Confondre MANDATAIRE, médiateur et tribunal créerait une fausse autorité dans le protocole.

## DEC-025 — `h2a` devient le nom parapluie ; `a2a` devient une sous-surface
**Date** : 2026-05-18. **Réfère** : REQ-016, REQ-059, REQ-072.

**Décision** : Réviser DEC-020. Le nom parapluie recommandé du projet devient **`h2a`** (`humans to agents`), publié côté core sous `@sentropic/h2a`.

Packages complémentaires envisagés :

- `@sentropic/h2a-mcp` — serveur MCP minimal.
- `@sentropic/h2a-codex` — adapter/plugin Codex.
- `@sentropic/h2a-claude` — adapter/plugin Claude.
- `@sentropic/h2a-a2a` — sous-surface optionnelle pour le volet agent-to-agent pur si on veut l'isoler.

**Pourquoi** : le projet ne traite pas seulement l'échange agent-to-agent. Il couvre aussi la coordination multi-humain, l'organisation, l'autorité, les mandats, les escalades et le human-in-the-loop. `a2a` est donc trop étroit pour le nom parapluie ; il reste pertinent comme sous-surface ou sous-package spécialisé.

**Conséquence** : les noms runtime, packages, chemins locaux et identifiants de protocole proposés doivent désormais se caler sur `h2a`. L'ancien candidat `a2a-accord` reste dans l'historique de DEC-020 mais n'est plus le nom recommandé.

## DEC-026 — Réduire le bootstrap à 2 packages : `h2a` + `h2a-cli`
**Date** : 2026-05-18. **Réfère** : REQ-017, REQ-018, REQ-056, REQ-057, REQ-058, REQ-059.

**Décision** : À ce stade, le bootstrap runtime est réduit à **deux packages** :

- `@sentropic/h2a` — core runtime et contrats partagés.
- `@sentropic/h2a-cli` — surface d'intégration unique pour `mcp`, `codex`, `claude` et `gemini`.

Le package `@sentropic/h2a-cli` reste **modularisé en interne** pour préserver l'orthogonalité des développements et la clarté des contrats, sans multiplier les packages publiés trop tôt.

**Pourquoi** : quatre packages publiés pour un bootstrap créent plus de friction de release et de versioning que de valeur. Le besoin immédiat est la clarté des frontières, pas la fragmentation du registre npm.

**Conséquence** : les anciens candidats `@sentropic/h2a-mcp`, `@sentropic/h2a-codex` et `@sentropic/h2a-claude` sortent de la cible V1. Ils pourront réapparaître plus tard seulement si une divergence de dépendances, de cadence ou de contrat le justifie.

## DEC-027 — Licence du projet = MIT
**Date** : 2026-05-18. **Réfère** : REQ-016.

**Décision** : Le projet `h2a` adopte la licence **MIT** (`SPDX: MIT`). Les deux packages publiés (`@sentropic/h2a`, `@sentropic/h2a-cli`) passent leur champ `license` de `UNLICENSED` à `MIT`. Un fichier `LICENSE` racine porte le texte canonique avec copyright `2026 Fabien Antoine (rhanka)`.

**Pourquoi** : licence permissive standard pour la couche protocole/CLI, compatible commercial et publication npm. Lève l'ambiguïté `UNLICENSED` qui bloquait la consommation aval.

**Conséquence** : prochains `npm publish` héritent automatiquement de `MIT`. Si un sous-package futur nécessite une licence différente (ex. AGPL pour un serveur), il faudra le justifier explicitement.

## DEC-028 — Gemini reporté en wave 2
**Date** : 2026-05-18. **Réfère** : DEC-026, REQ-057, REQ-058.

**Décision** : L'intégration Gemini est **reportée en wave 2**. Wave 1 cible Codex + Claude pour l'effort plugin/registration/inbox. Le host descriptor `gemini` reste exposé via `h2a hosts` et la liste `H2A_CLI_HOSTS` pour la cohérence du surface CLI.

**Pourquoi** : tripler l'effort plugin en wave 1 ralentit la convergence du protocole core ; mieux vaut figer le pattern sur deux hôtes (Codex/Claude) avant d'en porter un troisième.

**Conséquence** : la track `Gemini` du workpackage 40 reste vide en wave 1 ; aucun engagement de support négociation/inbox Gemini avant wave 2.

## DEC-029 — Dépréciation de `@sentropic/h2a-cli@0.1.0`
**Date** : 2026-05-18. **Réfère** : DEC-026.

**Décision** : Marquer `@sentropic/h2a-cli@0.1.0` comme déprécié sur npm avec le message :
> `Use 0.1.1; 0.1.0 was published without the CLI bin entry.`

La version `0.1.1` reste la version de référence. La dépréciation est non-destructive (pas d'`unpublish`) pour préserver la traçabilité du registre.

**Pourquoi** : `0.1.0` ne fournit pas le bin `h2a` exécutable suite à une autocorrection npm lors de la première publication. Sa coexistence sans avertissement risque d'aiguiller les installs neufs vers une version cassée.

**Conséquence** : commande à exécuter en interactif côté utilisateur authentifié npm — `npm deprecate "@sentropic/h2a-cli@0.1.0" "Use 0.1.1; 0.1.0 was published without the CLI bin entry."`.

## DEC-030 — Prochaine livraison = schémas core d'abord
**Date** : 2026-05-18. **Réfère** : WP-10.

**Décision** : Le prochain track de livraison est l'**implémentation des schémas core** dans `@sentropic/h2a` :
- `CONTRACT`, `POLICY`, `ENGAGEMENT`, `AMENDMENT`,
- `MANDATE`, `AUTHORITY`, `SIGNATURE`, `ENFORCEMENT_PLAN`,
- canonicalisation déterministe (sort de clés, JSON stable),
- hachage SHA-256 sur la forme canonique.

Implémentation guidée par tests (TDD) ; pas de runtime local-files ni MCP avant que les schémas soient minimalement stables.

**Pourquoi** : tout le reste (registry, négociation, inbox, MCP, plugins) dépend d'artefacts dont l'identité, la canonicalisation et le hash sont stables. Les figer en premier réduit la dette de migration.

**Conséquence** : WP-20 (local-files), WP-30 (CLI surface au-delà de `hosts`/`mcp-tools`) et WP-40 (intégrations) attendent l'atterrissage de WP-10.

## DEC-031 — Layout du store local-files figé
**Date** : 2026-05-18. **Réfère** : RUNTIME_PROPOSAL.md, WP-20.

**Décision** : Le store local-files de la V1 utilise la racine **`<root>/.h2a/`** (configurable, par défaut `<cwd>/.h2a` dans l'usage CLI ; explicite `src/{project}/h2a/` quand intégré à un workspace nommé). À l'intérieur :

```
<root>/.h2a/
  registry/instances.jsonl     # append-only des H2AActorRegistration
  contracts/<id>/contract.json # CONTRACT stabilisé immutable
  policies/<id>.json           # POLICY stabilisée immutable
  engagements/<id>/
    charter.json
    events.jsonl               # journal d'engagement
    inbox/<instance>/
    outbox/<instance>/
    evidence/
  negotiations/<id>/
    state.json                 # H2ANegotiationRecord courant (mutable)
    offers/                    # proposals/counteroffers (append-only)
    signatures/                # signatures collectées (append-only)
    journal.jsonl              # H2AJournalEntry chain
  inbox/<actor>/               # boîtes globales (hors engagement)
  outbox/<actor>/
```

**Pourquoi** : reprend la proposition de `RUNTIME_PROPOSAL.md` ; sépare clairement (a) registre runtime mutable append-only, (b) artefacts stabilisés immutables, (c) sessions de négociation mutables jusqu'à stabilisation. Le format `.jsonl` est portable, grep-friendly, et trivialement append-only.

**Conséquence** : la première implémentation cible **registre + journal de négociation** ; engagements et artefacts stabilisés viennent ensuite. Le module `runtime/local-files` vit dans `@sentropic/h2a-cli` (cible 2-package, DEC-026).

## DEC-032 — V1 sans authentification de transport ; identité déclarée par l'appelant
**Date** : 2026-05-20. **Réfère** : DEC-026, RUNTIME_PROPOSAL.md, WP-40.

**Décision** : pour V1, le runtime local-files et le serveur MCP en stdio ne posent **aucune authentification de transport**. L'appelant déclare son `instance` dans les arguments (CLI flags ou MCP `tools/call` args). Le runtime fait confiance à cette déclaration ; il vérifie en revanche que **les signatures cryptographiques sur les artefacts** se valident contre les `publicKeys` enregistrées dans le registry. Trust-on-first-use sur l'enregistrement : la première `registerInstance` fixe la `publicKeys` ; les appels suivants utilisant le même `id` mais une clé différente seront détectés à la stabilization via échec de `verifyCanonical`.

**Pourquoi** : V1 cible un seul utilisateur sur sa machine (DEC-026, RUNTIME_PROPOSAL). Empiler de l'auth transport sur un store local-files single-user serait du gold-plating. La sécurité opérationnelle repose sur (a) les permissions filesystem, (b) la signature ed25519 des artefacts dans le journal, (c) la détection d'incohérence à la stabilization.

**Conséquence** : tout déploiement multi-utilisateur ou réseau exigera **DEC-V2** définissant un transport sécurisé (mTLS, bearer signé, etc.). Pas de chemin de mise à niveau caché dans le code V1.

## DEC-033 — Persistance immutable des artefacts stabilisés + propagation causationId/correlationId par défaut
**Date** : 2026-05-20. **Réfère** : DEC-031, WP-20.

**Décision** : à la stabilization d'une négociation, le runtime local-files :

1. **Retrouve l'artefact gagnant** en parcourant le journal pour trouver l'événement `offer`/`counter` dont `computeHash(body.artifact)` est égal au `winningHash` (le hash signé par le quorum). Si aucun événement ne correspond, la stabilization échoue (`stabilizeNegotiation: no offer/counter event matches the winning artifactHash <hash>`).
2. **Écrit l'artefact en write-once** dans l'arborescence immutable de DEC-031 selon `artifact.kind` :
   - `CONTRACT` → `<root>/contracts/<artifact.id>/contract.json`
   - `POLICY` → `<root>/policies/<artifact.id>.json`
   - `ENGAGEMENT` → `<root>/engagements/<artifact.id>/charter.json`
   - **Fallback** (toute autre `kind` ou `kind` manquante : `AMENDMENT`, `MANDATE`, `AUTHORITY`, `ENFORCEMENT_PLAN`, etc.) → `<root>/artifacts/<sha256_…>.json`, addressé par son hash canonique (les `:` du `sha256:` sont remplacés par `_` pour produire un nom de fichier portable).
3. Refuse l'écriture si le fichier cible existe déjà (`writeFileSync(..., { flag: "wx" })`) : la stabilization rapporte `stabilizeNegotiation: stabilized artifact already on disk at <path>`. L'identifiant d'un artefact (`<kind>:<id>`) est donc unique à l'échelle du store ; deux négociations ne peuvent pas matérialiser le même `id` sans collision détectée.
4. Renvoie le chemin d'écriture dans `artifactPath` (exposé via `LocalStore.stabilizeNegotiation`, `h2a negotiate stabilize` et `h2a_stabilize` MCP), et l'inscrit dans l'événement `stabilized` du journal.

**Pourquoi (write-once)** : (a) preuve d'audit minimale — un artefact stabilisé ne change plus jamais sur disque, ce qui rend `cat <root>/contracts/<id>/contract.json` une source de vérité reproductible ; (b) défense en profondeur contre les bugs/race conditions qui réécriraient l'artefact à un hash divergent du contenu déjà stocké ; (c) le détail de l'erreur expose immédiatement la collision plutôt que de l'enfouir.

**Pourquoi (fallback `artifacts/`)** : DEC-031 a figé les sous-arborescences pour `CONTRACT` / `POLICY` / `ENGAGEMENT`, mais le vocabulaire (DEC-018, DEC-019) déclare aussi `AMENDMENT`, `MANDATE`, `AUTHORITY`, `ENFORCEMENT_PLAN`. Plutôt que d'attendre qu'on leur invente un sous-arbre dédié, le fallback hash-adressé garantit que tout artefact signé+stabilisé reçoit dès aujourd'hui un emplacement immutable et grep-friendly.

**Décision (causation/correlation)** : les flags CLI `--causation-id` / `--correlation-id` sont acceptés par `h2a negotiate offer / counter / sign / event`, mirorrés dans les tools MCP `h2a_offer / h2a_counteroffer / h2a_sign / h2a_escalate`. **Par défaut**, sans flag explicite, chaque nouvel événement journal hérite :

- `causationId ← previous.id` — chaque événement est causé par celui qui le précède dans le journal, formant une chaîne de causalité parallèle à `prevHash`.
- `correlationId ← previous.correlationId` — la négociation est, par convention, **un seul thread de corrélation** ; la valeur n'est jamais inventée, elle est seulement propagée si elle a été posée explicitement à un événement précédent.

**Pourquoi (thread = négociation)** : on évite à V1 de réinventer un identifiant de conversation orthogonal à `negotiationId`. Quand un appelant veut explicitement coudre plusieurs négociations dans le même thread (ex. orchestration multi-engagement par un PRINCIPAL), il passe `--correlation-id <thread>` à la première `offer` et tous les événements suivants l'héritent automatiquement. À l'inverse, un événement explicite (`--causation-id manual`) peut casser la chaîne — utile pour signaler une bifurcation côté audit.

**Conséquence** : aucun changement de schéma pour V1 — `H2AJournalPayload` déclarait déjà ces deux champs (DEC-031 a fixé le layout, pas la sémantique de propagation). Cette DEC fige la sémantique d'inhéritance ; tout code consommateur peut désormais s'appuyer sur le fait que la `causationId` est non-vide pour tout événement autre que le premier d'une négociation.

## DEC-034 — Contrat JSON output stable + table des codes de sortie
**Date** : 2026-05-20. **Réfère** : DEC-026, DEC-031, DEC-033, WP-30.

**Décision** : la surface `@sentropic/h2a-cli` figée par cette DEC est **l'API publique des clients programmatiques** du CLI `h2a`. Tout verbe émettant du JSON sur `stdout` respecte **exactement une** des trois enveloppes canoniques suivantes :

- **`resource`** — JSON brut de l'entité persistée/lue (record de négociation, entrée de journal, enveloppe, snippet de configuration hôte). Utilisé par `negotiate open / status / event / offer / counter / sign`, `inbox pop`, `host setup --print`.
- **`list`** — tableau JSON brut. Utilisé par `hosts`, `mcp-tools`, `discover`, `inbox read`, `outbox read`, `negotiate journal`.
- **`action`** — `{ "ok": true, ...details }` pour les verbes à effet de bord sans entité naturelle à retourner. Utilisé par `init`, `register`, `inbox put`, `outbox put`, `negotiate stabilize`, `host setup --write`.

Deux cas hors enveloppe : `--help` émet du texte humain (`text`), `mcp-serve` parle JSON-RPC 2.0 framé sur stdio (`stream`).

Stderr suit toujours `h2a <verb> [sub]: <message>` pour grep déterministe.

**Décision (codes de sortie)** : tous les verbes utilisent **uniquement** l'alphabet suivant :

- `0` — succès.
- `1` — erreur utilisateur : flag manquant/incorrect, JSON invalide, validation de payload caller-supplied, verbe/subverbe/hôte inconnu.
- `2` — erreur runtime/état contre le store local : négociation introuvable, déjà ouverte, déjà stabilisée, signature non vérifiée, quorum incomplet, journal cassé, entrée de configuration pré-existante divergente refusée sans `--force`.
- `3` — erreur I/O / OS : fichier illisible, permission refusée, écriture refusée par le système de fichiers.

**Pourquoi** : (a) un client MCP, un script shell ou un test d'intégration doivent pouvoir parser le `stdout` JSON sans deviner la forme (objet, tableau, ou enveloppe `ok`) verbe par verbe ; (b) la séparation 1/2/3 distingue clairement les erreurs « ton input est mauvais » (le caller doit corriger sa requête), « ton état stocké refuse cette action » (le caller doit consulter le store), et « ton environnement OS bloque » (le caller doit corriger ses permissions/fichiers) — ce qui permet des branches de retry/abort différenciées en automation.

**Pourquoi (`action` plutôt que bare-entity pour les writes)** : un verbe qui écrit mais n'a pas d'entité naturelle à retourner (`init` ne retourne pas un objet « root », `register` ne retourne pas le registre entier, `inbox put` ne retourne pas l'enveloppe stockée mais sa coordonnée) émet une confirmation explicite `{ok:true, …}`. Réinjecter l'entité d'entrée serait du bruit ; ne rien émettre serait perdre la traçabilité de l'écriture. La forme `action` rend l'opération auditable d'un seul `tee` shell.

**Pourquoi `negotiate stabilize` reste `action` malgré l'entité disponible** : la stabilization retourne *plusieurs* artefacts d'un coup (`record`, `artifactHash`, `signers`, `artifactPath`, `finalEvent`) — il n'y a pas une entité unique mais un résultat composite, et le flag `ok` est sémantiquement informatif (le caller peut tester `parsed.ok` sans connaître la structure interne). Bare-unwrap dégraderait la lisibilité programmatique.

**Conséquence** : (a) le manifeste `H2A_CLI_VERB_CONTRACTS` (`packages/h2a-cli/src/cli-contract.ts`) est ré-exporté publiquement et fait foi ; (b) `docs/cli-contract.md` est la référence humaine ; (c) toute modification rétro-incompatible exige une **nouvelle DEC** + un bump majeur de `@sentropic/h2a-cli` ; (d) les ajouts purement additifs (nouveau verbe, nouveau champ optionnel dans une enveloppe `action`/`resource`) restent compatibles mineur.


## DEC-035 — Matrice d'autorité de signature + fixtures canoniques cross-language
**Date** : 2026-05-20. **Réfère** : DEC-004, DEC-018, DEC-021, DEC-023, DEC-032, DEC-033.

**Décision (matrice d'autorité)** : `@sentropic/h2a` expose **`H2A_AUTHORITY_MATRIX`**, table déclarative mappant chaque `H2AArtifactKind` à la liste des rôles autorisés à produire une signature *liante* sur cet artefact. Baseline V1 :

- `CONTRACT` → `PRINCIPAL`, `EXECUTIF`, `CONDUCTOR`
- `POLICY` → `PRINCIPAL`, `EXECUTIF`, `CONTROL`
- `ENGAGEMENT` → `PRINCIPAL`, `EXECUTIF`, `CONDUCTOR`
- `AMENDMENT` → `PRINCIPAL`, `EXECUTIF`, `CONDUCTOR`, `CONTROL`
- `MANDATE` → `PRINCIPAL`, `EXECUTIF`
- `AUTHORITY` → `PRINCIPAL`, `EXECUTIF`
- `SIGNATURE` → tous les 6 rôles (trace d'un acte de signature)
- `ENFORCEMENT_PLAN` → `PRINCIPAL`, `EXECUTIF`, `CONTROL`

`MANDATAIRE` n'apparaît jamais pour un artefact *liant* — DEC-005 / DEC-024 le maintiennent comme *présentateur*. `canSignArtifactKind(role, kind)` retourne un booléen ; `assertCanSignArtifactKind(role, kind)` jette avec un message nommant rôle + kind + roster autorisé.

**Décision (exécution)** : `stabilizeNegotiation` (`@sentropic/h2a-cli/runtime/local-files/store.ts`) applique cette matrice après la vérification ed25519 (DEC-032) et avant la persistance write-once (DEC-033). Pour chaque signataire du `winningHash`, au moins un de ses `roles` registré doit appartenir au roster de la matrice pour le `kind` de l'artefact gagnant ; sinon `Negotiation <id>: signer <instance> is not authorized to sign artifact kind <KIND> (roles: [...])`. Si le kind est absent ou non canonique, un *warning* est émis sur `stderr` et la vérification d'autorité est *skipped* (V1 permissive sur l'extension).

**Décision (fixtures cross-langage)** : `packages/h2a/fixtures/` contient 6 artefacts canoniques (un par kind liant : `CONTRACT`, `POLICY`, `ENGAGEMENT`, `MANDATE`, `AUTHORITY`, `ENFORCEMENT_PLAN`). Chaque fichier contient *exactement* `canonicalize(value)` en bytes (pas de pretty-print, pas de trailing newline) ; `fixtures/manifest.json` liste `{path, kind, id, sha256}` où `sha256` est le hex SHA-256 des bytes (sans préfixe). `H2A_CANONICAL_FIXTURES` est ré-exporté par `@sentropic/h2a`.

**Pourquoi (matrice)** : (a) DEC-004 a déjà tranché que les amendements sensibles passent par quorum ; il manquait la table déclarative *qui peut signer quoi* en V1, sans laquelle un AGENTS pouvait techniquement signer un CONTRACT ; (b) le runtime applique la même matrice que celle exposée dans la bibliothèque — pas de divergence possible entre vérif client et vérif store ; (c) une implémentation cross-langage peut consommer la matrice directement (table simple, pas de DSL).

**Pourquoi (fixtures byte-canoniques)** : (a) la canonicalisation JSON sorted-key (DEC-031, `canonical.ts`) est trivialement portable mais doit être *testée* contre une référence ; (b) un binding non-TS (Python, Go, Rust) peut maintenant rejouer `manifest.json` et confirmer bit-pour-bit qu'il calcule la même `sha256` que la référence TS ; (c) les guards `is<Kind>` sont aussi validés contre les fixtures, donc une nouvelle implémentation des guards est testable contre la même batterie.

**Conséquence** : (a) toute extension future de `H2A_ARTIFACT_KINDS` doit étendre `H2A_AUTHORITY_MATRIX` (une garde *au moment du chargement* refuse un kind sans entrée) ; (b) toute modification des fixtures recalcule la `sha256` du manifeste (le test `fixtures.test.js` casserait sinon) ; (c) la matrice est volontairement *permissive sur kind inconnu* en V1 pour ne pas casser les extensions privées : la durcir (refus par défaut + opt-in) demandera une nouvelle DEC.


## DEC-036 — Verrous fichier advisory + version de schéma du store local-files
**Date** : 2026-05-20. **Réfère** : DEC-031, DEC-033, DEC-034.

**Décision (verrouillage advisory)** : chaque section critique read-then-write du store local-files (`packages/h2a-cli/src/runtime/local-files/store.ts`) acquiert un verrou *advisory* via un fichier sentinelle `.lock` créé par `openSync(path, "wx")` (sémantique `O_CREAT|O_EXCL`). Le fichier contient `{pid, hostname, startedAt}` ; en cas de collision (`EEXIST`), on inspecte le payload, et si la `hostname` correspond et que `process.kill(pid, 0)` retourne `ESRCH`, le verrou est considéré *stale* et est récupéré (`unlinkSync` + retry). Sinon on polle jusqu'à `lockTimeoutMs` (défaut 5000 ms, poll 50 ms) puis on lève `LockTimeoutError` (exporté).

Le périmètre du verrou couvre :
- `registerInstance` → `<root>/registry/.lock` (dup detection + append).
- `openNegotiation` / `updateNegotiationStatus` / `appendNegotiationEvent` / `stabilizeNegotiation` → `<root>/negotiations/<id>/.lock`.
- `putInboxMessage` / `popInboxMessage` → `<root>/inbox/<actor>/.lock`.
- `putOutboxMessage` → `<root>/outbox/<actor>/.lock`.

`createLocalStore({ root })` reste **rétro-compatible** ; deux options *optionnelles* étendent l'API : `lockTimeoutMs` (défaut 5000) et `allowVersionMismatch` (défaut false). La primitive `withLock` (async) / `withLockSync` est aussi exportée pour le code applicatif qui aurait besoin du même mécanisme hors du store.

**Décision (version de schéma)** : le store écrit `<root>/.h2a-schema.json` à la première création (`{version, createdAt, createdBy}`). La constante exportée `H2A_STORE_SCHEMA_VERSION = "1"` est l'unique source de vérité côté CLI. Ouvrir un store dont la sentinelle déclare une version inconnue lève `StoreSchemaMismatchError` (exporté) ; la sentinelle n'est **jamais** réécrite (idempotence — `createdAt` reste celui de la création initiale).

L'option `createLocalStore({ root, allowVersionMismatch: true })` est une trappe d'évasion read-only : elle ignore la sentinelle, journalise un *warning* sur stderr, et ne réécrit rien. Le verbe CLI `h2a store migrate [--from <v>] [--to <v>] [--dry-run] [--root <path>]` (enveloppe `action`, codes 0/1) couvre l'avenir : V1 → V1 est un no-op (`changed:false`) ; toute version inconnue côté `--from` ou `--to` retourne 1 avec un message clair. Les transformations effectives seront ajoutées au moment du bump V2.

**Pourquoi (verrous)** : (a) `appendFileSync` (mode `appendJsonl`) repose sur `PIPE_BUF` (~4096 octets sur Linux) pour garantir l'atomicité d'un append ; les sections critiques *read-then-write* (dup detection sur `registerInstance`, lien `prevHash` sur `appendNegotiationEvent`, vérification + persistance write-once dans `stabilizeNegotiation`) ne sont **pas** protégées par cette propriété — d'où la nécessité d'un verrou advisory ; (b) un verrou OS *mandatory* (`flock`, `fcntl`) supposerait des bindings natifs ou un add-on, ce qui violerait la contrainte « built-ins uniquement » (DEC-026) ; (c) le verrou par fichier-sentinelle est portable Linux/macOS/Windows, lisible (le payload se grep), et auto-récupérable via PID-staleness — c'est l'équivalent moderne d'un `pidfile` ; (d) le trade-off explicite : on protège la concurrence **sur la même machine** uniquement. Un partage du store via NFS / SMB *cross-host* est hors périmètre V1 ; tenter le détecter émettrait des faux positifs (deux hôtes ne peuvent pas se sonder mutuellement via `kill(pid, 0)`).

**Pourquoi (version de schéma)** : (a) le layout de DEC-031 finira par évoluer (V2 : changement de format JSONL, partition par scope, ajout d'index secondaires) ; sans sentinelle, un CLI futur ouvre un store ancien et le corrompt silencieusement ; (b) la sentinelle versus un champ enfoui dans un fichier existant a deux avantages — elle est triviale à lire avant tout chargement, et son absence signale un store *pré-versioning* (auto-migré en V1 à la prochaine ouverture, sans interruption) ; (c) l'option `allowVersionMismatch` garde la voie ouverte pour un outillage de debug d'une version future depuis un CLI installé ; (d) le verbe `store migrate` matérialise la rampe — chaque future DEC qui bump la version doit l'étendre avec une transformation testable.

**Conséquence** : (a) tout `h2a` ou `h2a mcp-serve` concurrent sur le **même `<root>`** sérialise désormais les sections critiques ; un test de timeout (`local-store-locking.test.js`) garantit que la limite par défaut reste raisonnable ; (b) les options ajoutées sont strictement additives — `createLocalStore({ root })` continue de fonctionner sans modification ; (c) la sortie de `h2a store migrate` suit l'enveloppe `action` figée par DEC-034 (`{ok:true, fromVersion, toVersion, changed, dryRun, root}`) ; (d) une release **majeure** future de `@sentropic/h2a-cli` portant une bump du schéma devra livrer simultanément la migration dans `cmdStoreMigrate`. Le V2 cross-host (lockd réseau, mTLS, store partagé) restera explicitement *out of scope* tant qu'une DEC dédiée ne l'aura pas justifié.


## DEC-037 — Statut de compatibilité hôtes + matrice Codex / Claude / Gemini / MCP
**Date** : 2026-05-20. **Réfère** : DEC-028, DEC-032, DEC-034, WP-40, WP-60.

**Décision** : chaque descriptor hôte exposé par `@sentropic/h2a-cli` déclare désormais une `wave` (`1 | 2`). Codex et Claude Code sont **wave 1** : descriptor public, `h2a host setup --host <codex|claude>` livré, et MCP local (`mcp-serve` stdio + serveur in-process) disponible. Gemini reste **wave 2** : descriptor visible dans `h2a hosts`, mais pas de snippet `host setup` ni scénario end-to-end livré.

Le CLI ajoute `h2a host status [--host <name>]`, enveloppe `action` DEC-034 :

```json
{
  "ok": true,
  "hosts": [
    {
      "host": "codex",
      "wave": 1,
      "mcpAdapterShipped": true,
      "hostSetupShipped": true,
      "summary": "wave 1 — host setup snippet shipped; MCP adapter (stdio + local) wired"
    }
  ]
}
```

`--host` filtre sur un host unique ; un nom inconnu sort en `1` avec la liste des hosts supportés.

**Décision (documentation)** : `docs/compatibility-matrix.md` est la matrice humaine Codex / Claude Code / Gemini / MCP. Elle est dérivée de la même source de vérité que `h2a host status` et distingue explicitement quatre niveaux : descriptor, MCP adapter, setup snippet, scénario end-to-end hôte. Les scénarios end-to-end Codex et Claude restent TODO malgré les snippets setup livrés.

**Pourquoi** : (a) DEC-028 a repoussé Gemini en wave 2 mais le statut n'était pas interrogeable par automation ; (b) les snippets Codex/Claude exposent déjà les 10 outils MCP, mais cela ne doit pas être confondu avec un scénario host-driven complet ; (c) les clients programmatiques ont besoin d'une réponse stable plutôt que de parser `h2a hosts` ou une doc Markdown ; (d) la matrice humaine évite de sur-vendre Gemini ou les tests end-to-end hôtes.

**Conséquence** : (a) `H2A_CLI_VERB_CONTRACTS` ajoute le verbe `host status` ; (b) tout nouveau host doit déclarer sa wave ; (c) promouvoir Gemini en wave 1 demandera une DEC ou une mise à jour explicite de DEC-028/037 et devra fournir au minimum `renderMcpConfig`, tests `host setup`, et une ligne de matrice mise à jour ; (d) la completion de WP-40 reste bloquée par les scénarios réels Codex/Claude, pas par la simple présence du setup MCP.


## DEC-038 — Release prep local + publication tag-driven via GitHub Actions
**Date** : 2026-05-20. **Réfère** : DEC-026, DEC-027, DEC-029, DEC-034, DEC-036, WP-00.

**Décision** : le flux V1 de release devient **tag-driven**. La commande locale `npm run release -- --version X.Y.Z` prépare la release sans toucher au réseau :

1. refuse un worktree sale avant vérification ;
2. exécute `npm run typecheck` puis `npm test` ;
3. refuse de continuer si la vérification a sali le worktree ;
4. bump `package.json`, `package-lock.json`, `packages/h2a/package.json`, `packages/h2a-cli/package.json` ;
5. aligne la dépendance `@sentropic/h2a-cli -> @sentropic/h2a` en `^X.Y.Z` ;
6. commit `release: vX.Y.Z` ;
7. crée un tag annoté `vX.Y.Z` (signé si `git config commit.gpgsign=true`).

La version acceptée est strictement `X.Y.Z` sans préfixe `v`, sans pré-release/build metadata, et sans zéros initiaux.

**Décision (CI publish)** : `.github/workflows/release.yml` se déclenche sur `v*.*.*`, réinstalle via `npm ci`, relance typecheck/tests, vérifie que le tag `vX.Y.Z` correspond aux deux package manifests, puis publie `@sentropic/h2a` et `@sentropic/h2a-cli` avec `npm publish --provenance --access public` lorsque `secrets.NPM_TOKEN` est présent. Le workflow crée ensuite une GitHub Release idempotente via `gh release create --generate-notes`. Si `NPM_TOKEN` est absent, le workflow avertit et saute publication + release GitHub.

**Pourquoi** : (a) la première publication a déjà produit un `0.1.0` CLI cassé (DEC-029), donc le bump manuel + publish local n'est pas assez reproductible ; (b) le lockfile est suivi et consommé par `npm ci`, donc il doit être bumpé dans le commit de release ; (c) tester un worktree sale puis ne committer que les versions taguerait potentiellement un état différent de l'état validé ; (d) npm provenance exige un publish depuis CI avec OIDC, pas depuis un shell local.

**Conséquence** : (a) la racine reste `private` et ne publie jamais ; (b) les releases V1 sont lockstep entre les deux packages publics ; (c) `@sentropic/h2a-cli@0.1.0` reste à déprécier manuellement par un maintainer authentifié npm, car la dépréciation rétroactive n'est pas le rôle du workflow de publication ; (d) une future release partielle non-lockstep demanderait une nouvelle DEC ou une extension explicite du script.


## DEC-039 — Invariants exécutables CONTRACT / POLICY / ENGAGEMENT
**Date** : 2026-05-20. **Réfère** : DEC-016, DEC-018, DEC-021, DEC-035, WP-50.

**Décision** : `@sentropic/h2a` expose une couche d'audit stricte pour empêcher le collapse entre les trois artefacts contractuels de DEC-018 :

- `CONTRACT` → profil `normative-container` : durable, non exécutable, peut contenir/référencer des policies et instancier des engagements.
- `POLICY` → profil `durable-rule` : durable, non exécutable, n'instancie pas d'engagement et ne porte pas de charter opérationnel.
- `ENGAGEMENT` → profil `operational-executable` : exécutable, non durable par nature, référence les policies applicables mais ne les contient pas comme règles autonomes.

La table `H2A_CONTRACTUAL_ARTIFACT_PROFILES` est ré-exportée publiquement. `auditContractualArtifact(value)` retourne `{ok, kind, profile, issues}` ; `assertContractualArtifactInvariants(value)` lève si un artefact porte des champs qui appartiennent à une autre catégorie.

**Invariants V1** :

- Un `CONTRACT` ne doit pas porter les champs de règle durable d'une `POLICY` (`rule`, `sourceAuthority`, `adoptionMode`, `parameters`) ni les champs exécutables d'un `ENGAGEMENT` (`charter`, `roleBindings`, `controls`, `successCriteria`, etc.).
- Une `POLICY` ne doit pas porter les champs de conteneur normatif d'un `CONTRACT` (`parties`, `clauses`, `engagements`, `signatures`, etc.) ni les champs exécutables d'un `ENGAGEMENT`.
- Un `ENGAGEMENT` ne doit pas porter les champs de règle durable d'une `POLICY` ni les champs de conteneur normatif d'un `CONTRACT`. Il peut seulement référencer des policies applicables via `policies[]` et référencer un contrat amont via `contractId`.

**Pourquoi** : les guards `isContract` / `isPolicy` / `isEngagement` restent volontairement permissifs sur les champs additionnels pour compatibilité et extensibilité. Il fallait donc une primitive séparée qui encode la frontière sémantique sans casser les payloads existants. Cette séparation rend REQ-037/038/046/047/048/050 vérifiables par code : une policy ne devient pas une mission, un engagement ne devient pas une loi/règle autonome, et un contract-cadre ne devient pas le journal opérationnel.

**Conséquence** : (a) les clients peuvent appeler l'audit strict avant négociation/stabilisation lorsqu'ils veulent refuser un artefact ambigu ; (b) le runtime local reste compatible avec les artefacts existants, car l'audit strict n'est pas encore imposé automatiquement dans `stabilizeNegotiation` ; (c) une future DEC pourra décider où rendre cet audit bloquant (CLI, MCP, store ou seulement tooling) ; (d) la précédence inter-policy et les règles d'exception restent ouvertes — DEC-039 fixe la distinction de catégorie, pas encore le moteur de résolution de conflits.


## DEC-040 — Résolution exécutable des cibles d'escalade par scope
**Date** : 2026-05-20. **Réfère** : DEC-012, DEC-014, DEC-021, DEC-023, DEC-024, REQ-068, WP-50.

**Décision** : `@sentropic/h2a` expose le vocabulaire et le résolveur V1 des cibles d'escalade :

- canaux : `H2A_ESCALATION_CHANNELS = ["advise", "decide", "alert"]` ;
- autorités cibles : `H2A_ESCALATION_AUTHORITY_KINDS = ["PRINCIPAL", "EXECUTIF", "QUORUM", "CONTROL", "EXTERNAL_AUTHORITY", "RECOURSE"]` ;
- helper `resolveEscalationTarget(enforcementPlan, request, {fallbackPrincipal?})` ;
- helper `assertEscalationTargetResolved(resolution)`.

Le résolveur lit `ENFORCEMENT_PLAN.escalations[]`. Chaque route peut déclarer `{trigger, target, channel, scope, authorityKind, domain}`. La sélection est déterministe : filtre par channel/scope/trigger/domain compatibles, préfère les routes les plus spécifiques (domain > trigger > scope > channel), puis conserve l'ordre du plan en cas d'égalité. Les anciennes routes qui n'indiquent pas `authorityKind` sont interprétées comme `PRINCIPAL` pour compatibilité.

**Décision (fallback)** : le PRINCIPAL n'est plus inventé implicitement. Le fallback mono-humain existe seulement si l'appelant fournit explicitement `fallbackPrincipal`. Sans route de plan et sans fallback, le résultat est `{ok:false, issues:[...]}`. C'est l'encodage exécutable de DEC-024 : l'escalade cible l'autorité compétente du scope, pas automatiquement le PRINCIPAL local.

**Pourquoi** : (a) les modèles multi-humain/fédération/gouvernement exigent EXECUTIF, CONTROL, autorité externe, recours ou quorum selon le scope ; (b) une règle cachée "tout remonte au PRINCIPAL" recrée le goulot d'étranglement identifié dans EVALUATIONS.md ; (c) `ENFORCEMENT_PLAN` était déjà le bon artefact pour l'application, mais ses routes n'étaient pas exploitables par code ; (d) garder le fallback explicite préserve le cas mono-humain sans affaiblir les scénarios fédérés.

**Conséquence** : (a) `H2AEnforcementPlan.escalations[]` gagne des champs optionnels `scope`, `authorityKind`, `domain` ; (b) les clients peuvent résoudre une cible d'escalade avant d'écrire un événement `escalate` ; (c) le handler MCP existant reste compatible mais ne consomme pas encore ce résolveur — une future slice pourra ajouter `target`/`authorityKind` au payload d'escalade ; (d) DEC-040 ne résout pas la précédence entre policies : elle route seulement le besoin d'arbitrage vers l'autorité déclarée.
