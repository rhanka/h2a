import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { H2A_CLI_MCP_TOOL_NAMES, createMcpServer } from "../dist/index.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-mcp-"));
}

function registration(overrides = {}) {
  return {
    id: "conductor:01",
    instance: "conductor:01",
    roles: ["CONDUCTOR"],
    scopes: ["scope:principal/antoine"],
    capabilities: ["negotiate"],
    endpoints: [{ kind: "local-files", uri: "file:///tmp/h2a" }],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: "2026-05-18T00:00:00.000Z",
    ...overrides
  };
}

function envelope(id, instance = "conductor:01") {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id,
    type: "propose",
    actor: { instance, role: "CONDUCTOR", scope: "scope:x" },
    body: { offer: 1 },
    createdAt: "2026-05-18T00:00:00.000Z"
  };
}

test("createMcpServer.listTools returns all canonical tools with schemas (DEC-051 added 3)", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });
    const tools = server.listTools();
    assert.equal(tools.length, H2A_CLI_MCP_TOOL_NAMES.length);
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [...H2A_CLI_MCP_TOOL_NAMES].sort());
    for (const tool of tools) {
      assert.equal(typeof tool.name, "string");
      assert.equal(typeof tool.description, "string");
      assert.equal(tool.inputSchema?.type, "object");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("callTool h2a_register_instance + h2a_discover_instances dispatch to the store", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });

    const regResult = server.callTool("h2a_register_instance", {
      registration: registration()
    });
    assert.equal(regResult.ok, true);
    assert.equal(regResult.instance, "conductor:01");

    const second = registration({
      id: "principal:fa",
      instance: "principal:fa",
      roles: ["PRINCIPAL"],
      scopes: ["scope:principal/antoine"]
    });
    server.callTool("h2a_register_instance", { registration: second });

    const all = server.callTool("h2a_discover_instances", {});
    assert.equal(all.instances.length, 2);

    const conductors = server.callTool("h2a_discover_instances", {
      role: "CONDUCTOR"
    });
    assert.equal(conductors.instances.length, 1);
    assert.equal(conductors.instances[0].id, "conductor:01");

    const scoped = server.callTool("h2a_discover_instances", {
      scope: "scope:principal/antoine"
    });
    assert.equal(scoped.instances.length, 2);

    const missing = server.callTool("h2a_discover_instances", {
      role: "AGENTS"
    });
    assert.equal(missing.instances.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("callTool h2a_inbox put / read / pop round-trips", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });
    // WP-2: register the target so it resolves to deliver-dormant (not phantom).
    server.callTool("h2a_register_instance", {
      registration: {
        id: "conductor:02",
        instance: "conductor:02",
        roles: ["CONDUCTOR"],
        scopes: ["scope:x"],
        capabilities: [],
        endpoints: [],
        publicKeys: [],
        acceptedPolicies: [],
        createdAt: new Date().toISOString()
      }
    });

    const putResult = server.callTool("h2a_inbox", {
      action: "put",
      instance: "conductor:02",
      envelope: envelope("env-001")
    });
    assert.equal(putResult.ok, true);

    const readResult = server.callTool("h2a_inbox", {
      action: "read",
      instance: "conductor:02"
    });
    assert.equal(readResult.envelopes.length, 1);
    assert.equal(readResult.envelopes[0].id, "env-001");

    const popResult = server.callTool("h2a_inbox", {
      action: "pop",
      instance: "conductor:02",
      envelopeId: "env-001"
    });
    assert.equal(popResult.envelope.id, "env-001");

    const afterPop = server.callTool("h2a_inbox", {
      action: "read",
      instance: "conductor:02"
    });
    assert.equal(afterPop.envelopes.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("callTool h2a_inbox returns an error for an unknown action", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });
    const result = server.callTool("h2a_inbox", {
      action: "burn",
      instance: "conductor:02"
    });
    assert.ok(result.error, "expected an error field");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("callTool h2a_append_journal chains entries through the store", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });

    const first = server.callTool("h2a_append_journal", {
      negotiationId: "nego-mcp-01",
      payload: {
        id: "evt-001",
        type: "register",
        actor: { instance: "conductor:01", role: "CONDUCTOR", scope: "scope:x" },
        body: { ok: true },
        createdAt: "2026-05-18T00:00:00.000Z"
      }
    });
    assert.equal(first.entry.sequence, 0);

    const second = server.callTool("h2a_append_journal", {
      negotiationId: "nego-mcp-01",
      payload: {
        id: "evt-002",
        type: "propose",
        actor: { instance: "conductor:01", role: "CONDUCTOR", scope: "scope:x" },
        body: { offer: 7 },
        createdAt: "2026-05-18T00:01:00.000Z"
      }
    });
    assert.equal(second.entry.sequence, 1);
    assert.equal(second.entry.prevHash, first.entry.contentHash);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("callTool returns an error for an unknown tool name", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });
    const result = server.callTool("h2a_unknown_tool", {});
    assert.ok(result.error, "expected error for unknown tool");
    assert.match(result.error, /unknown tool/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("callTool returns descriptive arg errors (not 'not implemented') for the negotiation tools when called with empty args", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });
    const wired = [
      "h2a_open_negotiation",
      "h2a_offer",
      "h2a_counteroffer",
      "h2a_sign",
      "h2a_stabilize",
      "h2a_escalate"
    ];
    for (const name of wired) {
      const result = server.callTool(name, {});
      assert.ok(result.error, `${name} should return a structured error on empty args`);
      assert.doesNotMatch(
        result.error,
        /not implemented/i,
        `${name} should now be wired (not return 'not implemented')`
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
