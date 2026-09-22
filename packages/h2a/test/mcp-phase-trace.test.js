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
  // F3: WAIT for identity to actually become ready before collecting the trace,
  // so `identity_ready` is genuinely present (the ordering assert is not vacuous)
  // AND the child worker's identity/lock/registry spans have all been emitted.
  let readyState;
  for (let i = 0; i < 100; i++) {
    const st = await callRpc(handle, {
      jsonrpc: "2.0",
      id: 1000 + i,
      method: "tools/call",
      params: { name: "h2a_identity_status", arguments: {} }
    });
    try {
      readyState = JSON.parse(st.message.result.content[0].text);
    } catch {
      readyState = undefined;
    }
    if (readyState && (readyState.state === "identity_ready" || readyState.state === "identity_failed")) {
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
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
  // L2: the parent traces that identity entered the async pending window AND that
  // it actually became ready (session() waits for it — so this is not vacuous).
  assert.ok(
    phases.has(IDENTITY_LIFECYCLE_SPAN),
    `missing identity lifecycle span: ${IDENTITY_LIFECYCLE_SPAN}`
  );
  assert.ok(phases.has("identity_ready"), "identity_ready must actually be emitted");
  // Identity is OFF the boot critical path: initialize is sent BEFORE identity
  // becomes ready (it never waits on the shared-identity section). Both spans are
  // present, so this ordering is a real comparison, not `< Infinity`.
  const seqOf = (p) => {
    const e = s.events.find((ev) => ev.phase === p);
    assert.ok(e, `expected span present for ordering: ${p}`);
    return e.seq;
  };
  assert.ok(
    seqOf("initialize_sent") < seqOf("identity_ready"),
    "initialize must be sent before identity becomes ready (identity is not on the boot critical path)"
  );
});

test("phase-trace: the #249 identity/lock/registry instrumentation is emitted (relocated to the child worker)", async () => {
  const s = await session();
  // The deep spans moved WITH identity resolution into the child worker; they are
  // emitted under role=identity-child (correlated to the same attemptId) and
  // forwarded to the parent's stderr — never silently dropped.
  const childPhases = new Set(s.events.filter((e) => e.role === "identity-child").map((e) => e.phase));
  for (const deep of ["identity_provider", "identity_register", "registry_read"]) {
    assert.ok(childPhases.has(deep), `missing relocated deep span: ${deep}`);
  }
  // The identity write path takes the binding lock: at least one lock event.
  assert.ok(
    s.events.some(
      (e) =>
        e.role === "identity-child" &&
        (/_lock_(wait|acquired|released)$/.test(e.phase) || e.phase.startsWith("lock_"))
    ),
    "no binding/registry lock span on the identity write path"
  );
  // Correlation preserved: the child spans share the parent's attemptId.
  const serverAttempt = s.events.find((e) => e.role === "server")?.attemptId;
  const childAttempt = s.events.find((e) => e.role === "identity-child")?.attemptId;
  assert.ok(serverAttempt && childAttempt, "both roles emitted spans");
  assert.equal(childAttempt, serverAttempt, "child spans correlate to the parent attemptId");
});

test("phase-trace: events are well-formed and correlated by attemptId (+ role/pid)", async () => {
  const s = await session();
  const attempts = new Set();
  const serverPids = new Set();
  for (const e of s.events) {
    assert.equal(e.v, 1, "event schema version must be 1");
    assert.ok(
      e.role === "server" || e.role === "identity-child",
      `unexpected role: ${e.role}`
    );
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
    if (e.role === "server") serverPids.add(e.pid);
  }
  // ONE attemptId correlates the server boot spans AND the relocated child spans.
  assert.equal(attempts.size, 1, "all events (server + identity-child) share ONE attemptId");
  // The server-role boot spans all come from the mcp-serve child process.
  assert.equal(serverPids.size, 1, "all server-role events share ONE pid");
  assert.equal([...serverPids][0], s.childPid, "the server-role traced pid is the mcp-serve child pid");
});

test("phase-trace: serverInfo.version is the real package version, not a frozen literal", async () => {
  const s = await session();
  // SAME assertion on red and green: main reports "0.1.1" ≠ currentCliVersion().
  assert.equal(s.initVersion, currentCliVersion());
});

test("phase-trace: seq and monotonicMs are non-decreasing in emit order (per role)", async () => {
  const s = await session();
  // seq/monotonicMs are per-TRACE counters. The server and the identity-child are
  // distinct processes with independent counters, so monotonicity is asserted
  // WITHIN each role, not across the interleaved merge.
  for (const role of ["server", "identity-child"]) {
    const roleEvents = s.events.filter((e) => e.role === role);
    for (let i = 1; i < roleEvents.length; i++) {
      assert.ok(roleEvents[i].seq > roleEvents[i - 1].seq, `${role}: seq must strictly increase`);
      assert.ok(
        roleEvents[i].monotonicMs >= roleEvents[i - 1].monotonicMs,
        `${role}: monotonicMs must not go backwards`
      );
    }
  }
  // Lifecycle ordering within the server boot trace: process start precedes
  // transport, which precedes the first emitted response.
  const server = s.events.filter((e) => e.role === "server");
  // Presence-asserting (matches the identity-ordering seqOf above): a missing
  // span throws here instead of passing vacuously via `< Infinity`.
  const seqOf = (phase) => {
    const e = server.find((ev) => ev.phase === phase);
    assert.ok(e, `expected server span present for ordering: ${phase}`);
    return e.seq;
  };
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
