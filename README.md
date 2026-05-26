# h2a — Humans-to-Agents Coordination Protocol

> **One-line pitch**: a protocol and CLI binary that lets multiple agentic CLIs (Claude Code, Codex, Gemini, others) **cooperate** with each other and with humans, through a system of **roles, signatures, negotiation and notifications** inspired by how a real organization works.

| | |
|---|---|
| **Published packages** | `@sentropic/h2a@0.1.24` (core), `@sentropic/h2a-cli@0.1.24` (CLI binary + MCP server + skills) ; OCI image `ghcr.io/rhanka/h2a-cli:latest` |
| **License** | MIT (DEC-027) |
| **Status** | V1 end-to-end usable: protocol + local runtime + 3 hosts (Claude / Codex / Gemini) + skills + K8s (sidecar & tenant). V2 shipping on the 0.2.x line: first-class subagents + signed-bearer remote transport. Network broker (Scenario C) still under design. |
| **Quickstart** | `npm i -g @sentropic/h2a-cli`, then see [§5-minute getting started](#5-minute-getting-started). |

---

## Why h2a exists

When several agentic CLIs (Claude Code, Codex, Gemini, …) are used together to push the same project forward, **none of them knows the others exist**. Each talks to its own human; no shared memory; no negotiation between agents; no contractual trace of what was agreed.

h2a fills that gap. Three needs, treated as a single protocol:

1. **Multi-agent** — Claude and Codex must be able to discover each other, exchange messages, negotiate a signed deliverable, without depending on any central service.
2. **Multi-human** — a developer is the PRINCIPAL of their own mini-organization, and can also participate in a larger organization (team, federation, public-authority recourse). h2a models both.
3. **Human-in-the-loop** — a human can take over an AGENT or a CONDUCTOR at any moment; escalation toward a scope authority (PRINCIPAL, CONTROL, external authority, recourse) is a first-class protocol primitive.

All of this without inventing a hidden governance engine: V1 **declares** the profiles (disclosure, recourse, jurisdiction, recurring obligations, policy precedence) and **escalates** conflicts — there is no automatic resolver. See [INTENTION.md](./INTENTION.md) for the original brief.

---

## Mental model in two diagrams

### 1. How the CLIs cooperate

```
┌──────────────────────────────────────────────────────────────────┐
│                       Developer's machine                        │
│                                                                  │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│   │ Claude Code  │    │  Codex CLI   │    │  Gemini CLI  │       │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘       │
│          │ MCP stdio          │ MCP stdio          │ MCP stdio   │
│          ▼                    ▼                    ▼             │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│   │ h2a mcp-serve│    │ h2a mcp-serve│    │ h2a mcp-serve│       │
│   │  (subprocess │    │  (subprocess │    │  (subprocess │       │
│   │   of the CLI)│    │   of the CLI)│    │   of the CLI)│       │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘       │
│          │                    │                    │             │
│          └────────────────────┴────────────────────┘             │
│                               │                                  │
│                               ▼                                  │
│              ┌────────────────────────────────┐                  │
│              │     <root>/.h2a/  (the bus)    │                  │
│              │                                │                  │
│              │  registry/instances.jsonl     │                  │
│              │  presence/<sid>.json          │                  │
│              │  negotiations/<id>/journal..  │                  │
│              │  inbox/<instance>/*.json      │                  │
│              │  contracts/ engagements/ ...  │                  │
│              └────────────────────────────────┘                  │
└──────────────────────────────────────────────────────────────────┘
```

The three CLIs never talk to each other directly. They read and write a shared `.h2a/` directory, each through its own instance of the `h2a mcp-serve` MCP server (a subprocess spawned by every host CLI). The **file layout IS the protocol** — every journal line is a signed chained entry, every inbox envelope is a routed message, every presence file is a heartbeat.

### 2. The contractual stack (DEC-010)

```
INTENTION    the why                  → INTENTION.md (user verbatim)
   │
   ▼
SPECIFICATION  measurable requirements → SPEC.md (REQ-NNN)
   │
   ▼
ARTIFACTS    what binds                → CONTRACT, POLICY, ENGAGEMENT,
   │         (ed25519-signed,            MANDATE, AUTHORITY, SIGNATURE,
   │          canonical JSON + hash)     AMENDMENT, ENFORCEMENT_PLAN
   ▼
ENFORCEMENT  the application           → ENFORCEMENT_PLAN, escalations,
             (who decides what in        recourse, controlled disclosure
              which scope)
```

The cardinal roles: **PRINCIPAL** (the ultimate human), **EXECUTIF** (overall responsibility), **CONDUCTOR** (drives a herd of agents), **AGENTS** (the CLIs), **CONTROL** (cross-cutting functions: cyber, finance, ethics, legal, quality), **MANDATAIRE** (neutral presenter, never arbitrator). See [VOCABULARY.md](./VOCABULARY.md).

---

## 5-minute getting started

```bash
# 1. Install
npm i -g @sentropic/h2a-cli@latest

# 2. Bootstrap each host CLI (do this once per machine)
h2a connect --host claude --root ~/h2a-workspace/.h2a --instance claude:demo
h2a connect --host codex  --root ~/h2a-workspace/.h2a --instance codex:demo
h2a connect --host gemini --root ~/h2a-workspace/.h2a --instance gemini:demo
# … then merge the printed MCP snippets into each CLI's config

# 3. Generate a signing key per instance
h2a keys generate --instance claude:demo --root ~/h2a-workspace/.h2a
h2a keys generate --instance codex:demo  --root ~/h2a-workspace/.h2a

# 4. Install the `/h2a` skill into each host CLI
h2a install-skills --host claude --scope user
h2a install-skills --host codex  --scope user
h2a install-skills --host gemini --scope user
```

Then, inside each CLI:

```
/h2a                          ← shortcut for /h2a status
/h2a connect                  ← opens a live session in this conversation
/h2a discover                 ← lists peers currently online
/h2a send codex:demo "hi"     ← sends a message
/h2a receive                  ← reads inbox + reacts to push notifications
/h2a negotiate open ...       ← starts a signed negotiation
/h2a help                     ← command map
```

**Full step-by-step guide**: [`docs/tutorial-cross-cli.md`](./docs/tutorial-cross-cli.md). It covers setup, common failure modes, and the V1/V2 mapping.

---

## What is shipped (V1) vs what is not

| Capability | V1 (current state) | V2 / deferred |
|---|---|---|
| Local-files transport (`<root>/.h2a/`) | ✅ shipped | — |
| MCP stdio server (13 JSON-RPC 2.0 tools) | ✅ shipped | — |
| Codex / Claude Code / Gemini adapters | ✅ shipped (DEC-049) | — |
| Consolidated `/h2a` skill for the 3 hosts | ✅ shipped (DEC-057) | — |
| Session protocol: presence + heartbeat + push notifications | ✅ shipped (DEC-050..053) | — |
| ed25519 signatures + canonical JSON + chained journal | ✅ shipped (DEC-035) | — |
| Declarative ABC profiles: disclosure, recourse, recurring obligations, jurisdiction, precedence | ✅ shipped (DEC-045..048) | automatic resolvers (V2) |
| Cross-machine remote transport | ✅ signed-bearer over HTTP ([docs/remote-transport.md](./docs/remote-transport.md), DEC-073..077) | broker/relay (Scenario C) → V2 |
| Transport auth (signed bearer) | ✅ signed envelopes + anti-replay + verify-on-receipt (DEC-073..077) | mTLS channel hardening optional |
| First-class SUBAGENTS (individually addressable) | ✅ addressable/persistent/routable/auditable/revocable ([docs/subagents.md](./docs/subagents.md), DEC-068..072) | — |
| Key management UX (rotation, keyring) | ✅ keyring + zero-downtime rotation: `h2a keys generate/add/list/revoke` (DEC-078/079) | — |
| Kubernetes deployment | ✅ sidecar ([docs/k8s-sidecar.md](./docs/k8s-sidecar.md), DEC-058) + cluster tenant with RWX store + lease lock ([docs/k8s-tenant.md](./docs/k8s-tenant.md), DEC-067) | broker (Scenario C) → V2 |

V1 declares what is permitted and traces everything. V1 **never** arbitrates a conflict in place of a human authority — that is by design (REQ-054).

---

## CLI surface (reference)

```
h2a --help
h2a hosts
h2a mcp-tools

# High-level coordination (DEC-054)
h2a connect --host <codex|claude|gemini> [--root <path>] [--instance <id>]
h2a doctor [--root <path>]
h2a sessions [--root <path>] [--scope <s>] [--instance <i>]
h2a keys generate --instance <id> [--out <dir>] [--root <path>]
h2a install-skills --host <claude|codex|gemini> [--scope user|project] [--force]

# Local-files runtime (store under <root>/.h2a, DEC-031)
h2a init [--root <path>]
h2a register --json <registration-json> [--root <path>]
h2a discover [--role <role>] [--scope <scope>] [--root <path>]

# Negotiation (offer/counter/sign/event accept --causation-id / --correlation-id;
# by default, each event inherits from the previous one — DEC-033)
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

# Store maintenance
h2a store migrate [--from <v>] [--to <v>] [--dry-run] [--root <path>]

# MCP server (JSON-RPC 2.0 over stdio, DEC-026 + DEC-051/052)
h2a mcp-serve [--root <path>]

# Host wiring (MCP snippets for each host)
h2a host setup --host <codex|claude|gemini> [--root <path>] [--print | --write <file>] [--force]
h2a host status [--host <name>]
```

Every JSON-emitting verb follows one of three canonical envelopes (`resource` / `list` / `action`) with an exit-code table `0 / 1 / 2 / 3`. Machine-readable contract: `H2A_CLI_VERB_CONTRACTS` (`packages/h2a-cli/src/cli-contract.ts`). Human-readable reference: [`docs/cli-contract.md`](./docs/cli-contract.md).

---

## MCP tools exposed by `mcp-serve`

13 JSON-RPC 2.0 stdio tools, consumed by host CLIs via their `mcpServers.h2a` config:

| Family | Tools |
|---|---|
| Registry | `h2a_register_instance`, `h2a_discover_instances` |
| Session (DEC-051) | `h2a_session_open`, `h2a_session_close`, `h2a_discover_sessions` |
| Negotiation | `h2a_open_negotiation`, `h2a_offer`, `h2a_counteroffer`, `h2a_sign`, `h2a_stabilize`, `h2a_append_journal`, `h2a_escalate` |
| Mailbox | `h2a_inbox` (`read` / `put` / `pop`) |

Plus a **push notification channel** (`notifications/h2a`) on 4 topics (DEC-052): `presence.peer_joined`, `presence.peer_left`, `inbox.envelope_arrived`, `negotiation.event_appended`. Sessions subscribe to a subset via `h2a_session_open`.

---

## Runnable example

[`examples/principal-conductors/`](./examples/principal-conductors/) — end-to-end demo of the **1 PRINCIPAL / 15 CONDUCTORS** case: generates 16 ed25519 keypairs, registers the 16 instances, opens a negotiation with a 3-of-15 quorum, signs and stabilizes, and finishes by querying the MCP server in JSON-RPC over stdio.

```bash
./examples/principal-conductors/run.sh   # build + run
```

---

## Reference documents

| Document | Role |
|---|---|
| [INTENTION.md](./INTENTION.md) | Initial user verbatim + narrative rewrite |
| [SPEC.md](./SPEC.md) | Measurable requirements `REQ-NNN` |
| [VOCABULARY.md](./VOCABULARY.md) | Canonical vocabulary (frozen V1.x) |
| [DECISIONS.md](./DECISIONS.md) | Append-only journal of `DEC-NNN` (model, runtime, host, governance) |
| [PLAN.md](./PLAN.md) | Project plan, workpackages, status |
| [EVALUATIONS.md](./EVALUATIONS.md) | ABC compatibility evaluations (enterprise / ecosystem / public-authority) |
| [RUNTIME_PROPOSAL.md](./RUNTIME_PROPOSAL.md) | Original minimal-runtime proposal |
| [docs/cli-contract.md](./docs/cli-contract.md) | CLI contract, verb by verb (DEC-034) |
| [docs/compatibility-matrix.md](./docs/compatibility-matrix.md) | Host compatibility matrix (DEC-037) |
| [docs/release.md](./docs/release.md) | Release procedure + security notes |
| [docs/tutorial-cross-cli.md](./docs/tutorial-cross-cli.md) | **Claude + Codex + Gemini in 5 minutes** |
| [docs/instruction-k8s-and-remote-interop.md](./docs/instruction-k8s-and-remote-interop.md) | K8s deployment + `@sentropic/remote` interop note (DEC-056) |
| [docs/k8s-sidecar.md](./docs/k8s-sidecar.md) | K8s sidecar deployment — Scenario A (DEC-058) |
| [docs/k8s-tenant.md](./docs/k8s-tenant.md) | K8s cluster-tenant deployment — Scenario B, RWX + lease lock (DEC-067) |
| [docs/remote-transport.md](./docs/remote-transport.md) | Cross-machine signed-bearer transport — `h2a remote serve`/`send` (DEC-073..077) |
| [docs/subagents.md](./docs/subagents.md) | First-class subagents — addressable/auditable/revocable (DEC-068..072) |
| [handover.md](./handover.md) | Handover prompt for a Claude session |

> Project policy: all docs and code in this repository are in English. `INTENTION.md` contains an English translation of the original French user verbatim; the French source remains recoverable from git history at commit `195d1c2~1`.

---

## Contribution conventions

- Any new requirement → add to `SPEC.md` (continuous `REQ-NNN` numbering).
- Any new decision → add to `DECISIONS.md` (continuous `DEC-NNN`, append-only).
- Any concept rename → new DEC + version bump of `VOCABULARY.md`.
- Release: see [`docs/release.md`](./docs/release.md).

---

## Project origin

h2a originates from a user brief on 16 May 2026 ([INTENTION.md](./INTENTION.md), verbatim preserved). Initial working name: `a2a-cli` (the repo and folder still carry that name). The umbrella name was frozen to `h2a` by DEC-025 on 17 May 2026, because the scope goes beyond pure agent-to-agent — it covers multi-human coordination, human-in-the-loop, governance and contracts.

`@sentropic/h2a-cli@0.1.0` was published with a `bin` entry broken by npm autocorrection and is deprecated (DEC-029). `0.1.6` and then `0.1.24` are the successive supported baselines.
