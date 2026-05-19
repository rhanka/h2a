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
