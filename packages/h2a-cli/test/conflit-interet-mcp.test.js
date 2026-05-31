import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createMcpServer } from "../dist/index.js";

test("MCP declares conflitInteret and reads postureConflit for a negotiation", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-conflit-mcp-"));
  try {
    const server = createMcpServer({ root });
    const signer = "signer:1";
    server.callTool("h2a_register_instance", {
      registration: {
        id: signer,
        instance: signer,
        roles: ["CONDUCTOR"],
        scopes: ["scope:self"],
        capabilities: [],
        endpoints: [],
        publicKeys: [],
        acceptedPolicies: [],
        createdAt: "2026-05-31T00:00:00.000Z"
      }
    });
    server.callTool("h2a_open_negotiation", {
      record: {
        id: "nego-conflit-mcp",
        scope: "scope:self",
        parties: [signer],
        subject: "engagement",
        status: "draft",
        requiredSigners: [signer]
      }
    });

    const declared = server.callTool("h2a_declare_conflit_interet", {
      negotiationId: "nego-conflit-mcp",
      instance: signer,
      interets: ["vendor stake"],
      bindings: ["scope:umbrella"],
      eventId: "evt-declaration-01"
    });
    assert.equal(declared.error, undefined);
    assert.equal(declared.entry.body.kind, "declaration-interet");

    const posture = server.callTool("h2a_conflict_posture", {
      negotiationId: "nego-conflit-mcp"
    });
    assert.equal(posture.error, undefined);
    assert.equal(posture.negotiationId, "nego-conflit-mcp");
    assert.equal(posture.postures[0].subject, signer);
    assert.equal(posture.postures[0].postureConflit, "conflit-declarable");
    assert.deepEqual(posture.postures[0].criteres, ["hors-scope-propre", "signataire"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
