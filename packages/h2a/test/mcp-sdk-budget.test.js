/**
 * L1 — the SDK-backed dispatch (central / hosted) bounds its final frame.
 *
 * `dispatchHostedTool` is the function that feeds the SDK `Server` for the hosted
 * read-only surface. This test drives it directly with a deliberately small
 * budget so a legitimate large result (nhi inventory over a 500-instance corpus)
 * exceeds the budget and is replaced by a bounded -32010-style error carrying a
 * recovery ref — then `h2a_read_payload` (allowlisted) recovers the intact bytes.
 * Discovery through the same surface stays a bounded page (pagination), and a
 * second tool on the same server still succeeds.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createMcpServer } from "../dist/index.js";
import { dispatchHostedTool } from "../dist/runtime/mcp-http/hosted-mcp-server.js";
import { encodeFrame } from "../dist/runtime/mcp/frame-budget.js";

function syntheticRoot(count) {
  const root = mkdtempSync(join(tmpdir(), "h2a-sdk-"));
  mkdirSync(join(root, "registry"), { recursive: true });
  writeFileSync(
    join(root, ".h2a-schema.json"),
    `${JSON.stringify({ version: "1", createdAt: new Date().toISOString(), createdBy: "test" })}\n`
  );
  const lines = [];
  for (let i = 0; i < count; i += 1) {
    const id = `inst:${String(i).padStart(6, "0")}`;
    lines.push(
      JSON.stringify({
        id,
        instance: id,
        roles: ["AGENT"],
        scopes: ["scope:default"],
        capabilities: [],
        endpoints: [],
        publicKeys: [],
        acceptedPolicies: [],
        createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString()
      })
    );
  }
  writeFileSync(join(root, "registry", "instances.jsonl"), `${lines.join("\n")}\n`);
  return root;
}

/** Model the SDK's emitted JSON-RPC frame for a tool result. */
function frameBytes(result) {
  return encodeFrame({ jsonrpc: "2.0", id: 1, result }).bytes;
}

test("hosted SDK dispatch bounds an oversize tool result and recovers it via h2a_read_payload", () => {
  const root = syntheticRoot(500);
  const budget = { maxBytes: 16 * 1024 };
  try {
    const server = createMcpServer({ root, frameBudget: budget });

    // nhi inventory over 500 instances is well over 16 KiB → must be bounded.
    const inv = dispatchHostedTool(server, "h2a_nhi_inventory", {});
    assert.ok(frameBytes(inv) <= budget.maxBytes, `bounded frame; got ${frameBytes(inv)}`);
    assert.equal(inv.isError, true, "oversize result is surfaced as an error");
    const body = JSON.parse(inv.content[0].text);
    assert.equal(body.code, "response_too_large");
    assert.equal(body.retryOriginal, false);
    assert.ok(body.recovery && body.recovery.ref, "a recovery ref is provided");
    assert.equal(body.budgetBytes, budget.maxBytes);

    // Recover the intact bytes through the hosted, allowlisted read_payload.
    const parts = [];
    let offset = 0;
    for (let guard = 0; guard < 100000; guard += 1) {
      const rr = dispatchHostedTool(server, "h2a_read_payload", { ref: body.recovery.ref, offset, maxBytes: 65536 });
      assert.ok(frameBytes(rr) <= budget.maxBytes, "read_payload frame is itself bounded");
      const chunk = JSON.parse(rr.content[0].text);
      parts.push(Buffer.from(chunk.data, "base64"));
      if (chunk.nextOffset === null) {
        assert.equal(chunk.sha256, body.recovery.sha256);
        break;
      }
      offset = chunk.nextOffset;
    }
    const recovered = Buffer.concat(parts);
    assert.equal(`sha256:${createHash("sha256").update(recovered).digest("hex")}`, body.recovery.sha256);
    // The recovered bytes are the intact original result (a valid JSON inventory).
    const original = JSON.parse(recovered.toString("utf8"));
    assert.ok(original.content || original.totals || Array.isArray(original.instances) || typeof original === "object");

    // A second tool on the same server still succeeds and is bounded.
    const disc = dispatchHostedTool(server, "h2a_discover_instances", { limit: 5 });
    assert.ok(frameBytes(disc) <= budget.maxBytes);
    assert.notEqual(disc.isError, true);
    const page = JSON.parse(disc.content[0].text);
    assert.equal(page.returned, 5, "discovery through the hosted surface is a bounded page");
    assert.equal(page.total, 500);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a recovery ref is tenant-confined: another root's server cannot read it", () => {
  const rootA = syntheticRoot(500);
  const rootB = syntheticRoot(1);
  const budget = { maxBytes: 16 * 1024 };
  try {
    const serverA = createMcpServer({ root: rootA, frameBudget: budget });
    const serverB = createMcpServer({ root: rootB, frameBudget: budget });
    const inv = dispatchHostedTool(serverA, "h2a_nhi_inventory", {});
    const ref = JSON.parse(inv.content[0].text).recovery.ref;

    const cross = dispatchHostedTool(serverB, "h2a_read_payload", { ref, offset: 0, maxBytes: 65536 });
    const crossBody = JSON.parse(cross.content[0].text);
    assert.equal(cross.isError, true);
    assert.equal(crossBody.code, "payload_not_found", "cross-tenant recovery is refused");
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  }
});
