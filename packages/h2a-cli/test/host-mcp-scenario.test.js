import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { H2A_CLAUDE_HOST, H2A_CODEX_HOST } from "../dist/index.js";

const BIN_PATH = join(process.cwd(), "packages/h2a-cli/dist/bin.js");

function registration(host) {
  return {
    id: `conductor:${host}`,
    instance: `conductor:${host}`,
    roles: ["CONDUCTOR"],
    scopes: [`scope:host/${host}`],
    capabilities: ["negotiate", "inbox"],
    endpoints: [{ kind: "mcp", uri: "stdio://h2a" }],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: "2026-05-20T00:00:00.000Z"
  };
}

function record(host) {
  return {
    id: `nego:${host}`,
    scope: `scope:host/${host}`,
    parties: [`conductor:${host}`],
    subject: "engagement",
    status: "draft",
    requiredSigners: [`conductor:${host}`]
  };
}

function envelope(host) {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id: `env:${host}:01`,
    type: "event",
    actor: {
      instance: `conductor:${host}`,
      role: "CONDUCTOR",
      scope: `scope:host/${host}`
    },
    body: { kind: "host-scenario", host },
    createdAt: "2026-05-20T00:00:01.000Z"
  };
}

function call(id, name, args) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args }
  };
}

async function runJsonRpcProcess(command, args, requests) {
  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const closed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`MCP process timed out; stderr:\n${stderr}`));
    }, 5000);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`MCP process exited ${code}; stderr:\n${stderr}`));
        return;
      }
      resolve(
        stdout
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line))
      );
    });
  });

  for (const request of requests) {
    child.stdin.write(`${JSON.stringify(request)}\n`);
  }
  child.stdin.end();

  return closed;
}

function toolPayload(response) {
  assert.equal(response.result?.isError, false, JSON.stringify(response));
  assert.equal(response.result.content[0].type, "text");
  return JSON.parse(response.result.content[0].text);
}

for (const descriptor of [H2A_CODEX_HOST, H2A_CLAUDE_HOST]) {
  test(`${descriptor.host} host setup snippet drives MCP registration, negotiation, and inbox`, async () => {
    const root = mkdtempSync(join(tmpdir(), `h2a-${descriptor.host}-host-scenario-`));
    try {
      const snippet = descriptor.renderMcpConfig({
        command: process.execPath,
        args: [BIN_PATH, "mcp-serve"],
        root
      });
      const server = snippet.config.mcpServers.h2a;
      const host = descriptor.host;
      const responses = await runJsonRpcProcess(server.command, server.args, [
        { jsonrpc: "2.0", id: 1, method: "initialize" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        call(3, "h2a_register_instance", { registration: registration(host) }),
        call(4, "h2a_open_negotiation", { record: record(host) }),
        call(5, "h2a_offer", {
          negotiationId: `nego:${host}`,
          instance: `conductor:${host}`,
          artifact: {
            kind: "ENGAGEMENT",
            id: `eng:${host}`,
            scope: `scope:host/${host}`,
            charter: { goal: `drive ${host} via MCP config` },
            roleBindings: [{ role: "CONDUCTOR", instance: `conductor:${host}` }],
            controls: [],
            policies: [],
            successCriteria: ["host scenario completed"]
          },
          eventId: `evt:${host}:offer`
        }),
        call(6, "h2a_inbox", {
          action: "put",
          instance: `conductor:${host}`,
          envelope: envelope(host)
        }),
        call(7, "h2a_inbox", {
          action: "read",
          instance: `conductor:${host}`
        })
      ]);

      assert.equal(responses.length, 7);
      assert.equal(responses[0].result.serverInfo.name, "@sentropic/h2a-cli");
      const toolNames = responses[1].result.tools.map((tool) => tool.name);
      assert.equal(toolNames.includes("h2a_offer"), true);
      assert.equal(toolNames.includes("h2a_inbox"), true);

      assert.equal(toolPayload(responses[2]).instance, `conductor:${host}`);
      assert.equal(toolPayload(responses[3]).record.id, `nego:${host}`);
      assert.equal(toolPayload(responses[4]).entry.type, "propose");
      assert.equal(toolPayload(responses[5]).envelopeId, `env:${host}:01`);
      assert.equal(toolPayload(responses[6]).envelopes[0].id, `env:${host}:01`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
