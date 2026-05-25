# First-class subagents

> V2 of DEC-008, implemented by DEC-068→072. Ships in `@sentropic/h2a-cli@>=0.2.4`.

In V1, a host CLI's subagents are consolidated into the parent `AGENTS` actor: not individually addressable, not separately audited. V2 makes them **first-class** — addressable, persistent, routable, auditable, and revocable — without changing the authority model.

## The model

A subagent is **not a new role**. It is an addressable actor that acts under its parent's `AGENTS` role, so the frozen role set and the authority matrix are untouched — a subagent's signing authority stays exactly its parent's (consolidated). What V2 adds is *addressability*, not new authority.

- **Address**: `<parentInstance>~<name>` (e.g. `claude:proj-1~researcher`). The `~` separator is filesystem-safe (not in the `safePathSegment` set, DEC-062), so a subagent address routes through the store like any instance id.
- **Capabilities** are a *subset* of the parent's — a subagent can restrict, never exceed (validated at registration).
- **Status** (`active` / `revoked`) is derived from the audit log (see Revocation), so the binding registry stays append-only.

## CLI

All verbs live under `h2a subagent` and operate on a `<root>/.h2a/` store.

```bash
# register a subagent under an AGENTS parent
h2a subagent register --parent claude:proj-1 --name researcher --capabilities research,read

# list bindings (annotated with derived status), optionally for one parent
h2a subagent list --parent claude:proj-1

# route a signed-or-local envelope to a subagent's mailbox (validated: refuses
# an unregistered or revoked subagent)
h2a subagent route --to claude:proj-1~researcher --json "$(cat env.json)" [--mailbox inbox|outbox]

# parent fan-in: every registered subagent of a parent + its current inbox
h2a subagent inbox --parent claude:proj-1

# permanent audit trail (registered / routed / revoked), per subagent or per parent
h2a subagent audit --id claude:proj-1~researcher
h2a subagent audit --parent claude:proj-1

# takeover: revoke a subagent (future routing refused; pending inbox stays
# readable by the parent via the fan-in)
h2a subagent revoke --id claude:proj-1~researcher --reason "reassigning work"
```

## How the capabilities compose

| Capability | Verb / API | DEC |
|---|---|---|
| Addressable identity | `subagentAddress`, `parseSubagentAddress` (core) | DEC-068 |
| Persistent binding | `subagent register` / `list` → `registry/subagents.jsonl` | DEC-069 |
| Validated routing + parent fan-in | `subagent route` / `inbox` | DEC-070 |
| Per-subagent audit trail | `subagent audit` → `registry/subagent-audit.jsonl` | DEC-071 |
| Takeover (revocation) | `subagent revoke` | DEC-072 |

**Fan-in vs audit**: `subagent inbox` shows the *current* inbox (an envelope disappears once popped); `subagent audit` is the *permanent history* (`registered`/`routed`/`revoked` events survive a pop). Use fan-in to reclaim pending work, audit to answer "what happened to this subagent".

**Takeover semantics**: revoking a subagent refuses *new* routing to it (`route` → exit 2) but leaves its already-delivered inbox intact and readable by the parent through the fan-in — that is how a parent reclaims the work.

## Library

Core (`@sentropic/h2a`): `subagentAddress`, `isSubagentAddress`, `parseSubagentAddress`, `validateSubagentBinding`, `subagentActorRef`. Store (`@sentropic/h2a-cli`'s `LocalStore`): `registerSubagent`, `listSubagents`, `listSubagentsOf`, `findSubagent`, `routeToSubagent`, `readSubagentInboxes`, `readSubagentAudit`, `readSubagentAuditOf`, `subagentStatus`, `revokeSubagent`.

## Related

- [DEC-008](../DECISIONS.md#dec-008--agent--agents--subagents-layer-planned) — the original reservation of the SUBAGENTS layer.
- [DEC-068…072](../DECISIONS.md) — the five implementation slices.
- [`docs/remote-transport.md`](./remote-transport.md) — a subagent address can be a remote sender/recipient.
