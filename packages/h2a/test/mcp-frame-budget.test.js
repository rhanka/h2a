/**
 * L1 frame-budget tests.
 *
 * Unit half (green completer, module-only import): the exact-byte encoder, the
 * B-1/B/B+1 boundary, the -32010 oversize refusal + recovery, the -32603
 * serialization guard, the incoming-id gate, and the notification overflow /
 * recovery-unavailable notices.
 *
 * Transport half (runs against the real binary): a too-big request id is refused
 * with -32600 id:null BEFORE execution, and the SAME connection then serves a
 * normal tool call — the connection is preserved.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MCP_MAX_FRAME_BYTES,
  boundNotificationFrame,
  boundResponseFrame,
  buildInvalidRequestId,
  encodeFrame,
  isAcceptableRequestId,
  resolveFrameBudget
} from "../dist/runtime/mcp/frame-budget.js";
import { createPayloadStore } from "../dist/runtime/mcp/payload-store.js";
import { callRpc, copySeed, notify, spawnMcp, stopChildren } from "./helpers/mcp-fix-lab.js";

const SEED = process.env.H2A_MCP_TEST_SEED;

test("encodeFrame measures the exact wire bytes including the newline and multibyte chars", () => {
  const f = encodeFrame({ ok: "é€" });
  assert.equal(f.line, `${f.json}\n`);
  assert.equal(f.bytes, Buffer.byteLength(f.line, "utf8"));
  assert.ok(f.bytes > f.json.length, "multibyte content makes byte length exceed char length");
});

test("resolveFrameBudget clamps to [16 KiB, 1 MiB]", () => {
  assert.equal(resolveFrameBudget({}).maxBytes, MCP_MAX_FRAME_BYTES);
  assert.equal(resolveFrameBudget({ H2A_MCP_MAX_FRAME_BYTES: "1024" }).maxBytes, 16 * 1024);
  assert.equal(resolveFrameBudget({ H2A_MCP_MAX_FRAME_BYTES: "999999999" }).maxBytes, MCP_MAX_FRAME_BYTES);
  assert.equal(resolveFrameBudget({ H2A_MCP_MAX_FRAME_BYTES: "200000" }).maxBytes, 200000);
});

test("boundResponseFrame: B-1 fits, B fits, B+1 is replaced by a bounded -32010", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-fb-"));
  try {
    const store = createPayloadStore(root);
    const budget = { maxBytes: 4096 };
    // Build a payload whose frame lands exactly on the boundary by padding.
    const mk = (padLen) => ({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "x".repeat(padLen) }] } });
    // find padLen so frame == B
    let padLen = 0;
    for (let p = 0; p < 8000; p += 1) {
      if (encodeFrame(mk(p)).bytes === budget.maxBytes) { padLen = p; break; }
    }
    assert.ok(padLen > 0, "found a payload landing exactly on B");

    const atB = boundResponseFrame(1, mk(padLen), budget, (j) => store.persistOutput(Buffer.from(j)));
    assert.ok(atB.bytes <= budget.maxBytes);
    assert.ok(!atB.json.includes("response_too_large"), "== B is emitted as-is");

    const belowB = boundResponseFrame(1, mk(padLen - 1), budget, (j) => store.persistOutput(Buffer.from(j)));
    assert.ok(belowB.bytes < budget.maxBytes);
    assert.ok(!belowB.json.includes("response_too_large"), "B-1 is emitted as-is");

    const aboveB = boundResponseFrame(1, mk(padLen + 1), budget, (j) => store.persistOutput(Buffer.from(j)));
    assert.ok(aboveB.bytes <= budget.maxBytes, "the replacement error fits the budget");
    const parsed = JSON.parse(aboveB.json);
    assert.equal(parsed.error.code, -32010);
    assert.equal(parsed.error.data.code, "response_too_large");
    assert.equal(parsed.error.data.retryOriginal, false);
    assert.ok(parsed.error.data.recovery.ref, "recovery ref points at the intact bytes");
    assert.equal(parsed.id, 1, "the id correlation is preserved");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("boundResponseFrame: a cyclic value is a bounded -32603 serialization_failed", () => {
  const budget = { maxBytes: 65536 };
  const cyclic = { jsonrpc: "2.0", id: 7, result: {} };
  cyclic.result.self = cyclic; // cycle
  const frame = boundResponseFrame(7, cyclic, budget);
  const parsed = JSON.parse(frame.json);
  assert.equal(parsed.error.code, -32603);
  assert.equal(parsed.error.data.code, "serialization_failed");
  assert.ok(frame.bytes <= budget.maxBytes);
});

test("isAcceptableRequestId: number, null, <=128-byte string accepted; huge string / object refused", () => {
  assert.equal(isAcceptableRequestId(42), true);
  assert.equal(isAcceptableRequestId(null), true);
  assert.equal(isAcceptableRequestId("x".repeat(128)), true);
  assert.equal(isAcceptableRequestId("x".repeat(129)), false);
  assert.equal(isAcceptableRequestId({}), false);
  assert.equal(isAcceptableRequestId([1]), false);
  assert.equal(isAcceptableRequestId(Number.POSITIVE_INFINITY), false);
  assert.equal(buildInvalidRequestId().id, null);
  assert.equal(buildInvalidRequestId().error.code, -32600);
});

test("boundNotificationFrame: oversize with persistence → overflow notice, accepted; without → recovery_unavailable, not accepted", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-fbn-"));
  try {
    const store = createPayloadStore(root);
    const budget = { maxBytes: 2048 };
    const big = { jsonrpc: "2.0", method: "notifications/h2a", params: { topic: "t", blob: "z".repeat(4096) } };

    const ok = boundNotificationFrame(big, { method: "notifications/h2a", topic: "t" }, budget, (j) => store.persistOutput(Buffer.from(j)));
    assert.equal(ok.accepted, true);
    const okp = JSON.parse(ok.frame.json);
    assert.equal(okp.method, "notifications/h2a/overflow");
    assert.equal(okp.params.code, "notification_too_large");
    assert.ok(okp.params.recovery.ref);
    assert.ok(ok.frame.bytes <= budget.maxBytes);

    const noStore = boundNotificationFrame(big, { method: "notifications/h2a", topic: "t" }, budget, () => undefined);
    assert.equal(noStore.accepted, false, "no persistence means the source event is NOT acknowledged");
    const np = JSON.parse(noStore.frame.json);
    assert.equal(np.params.code, "recovery_unavailable");
    assert.equal(np.params.delivered, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("transport: a too-big request id is refused (-32600 id:null) and the connection survives", { skip: !SEED }, async (t) => {
  const root = copySeed(SEED);
  const mcp = spawnMcp({ root });
  t.after(() => stopChildren(mcp));
  await callRpc(mcp, { jsonrpc: "2.0", id: "i", method: "initialize", params: {} });
  notify(mcp, { jsonrpc: "2.0", method: "notifications/initialized" });

  // A 4 KB id string cannot be correlated within budget → -32600 with id:null.
  const hugeId = "z".repeat(4096);
  const refused = await callRpc(
    mcp,
    { jsonrpc: "2.0", id: hugeId, method: "tools/list", params: {} },
    { timeoutMs: 15000 }
  ).catch((e) => ({ error: e }));
  // The reply carries id:null, so callRpc (which matches on the sent id) times
  // out; assert the id:null error landed as a notification-shaped frame instead.
  const nullIdErr = mcp._notifications.find(
    (n) => n.message && n.message.id === null && n.message.error && n.message.error.code === -32600
  );
  assert.ok(nullIdErr, "a -32600 with id:null was emitted for the oversize id");

  // The SAME connection still serves a normal request.
  const ok = await callRpc(mcp, { jsonrpc: "2.0", id: 5, method: "tools/list", params: {} }, { timeoutMs: 15000 });
  assert.ok(Array.isArray(ok.message.result.tools), "the connection survived and serves tools/list");
  assert.ok(ok.bytes <= MCP_MAX_FRAME_BYTES);
});
