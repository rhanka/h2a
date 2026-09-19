/**
 * T6 / L1 — full paginated traversal, cursors, typed errors and giant-entry
 * recovery, over the REAL binary transport.
 *
 * Synthetic corpora (built as plain registry files the real `mcp-serve` reads)
 * keep the edge cases fast and deterministic. On main these assertions fail:
 * main ignores `limit`, offers no cursor, and returns every inscription in one
 * over-budget frame — so `returned === 3`, `invalid_limit`, `invalid_cursor`,
 * `cursor_stale` and `entry_too_large` all diverge.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { callRpc, notify, spawnMcp, stopChildren } from "./helpers/mcp-fix-lab.js";

const MCP_MAX_FRAME_BYTES = 1_048_576;

function mkReg(i, extra = {}) {
  const id = `inst:${String(i).padStart(6, "0")}`;
  return {
    id,
    instance: id,
    roles: ["AGENT"],
    scopes: ["scope:default"],
    capabilities: [],
    endpoints: [],
    publicKeys: [],
    acceptedPolicies: [],
    // Ascending createdAt with i, so canonical desc order is highest i first.
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
    ...extra
  };
}

function syntheticRoot(entries) {
  const root = mkdtempSync(join(tmpdir(), "h2a-pag-"));
  mkdirSync(join(root, "registry"), { recursive: true });
  writeFileSync(
    join(root, ".h2a-schema.json"),
    `${JSON.stringify({ version: "1", createdAt: new Date().toISOString(), createdBy: "test" })}\n`
  );
  writeFileSync(join(root, "registry", "instances.jsonl"), `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`);
  return root;
}

async function open(root) {
  const mcp = spawnMcp({ root });
  await callRpc(mcp, { jsonrpc: "2.0", id: "i", method: "initialize", params: {} });
  notify(mcp, { jsonrpc: "2.0", method: "notifications/initialized" });
  return mcp;
}

let rpcId = 100;
async function discover(mcp, args, { timeoutMs = 20000 } = {}) {
  const res = await callRpc(
    mcp,
    { jsonrpc: "2.0", id: rpcId++, method: "tools/call", params: { name: "h2a_discover_instances", arguments: args } },
    { timeoutMs }
  );
  assert.ok(res.bytes <= MCP_MAX_FRAME_BYTES, `frame bounded; got ${res.bytes}`);
  const body = JSON.parse(res.message.result.content[0].text);
  return { isError: res.message.result.isError === true, body, bytes: res.bytes };
}

test("T6: limit=3 returns exactly 3 with a cursor; full traversal reproduces the corpus in canonical order", async (t) => {
  const N = 500;
  const entries = Array.from({ length: N }, (_, i) => mkReg(i));
  const root = syntheticRoot(entries);
  const mcp = await open(root);
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    return stopChildren(mcp);
  });

  const first = await discover(mcp, { limit: 3 });
  assert.equal(first.isError, false);
  assert.equal(first.body.returned, 3, "limit is honored");
  assert.equal(first.body.instances.length, 3);
  assert.equal(first.body.total, N);
  assert.equal(first.body.hasMore, true);
  assert.equal(typeof first.body.nextCursor, "string");
  assert.equal(first.body.limit, 3);
  // Canonical order: highest i (most recent) first.
  assert.equal(first.body.instances[0].id, "inst:000499");
  assert.equal(first.body.instances[1].id, "inst:000498");
  assert.equal(first.body.instances[2].id, "inst:000497");

  // Full traversal keeps limit via the cursor.
  const order = [];
  let page = first;
  let guard = 0;
  while (page.body.hasMore) {
    page = await discover(mcp, { cursor: page.body.nextCursor });
    assert.equal(page.isError, false);
    for (const r of page.body.instances) order.push(r.id);
    assert.ok(++guard < 1000);
  }
  const all = ["inst:000499", "inst:000498", "inst:000497", ...order];
  assert.equal(all.length, N, "traversal reproduced every inscription once");
  assert.equal(new Set(all).size, N, "no duplicate across pages");
  // Strictly descending by i.
  for (let k = 1; k < all.length; k += 1) assert.ok(all[k] < all[k - 1], `descending at ${k}`);
});

test("T6: default (no params) is the 200 most recent", async (t) => {
  const entries = Array.from({ length: 350 }, (_, i) => mkReg(i));
  const root = syntheticRoot(entries);
  const mcp = await open(root);
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    return stopChildren(mcp);
  });
  const p = await discover(mcp, {});
  assert.equal(p.body.returned, 200, "default limit is 200");
  assert.equal(p.body.total, 350);
  assert.equal(p.body.hasMore, true);
  assert.equal(p.body.instances[0].id, "inst:000349", "most recent first");
});

test("T6: invalid limit and cursor are typed errors", async (t) => {
  const root = syntheticRoot(Array.from({ length: 10 }, (_, i) => mkReg(i)));
  const mcp = await open(root);
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    return stopChildren(mcp);
  });

  for (const bad of [0, -1, 1001, 1.5]) {
    const r = await discover(mcp, { limit: bad });
    assert.equal(r.isError, true, `limit ${bad} is an error`);
    assert.equal(r.body.code, "invalid_limit");
  }
  // A string limit is NOT coerced.
  const strLimit = await discover(mcp, { limit: "3" });
  assert.equal(strLimit.isError, true);
  assert.equal(strLimit.body.code, "invalid_limit");

  const malformed = await discover(mcp, { cursor: "not-a-real-cursor" });
  assert.equal(malformed.isError, true);
  assert.equal(malformed.body.code, "invalid_cursor");

  // Tamper a valid cursor's MAC.
  const good = await discover(mcp, { limit: 3 });
  const tampered = `${good.body.nextCursor.slice(0, -2)}xx`;
  const t2 = await discover(mcp, { cursor: tampered });
  assert.equal(t2.isError, true);
  assert.equal(t2.body.code, "invalid_cursor");
});

test("T6: a registry mutation mid-traversal fails the old cursor with cursor_stale (no silent restart)", async (t) => {
  const root = syntheticRoot(Array.from({ length: 20 }, (_, i) => mkReg(i)));
  const mcp = await open(root);
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    return stopChildren(mcp);
  });
  const first = await discover(mcp, { limit: 5 });
  assert.equal(first.isError, false);
  const cursor = first.body.nextCursor;
  // Mutate the corpus: append a new inscription → the generation changes.
  appendFileSync(join(root, "registry", "instances.jsonl"), `${JSON.stringify(mkReg(999))}\n`);
  const stale = await discover(mcp, { cursor });
  assert.equal(stale.isError, true);
  assert.equal(stale.body.code, "cursor_stale");
  assert.equal(stale.body.restartRequired, true);
});

test("T6: a giant middle entry is entry_too_large, recovered via h2a_read_payload, then resumed", async (t) => {
  // 5 entries; the desc-order index 2 is a >1 MiB entry (a huge `name`).
  const entries = [
    mkReg(0),
    mkReg(1),
    mkReg(2, { name: "G".repeat(1_200_000) }), // giant
    mkReg(3),
    mkReg(4)
  ];
  const root = syntheticRoot(entries);
  const mcp = await open(root);
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    return stopChildren(mcp);
  });

  // Page 1 (default): fits inst:000004, inst:000003 (desc), then the giant blocks.
  const p1 = await discover(mcp, {});
  assert.equal(p1.isError, false);
  assert.equal(p1.body.returned, 2, "the prefix before the giant");
  assert.deepEqual(p1.body.instances.map((r) => r.id), ["inst:000004", "inst:000003"]);
  assert.equal(p1.body.hasMore, true);

  // Page 2: the giant is now the head → entry_too_large with a recovery ref.
  const p2 = await discover(mcp, { cursor: p1.body.nextCursor });
  assert.equal(p2.isError, true);
  assert.equal(p2.body.code, "entry_too_large");
  assert.equal(p2.body.offset, 2);
  assert.equal(p2.body.total, 5);
  assert.ok(p2.body.recovery && p2.body.recovery.ref, "an oversize entry carries a recovery ref");
  assert.equal(typeof p2.body.resumeCursor, "string", "resume points past the giant");
  const entrySha = p2.body.entrySha256;

  // Recover the intact entry bytes via h2a_read_payload (chunked base64).
  const parts = [];
  let offset = 0;
  let guard = 0;
  for (;;) {
    const rr = await callRpc(mcp, {
      jsonrpc: "2.0",
      id: rpcId++,
      method: "tools/call",
      params: { name: "h2a_read_payload", arguments: { ref: p2.body.recovery.ref, offset, maxBytes: 65536 } }
    });
    assert.ok(rr.bytes <= MCP_MAX_FRAME_BYTES, "read_payload is itself bounded");
    const chunk = JSON.parse(rr.message.result.content[0].text);
    assert.equal(chunk.encoding, "base64");
    parts.push(Buffer.from(chunk.data, "base64"));
    if (chunk.nextOffset === null) {
      assert.equal(chunk.sha256, entrySha, "recovered sha256 matches the entry_too_large ref");
      break;
    }
    offset = chunk.nextOffset;
    assert.ok(++guard < 1000);
  }
  const recovered = Buffer.concat(parts);
  assert.equal(`sha256:${createHash("sha256").update(recovered).digest("hex")}`, entrySha, "reassembled integrity");
  const giant = JSON.parse(recovered.toString("utf8"));
  assert.equal(giant.id, "inst:000002", "the exact indivisible entry was recovered, not skipped");
  assert.equal(giant.name.length, 1_200_000);

  // Resume AFTER the giant with resumeCursor: the last two entries, then done.
  const p3 = await discover(mcp, { cursor: p2.body.resumeCursor });
  assert.equal(p3.isError, false);
  assert.deepEqual(p3.body.instances.map((r) => r.id), ["inst:000001", "inst:000000"]);
  assert.equal(p3.body.hasMore, false);
  assert.equal(p3.body.nextCursor, null, "traversal terminates without an empty extra page");
});
