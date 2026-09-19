/**
 * L0 behavioral phase-trace contract (RED on un-instrumented main, GREEN on the
 * candidate — SAME stimuli, SAME assertions, no version branching).
 *
 * This suite drives the REAL built binary over its stdio JSON-RPC transport and
 * observes the `h2a.mcp.phase ...` JSONL spans on STDERR. It imports NO new
 * module, so on main it does not fail an import — it fails because main emits no
 * correlated spans and reports a frozen `serverInfo.version`. That absence IS
 * the reproduction; it is not a skip, a zero-selected run, or a bare nonzero.
 *
 * It generates its own tiny synthetic corpus (a fresh empty root + one minted
 * identity), so it runs in public CI without the mandatory measurement seed.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { currentCliVersion } from "../dist/index.js";
import {
  spawnMcp,
  callRpc,
  collectFrames,
  stopChildren
} from "./helpers/mcp-fix-lab.js";

const MILESTONES = [
  "process_start",
  "mcp_serve_enter",
  "transport_enter",
  "initialize_recv",
  "initialize_sent",
  "tools_list_sent",
  "tool_first_sent"
];

// L2: identity resolution moved OFF the parent's synchronous boot path into a
// dedicated child worker, so the parent now traces the identity LIFECYCLE
// (pending → ready/failed) instead of the deep provider/register/registry/lock
// spans — those run in the child, off the MCP event loop (the #249 fix). On
// un-instrumented main NO span is emitted at all, so the lifecycle span is
// absent there too → the L0 RED/GREEN contract is preserved.
const IDENTITY_LIFECYCLE_SPAN = "identity_pending";

let cached;
const roots = [];

async function session() {
  if (cached) return cached;
  const root = mkdtempSync(join(tmpdir(), "h2a-phase-trace-"));
  roots.push(root);
  // `--auto-open` exercises the full identity resolution (provider → mint →
  // keypair → register → alias) so the deep spans + a real keypair generation
  // are on the path — the keypair must NEVER surface in an event (confidentiality).
  const handle = spawnMcp({ root, trace: true, args: ["--auto-open", "--host", "agent"] });
  const raws = [];
  const ini = await callRpc(handle, { jsonrpc: "2.0", id: 1, method: "initialize" });
  raws.push(ini.raw);
  const tl = await callRpc(handle, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  raws.push(tl.raw);
  const tc = await callRpc(handle, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "h2a_discover_instances", arguments: {} }
  });
  raws.push(tc.raw);
  await stopChildren(handle);
  const events = collectFrames(handle);
  cached = {
    handle,
    events,
    raws,
    notifications: handle._notifications,
    initVersion: ini.message.result?.serverInfo?.version,
    initBytes: ini.bytes,
    listBytes: tl.bytes,
    toolBytes: tc.bytes,
    childPid: handle.pid
  };
  return cached;
}

after(() => {
  for (const r of roots) {
    try {
      rmSync(r, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

test("phase-trace: emits the lifecycle milestone spans (absent on main → RED)", async () => {
  const s = await session();
  assert.ok(s.events.length > 0, "no h2a.mcp.phase spans on stderr (main emits none)");
  const phases = new Set(s.events.map((e) => e.phase));
  for (const m of MILESTONES) {
    assert.ok(phases.has(m), `missing milestone span: ${m}`);
  }
});

test("phase-trace: emits the async identity lifecycle span, deferred off the boot path", async () => {
  const s = await session();
  const phases = new Set(s.events.map((e) => e.phase));
  // L2: the parent traces that identity entered the async pending window.
  assert.ok(
    phases.has(IDENTITY_LIFECYCLE_SPAN),
    `missing identity lifecycle span: ${IDENTITY_LIFECYCLE_SPAN}`
  );
  // Identity is OFF the boot critical path: initialize is sent before identity
  // could ever become ready (it never waits on the shared-identity section).
  const seqOf = (p) => s.events.find((e) => e.phase === p)?.seq ?? Infinity;
  assert.ok(
    seqOf("initialize_sent") < seqOf("identity_ready"),
    "initialize must be sent before identity becomes ready (identity is not on the boot critical path)"
  );
});

test("phase-trace: events are well-formed and correlated by attemptId + pid", async () => {
  const s = await session();
  const attempts = new Set();
  const pids = new Set();
  for (const e of s.events) {
    assert.equal(e.v, 1, "event schema version must be 1");
    assert.equal(e.role, "server", "boot events are role=server");
    assert.match(
      String(e.attemptId),
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      "attemptId must be a locally minted UUID"
    );
    assert.equal(typeof e.pid, "number");
    assert.equal(typeof e.seq, "number");
    assert.equal(typeof e.monotonicMs, "number");
    assert.ok(["begin", "end", "error", "sample"].includes(e.event), `bad event kind: ${e.event}`);
    attempts.add(e.attemptId);
    pids.add(e.pid);
  }
  assert.equal(attempts.size, 1, "all events share ONE attemptId");
  assert.equal(pids.size, 1, "all events share ONE pid");
  assert.equal([...pids][0], s.childPid, "the traced pid is the server child pid");
});

test("phase-trace: serverInfo.version is the real package version, not a frozen literal", async () => {
  const s = await session();
  // SAME assertion on red and green: main reports "0.1.1" ≠ currentCliVersion().
  assert.equal(s.initVersion, currentCliVersion());
});

test("phase-trace: seq and monotonicMs are non-decreasing in emit order", async () => {
  const s = await session();
  for (let i = 1; i < s.events.length; i++) {
    assert.ok(s.events[i].seq > s.events[i - 1].seq, "seq must strictly increase");
    assert.ok(
      s.events[i].monotonicMs >= s.events[i - 1].monotonicMs,
      "monotonicMs must not go backwards"
    );
  }
  // Lifecycle ordering: process start precedes transport, which precedes the
  // first emitted response.
  const seqOf = (phase) => s.events.find((e) => e.phase === phase)?.seq ?? Infinity;
  assert.ok(seqOf("process_start") < seqOf("transport_enter"), "process_start before transport_enter");
  assert.ok(seqOf("transport_enter") < seqOf("initialize_sent"), "transport_enter before initialize_sent");
  assert.ok(seqOf("initialize_sent") < seqOf("tools_list_sent"), "initialize before tools/list");
});

test("phase-trace: final wire byte sizes are attached to initialize/tools-list/first-tool", async () => {
  const s = await session();
  const sent = (phase) => s.events.find((e) => e.phase === phase);
  const init = sent("initialize_sent");
  const list = sent("tools_list_sent");
  const tool = sent("tool_first_sent");
  assert.ok(init && init.bytes > 0 && init.requestId === 1, "initialize_sent carries bytes + requestId");
  assert.ok(list && list.bytes > 0 && list.requestId === 2, "tools_list_sent carries bytes + requestId");
  assert.ok(tool && tool.bytes > 0 && tool.requestId === 3, "tool_first_sent carries bytes + requestId");
  assert.equal(tool.tool, "h2a_discover_instances", "first tool span names the tool");
  // The trace's measured bytes match the response line the client actually read.
  assert.equal(init.bytes, s.initBytes, "traced initialize bytes == observed wire bytes");
  assert.equal(list.bytes, s.listBytes, "traced tools/list bytes == observed wire bytes");
  assert.equal(tool.bytes, s.toolBytes, "traced tool bytes == observed wire bytes");
});

test("phase-trace: no secret material leaks into any event", async () => {
  const s = await session();
  const forbidden = [/PRIVATE KEY/i, /BEGIN [A-Z ]*KEY/i, /-----BEGIN/, /"privateKey/i];
  for (const e of s.events) {
    const line = JSON.stringify(e);
    for (const re of forbidden) {
      assert.ok(!re.test(line), `event leaked secret-shaped text (${re}): ${line.slice(0, 120)}`);
    }
    // Closed field set: no unexpected keys carrying free content.
    const allowed = new Set([
      "v", "attemptId", "pid", "role", "seq", "monotonicMs", "phase", "event",
      "durationMs", "requestId", "method", "tool", "bytes", "waitMs", "holdMs", "code"
    ]);
    for (const k of Object.keys(e)) {
      assert.ok(allowed.has(k), `event carries a non-whitelisted field: ${k}`);
    }
  }
});

test("phase-trace: stdout carries ONLY JSON-RPC frames (trace stays on stderr)", async () => {
  const s = await session();
  // Every response the client read parsed as JSON-RPC (callRpc would have
  // thrown otherwise); assert none of them, nor any interleaved notification,
  // carried the stderr trace prefix onto stdout.
  for (const raw of s.raws) {
    assert.doesNotMatch(String(raw), /h2a\.mcp\.phase /, "trace prefix leaked onto stdout");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.jsonrpc, "2.0", "stdout frame is JSON-RPC 2.0");
  }
  for (const n of s.notifications) {
    assert.ok(!n.parseError, "a non-JSON line reached stdout");
  }
});
