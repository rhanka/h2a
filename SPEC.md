# Spécification — couche 2 de la pile contractuelle (DEC-010)

> **Couche** : SPÉCIFICATION (le **quoi mesurable**). Exigences vérifiables traduisant `INTENTION.md`.
> **Convention** : `REQ-NNN`, numérotation continue. Toute évolution = nouvelle REQ ou amendement explicite tracé.
> **Aval** : `DECISIONS.md` (choix de design justifiés contre ces REQs) ; futur `specs/SPEC-*.md` (architectures détaillées) ; futur `specs/REQ-MAPPING.md` (mapping REQ → SPEC-doc).

## Vision & portée

- **REQ-001** — Concevoir un **protocole** permettant la collaboration entre agents CLI hétérogènes (Claude Code, Codex, Gemini, autres), inspiré d'A2A mais adapté au monde CLI.
- **REQ-002** — Le protocole doit être implémentable comme **tool / plugin dans chaque CLI cible** (un même contrat, plusieurs adapters CLI).

## Modes de transport

- **REQ-003** — Mode **remote** : collaboration via un service distant (à terme rattaché au projet `@sentropic/remote`).
- **REQ-004** — Mode **local** : collaboration sans dépendance réseau, via **fichiers dans chaque workspace** (zone de réception → traitement → réponse). Doit fonctionner offline.
- **REQ-005** — Mode **MCP central** : collaboration via un service MCP partagé jouant le rôle de bus / broker.
- **REQ-006** — Les trois transports (REQ-003/004/005) doivent être **interchangeables** sans changer le code des agents — le protocole est agnostique du transport.

## Rôles & organisation

- **REQ-007** — Rôle **CONDUCTOR** (cf. `VOCABULARY.md §1.2`) : supervise un cheptel d'AGENTS, sert d'interface au pilotage du PRINCIPAL, porte la responsabilité de l'exécution déléguée.
- **REQ-008** — Rôles de **CONTROL** (ex. cyber, finance, éthique, legal, qualité — cf. DEC-007) qui ne sont ni purement opérateurs ni purement conductors, et doivent pouvoir s'imposer/conseiller à travers l'organisation.
- **REQ-009** — La terminologie de rôles doit être validée pendant le design — proposer des alternatives. *(Partiellement satisfait : DEC-007/008/009.)*
- **REQ-010** — Mode **organisation** : le protocole doit permettre de répliquer le mode de fonctionnement d'une organisation humaine (hiérarchies, rôles, responsabilités, escalades).

## Multi-humain & fédération organisationnelle

- **REQ-029** — Le protocole doit supporter plusieurs humains, chacun pouvant être **PRINCIPAL de sa propre mini-organisation** : agents, engagements, contrôles et journaux propres.
- **REQ-030** — Un même humain doit pouvoir tenir un **rôle dans une organisation plus large** tout en conservant son périmètre de PRINCIPAL local.
- **REQ-031** — Le premier mode multi-humain à spécifier est un mode **pair-à-pair humain-humain** : chaque humain dialogue avec les autres depuis sa mini-organisation, sans exécutif global obligatoire.
- **REQ-032** — Le protocole doit aussi permettre des modes multi-humains plus structurés, notamment un mode où un **exécutif** porte la responsabilité de l'activité d'ensemble couvrant plusieurs PRINCIPAUX et leurs AGENTS.
- **REQ-033** — Les frontières entre mini-organisations doivent être explicites : identité, autorité, droits de lecture/écriture, routage des escalades, journalisation et responsabilités doivent rester auditables.
- **REQ-034** — Le protocole doit supporter trois canaux multi-humains distincts : **PRINCIPAL ↔ PRINCIPAL**, **CONDUCTOR ↔ CONDUCTOR**, et **ENGAGEMENT partagé**.
- **REQ-035** — Le rôle **EXECUTIF** doit représenter la responsabilité d'ensemble sur une activité couvrant plusieurs PRINCIPAUX, leurs mini-organisations, leurs CONDUCTORS, leurs AGENTS et leurs CONTROL.
- **REQ-036** — L'EXECUTIF ne doit pas effacer l'autorité des PRINCIPAUX locaux : le protocole doit représenter les responsabilités locales et globales simultanément.
- **REQ-037** — Le protocole doit représenter des **POLICY** durables, versionnées et applicables à un scope : mini-organisation, engagement, fédération, activité d'ensemble.
- **REQ-038** — Une POLICY doit être distincte d'un ENGAGEMENT : elle contraint les engagements et actions, mais ne remplace pas le charter opérationnel d'une mission.
- **REQ-039** — Chaque ENGAGEMENT doit pouvoir déclarer les policies applicables et tracer les violations, dérogations, conflits ou escalades associées.
- **REQ-040** — Les rôles CONTROL doivent pouvoir proposer, valider, imposer, auditer, alerter ou veto des policies dans leur domaine, selon les droits attachés au scope.
- **REQ-041** — Le protocole doit définir la précédence et la résolution de conflit entre policies de scopes différents ou entre CONTROL de domaines différents.
- **REQ-046** — Le protocole doit représenter un **CONTRACT** comme conteneur normatif signé distinct d'un ENGAGEMENT opérationnel.
- **REQ-047** — Un CONTRACT doit pouvoir contenir ou référencer des policies, obligations, droits, clauses de contrôle/escalade, références externes, signatures, preuves et engagements dérivés.
- **REQ-048** — Un ENGAGEMENT doit être traité comme le contrat opérationnel exécutable : scope, charter, bindings, controls, policies applicables, success criteria, actions, journaux et amendements.
- **REQ-049** — ENFORCEMENT_PLAN/ESCALADE doit être traité comme un plan transversal d'application des intentions, specs, contracts, policies et engagements, pas comme un artefact contractuel de contenu ni comme le rôle CONTROL.
- **REQ-050** — Le protocole doit distinguer contrat-cadre, policy autonome, clause de contract, engagement dérivé, obligation réglementaire et action de contrôle.
- **REQ-061** — Le protocole doit représenter **SCOPE** comme concept first-class distinct de l'ENGAGEMENT : un engagement a un scope, mais n'est pas le scope lui-même.
- **REQ-062** — Le protocole doit distinguer **PARTY**, **AUTHORITY**, **MANDATE** et **SIGNATURE** : un scope ne signe jamais ; une INSTANCE autorisée signe pour une partie ou un scope selon un mandat explicite.
- **REQ-063** — Le protocole doit représenter **OBLIGATION**, **RIGHT**, **CLAUSE** et **EVIDENCE_PACKAGE** comme composants possibles d'un CONTRACT, d'une POLICY ou d'un ENGAGEMENT.
- **REQ-064** — Une POLICY doit porter une `sourceAuthority` et un `adoptionMode` (`ratified`, `contractual`, `imposed`, `acknowledged`) afin de couvrir lois, taxes, règlements et policies internes.

## Coordination globale

- **REQ-011** — Coordination/consolidation **possiblement non centralisée** : pas de point d'autorité unique imposé. Soit un CONDUCTOR "racine", soit un rôle de CONTROL, soit un mécanisme de consensus — à concevoir.
- **REQ-012** — Mécanisme de **cohérence globale** entre AGENTS/CONDUCTORS (audit, vue agrégée, résolution de conflits).

## Registration, négociation et stabilisation

- **REQ-051** — Le protocole doit fournir un **REGISTRY** minimal où des INSTANCE déclarent leurs rôles, scopes, capabilities, endpoints, clés de signature et policies acceptées.
- **REQ-052** — Le protocole doit représenter une **NEGOTIATION** comme session transitoire entre deux ou plusieurs parties visant à produire un CONTRACT, une POLICY, un ENGAGEMENT ou un amendement.
- **REQ-053** — Une NEGOTIATION est **stabilisée** quand les signataires requis acceptent le même artefact canonique, identifié par version et hash, avec signatures vérifiables.
- **REQ-054** — En V1, le protocole doit fonctionner **sans médiateur inter-contrat** : les négociations peuvent être bilatérales ou multilatérales locales, mais la résolution globale de conflits entre contrats reste un sujet d'ENFORCEMENT_PLAN/ESCALADE ou d'autorité de scope.
- **REQ-055** — Le cas d'usage initial doit supporter un humain PRINCIPAL pilotant **15 CONDUCTORS** capables de s'enregistrer, découvrir leurs capacités, négocier des contrats/engagements entre eux et stabiliser les artefacts signés.
- **REQ-065** — Une NEGOTIATION doit avoir une state machine minimale : `draft`, `proposed`, `countered`, `accepted`, `rejected`, `withdrawn`, `expired`, `stabilized`, `abandoned`.
- **REQ-066** — Toute proposition de NEGOTIATION doit référencer une base version/hash ; une proposition stale doit être rejetée ou explicitement rebasée.
- **REQ-067** — La stabilisation sans médiateur inter-contrat doit s'appuyer sur un ledger de négociation, des règles de quorum/signature et des états terminaux explicites, pas sur un consensus global implicite.

## Human-in-the-loop

- **REQ-013** — Le PRINCIPAL peut **prendre le contrôle** d'un AGENT en cours d'exécution.
- **REQ-014** — Le PRINCIPAL peut **prendre le contrôle d'un CONDUCTOR** (et donc de ses subordonnés).
- **REQ-015** — Les transitions PRINCIPAL ↔ AGENT/CONDUCTOR doivent rester **observables et auditables** par l'organisation.
- **REQ-025** — **HITL par engagement** : la prise de contrôle humaine se déclare et s'applique au niveau d'un engagement (pas globalement, pas par message isolé). Le scope HITL = scope d'un engagement.
- **REQ-026** — **Escalade vers le PRINCIPAL = primitive du protocole** (pas un cas particulier d'amendement). N'importe quel rôle d'un engagement doit pouvoir demander l'arbitrage du PRINCIPAL ; le protocole gère le canal, l'attente, le timeout, et la trace.
- **REQ-027** — **Présentation neutre des choix soumis au PRINCIPAL (ou à un quorum)** : un rôle dédié — **MANDATAIRE** — formule la question et présente les options sans biais. Le proposant ne pose pas sa propre question aux votants.
- **REQ-028** — **Modes d'absence du décideur** (PRINCIPAL ou quorum) explicitement gérés : timeout → action de repli déclarée (continuer/abandonner/pause indéterminée/escalader plus haut), et ce repli est lui-même tracé au charter.
- **REQ-068** — Les escalades doivent pouvoir cibler l'**autorité du scope** : PRINCIPAL, EXECUTIF, quorum, CONTROL habilité, autorité externe ou recours/adjudication explicite selon le contexte.
- **REQ-069** — Le MANDATAIRE ne doit jamais être modélisé comme médiateur, arbitre ou tribunal : il présente neutrement, mais ne résout pas le litige.
- **REQ-070** — L'audit CONTROL doit supporter la minimisation de disclosure : vues redigées, preuves limitées, hashes, attestations et evidence packages, afin d'éviter accès excessif en cross-organisation.

## Représentation de l'organisation (non-fonctionnel)

- **REQ-020** — **Compréhensible** : la représentation de l'org (rôles, engagements, hiérarchie) doit être lisible par un humain non spécialisé.
- **REQ-021** — **Représentable** : doit pouvoir être rendue visuellement (au minimum sous forme d'org-chart classique ou d'arbre).
- **REQ-022** — **Validable** : vérifiable par outil (schéma, type-check, lint des contrats de rôles).
- **REQ-023** — **Changeable** : mutation contrôlée et versionnable (toute évolution de structure laisse une trace).

## Sémantique d'exécution

- **REQ-024** — **Exécutable sans ambiguïté** : la sémantique d'exécution (qui parle à qui, qui décide quoi, dans quel ordre) doit être déterministe et observable.

## Validation par modèles réels

- **REQ-042** — Le modèle doit être évalué contre une **entreprise traditionnelle** : contrats fournisseurs, contrats employés, contrats clients, investisseurs, actionnaires, réglementation, administrations et taxes.
- **REQ-043** — Le modèle doit être évalué contre un **écosystème multi-entreprises** : clients, fournisseurs, partenaires, compétiteurs, consortiums, plateformes, supply chains et joint ventures.
- **REQ-044** — Le modèle doit être évalué contre des **écosystèmes gouvernementaux / citoyens** : citoyens, administrations, élus, régulateurs, services publics, droits, recours, obligations légales et fiscalité.
- **REQ-045** — Chaque évaluation doit produire un mapping acteurs/scopes/contrats/policies/controls/escalades/audit/gaps, puis alimenter `SPEC.md`, `VOCABULARY.md`, `DECISIONS.md` ou les specs détaillées.
- **REQ-060** — Le cas "1 PRINCIPAL / 15 CONDUCTORS / sans médiateur inter-contrat" doit être traité comme un scénario d'évaluation opérationnel et mappé aux tracks A, B et C.
- **REQ-071** — Chaque évaluation ABC doit aussi auditer autorité, mandat, signature, disclosure, précédence, deadlock, recours, obligations récurrentes et droits réservés.

## Packaging & technique

- **REQ-072** — Le nom parapluie du projet doit couvrir la **coordination multi-agent, multi-humain, l'organisation et le human-in-the-loop** ; l'agent-to-agent pur n'en est qu'une sous-surface.
- **REQ-016** — Nom de projet à définir (le nom de travail actuel `a2a-cli` n'est pas définitif). Candidat recommandé révisé : `h2a`, package core `@sentropic/h2a` (DEC-025).
- **REQ-017** — **TypeScript**, gestionnaire de paquets **npm** (pas pnpm) — contrainte dure.
- **REQ-018** — Architecture **modulaire** : core, schemas, local-files, MCP, adapters Codex/Claude doivent rester séparables, même si le package public n'utilise pas le suffixe `-modules`.
- **REQ-056** — Le runtime minimal doit exposer une librairie core TypeScript indépendante des CLI, contenant types, schemas, validation, canonicalisation/hash, signatures et stockage local.
- **REQ-057** — Le runtime minimal doit proposer des adapters fins pour **Codex** et **Claude**, sans coupler le protocole à leurs APIs internes.
- **REQ-058** — Le runtime minimal doit proposer un serveur **MCP** partagé pour registration, discovery, negotiation, signature, inbox/outbox, journal et escalade.
- **REQ-059** — Le runtime minimal doit proposer un mode **local-files bilatéral** dans `src/{project}/h2a/...`, utilisable offline et sans serveur MCP.

## Intégration existante

- **REQ-019** — À terme, possible reprise / intégration du projet `@sentropic/harness` situé dans `../sentropic/` (branche à confirmer — `br23` ou `br25`, à vérifier sur place). Décider en phase design si on l'absorbe, on l'étend, ou on s'y connecte.

## Méta

- Chaque `REQ-NNN` doit être tracé dans `specs/REQ-MAPPING.md` (à créer en sortie de brainstorming).
- Toute nouvelle exigence issue d'un brainstorming aval → ajouter ici en continuant la numérotation.
- Le vocabulaire canonique utilisé ici est figé dans `VOCABULARY.md` (V1.7).
