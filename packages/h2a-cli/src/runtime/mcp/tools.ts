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
    name: "h2a_attest_comprehension",
    description:
      "Emit a signed, non-binding comprehension-attestation for a dossier hash. When negotiationId is provided, appends an event with no artifactKind.",
    inputSchema: {
      type: "object",
      properties: {
        negotiationId: { type: "string" },
        instance: { type: "string" },
        dossier: {
          description: "JSON-serializable dossier. The tool computes its canonical sha256 hash."
        },
        dossierHash: { type: "string", description: "Precomputed sha256:<hex> dossier hash." },
        privateKeyPem: {
          type: "string",
          description: "ed25519 PKCS#8 PEM-encoded private key contents (NOT a file path)."
        },
        role: { type: "string", description: "Actor role; defaults to the instance's first registered role." },
        scope: { type: "string", description: "Actor scope; defaults to the instance's first registered scope or negotiation scope." },
        eventId: { type: "string" },
        at: { type: "string" },
        causationId: { type: "string" },
        correlationId: { type: "string" }
      },
      required: ["instance", "privateKeyPem"]
    }
  },
  {
    name: "h2a_declare_conflit_interet",
    description:
      "Append a declaration-interet journal event for an instance in a negotiation.",
    inputSchema: {
      type: "object",
      properties: {
        negotiationId: { type: "string" },
        instance: { type: "string" },
        interets: {
          type: "array",
          items: { type: "string" }
        },
        bindings: {
          type: "array",
          items: { type: "string" }
        },
        masqueImpactCollectif: { type: "boolean" },
        eventId: { type: "string" },
        at: { type: "string" }
      },
      required: ["negotiationId", "instance", "interets"]
    }
  },
  {
    name: "h2a_conflict_posture",
    description:
      "Derive postureConflit for the negotiation signers and declared subjects.",
    inputSchema: {
      type: "object",
      properties: {
        negotiationId: { type: "string" }
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
  },
  {
    name: "h2a_session_open",
    description:
      "Open a live session for an instance (DEC-050/051). Writes a presence file under <root>/.h2a/presence/<sessionId>.json and returns the session plus the currently-fresh peers. The session subscribes by default to all canonical notification topics.",
    inputSchema: {
      type: "object",
      properties: {
        instance: {
          type: "string",
          description: "Identity of the live attachment (e.g. 'claude:proj-1')."
        },
        host: {
          type: "string",
          description: "Optional host CLI hint ('claude', 'codex', 'gemini', ...)."
        },
        pid: {
          type: "number",
          description: "Optional PID of the holding process; defaults to the mcp-serve PID."
        },
        interests: {
          type: "object",
          description: "Scopes / negotiations the session wants to observe.",
          properties: {
            scopes: { type: "array", items: { type: "string" } },
            negotiations: { type: "array", items: { type: "string" } }
          }
        },
        subscribedTopics: {
          type: "array",
          items: { type: "string" },
          description:
            "Subset of canonical notification topics to subscribe to. Defaults to all four."
        },
        sessionId: {
          type: "string",
          description: "Optional explicit session id (UUID-like). Generated if absent."
        }
      },
      required: ["instance"]
    }
  },
  {
    name: "h2a_session_close",
    description:
      "Close a previously-opened session (DEC-051). Stops the heartbeat, marks the final state, and deletes the presence file for the 'closed'/'expired' terminal states.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        state: {
          type: "string",
          enum: ["closed", "draining", "expired"],
          description: "Final state to record. Defaults to 'closed'."
        }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "h2a_discover_sessions",
    description:
      "List currently-live peer sessions (DEC-051). Reads presence files under <root>/.h2a/presence/ and filters by freshness (default expiry 90s). Optional scope/instance/name filters.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string" },
        instance: { type: "string" },
        name: {
          type: "string",
          description:
            "Case-insensitive substring match on session.name (display name). Use to find a peer by friendly name when you don't know the full instance id."
        }
      }
    }
  },
  {
    name: "h2a_nhi_report",
    description:
      "Derive a Non-Human-Identity posture (OWASP NHI Top 10 / NIST CSF) from the registry (DEC-087): per-risk findings (NHI1 offboarding, NHI4 auth, NHI5 over-privilege, NHI7 long-lived keys, NHI9 reuse) plus a summary. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        longLivedKeyMaxDays: {
          type: "number",
          description: "Keys older than this many days are flagged long-lived (NHI7). Default 90."
        }
      }
    }
  },
  {
    name: "h2a_nhi_inventory",
    description:
      "Per-identity inventory of the NHI estate (DEC-090): each instance with its active keys (fingerprint, age, long-lived flag, reuse), subagents (status, capability bound) and offboard state, plus estate totals. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        longLivedKeyMaxDays: {
          type: "number",
          description: "Keys older than this many days are flagged long-lived. Default 90."
        }
      }
    }
  },
  {
    name: "h2a_nhi_attest",
    description:
      "Emit a signed attestation of the current NHI posture (DEC-087): an ed25519-signed `event` envelope whose body carries the posture report. Actor role/scope default to the instance's registration.",
    inputSchema: {
      type: "object",
      properties: {
        instance: { type: "string" },
        privateKeyPem: {
          type: "string",
          description: "ed25519 PKCS#8 PEM-encoded private key contents (NOT a file path)."
        },
        role: { type: "string", description: "Actor role; defaults to the instance's first registered role." },
        scope: { type: "string", description: "Actor scope; defaults to the instance's first registered scope." },
        longLivedKeyMaxDays: { type: "number" }
      },
      required: ["instance", "privateKeyPem"]
    }
  },
  {
    name: "h2a_nhi_offboard",
    description:
      "Coordinated decommission of an NHI (DEC-089): revoke every active key and every active subagent of the instance, then append an offboard tombstone. Idempotent. Returns the tombstone.",
    inputSchema: {
      type: "object",
      properties: {
        instance: { type: "string" },
        reason: { type: "string" }
      },
      required: ["instance"]
    }
  },
  {
    name: "h2a_nhi_export",
    description:
      "Export an instance's active public keys as a SPIFFE-trust-bundle / JWKS-shaped object (NHI P3 interop, DEC-094). Trust-anchor material in a bundle shape; live SPIRE integration stays in an external connector.",
    inputSchema: {
      type: "object",
      properties: {
        instance: { type: "string" },
        trustDomain: { type: "string", description: "SPIFFE trust domain, e.g. example.org" }
      },
      required: ["instance", "trustDomain"]
    }
  },
  {
    name: "h2a_blockage_raise",
    description:
      "Raise a blockage (DEC-092, EVO-3) so peers in scope are notified (peer.blocked push) — distinct from the drumbeat stall and from escalation. Durable.",
    inputSchema: {
      type: "object",
      properties: {
        instance: { type: "string" },
        reason: { type: "string" },
        scope: { type: "string" },
        needs: { type: "string", description: "What would unblock it (helps a peer act)." }
      },
      required: ["instance", "reason"]
    }
  },
  {
    name: "h2a_blockage_list",
    description: "List recorded blockages (DEC-092), optionally filtered by scope or active-only.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string" },
        active: { type: "boolean", description: "Only unresolved blockages." }
      }
    }
  },
  {
    name: "h2a_blockage_resolve",
    description: "Resolve a blockage (DEC-092, idempotent); the dispatcher then pushes peer.unblocked.",
    inputSchema: {
      type: "object",
      properties: {
        instance: { type: "string" },
        by: { type: "string" }
      },
      required: ["instance"]
    }
  },
  {
    name: "h2a_conductor",
    description:
      "Resolve the live conductor/owner of a workspace (WP-G1, read-only). conductor = the earliest active-claim live agent (WP-G1b), or the live agent registered with role CONDUCTOR (WP-G1a), or null. candidates = all in-workspace live agents. Accepts workspaceId (ws:…) or workspacePath (filesystem path).",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: {
          type: "string",
          description: "Workspace id in ws:<uuid> form. Mutually exclusive with workspacePath."
        },
        workspacePath: {
          type: "string",
          description: "Filesystem path; resolved to a workspaceId via the same derivation presence uses."
        }
      }
    }
  },
  {
    name: "h2a_conductor_claim",
    description:
      "Claim the conductor role for a workspace (WP-G1b, additive/reversible). Appends a claim event and returns the post-claim conductorFor resolution — the caller sees who the conductor now is (should be itself if it won the election). Earliest live claimant wins.",
    inputSchema: {
      type: "object",
      properties: {
        instance: {
          type: "string",
          description: "The claiming instance id (perennial, host:label:uuid12)."
        },
        workspaceId: {
          type: "string",
          description: "Workspace id in ws:<uuid> form. Mutually exclusive with workspacePath."
        },
        workspacePath: {
          type: "string",
          description: "Filesystem path; resolved to a workspaceId via the same derivation presence uses."
        }
      },
      required: ["instance"]
    }
  },
  {
    name: "h2a_conductor_release",
    description:
      "Release the conductor claim for a workspace (WP-G1b, additive/reversible). Appends a release event and returns the post-release conductorFor resolution so the caller sees the new conductor (or null if no other claimant is live).",
    inputSchema: {
      type: "object",
      properties: {
        instance: {
          type: "string",
          description: "The releasing instance id (perennial, host:label:uuid12)."
        },
        workspaceId: {
          type: "string",
          description: "Workspace id in ws:<uuid> form. Mutually exclusive with workspacePath."
        },
        workspacePath: {
          type: "string",
          description: "Filesystem path; resolved to a workspaceId via the same derivation presence uses."
        }
      },
      required: ["instance"]
    }
  },
  {
    name: "h2a_conductor_launch_check",
    description:
      "DRY-RUN (D3): poll track workspace-activity and return a recommendation to launch a conductor if work is durably stalled and no conductor is live. h2a does NOT spawn anything — this is advisory only. The launch is parked pending a spawn policy and remote-trigger support. Returns: { workspaceId, trackAvailable, conductor, conductorLive, pending, stalled, recommendation, reason, suggestedHosts? }.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: {
          type: "string",
          description: "Workspace id in ws:<uuid> form. Mutually exclusive with workspacePath."
        },
        workspacePath: {
          type: "string",
          description: "Filesystem path; resolved to a workspaceId via the same derivation presence uses."
        },
        idleMs: {
          type: "number",
          description: "Idle threshold in milliseconds for track workspace-activity (default 86400000 = 24h)."
        }
      }
    }
  }
];
