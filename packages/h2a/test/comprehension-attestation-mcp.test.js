import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { computeHash } from "@sentropic/h2a";
import { createMcpServer } from "../dist/index.js";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

function openServer(root, capabilities = []) {
  const server = createMcpServer({ root });
  const keys = keypair();
  server.callTool("h2a_register_instance", {
    registration: {
      id: "agent:1",
      instance: "agent:1",
      roles: ["AGENTS"],
      scopes: ["scope:attn"],
      capabilities,
      endpoints: [],
      publicKeys: [keys.publicPem],
      acceptedPolicies: [],
      createdAt: "2026-05-31T00:00:00.000Z"
    }
  });
  server.callTool("h2a_open_negotiation", {
    record: {
      id: "nego-attn-mcp",
      scope: "scope:attn",
      parties: ["agent:1"],
      subject: "engagement",
      status: "draft",
      requiredSigners: ["agent:1"]
    }
  });
  return { server, keys };
}

test("MCP attest-comprehension appends a signed non-binding journal event", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-attn-mcp-"));
  try {
    const { server, keys } = openServer(root, ["attester-comprehension"]);
    const dossierHash = computeHash({ dossier: "exact" });

    const result = server.callTool("h2a_attest_comprehension", {
      negotiationId: "nego-attn-mcp",
      instance: "agent:1",
      dossierHash,
      privateKeyPem: keys.privatePem,
      eventId: "evt-mcp-comprehension-01"
    });

    assert.equal(result.error, undefined);
    assert.equal(result.entry.id, "evt-mcp-comprehension-01");
    assert.equal(result.entry.type, "event");
    assert.equal(result.entry.artifactKind, undefined);
    assert.equal(result.entry.body.kind, "comprehension-attestation");
    assert.equal(result.entry.body.subject, "agent:1");
    assert.equal(result.entry.body.dossierHash, dossierHash);
    assert.equal(result.entry.signatures.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP AGENTS need attester-comprehension for comprehension attestations", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-attn-mcp-"));
  try {
    const { server, keys } = openServer(root, []);

    const result = server.callTool("h2a_attest_comprehension", {
      negotiationId: "nego-attn-mcp",
      instance: "agent:1",
      dossierHash: computeHash("dossier"),
      privateKeyPem: keys.privatePem
    });

    assert.match(result.error, /attester-comprehension/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
