# Proposition — Re-segmentation sentropic ↔ h2a (consolidation single-CLI)

Status: PROPOSAL (à stabiliser par double consensus opus-4-8 max + codex 5.5 xhigh, puis à négocier avec stp + architecte via h2a)
Date: 2026-06-27
Conducteur: claude:a2a-cli (h2a)
Décideur (PRINCIPAL): Fabien

## 1. Décision à intégrer (PRINCIPAL)

- **h2a = LA CLI de sentropic** : un cadre d'organisation **centré humain** pour agents **conversationnels ET de code**.
- h2a **gère + aide** tous les agents/outils, et **en offre un** : faire du **code** (≈ Claude Code) *et* des **tâches de tout type** (≈ Hermes, cf orchestration déléguée de remote).
- **sentropic porte les libs techniques** consommées par h2a.
- **Un seul plugin à déployer = h2a.**
- Axe de segmentation = **CLI vs ORGANISATION**.

## 2. Tension réelle révélée par la vision d'ensemble

La clé de voûte **actuelle** est `stp` = `@sentropic/cli@0.2.0` : une CLI-parapluie qui **fédère** 8 sous-commandes pairs
(`stp app|h2a|track|remote|harness|knowledge|design|agent-stats`), avec harmonisation de verbes et registry de découverte
(SPEC_EVOL_STP_FEDERATION, BR-42). Direction documentée = **fédération de pairs**, pas absorption.

La décision PRINCIPAL **repointe la clé de voûte de `stp` vers `h2a`** :
- h2a devient le **front-door unique + cadre d'organisation** ;
- les 8 briques deviennent soit **libs sentropic** (technique), soit **capabilities h2a-org** (gouvernance) ;
- la **fédération `stp` devient transitionnelle/dépréciée** (alignée S3 architecte) : son rôle de coordination est **absorbé par h2a** (conductor/Objective Loop + RACI), son binaire reste un **alias de compat** pendant la migration.

C'est le point central que le double consensus doit trancher : **repointage d'umbrella (h2a) vs maintien de la fédération `stp` avec h2a comme simple sous-commande.** Proposition: repointage vers h2a, fédération `stp` en compat dépréciée.

## 3. Re-segmentation (CLI+ORG → h2a ; technique → libs sentropic)

| Brique (aujourd'hui) | Va dans | Forme |
| --- | --- | --- |
| **stp / @sentropic/cli** (fédération) | **h2a (umbrella+org)** | h2a devient le front-door ; registry de sous-commandes + harmonisation de verbes repris ; `stp` binaire = alias compat déprécié |
| **track** (record-only backlog) | **h2a-org (UX) + lib** | h2a expose org/report/decision/acceptance/provenance/canevas ; **consomme `@sentropic/track` comme lib/service** (record-only préservé, machine-contracts JSON/MCP intacts) — fold UX, PAS merge de modèle |
| **remote** (orchestration K8s) | **h2a-cli (UX) + lib** | h2a expose run/attach/logs/wake/delegate ; **consomme les libs remote/gateway/transport sentropic** ; remote reste plateforme/lib autonome (transporte h2a) ; secrets/gw restent library-owned |
| **harness** (méthode dev) | **h2a-org (méthode)** | h2a expose method/check/verify/plan/review ; reprend les kernels `@sentropic/harness` (qui supplante superpowers) ; ownership de `scope` **stratifié préservé** (track=règles, harness=verdict-commit, track=statut) |
| **knowledge (ex-graphify), design, app, agent-stats** | **h2a-org capabilities** consommant libs | sous-commandes h2a adossées aux libs sentropic correspondantes |
| **canevas** | **h2a-org (sémantique)** | concept h2a (surface décision humaine) **rendu via design-system** ; données via lib sentropic |
| **gateway, LLM-mesh, MCP/auth interop, transport/session/remote-exec, identité/crypto/NHI, k8s/deploy, design-system/rendering** | **sentropic (libs)** | packages techniques `@sentropic/*` consommés par h2a ; **n'importent jamais h2a** (anti-cycle) |
| **agent offert (code + tâches tout-type)** | **h2a-cli** | un agent h2a faisant code (≈ Claude Code) + tâches tout-type (≈ délégation Hermes de remote) |

## 4. Invariants / contraintes (architecte ALIGN + vision)

1. **Pas de big-bang** : shims de compat + anciens entrypoints conservés jusqu'à migration des callers/agents.
2. **Anti-cycle** : les libs sentropic n'importent PAS la CLI/org h2a ; h2a importe libs/adapters.
3. **track reste record-only** : machine-contracts JSON/MCP intacts en S1 ; h2a les *enveloppe* pour l'humain, ne les mute pas.
4. **remote reste plateforme autonome** : secrets/gateway/runtime restent library-owned ; h2a en est un *caller*.
5. **harness supplante superpowers** (backend interchangeable) ; **propriété de `scope` stratifiée** non fusionnée.
6. **Un seul plugin déployé = h2a** ; les libs restent versionnées/publiées séparément.

## 5. Staging réaliste (S0–S4, depuis l'architecte)

- **S0** — Figer le langage de frontière dans specs/README (h2a = CLI+org, sentropic = libs). Aucun rename global.
- **S1** — Fold **track → h2a-org** au niveau UX/plugin ; h2a consomme `@sentropic/track` (lib) ; contrats machine intacts.
- **S2** — Fold **remote CLI → h2a-cli** ; h2a consomme libs remote/gateway/transport ; remote reste lib/adapter compat.
- **S3** — Fold **harness → h2a-org** (method/check/verify/plan) ; **fédération `stp` → transitionnelle/dépréciée**, binaire en alias compat.
- **S4** — **Un seul plugin h2a** déployé ; libs `@sentropic/*` versionnées à part ; agent offert (code+tout-type) livré.

## 6. Reprise des backlogs

Les backlogs **track, remote, harness, stp** sont repris sous **une gouvernance unique** pilotée par l'Objective Loop h2a
`loop-mqwbq2vn` (1 WP par brique absorbée), avec refs typés vers chaque repo/baseline (modèle Objective Loop déjà acté).

## 7. Questions ouvertes (à stabiliser par le double consensus)

- Q1. **Repointage umbrella h2a vs maintien fédération stp** : confirmer le repointage + le statut d'alias compat de `stp`.
- Q2. **Frontière fine libs↔CLI** : où s'arrête la lib (ex. gateway/transport) et où commence le verbe h2a, sans cycle.
- Q3. **track record-only vs h2a-org** : la frontière « h2a enveloppe, ne mute pas » tient-elle pour acceptance/provenance ?
- Q4. **`scope` stratifié** : préservation exacte (track règles / harness verdict-commit / track statut) sous un seul plugin.
- Q5. **Compat & dépréciation** : durée/critères de bascule des callers de `stp`/`track`/`remote`/`harness` avant retrait des shims.
- Q6. **Agent offert (code + tout-type)** : périmètre MVP (réutilise la délégation remote façon Hermes ? nouveau ?).

## 8. Consensus stabilisé (double review Opus-4-8 + Codex 5.5 xhigh — 2026-06-27)

Décision PRINCIPAL = **B (repoint complet)**. Les deux pairs convergent : **B exécutable, mais DESIGN-FIRST**.
Verdicts : Opus-4-8 = AMEND (reco A/scinder) ; Codex 5.5 xhigh = **NEEDS_DESIGN_FIRST**. 5 objections CONFIRMÉES par les deux.

**Must-fix bloquants (à concevoir AVANT toute dépréciation de `stp` / tout merge) :**

1. **Paquet neutre `@sentropic/session-protocol`** (anti-cycle O3) — enveloppes, présence, adressage, *wake intent*, *delegation intent*, capability tokens. `@sentropic/remote` transporte ce protocole **sans connaître h2a** ; `h2a-cli` implémente wake/delegate comme UX au-dessus ; **guards tmux/human-typing restent dans `h2a-cli`**, jamais dans la remote-lib.
2. **`@sentropic/governance-protocol`** (O2) — schémas RACI/decision/conductor/objective-loop. Persistance canonique = log append-only `@sentropic/track` qui ne porte **aucune logique métier** (validation JSON-schema + provenance + horodatage seulement) ; projecteurs/workflows vivent dans `h2a-org`. → record-only préservé, ni shadow-store h2a, ni merge de modèle track.
3. **`@sentropic/scope-gate`** (O4) — gate unique appelé avant toute écriture track/statut/commit ; vérifie : règles scope présentes, verdict harness signé, statut track cohérent ; **hard-fail** sans preuve ; `--break-glass` écrit un record auditable. Test de conformité qui échoue si une commande écrit track/statut sans passer le gate.
4. **Matrice compat-versions + contract-tests inter-lib** (O5) — `h2a-cli@M` déclare supporter `track-protocol@N..`, `session-protocol@N`, `remote-lib@N..`, `governance-protocol@N` ; contract-tests obligatoires gatant la release h2a ; **bus présence/adressage keyés par version de protocole, PAS par la string `h2a`**.
5. **Gate de gouvernance / conflit d'intérêt (O1)** — la réversion de **BR-42** (fédération→absorption) n'est valide que par **ADR signé par un owner non-h2a + Fabien**, avec matrice de critères et fenêtre d'appel. h2a porte l'exécution, ne s'auto-valide pas.
6. **Taxonomie stable (risque Codex)** — `h2a-cli` / `h2a-org` / `sentropic/*-protocol` ; **jamais « h2a » comme nom de lib interne** (évite la collision protocole/org/runtime/CLI).

**Staging stabilisé :**
- **S0** — Figer noms + protocoles neutres + **ADR reversal BR-42** + matrice compat + contract-tests. Aucun rename public.
- **S1** — Déplacer **uniquement** les schémas/records gouvernance vers `governance-protocol` ; track reste API stable.
- **S2** — Introduire `session-protocol` ; remote le consomme ; h2a-cli consomme remote ; wake/delegate restent CLI.
- **S3** — Ajouter `h2a-org` en façade ; brancher harness via `scope-gate`.
- **S4** — `stp` = alias compat (warnings structurés). **Retrait stp seulement après** : 2 releases mineures sans rupture, 0 commande externe non-aliasée, docs+CI migrées, contract-tests track/remote/harness verts via anciens chemins, fenêtre LTS annoncée.

**Q1–Q6 (réponses stabilisées) :** Q1 `stp`→`h2a` par alias binaire+npm, sous-commandes gardent leur nom, jamais de changement silencieux de sortie machine. Q2 libs n'importent que `*-protocol` ; h2a importe libs+protocoles ; CI interdit les cycles. Q3 track record-only tient pour acceptance/provenance **ssi** ce sont des record-types versionnés validés par schema, interprétés hors track. Q4 enforcement par `scope-gate` + test de conformité. Q5 semver + matrice supportée + contract-tests ; dépréciation stp = alias complet + warnings + LTS. Q6 agent offert MVP = `h2a agent run|attach|delegate|logs|wake`, délégation Hermes minimale, exécution code façon Claude Code, journalisation track, capabilities explicites, **pas d'auto-conductor complet** au départ.

**Statut : STABILISÉE pour négociation** avec stp (claude:sentropic:1ac787684c04) + architecte (claude:architect:ed8bbd8bf573). Le gate O1 (ADR BR-42) revient à Fabien pour signature.
