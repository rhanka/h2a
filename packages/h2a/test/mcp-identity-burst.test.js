/**
 * L2 T4 — N-way connection burst over the REAL binary.
 *
 * Natural cohorts (no contention) are GREEN on BOTH main and the candidate — kept
 * as green→green regressions. They observe resolution via the on-disk bindings
 * (a signal both write), NOT via `h2a_identity_status` (a candidate-only tool), so
 * the green→green claim is honest across versions: distinct conversations get
 * distinct identities; one conversation collapses to a single binding.
 *
 * The holder cohort holds the registry lock LIVE, so main blocks before ANY
 * handshake (RED: initialize never returns) while the candidate answers every
 * initialize <2s and every identity resolves after the lock is released (GREEN).
 *
 * `H2A_MCP_TEST_N` sets the cohort size (default 36). A start barrier launches all
 * processes on ONE shared private copy of the mandatory seed.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { callRpc, copySeed, spawnMcp, startLiveHolder, stopChildren } from "./helpers/mcp-fix-lab.js";

const SEED = process.env.H2A_MCP_TEST_SEED;
if (process.env.H2A_MCP_REQUIRE_REAL_SEED === "1" && !SEED) {
  throw new Error(
    "H2A_MCP_REQUIRE_REAL_SEED=1 but H2A_MCP_TEST_SEED is unset — the real seed is mandatory (no reduced fixture)."
  );
}
const maybe = SEED ? test : test.skip;
const N = Math.max(1, Number.parseInt(process.env.H2A_MCP_TEST_N ?? "36", 10) || 36);
// Mirrors MCP_IDENTITY_TIMEOUT_MS (identity-state.ts) as a LOCAL literal (the L2
// export is absent on main@4be46caf; importing it would turn the RED into an import
// error). The holder-cohort latency bound is a FRACTION of this deadline so a
// lock-blocked initialize (~20s / server death) fails while CI scheduler jitter
// under full-suite parallelism does not; the jitter-immune proof is "no binding
// while the lock is held".
const IDENTITY_DEADLINE_MS = 20_000;

function readBindings(root) {
  const file = join(root, "identity", "bindings.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
}

/** Bindings created by THIS test (its conversation-id prefix), isolated from the seed. */
function bindingsWithPrefix(root, prefix) {
  return readBindings(root).filter((b) => typeof b.providerSessionId === "string" && b.providerSessionId.startsWith(prefix));
}

async function initAll(handles, timeoutMs) {
  const t0 = Date.now();
  const latencies = await Promise.all(
    handles.map((h) =>
      callRpc(h, { jsonrpc: "2.0", id: 1, method: "initialize" }, { timeoutMs }).then(() => Date.now() - t0)
    )
  );
  return { latencies, max: Math.max(...latencies) };
}

/** Poll the bindings file (a version-neutral readiness signal) until `predicate`. */
async function waitForBindings(root, prefix, predicate, { timeoutMs = 40_000, pollMs = 400 } = {}) {
  const start = Date.now();
  let last = bindingsWithPrefix(root, prefix);
  while (Date.now() - start < timeoutMs) {
    last = bindingsWithPrefix(root, prefix);
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return last;
}

maybe(
  `T4 ${N} distinct conversations resolve to distinct identities (green→green)`,
  { timeout: 90_000 },
  async () => {
    const root = copySeed(SEED);
    const prefix = "t4-distinct-";
    const handles = Array.from({ length: N }, (_, i) =>
      spawnMcp({ root, args: ["--auto-open", "--host", "claude"], env: { CLAUDE_CODE_SESSION_ID: `${prefix}${i}` } })
    );
    try {
      const { max } = await initAll(handles, 20_000);
      assert.ok(max < 30_000, `no connection latency may reach the client's 30s window (max ${max}ms)`);
      const mine = await waitForBindings(root, prefix, (b) => b.length >= N);
      assert.equal(mine.length, N, `all ${N} distinct conversations produce a binding`);
      const instances = new Set(mine.map((b) => b.instance));
      assert.equal(instances.size, N, "distinct conversations get distinct identities (no duplicate)");
    } finally {
      await Promise.all(
        handles.map((h) => {
          h.child.stdin.end();
          return stopChildren(h);
        })
      );
    }
  }
);

// RED on main: its binding-before-keys publish window means a concurrent
// connector cannot prove possession of the just-created binding and MINTS a
// duplicate — main produces one binding PER connection (36 for 36). GREEN on the
// candidate: keyring is published before the binding, so proof-of-possession
// reclaims and exactly ONE binding exists.
maybe(
  `T4 ${N} connections on ONE conversation → one identity, exactly one binding (window closure)`,
  { timeout: 90_000 },
  async () => {
    const root = copySeed(SEED);
    const CONV = "t4-shared-conversation";
    const handles = Array.from({ length: N }, () =>
      spawnMcp({ root, args: ["--auto-open", "--host", "claude"], env: { CLAUDE_CODE_SESSION_ID: CONV } })
    );
    try {
      await initAll(handles, 20_000);
      // Give the burst time to converge, then assert EXACTLY one binding.
      const mine = await waitForBindings(root, CONV, (b) => b.length >= 1, { timeoutMs: 30_000 });
      // Small settle window so a would-be duplicate would have appeared.
      await new Promise((r) => setTimeout(r, 1_500));
      const settled = bindingsWithPrefix(root, CONV);
      assert.equal(settled.length, 1, "exactly one binding for the shared conversation (no duplicate)");
      assert.equal(new Set(settled.map((b) => b.instance)).size, 1, "one perennial identity");
      assert.ok(mine.length >= 1);
    } finally {
      await Promise.all(
        handles.map((h) => {
          h.child.stdin.end();
          return stopChildren(h);
        })
      );
    }
  }
);

maybe(
  `T4 holder: ${N} connect while the registry lock is held, then all resolve after release`,
  { timeout: 90_000 },
  async () => {
    const root = copySeed(SEED);
    const prefix = "t4-holder-";
    const holder = startLiveHolder({ root, lock: "registry" });
    await holder.ready;
    const handles = Array.from({ length: N }, (_, i) =>
      spawnMcp({ root, args: ["--auto-open", "--host", "claude"], env: { CLAUDE_CODE_SESSION_ID: `${prefix}${i}` } })
    );
    try {
      // Every initialize must answer while the lock is HELD. RED on main: it
      // blocks in identity resolution and never returns (the server closes).
      // DECOUPLING bound: a FRACTION of the identity deadline, not a tight
      // wall-clock — a lock-blocked initialize would scale to ~20s (or die). Half
      // the deadline discriminates that and absorbs CI parallel-load jitter.
      const { max } = await initAll(handles, 18_000);
      assert.ok(
        max < IDENTITY_DEADLINE_MS / 2,
        `initialize must answer well before the identity deadline while contended (max ${max}ms, bound ${IDENTITY_DEADLINE_MS / 2}ms)`
      );
      // Jitter-IMMUNE proof: the registry lock has NOT been released yet, so no
      // binding can exist — a decoupled transport wrote none while contended.
      assert.equal(bindingsWithPrefix(root, prefix).length, 0, "no binding while contended");
      // Release only AFTER the decoupling proof — no race with the check above.
      await holder.stop();
      const mine = await waitForBindings(root, prefix, (b) => b.length >= N, { timeoutMs: 40_000 });
      assert.equal(mine.length, N, `all ${N} resolve after release`);
      assert.equal(new Set(mine.map((b) => b.instance)).size, N, "distinct identities, no collision");
    } finally {
      holder.stop();
      await Promise.all(
        handles.map((h) => {
          h.child.stdin.end();
          return stopChildren(h);
        })
      );
    }
  }
);
