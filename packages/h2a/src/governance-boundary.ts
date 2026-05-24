export const H2A_GOVERNANCE_BOUNDARY_LAYERS = [
  "PROTOCOL",
  "POLICY",
  "IMPLEMENTATION"
] as const;

export const H2A_GOVERNANCE_BOUNDARY_STATUSES = [
  "v1-shipped",
  "v1-open",
  "v2-deferred"
] as const;

export type H2AGovernanceBoundaryLayer =
  (typeof H2A_GOVERNANCE_BOUNDARY_LAYERS)[number];
export type H2AGovernanceBoundaryStatus =
  (typeof H2A_GOVERNANCE_BOUNDARY_STATUSES)[number];

export interface H2AGovernanceBoundaryItemDescriptor {
  readonly id: string;
  readonly layer: H2AGovernanceBoundaryLayer;
  readonly status: H2AGovernanceBoundaryStatus;
  readonly summary: string;
  readonly references: readonly string[];
}

export const H2A_GOVERNANCE_BOUNDARY_ITEMS = Object.freeze([
  {
    id: "protocol-identity",
    layer: "PROTOCOL",
    status: "v1-shipped",
    summary: "Protocol id, version, envelope frame, and canonical public vocabulary.",
    references: ["REQ-001", "DEC-010"]
  },
  {
    id: "canonical-artifacts",
    layer: "PROTOCOL",
    status: "v1-shipped",
    summary: "Artifact kinds, guards, canonical JSON, hashes, and byte fixtures.",
    references: ["DEC-031", "DEC-035", "DEC-039"]
  },
  {
    id: "mandated-signatures",
    layer: "PROTOCOL",
    status: "v1-shipped",
    summary: "A scope never signs; an authorized instance signs through role, mandate, and signature.",
    references: ["DEC-021", "DEC-035"]
  },
  {
    id: "negotiation-ledger",
    layer: "PROTOCOL",
    status: "v1-shipped",
    summary: "Negotiation state machine, append-only journal, canonical artifact hash, and stabilization rule.",
    references: ["DEC-019", "DEC-022", "DEC-033"]
  },
  {
    id: "scope-authority-escalation",
    layer: "PROTOCOL",
    status: "v1-shipped",
    summary: "Escalation channels and target resolution by scope authority.",
    references: ["DEC-012", "DEC-024", "DEC-040"]
  },
  {
    id: "abc-model-profiles",
    layer: "PROTOCOL",
    status: "v1-shipped",
    summary: "Stable ABC model profile ids and compatibility audit vocabulary.",
    references: ["DEC-041"]
  },
  {
    id: "multi-human-mode-taxonomy",
    layer: "PROTOCOL",
    status: "v1-shipped",
    summary: "Deterministic taxonomy for peer, delegated, shared, federated, quorum, and public-authority modes.",
    references: ["DEC-042"]
  },
  {
    id: "session-protocol",
    layer: "PROTOCOL",
    status: "v1-shipped",
    summary: "Session lifecycle, heartbeat-based presence, expiry semantics, and notification topics; transport-specific producers (presence files, MCP push) are implementation.",
    references: ["DEC-050"]
  },
  {
    id: "host-bridge-contract",
    layer: "PROTOCOL",
    status: "v1-shipped",
    summary: "Formal interop contract between h2a and external host runtimes (e.g. @sentropic/remote-controle), with five canonical clauses (identity, lifecycle, resource-limits, disclosure, auth-boundary). V1 ships the remote-controle profile.",
    references: ["DEC-056", "DEC-058", "DEC-059"]
  },
  {
    id: "policy-precedence",
    layer: "POLICY",
    status: "v1-open",
    summary: "Conflict precedence between local, contractual, federated, and public policies is not hard-coded in V1.",
    references: ["REQ-041", "DEC-039", "DEC-041"]
  },
  {
    id: "controlled-disclosure-profiles",
    layer: "POLICY",
    status: "v1-shipped",
    summary: "DEC-045 declares allowed disclosure modes per ABC profile; projection helpers remain policy/implementation work.",
    references: ["REQ-070", "REQ-071", "DEC-041", "DEC-045"]
  },
  {
    id: "recourse-adjudication-profiles",
    layer: "POLICY",
    status: "v1-shipped",
    summary: "DEC-046 declares recourse lifecycle states, allowed deciders, and appealability per ABC profile; adjudication itself stays with the declared authority.",
    references: ["REQ-068", "REQ-069", "REQ-071", "DEC-040", "DEC-041", "DEC-046"]
  },
  {
    id: "recurring-obligation-cadence",
    layer: "POLICY",
    status: "v1-shipped",
    summary: "DEC-047 declares allowed cadences, default grace, and reporting thresholds per ABC profile; scheduling and evaluation remain policy/implementation work.",
    references: ["REQ-063", "REQ-071", "DEC-041", "DEC-047"]
  },
  {
    id: "jurisdiction-profiles",
    layer: "POLICY",
    status: "v1-shipped",
    summary: "DEC-048 declares the allowed jurisdiction kinds (territorial, sectoral, functional, personal, temporal, delegated, private-contract) and a default per ABC profile; matching a scope/actor to a jurisdiction stays in policy.",
    references: ["REQ-044", "REQ-071", "DEC-041", "DEC-048"]
  },
  {
    id: "mandataire-assignment",
    layer: "POLICY",
    status: "v1-open",
    summary: "The protocol requires neutral presentation where applicable; assigning an instance is governance policy.",
    references: ["DEC-005", "DEC-013"]
  },
  {
    id: "conflict-blocking-thresholds",
    layer: "POLICY",
    status: "v1-open",
    summary: "Which conflicts block signatures versus escalate is a policy decision until a future engine is adopted.",
    references: ["REQ-054", "DEC-041"]
  },
  {
    id: "local-files-store",
    layer: "IMPLEMENTATION",
    status: "v1-shipped",
    summary: "The local-files layout, schema sentinel, and advisory locks are the reference V1 runtime, not the protocol itself.",
    references: ["DEC-031", "DEC-036"]
  },
  {
    id: "mcp-stdio-server",
    layer: "IMPLEMENTATION",
    status: "v1-shipped",
    summary: "The stdio JSON-RPC MCP server is a transport binding over the protocol tools.",
    references: ["DEC-026", "DEC-034"]
  },
  {
    id: "host-setup-snippets",
    layer: "IMPLEMENTATION",
    status: "v1-shipped",
    summary: "Codex and Claude config snippets are replaceable host adapter behavior.",
    references: ["DEC-028", "DEC-037"]
  },
  {
    id: "cli-json-contract",
    layer: "IMPLEMENTATION",
    status: "v1-shipped",
    summary: "CLI JSON envelopes and exit codes are a stable implementation contract for the shipped CLI.",
    references: ["DEC-034"]
  },
  {
    id: "transport-auth",
    layer: "IMPLEMENTATION",
    status: "v2-deferred",
    summary: "mTLS, signed bearer, or equivalent multi-user transport auth is deferred to V2.",
    references: ["DEC-032"]
  }
] as const satisfies readonly H2AGovernanceBoundaryItemDescriptor[]);

export type H2AGovernanceBoundaryItemId =
  (typeof H2A_GOVERNANCE_BOUNDARY_ITEMS)[number]["id"];

export function classifyGovernanceBoundary(
  itemId: string
): H2AGovernanceBoundaryItemDescriptor | undefined {
  return H2A_GOVERNANCE_BOUNDARY_ITEMS.find((item) => item.id === itemId);
}

export function listGovernanceBoundaryItems(
  layer?: string
): readonly H2AGovernanceBoundaryItemDescriptor[] {
  if (!layer) return H2A_GOVERNANCE_BOUNDARY_ITEMS;
  if (
    !H2A_GOVERNANCE_BOUNDARY_LAYERS.includes(
      layer as H2AGovernanceBoundaryLayer
    )
  ) {
    return [];
  }
  return H2A_GOVERNANCE_BOUNDARY_ITEMS.filter((item) => item.layer === layer);
}
