/**
 * T1 / L1 — the REAL discovery response is bounded (regression over the wire).
 *
 * Drives the real built `mcp-serve` binary against an UNCHANGED private copy of
 * the 26,753-inscription seed. On main the `h2a_discover_instances` response is
 * one ~19,185,053-byte frame — far over the 1 MiB frame budget AND over Claude's
 * 16 MiB cap — so `frameBytes <= B` fails (the behavioral red). On the candidate
 * every frame is bounded, the first page holds ≤200 inscriptions, and a full
 * cursor traversal reproduces the whole registry with no omission or duplicate.
 *
 * The registry file's SHA-256 is checked before/after: discovery never mutates
 * the corpus (auto-open is off, so no presence write touches the registry).
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { callRpc, copySeed, notify, spawnMcp, stopChildren } from "./helpers/mcp-fix-lab.js";

/** Frozen L1 frame ceiling (contract value; hardcoded so this test runs on main too). */
const MCP_MAX_FRAME_BYTES = 1_048_576;

const SEED = process.env.H2A_MCP_TEST_SEED;

function sha256File(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

async function handshake(mcp) {
  const init = await callRpc(mcp, {
    jsonrpc: "2.0",
    id: "init",
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "lab", version: "0" } }
  });
  assert.equal(init.message.result.protocolVersion, "2025-06-18");
  notify(mcp, { jsonrpc: "2.0", method: "notifications/initialized" });
}

function parsePage(res) {
  assert.ok(res.message.result, "tools/call returned a result");
  const text = res.message.result.content[0].text;
  return JSON.parse(text);
}

test("T1: the real discover response is bounded and never mutates the registry", { skip: !SEED }, async (t) => {
  // Requires the real 26,753-inscription seed; skipped (not failed) in public CI
  // where no private seed is present — the synthetic T6/SDK suites still cover it.
  const root = copySeed(SEED);
  const registryFile = join(root, "registry", "instances.jsonl");
  const shaBefore = sha256File(registryFile);

  const mcp = spawnMcp({ root });
  t.after(() => stopChildren(mcp));
  await handshake(mcp);

  const res = await callRpc(
    mcp,
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "h2a_discover_instances", arguments: {} } },
    { timeoutMs: 120000 }
  );

  // PRIMARY behavioral red: on main this frame is ~19,185,053 B (> B and > 16 MiB).
  assert.ok(
    res.bytes <= MCP_MAX_FRAME_BYTES,
    `discover frame must be <= ${MCP_MAX_FRAME_BYTES} bytes; got ${res.bytes}`
  );

  const page = parsePage(res);
  assert.notEqual(res.message.result.isError, true, "first page is not an error");
  assert.ok(Array.isArray(page.instances), "page carries an instances array");
  assert.ok(page.instances.length <= 200, `first page holds <= 200; got ${page.instances.length}`);
  assert.equal(page.returned, page.instances.length);
  assert.equal(page.total, 26753, "total reflects the whole filtered generation");
  assert.equal(page.hasMore, true, "there is more than one page for 26,753 inscriptions");
  assert.equal(typeof page.nextCursor, "string", "a non-final page carries an opaque cursor");
  assert.equal(typeof page.generation, "string");

  // Canonical identity: `id` when present, else the (pre-DEC-114) `instance`.
  const keyOf = (reg) => (typeof reg.id === "string" && reg.id.length > 0 ? reg.id : reg.instance);

  // Full traversal: every page bounded, ids reproduce the whole registry exactly.
  const seen = new Set();
  for (const reg of page.instances) seen.add(keyOf(reg));
  let cursor = page.nextCursor;
  let pages = 1;
  const generation = page.generation;
  while (cursor) {
    const next = await callRpc(
      mcp,
      {
        jsonrpc: "2.0",
        id: 100 + pages,
        method: "tools/call",
        params: { name: "h2a_discover_instances", arguments: { cursor } }
      },
      { timeoutMs: 120000 }
    );
    assert.ok(next.bytes <= MCP_MAX_FRAME_BYTES, `page ${pages} frame bounded; got ${next.bytes}`);
    assert.notEqual(next.message.result.isError, true, `page ${pages} is not an error`);
    const np = parsePage(next);
    assert.equal(np.generation, generation, "generation is stable across a stable traversal");
    for (const reg of np.instances) {
      const k = keyOf(reg);
      assert.equal(seen.has(k), false, `no duplicate id across pages: ${k}`);
      seen.add(k);
    }
    cursor = np.nextCursor;
    pages += 1;
    assert.ok(pages < 1000, "traversal terminates");
  }

  // Independent oracle: the set of ids the traversal returned == the seed's ids.
  const oracleIds = new Set(
    readFileSync(registryFile, "utf8")
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => keyOf(JSON.parse(l)))
  );
  assert.equal(seen.size, oracleIds.size, "traversal reproduced every inscription");
  assert.equal(seen.size, 26753);
  for (const id of oracleIds) assert.ok(seen.has(id), `missing id in traversal: ${id}`);

  assert.equal(sha256File(registryFile), shaBefore, "registry unchanged by discovery");
});
