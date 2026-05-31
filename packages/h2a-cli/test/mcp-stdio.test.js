import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { H2A_CLI_MCP_TOOL_NAMES, runMcpStdio } from "../dist/index.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-mcp-stdio-"));
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

/**
 * Drive runMcpStdio with a scripted sequence of newline-delimited JSON-RPC
 * messages. Resolves with the array of parsed JSON-RPC responses.
 */
async function runScenario(root, lines) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  let buffered = "";
  stdout.on("data", (chunk) => {
    buffered += chunk.toString("utf8");
  });

  const done = runMcpStdio({ root, stdin, stdout, stderr });

  for (const line of lines) {
    stdin.write(`${line}\n`);
  }
  stdin.end();

  await done;

  return buffered
    .split("\n")
    .filter((s) => s.length > 0)
    .map((s) => JSON.parse(s));
}

test("runMcpStdio: initialize returns the expected serverInfo", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })
    ]);
    assert.equal(responses.length, 1);
    const [res] = responses;
    assert.equal(res.jsonrpc, "2.0");
    assert.equal(res.id, 1);
    assert.equal(res.result.protocolVersion, "2025-06-18");
    assert.equal(res.result.serverInfo.name, "@sentropic/h2a-cli");
    assert.equal(res.result.serverInfo.version, "0.1.1");
    assert.deepEqual(res.result.capabilities, { tools: {} });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio: a notification (no id) draws NO response — never id:null (DEC-115)", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      // notification (no id): the standard post-init signal — MUST get no reply
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      // an unknown notification (no id): still no reply, not a -32601 error
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/something-unknown" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    ]);
    // exactly the two REQUESTS get responses; the two notifications get none
    assert.equal(responses.length, 2);
    assert.deepEqual(
      responses.map((r) => r.id).sort((a, b) => a - b),
      [1, 2]
    );
    // crucially: no id:null line (that is what broke codex's rmcp at startup)
    assert.equal(
      responses.some((r) => r.id === null),
      false
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio: tools/list returns all canonical tool names (DEC-051 added 3)", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    ]);
    assert.equal(responses.length, 1);
    const [res] = responses;
    assert.equal(res.id, 2);
    assert.ok(Array.isArray(res.result.tools));
    assert.equal(res.result.tools.length, H2A_CLI_MCP_TOOL_NAMES.length);
    const names = res.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [...H2A_CLI_MCP_TOOL_NAMES].sort());
    for (const tool of res.result.tools) {
      assert.equal(typeof tool.name, "string");
      assert.equal(typeof tool.description, "string");
      assert.equal(tool.inputSchema?.type, "object");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio: tools/call h2a_register_instance round-trips via the store", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "h2a_register_instance",
          arguments: { registration: registration() }
        }
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "h2a_discover_instances", arguments: {} }
      })
    ]);
    assert.equal(responses.length, 2);

    const [regRes, discoverRes] = responses;
    assert.equal(regRes.id, 3);
    assert.equal(regRes.result.isError, false);
    assert.equal(regRes.result.content[0].type, "text");
    const regPayload = JSON.parse(regRes.result.content[0].text);
    assert.equal(regPayload.ok, true);
    assert.equal(regPayload.instance, "conductor:01");

    assert.equal(discoverRes.id, 4);
    assert.equal(discoverRes.result.isError, false);
    const discoverPayload = JSON.parse(discoverRes.result.content[0].text);
    assert.equal(discoverPayload.instances.length, 1);
    assert.equal(discoverPayload.instances[0].id, "conductor:01");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio: tools/call duplicate registration returns isError:true content", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "h2a_register_instance",
          arguments: { registration: registration() }
        }
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "h2a_register_instance",
          arguments: { registration: registration() }
        }
      })
    ]);
    assert.equal(responses.length, 2);
    const [, dup] = responses;
    assert.equal(dup.id, 6);
    assert.equal(dup.result.isError, true);
    const payload = JSON.parse(dup.result.content[0].text);
    assert.ok(typeof payload.error === "string");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio: tools/call unknown tool returns isError:true", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "h2a_does_not_exist", arguments: {} }
      })
    ]);
    assert.equal(responses.length, 1);
    const [res] = responses;
    assert.equal(res.id, 7);
    assert.equal(res.result.isError, true);
    const payload = JSON.parse(res.result.content[0].text);
    assert.match(payload.error, /unknown tool/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio: unknown method returns -32601", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify({ jsonrpc: "2.0", id: 8, method: "no/such/method" })
    ]);
    assert.equal(responses.length, 1);
    const [res] = responses;
    assert.equal(res.id, 8);
    assert.equal(res.error.code, -32601);
    assert.match(res.error.message, /method not found/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio: malformed JSON returns -32700 with id:null", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, ["{ not valid json"]);
    assert.equal(responses.length, 1);
    const [res] = responses;
    assert.equal(res.id, null);
    assert.equal(res.error.code, -32700);
    assert.match(res.error.message, /parse error/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio: missing jsonrpc field returns -32600 Invalid Request", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify({ id: 9, method: "initialize" })
    ]);
    assert.equal(responses.length, 1);
    const [res] = responses;
    assert.equal(res.error.code, -32600);
    assert.match(res.error.message, /invalid request/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
