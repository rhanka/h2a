import { H2A_CLI_MCP_TOOL_NAMES } from "../../mcp.js";

export type McpToolName = (typeof H2A_CLI_MCP_TOOL_NAMES)[number];

export interface McpToolDescriptor {
  name: McpToolName;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

/**
 * Canonical tool descriptors for the in-process MCP server. Schemas are
 * intentionally permissive — wire-level validation lives in the store /
 * @sentropic/h2a invariants, not in the MCP shim.
 */
export const H2A_CLI_MCP_TOOL_DESCRIPTORS: McpToolDescriptor[] = [
  {
    name: "h2a_register_instance",
    description:
      "Register an h2a instance (PRINCIPAL / CONDUCTOR / AGENT / ...) in the local registry.",
    inputSchema: {
      type: "object",
      properties: {
        registration: {
          type: "object",
          description: "Full H2AActorRegistration record."
        }
      },
      required: ["registration"]
    }
  },
  {
    name: "h2a_discover_instances",
    description:
      "List instances from the registry, optionally filtered by role and/or scope.",
    inputSchema: {
      type: "object",
      properties: {
        role: { type: "string" },
        scope: { type: "string" }
      }
    }
  },
  {
    name: "h2a_open_negotiation",
    description: "Open a new negotiation. Not implemented in this slice.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "h2a_offer",
    description: "Submit an initial offer. Not implemented in this slice.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "h2a_counteroffer",
    description: "Submit a counter-offer. Not implemented in this slice.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "h2a_sign",
    description: "Sign the current artifact. Not implemented in this slice.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "h2a_stabilize",
    description:
      "Stabilize a negotiation once quorum of signatures is reached. Not implemented in this slice.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "h2a_inbox",
    description:
      "Inbox dispatch — read | put | pop envelopes for a given instance.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "put", "pop"] },
        instance: { type: "string" },
        envelope: { type: "object" },
        envelopeId: { type: "string" }
      },
      required: ["action", "instance"]
    }
  },
  {
    name: "h2a_append_journal",
    description:
      "Append a journal event to a negotiation's chained journal.jsonl.",
    inputSchema: {
      type: "object",
      properties: {
        negotiationId: { type: "string" },
        payload: { type: "object" }
      },
      required: ["negotiationId", "payload"]
    }
  },
  {
    name: "h2a_escalate",
    description:
      "Escalate a negotiation to a higher control surface. Not implemented in this slice.",
    inputSchema: { type: "object", properties: {} }
  }
];
