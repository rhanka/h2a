# Minimal runtime proposal — plugins, MCP, local-files

> **Status**: framing proposal, 2026-05-17.
> **Recommended name**: `h2a`.
> **Recommended core package**: `@sentropic/h2a`.

## Principle

The minimal runtime must stay a governed coordination protocol between humans
and agents, not a hard dependency on any particular CLI.

`H2A` is the umbrella name. The `A2A` aspect can exist as a specialised
sub-surface, but on its own it does not cover the organization, the mandates,
or the human-in-the-loop.

Recommended architecture:

1. **Core library** — `@sentropic/h2a`
   - TypeScript types and JSON schemas.
   - Validation of `CONTRACT`, `POLICY`, `ENGAGEMENT`, `REGISTRY`, `NEGOTIATION`.
   - Canonicalisation + artifact hash.
   - Signatures, amendments, append-only journal.
   - Abstract local store.

2. **CLI runtime** — `@sentropic/h2a-cli`
   - Bundles the MCP surface and the host adapters.
   - Separate internal modules for `mcp`, `codex`, `claude`, `gemini`.
   - Holds no contractual semantics; depends on the core.

3. **Bilateral local-files mode**
   - Conventional folder `src/{project}/a2a/...`.
   - Works offline and without an MCP server.
   - An agent reads its inbox, writes its proposals, and signs the local
     artifacts.

## Initial use case: 1 PRINCIPAL / 15 CONDUCTORS

Topology:

```text
human:antoine as PRINCIPAL
  ├─ conductor:01
  ├─ conductor:02
  ├─ ...
  └─ conductor:15
```

Minimal flow:

1. The PRINCIPAL creates the root scope `scope:principal/antoine`.
2. Each CONDUCTOR registers in the REGISTRY with its role, its capabilities,
   its endpoint, and its accepted policies.
3. A CONDUCTOR discovers another CONDUCTOR via the REGISTRY.
4. It opens a NEGOTIATION on a subject: `CONTRACT`, `POLICY`, `ENGAGEMENT`, or
   an amendment.
5. The parties exchange offers and counter-offers.
6. The NEGOTIATION stabilises once the required signers sign the same canonical
   artifact.
7. If an incompatibility appears between contracts, it is traced and escalated
   to the PRINCIPAL, the EXECUTIF, an authorised CONTROL, or another scope
   authority. In V1, no inter-contract mediator resolves the conflict
   automatically.

## Minimal MCP primitives

The exact names may evolve, but the V1 surface should stay small:

| MCP tool | Role |
|---|---|
| `h2a_register_instance` | Register an INSTANCE in a REGISTRY. |
| `h2a_discover_instances` | Find actors by role, scope, capability, or accepted policy. |
| `h2a_open_negotiation` | Open a NEGOTIATION session. |
| `h2a_offer` | Submit an artifact proposal. |
| `h2a_counteroffer` | Reply with a counter-proposal. |
| `h2a_sign` | Sign a canonical version of an artifact. |
| `h2a_stabilize` | Verify signatures/hash and declare the artifact stable. |
| `h2a_inbox` | Read the messages and requests addressed to the current actor. |
| `h2a_append_journal` | Append an append-only audit event. |
| `h2a_escalate` | Trigger `advise`, `decide`, or `alert`. |

## Minimal structures

```ts
type ActorRegistration = {
  id: string;
  instance: string;
  roles: string[];
  scopes: string[];
  principal?: string;
  conductor?: string;
  capabilities: string[];
  endpoints: Array<{ kind: "mcp" | "local-files" | "remote"; uri: string }>;
  publicKeys: string[];
  acceptedPolicies: string[];
  createdAt: string;
};

type Negotiation = {
  id: string;
  scope: string;
  parties: string[];
  subject: "contract" | "policy" | "engagement" | "amendment";
  status:
    | "draft"
    | "proposed"
    | "countered"
    | "accepted"
    | "rejected"
    | "withdrawn"
    | "expired"
    | "stabilized"
    | "abandoned";
  requiredSigners: string[];
  baseArtifactHash?: string;
  currentArtifactHash?: string;
  deadline?: string;
};

type ContractArtifact = {
  kind: "contract" | "policy" | "engagement" | "amendment";
  id: string;
  version: string;
  scope: string;
  body: unknown;
  hash: string;
  signatures: Array<{
    signer: string;
    role: string;
    mandate: string;
    signedAt: string;
    signature: string;
  }>;
};
```

Minimal exchange envelope:

```ts
type Role =
  | "PRINCIPAL"
  | "EXECUTIF"
  | "CONDUCTOR"
  | "AGENTS"
  | "CONTROL"
  | "MANDATAIRE";

type ArtifactKind = "CONTRACT" | "POLICY" | "ENGAGEMENT" | "AMENDMENT";

type H2AEnvelope = {
  protocol: "sentropic.h2a";
  version: "0.1";
  id: string;
  type:
    | "register"
    | "propose"
    | "accept"
    | "reject"
    | "counter"
    | "withdraw"
    | "event"
    | "escalate";
  actor: { instance: string; role: Role; scope: string; mandate?: string };
  target?: { instance?: string; role?: Role; scope?: string };
  artifactKind?: ArtifactKind;
  contractId?: string;
  policyIds?: string[];
  engagementId?: string;
  negotiationId?: string;
  baseArtifactHash?: string;
  causationId?: string;
  correlationId?: string;
  prevHash?: string;
  body: unknown;
  createdAt: string;
  signatures?: Array<{ by: string; alg: string; value: string }>;
};
```

## Local-files mode

Recommended structure:

```text
src/{project}/h2a/
  registry/
    instances.jsonl
  contracts/
    {contractId}/contract.json
  policies/
    {policyId}.json
  engagements/
    {engagementId}/
      charter.json
      events.jsonl
      inbox/
        {instanceId}/
      outbox/
        {instanceId}/
      evidence/
  negotiations/
    {negotiationId}/
      state.json
      offers/
      signatures/
      journal.jsonl
  inbox/
    {actorId}/
  outbox/
    {actorId}/
```

Rules:

- Stabilised artifact files are immutable; any evolution goes through an
  amendment.
- The journals are append-only.
- The `inbox/outbox` carry the same envelopes as the MCP server.
- The canonical hash is computed over the normalised content, excluding
  signatures.
- Events carry `causationId`, `correlationId`, and `prevHash` to make
  divergences auditable between two local journals.

## Codex and Claude plugins

V1 goal: thin adapters.

- **Codex / Claude / Gemini**: expose the H2A operations via internal modules
  of `@sentropic/h2a-cli`.
- **Common ground**: every host reads/writes the same artifacts and accepts the
  same registry.
- **Forbidden in V1**: putting negotiation logic inside a specific host.
  Otherwise the integrations diverge.

Main risk: the plugin surfaces of Codex, Claude, and Gemini may evolve. The
protocol must therefore treat MCP and local-files as the two stable
compatibility contracts; the host adapters stay replaceable inside `h2a-cli`.

## Likely CLI commands

```bash
h2a init --project my-project
h2a register --role conductor --principal human:antoine --scope scope:principal/antoine
h2a discover --role conductor --scope scope:principal/antoine
h2a negotiate open --with conductor:02 --subject engagement
h2a negotiate offer --negotiation neg-123 --file engagement.json
h2a negotiate sign --negotiation neg-123 --artifact-hash sha256:...
h2a negotiate stabilize --negotiation neg-123
h2a inbox read --actor conductor:01
```

## Assumed V1 limits

- No inter-contract mediator.
- No automatic resolution of policy conflicts.
- No global consensus among the 15 CONDUCTORS.
- No first-class subagents.
- No mandatory dependency on a remote service.

These limits are acceptable as long as the protocol traces the conflicts and
makes the escalation actionable.
