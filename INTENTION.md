# Intention — couche 1 de la pile contractuelle (DEC-010)

> **Couche** : INTENTION (le **pourquoi**). Narrative, value-driven, owned by PRINCIPAL.
> **Source** : message utilisateur initial du 2026-05-16, préservé verbatim ci-dessous.
> **Aval** : exigences mesurables dans `SPEC.md` ; décisions de design dans `DECISIONS.md`.

## Verbatim utilisateur (préservé pour ne rien perdre)

> Je veux concevoir un protocole permettant d'avoir un conductor d'agents CLI + une collab entre CLI de façon flexible. Un peu à la A2A mais entre CLI. L'idée serait d'avoir un tool / plugin dans chaque CLI (Claude, Codex, Gemini, autres), pour permettre aux agents de collaborer. Il faut que le protocole permette à la fois d'avoir une collaboration remote (projet `@sentropic/remote`) ou locale. L'idéal serait un plugin CLI + tool permettant de passer soit par un service MCP central soit simplement par des fichiers dans chaque workspace (i.e. il y a un endroit de réception pour recevoir les requêtes, les traiter).
>
> Le rôle conductor est essentiel : il permettra à l'humain de piloter un cheptel d'agents sous supervision / responsabilité d'un conductor. La terminologie n'est peut-être pas la bonne, parce qu'on pourrait imaginer des rôles largement transverses (cyber, etc.). Il faut prévoir in fine un mode permettant de répliquer le mode de travail d'une organisation. Dans ce contexte, il faut penser également la gestion globale de la coordination / consolidation de l'ensemble des rôles (qui peut être en mode "non central") — simplement l'un des rôles conductor (ou autre terminologie de fonction transverse à trouver) pour permettre une gestion cohérente. Il faut aussi permettre de gérer l'humain dans la boucle : au sein d'une organisation cohérente, un humain peut prendre le contrôle d'un agent, ou d'un des conductors.
>
> Je cherche également un nom pour ce projet (qui sera un projet `@sentropic/{project}-modules` npm TypeScript — pas pnpm). À ce stade j'étais sur un nom de travail `a2a-cli`.
>
> Enregistre cette intention initiale, dont chaque exigence devra être mappée à des spec, et lance le mode brainstorming pour commencer à poser le concept, sa structure, ses modules. À un moment on pourra reprendre le projet `@sentropic/harness` de `../sentropic/` (je crois branche 25 ou 23) — ce serait peut-être plus cohérent pour l'intégrer à ce nouveau projet.

## Reformulation narrative (distillation)

Concevoir un **protocole d'organisation et de collaboration entre agents CLI hétérogènes** (Claude Code, Codex, Gemini, autres), permettant à un humain (PRINCIPAL) de piloter un cheptel d'agents par l'intermédiaire d'un CONDUCTOR, avec des fonctions de CONTROL transverses (cyber, finance, éthique, legal, qualité), et la possibilité pour l'humain de reprendre la main à tout moment sur un agent ou un conductor.

Ce protocole doit pouvoir s'exécuter sur trois transports interchangeables (local-files, MCP central, remote `@sentropic/remote`), être implémentable comme tool/plugin dans chaque CLI cible, et permettre de **répliquer le mode de fonctionnement d'une organisation** — y compris dans des modes de coordination non centralisés.

## Extension d'intention — multi-humain (2026-05-17)

Chaque humain doit pouvoir fonctionner comme le PRINCIPAL de sa propre mini-organisation : son périmètre, ses agents, ses engagements, ses règles de contrôle et ses journaux. Ce même humain peut aussi tenir un rôle dans une organisation plus large, sans perdre sa responsabilité locale.

Le protocole doit donc cadrer le **multi-humain** comme une fédération possible de mini-organisations humaines. Le premier mode à explorer est un mode pair-à-pair où les humains dialoguent entre eux, chacun parlant depuis sa mini-organisation. Les modes suivants devront couvrir des formes plus structurées, notamment lorsqu'un exécutif porte la responsabilité de l'activité d'ensemble, incluant plusieurs PRINCIPAUX et leurs agents.

Cette organisation multi-humaine doit aussi traiter les **CONTROL** et les **POLICY** comme des éléments de premier ordre : les controls portent les responsabilités transverses (cyber, finance, éthique, legal, qualité), tandis que les policies expriment les règles durables applicables à une mini-organisation, une fédération, un engagement ou une activité d'ensemble.

## Périmètre projet

- **Package cible** : `@sentropic/{nom-à-définir}-modules`, npm, TypeScript.
- **Nom de travail** : `a2a-cli` (provisoire, à trancher).
- **Intégration prévue** : reprise possible du projet `@sentropic/harness` (`../sentropic/`, branche à confirmer — `br23` ou `br25`).

## Couches aval

- Exigences traduisant cette intention en éléments mesurables : `SPEC.md`.
- Décisions de design prises pour la satisfaire : `DECISIONS.md`.
- Vocabulaire canonique : `VOCABULARY.md`.

## Note de gouvernance de cette intention

Cette intention peut être révisée par le PRINCIPAL ; toute révision substantielle doit être tracée (date + raison) et déclencher une revue de cohérence sur `SPEC.md` et `DECISIONS.md`.
