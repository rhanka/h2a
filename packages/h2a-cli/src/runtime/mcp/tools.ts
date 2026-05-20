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
    description:
      "Open a new negotiation. The record is persisted under negotiations/<id>/state.json.",
    inputSchema: {
      type: "object",
      properties: {
        record: {
          type: "object",
          description:
            "Full H2ANegotiationRecord: { id, scope, parties, subject, status, requiredSigners, ... }."
        }
      },
      required: ["record"]
    }
  },
  {
    name: "h2a_offer",
    description:
      "Submit an initial offer (journal entry, type=propose) bearing the current artifact.",
    inputSchema: {
      type: "object",
      properties: {
        negotiationId: { type: "string" },
        instance: {
          type: "string",
          description: "Conductor instance id producing the offer."
        },
        artifact: {
          description: "Arbitrary JSON-serializable artifact to propose."
        },
        eventId: {
          type: "string",
          description: "Optional deterministic event id; generated if absent."
        }
      },
      required: ["negotiationId", "instance", "artifact"]
    }
  },
  {
    name: "h2a_counteroffer",
    description:
      "Submit a counter-offer (journal entry, type=counter) bearing a revised artifact.",
    inputSchema: {
      type: "object",
      properties: {
        negotiationId: { type: "string" },
        instance: {
          type: "string",
          description: "Conductor instance id producing the counter-offer."
        },
        artifact: {
          description: "Arbitrary JSON-serializable artifact to counter with."
        },
        eventId: {
          type: "string",
          description: "Optional deterministic event id; generated if absent."
        }
      },
      required: ["negotiationId", "instance", "artifact"]
    }
  },
  {
    name: "h2a_sign",
    description:
      "Sign the canonical {artifactHash} of an artifact with an ed25519 PEM-encoded private key. The signature is appended as a journal event with body.kind='signature'.",
    inputSchema: {
      type: "object",
      properties: {
        negotiationId: { type: "string" },
        instance: { type: "string" },
        artifact: {
          description: "JSON-serializable artifact whose canonical hash is signed."
        },
        privateKeyPem: {
          type: "string",
          description:
            "ed25519 PKCS#8 PEM-encoded private key contents (NOT a file path)."
        },
        eventId: { type: "string" }
      },
      required: ["negotiationId", "instance", "artifact", "privateKeyPem"]
    }
  },
  {
    name: "h2a_stabilize",
    description:
      "Stabilize a negotiation once the registered signers' ed25519 signatures form a quorum on a single artifactHash. Returns the stabilized record and the winning hash.",
    inputSchema: {
      type: "object",
      properties: {
        negotiationId: { type: "string" },
        eventId: {
          type: "string",
          description: "Optional deterministic id for the final 'stabilized' event."
        }
      },
      required: ["negotiationId"]
    }
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
      "Escalate a negotiation to a higher control surface. Appends a journal event with type=escalate carrying { kind: 'escalation', channel, payload }.",
    inputSchema: {
      type: "object",
      properties: {
        negotiationId: { type: "string" },
        instance: {
          type: "string",
          description: "Instance performing the escalation (acts as MANDATAIRE)."
        },
        channel: {
          type: "string",
          enum: ["advise", "decide", "alert"]
        },
        payload: {
          description: "Arbitrary JSON-serializable escalation payload."
        }
      },
      required: ["negotiationId", "instance", "channel"]
    }
  }
];
