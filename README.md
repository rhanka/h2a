# h2a — Humans-to-Agents Coordination Protocol

> **Pitch en une phrase** : un protocole et un binaire CLI pour faire **coopérer plusieurs CLI agentiques** (Claude Code, Codex, Gemini, autres) entre eux et avec des humains, à travers un système de **rôles, signatures, négociation et notifications** inspiré du fonctionnement d'une organisation réelle.

| | |
|---|---|
| **Packages publiés** | `@sentropic/h2a@0.1.19` (core), `@sentropic/h2a-cli@0.1.19` (binaire + serveur MCP + skills) |
| **Licence** | MIT (DEC-027) |
| **Statut** | V1 utilisable bout-en-bout : protocole + runtime local + 3 hôtes (Claude / Codex / Gemini) + skills. V2 (remote, auth transport, k8s) en cadrage. |
| **Quickstart** | `npm i -g @sentropic/h2a-cli` puis voir [§Démarrage en 5 minutes](#démarrage-en-5-minutes). |

---

## Pourquoi h2a existe

Quand plusieurs CLI agentiques (Claude Code, Codex, Gemini…) sont utilisés ensemble pour faire avancer un même projet, **aucun d'eux ne sait que les autres existent**. Chacun parle à son humain ; aucune mémoire partagée ; aucune négociation entre agents ; aucune trace contractuelle de ce qui a été décidé.

h2a comble ce trou. Trois besoins, traités comme un seul protocole :

1. **Multi-agents** — Claude et Codex doivent pouvoir se découvrir, s'envoyer des messages, négocier un livrable signé, sans dépendre d'un service central.
2. **Multi-humains** — un développeur est le PRINCIPAL de sa propre mini-organisation, et peut aussi participer à une organisation plus large (équipe, fédération, recours public). h2a modélise les deux.
3. **Human-in-the-loop** — un humain peut reprendre la main sur un AGENT ou un CONDUCTOR à tout moment ; l'escalade vers une autorité de scope (PRINCIPAL, CONTROL, autorité externe, recours) est une primitive du protocole.

Le tout sans inventer une couche de gouvernance cachée : V1 **déclare** les profils (disclosure, recours, juridiction, obligations récurrentes, précédence de policy) et **escalade** les conflits — sans résolveur automatique. Voir [INTENTION.md](./INTENTION.md) pour la formulation originale.

---

## Modèle mental en deux schémas

### 1. Comment les CLI coopèrent

```
┌──────────────────────────────────────────────────────────────────┐
│                       Machine du développeur                     │
│                                                                  │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│   │ Claude Code  │    │  Codex CLI   │    │  Gemini CLI  │       │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘       │
│          │ MCP stdio          │ MCP stdio          │ MCP stdio   │
│          ▼                    ▼                    ▼             │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│   │ h2a mcp-serve│    │ h2a mcp-serve│    │ h2a mcp-serve│       │
│   │  (subprocess │    │  (subprocess │    │  (subprocess │       │
│   │   du CLI)    │    │   du CLI)    │    │   du CLI)    │       │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘       │
│          │                    │                    │             │
│          └────────────────────┴────────────────────┘             │
│                               │                                  │
│                               ▼                                  │
│              ┌────────────────────────────────┐                  │
│              │     <root>/.h2a/  (le bus)     │                  │
│              │                                │                  │
│              │  registry/instances.jsonl     │                  │
│              │  presence/<sid>.json          │                  │
│              │  negotiations/<id>/journal..  │                  │
│              │  inbox/<instance>/*.json      │                  │
│              │  contracts/ engagements/ ...  │                  │
│              └────────────────────────────────┘                  │
└──────────────────────────────────────────────────────────────────┘
```

Les trois CLI ne se parlent jamais directement. Ils écrivent et lisent dans un dossier `.h2a/` partagé, via leur propre instance du serveur MCP `h2a mcp-serve` (un subprocess spawné par chaque CLI hôte). Le **format des fichiers EST le protocole** — chaque ligne d'un journal est une entrée signée chaînée, chaque enveloppe d'inbox est un message routé, chaque fichier de présence est un battement de cœur.

### 2. La pile contractuelle (DEC-010)

```
INTENTION    le pourquoi             → INTENTION.md (verbatim utilisateur)
   │
   ▼
SPÉCIFICATION  exigences mesurables  → SPEC.md (REQ-NNN)
   │
   ▼
ARTEFACTS    ce qui lie              → CONTRACT, POLICY, ENGAGEMENT,
   │         (signés ed25519,          MANDATE, AUTHORITY, SIGNATURE,
   │          canonical JSON hash)     AMENDMENT, ENFORCEMENT_PLAN
   ▼
ENFORCEMENT  l'application           → ENFORCEMENT_PLAN, escalations,
             (qui décide quoi          recourse, controlled disclosure
              dans quel scope)
```

Les rôles cardinaux : **PRINCIPAL** (l'humain ultime), **EXECUTIF** (responsabilité d'ensemble), **CONDUCTOR** (pilote un cheptel d'agents), **AGENTS** (les CLI), **CONTROL** (fonctions transverses : cyber, finance, éthique, legal, qualité), **MANDATAIRE** (présentateur neutre, jamais arbitre). Voir [VOCABULARY.md](./VOCABULARY.md).

---

## Démarrage en 5 minutes

```bash
# 1. Installer
npm i -g @sentropic/h2a-cli@latest

# 2. Bootstrap pour chaque CLI hôte (à faire une seule fois par machine)
h2a connect --host claude --root ~/h2a-workspace/.h2a --instance claude:demo
h2a connect --host codex  --root ~/h2a-workspace/.h2a --instance codex:demo
h2a connect --host gemini --root ~/h2a-workspace/.h2a --instance gemini:demo
# … puis fusionner les snippets MCP imprimés dans la config de chaque CLI

# 3. Générer une clé de signature par instance
h2a keys generate --instance claude:demo --root ~/h2a-workspace/.h2a
h2a keys generate --instance codex:demo  --root ~/h2a-workspace/.h2a

# 4. Installer la skill `/h2a` dans chaque CLI hôte
h2a install-skills --host claude --scope user
h2a install-skills --host codex  --scope user
h2a install-skills --host gemini --scope user
```

Ensuite, dans chaque CLI :

```
/h2a                          ← raccourci pour /h2a status
/h2a connect                  ← ouvre une session live dans la conversation
/h2a discover                 ← liste les peers en ligne
/h2a send codex:demo "hi"     ← envoie un message
/h2a receive                  ← lit l'inbox + réagit aux notifications push
/h2a negotiate open ...       ← démarre une négociation signée
/h2a help                     ← carte des commandes
```

**Guide complet pas-à-pas** : [`docs/tutorial-cross-cli.md`](./docs/tutorial-cross-cli.md). Il couvre la mise en place, les modes d'échec courants, et le mapping V1/V2.

---

## Ce qui est livré (V1) vs ce qui ne l'est pas

| Capacité | V1 (état actuel) | V2 / différé |
|---|---|---|
| Transport local-files (`<root>/.h2a/`) | ✅ shipped | — |
| Serveur MCP stdio (13 outils JSON-RPC 2.0) | ✅ shipped | — |
| Adapter Codex / Claude Code / Gemini | ✅ shipped (DEC-049) | — |
| Skill `/h2a` consolidée pour les 3 hôtes | ✅ shipped (DEC-057) | — |
| Session protocol : présence + heartbeat + push notifications | ✅ shipped (DEC-050..053) | — |
| Signatures ed25519 + canonical JSON + journal chaîné | ✅ shipped (DEC-035) | — |
| Profils ABC déclaratifs : disclosure, recours, obligations récurrentes, juridiction, précédence | ✅ shipped (DEC-045..048) | résolveurs automatiques (V2) |
| Cross-machine (`@sentropic/remote`) | ❌ pas commencé | V2 (`@sentropic/h2a-remote` candidat) |
| Auth de transport (mTLS / bearer signé) | ❌ V1 sans (DEC-032) | V2 |
| SUBAGENTS first-class (adressables individuellement) | ❌ V1 consolidés dans l'AGENT | V2 (DEC-008) |
| Key management UX (rotation, keyring) | ❌ PEM manuel via `h2a keys generate` | V2 candidat |
| Déploiement Kubernetes (sidecar / tenant / broker) | 🟡 instruit dans [docs/instruction-k8s-and-remote-controle-interop.md](./docs/instruction-k8s-and-remote-controle-interop.md) (DEC-056) | DEC-057+ |

V1 dit ce qu'on a le droit d'utiliser et trace tout. V1 n'arbitre **jamais** un conflit à la place d'une autorité humaine — c'est volontaire (REQ-054).

---

## Surface CLI (référence)

```
h2a --help
h2a hosts
h2a mcp-tools

# Setup haut niveau (DEC-054)
h2a connect --host <codex|claude|gemini> [--root <path>] [--instance <id>]
h2a doctor [--root <path>]
h2a sessions [--root <path>] [--scope <s>] [--instance <i>]
h2a keys generate --instance <id> [--out <dir>] [--root <path>]
h2a install-skills --host <claude|codex|gemini> [--scope user|project] [--force]

# Runtime local-files (store sous <root>/.h2a, DEC-031)
h2a init [--root <path>]
h2a register --json <registration-json> [--root <path>]
h2a discover [--role <role>] [--scope <scope>] [--root <path>]

# Négociation (offer/counter/sign/event acceptent --causation-id / --correlation-id ;
# par défaut, chaque événement hérite de l'événement précédent — DEC-033)
h2a negotiate open --json <record-json> [--root <path>]
h2a negotiate status --id <id> --status <status> [--root <path>]
h2a negotiate event --id <id> --json <payload-json> [...] [--root <path>]
h2a negotiate offer --id <id> --instance <id> --artifact <json> [...] [--root <path>]
h2a negotiate counter --id <id> --instance <id> --artifact <json> [...] [--root <path>]
h2a negotiate sign --id <id> --instance <id> --artifact <json> --private-key <pem-path> [...] [--root <path>]
h2a negotiate stabilize --id <id> [--event-id <id>] [--root <path>]
h2a negotiate journal --id <id> [--root <path>]

# Mailboxes
h2a inbox put --instance <id> --json <envelope> [--root <path>]
h2a inbox read --instance <id> [--root <path>]
h2a inbox pop --instance <id> --envelope <id> [--root <path>]
h2a outbox put --instance <id> --json <envelope> [--root <path>]
h2a outbox read --instance <id> [--root <path>]

# Maintenance du store
h2a store migrate [--from <v>] [--to <v>] [--dry-run] [--root <path>]

# MCP server (JSON-RPC 2.0 sur stdio, DEC-026 + DEC-051/052)
h2a mcp-serve [--root <path>]

# Host wiring (snippets MCP pour chaque hôte)
h2a host setup --host <codex|claude|gemini> [--root <path>] [--print | --write <file>] [--force]
h2a host status [--host <name>]
```

Tout verbe JSON suit une des trois enveloppes canoniques (`resource` / `list` / `action`) avec table de codes de sortie `0 / 1 / 2 / 3`. Contrat machine-readable : `H2A_CLI_VERB_CONTRACTS` (`packages/h2a-cli/src/cli-contract.ts`). Référence humaine : [`docs/cli-contract.md`](./docs/cli-contract.md).

---

## Outils MCP exposés par `mcp-serve`

13 outils JSON-RPC 2.0 stdio, consommés par les CLI hôtes via leur config `mcpServers.h2a` :

| Famille | Outils |
|---|---|
| Registry | `h2a_register_instance`, `h2a_discover_instances` |
| Session (DEC-051) | `h2a_session_open`, `h2a_session_close`, `h2a_discover_sessions` |
| Négociation | `h2a_open_negotiation`, `h2a_offer`, `h2a_counteroffer`, `h2a_sign`, `h2a_stabilize`, `h2a_append_journal`, `h2a_escalate` |
| Mailbox | `h2a_inbox` (`read` / `put` / `pop`) |

Plus un canal de **notifications push** (`notifications/h2a`) sur 4 topics (DEC-052) : `presence.peer_joined`, `presence.peer_left`, `inbox.envelope_arrived`, `negotiation.event_appended`. Les sessions s'abonnent à un sous-ensemble via `h2a_session_open`.

---

## Exemple runnable

[`examples/principal-conductors/`](./examples/principal-conductors/) — démo de bout en bout du cas **1 PRINCIPAL / 15 CONDUCTORS** : génère 16 paires ed25519, enregistre les 16 instances, ouvre une négociation avec quorum 3 sur 15, signe et stabilise, et finit en interrogeant le serveur MCP en JSON-RPC sur stdio.

```bash
./examples/principal-conductors/run.sh   # build + run
```

---

## Documents de référence

| Document | Rôle |
|---|---|
| [INTENTION.md](./INTENTION.md) | Verbatim utilisateur initial + reformulation narrative |
| [SPEC.md](./SPEC.md) | Exigences mesurables `REQ-NNN` |
| [VOCABULARY.md](./VOCABULARY.md) | Vocabulaire canonique (figé V1.x) |
| [DECISIONS.md](./DECISIONS.md) | Journal append-only des `DEC-NNN` (modèle, runtime, host, governance) |
| [PLAN.md](./PLAN.md) | Plan de pilotage projet, workpackages, état |
| [EVALUATIONS.md](./EVALUATIONS.md) | Évaluations de compatibilité avec ABC (entreprise / écosystème / public) |
| [RUNTIME_PROPOSAL.md](./RUNTIME_PROPOSAL.md) | Proposition runtime minimale d'origine |
| [docs/cli-contract.md](./docs/cli-contract.md) | Contrat CLI verbe-par-verbe (DEC-034) |
| [docs/compatibility-matrix.md](./docs/compatibility-matrix.md) | Matrice de compatibilité hôtes (DEC-037) |
| [docs/release.md](./docs/release.md) | Procédure de release + notes de sécurité |
| [docs/tutorial-cross-cli.md](./docs/tutorial-cross-cli.md) | **Tutoriel Claude + Codex + Gemini en 5 min** |
| [docs/instruction-k8s-and-remote-controle-interop.md](./docs/instruction-k8s-and-remote-controle-interop.md) | Note d'instruction K8s + interop `@sentropic/remote-controle` (DEC-056) |
| [handover.md](./handover.md) | Prompt de handover pour une session Claude |

---

## Conventions de contribution

- Toute nouvelle exigence → ajouter dans `SPEC.md` (numérotation continue `REQ-NNN`).
- Toute nouvelle décision → ajouter dans `DECISIONS.md` (numérotation continue `DEC-NNN`, append-only).
- Tout renommage de concept → nouvelle DEC + bump version de `VOCABULARY.md`.
- Release : voir [`docs/release.md`](./docs/release.md).

---

## Origine du projet

h2a est issu d'un brief utilisateur du 16 mai 2026 ([INTENTION.md](./INTENTION.md), verbatim préservé). Nom de travail initial : `a2a-cli` (le repo et le dossier portent toujours ce nom). Nom parapluie figé à `h2a` par DEC-025 le 17 mai 2026, parce que le périmètre dépasse l'agent-to-agent pur — il couvre la coordination multi-humain, le human-in-the-loop, la gouvernance et les contrats.

`@sentropic/h2a-cli@0.1.0` a été publié avec un `bin` cassé par autocorrection npm ; il est déprécié (DEC-029). `0.1.6` puis `0.1.19` sont les baselines successives.
