/**
 * L2 startup contention — REAL processes against a LIVE lock held to its timeout,
 * then a controlled release.
 *
 * Holds the registry lock LIVE past main's ~5 s lock timeout, launches a mix of
 * same-conversation and distinct-conversation connections, and asserts the
 * candidate contract under contention:
 *   - every `initialize` returns while the lock is contended (no block scaled to
 *     the client's 30 s window);
 *   - after a controlled release, EVERY identity resolves;
 *   - the same-conversation cohort collapses to ONE identity + ONE binding (no
 *     duplicate through the publish-order window);
 *   - the distinct cohort gets distinct identities.
 *
 * RED on main (4be46caf, no L2): contended startup blocks in identity resolution
 * before any handshake, so no `initialize` returns and the servers die with
 * LockTimeoutError.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  callRpc,
  copySeed,
  readIdentityStatus,
  spawnMcp,
  startLiveHolder,
  stopChildren,
  waitForIdentity
} from "./helpers/mcp-fix-lab.js";

const SEED = process.env.H2A_MCP_TEST_SEED;
if (process.env.H2A_MCP_REQUIRE_REAL_SEED === "1" && !SEED) {
  throw new Error(
    "H2A_MCP_REQUIRE_REAL_SEED=1 but H2A_MCP_TEST_SEED is unset — the real seed is mandatory (no reduced fixture)."
  );
}
const maybe = SEED ? test : test.skip;

// Mirrors MCP_IDENTITY_TIMEOUT_MS (identity-state.ts). Kept as a LOCAL literal on
// purpose: importing the L2-only export would make this file fail to load on
// main@4be46caf (an import error, not the intended behavioral RED). The decoupling
// bound below is a FRACTION of this deadline, so a lock-BLOCKED initialize (~20s /
// server death) still fails while scheduler jitter under CI parallel load does not.
const IDENTITY_DEADLINE_MS = 20_000;

function bindingsFor(root, providerSessionId) {
  const file = join(root, "identity", "bindings.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return undefined;
      }
    })
    .filter((b) => b && b.providerSessionId === providerSessionId);
}

maybe(
  "startup contention: initialize returns while the lock is held; all resolve after a controlled release; no duplicate binding",
  { timeout: 90_000 },
  async () => {
    const root = copySeed(SEED);
    const SAME = "contention-shared-conversation";
    const sameCount = 6;
    const distinctCount = 6;

    // Hold the registry lock LIVE (main mints → registry lock → block).
    const holder = startLiveHolder({ root, lock: "registry" });
    await holder.ready;

    // Spawn with a small stagger so the per-process identity worker forks do not
    // arrive as one spike — under a heavily loaded CI a simultaneous fork storm
    // can hit EAGAIN (a machine-saturation artifact, not a product fault). The
    // stagger flattens the spike without weakening any invariant: all processes
    // still contend on the held lock and must still resolve after release.
    const spawnConv = (conv) =>
      spawnMcp({ root, args: ["--auto-open", "--host", "claude"], env: { CLAUDE_CODE_SESSION_ID: conv } });
    const sameHandles = [];
    const distinctHandles = [];
    for (let i = 0; i < sameCount; i++) {
      sameHandles.push(spawnConv(SAME));
      await new Promise((r) => setTimeout(r, 40));
    }
    for (let i = 0; i < distinctCount; i++) {
      distinctHandles.push(spawnConv(`contention-distinct-${i}`));
      await new Promise((r) => setTimeout(r, 40));
    }
    const all = [...sameHandles, ...distinctHandles];
    try {
      // Every initialize must return WHILE the lock is held. The bound is a
      // FRACTION of the identity deadline, not a tight wall-clock: the invariant
      // is that the transport is DECOUPLED from the shared-identity section — a
      // lock-blocked initialize would scale to the ~20 s deadline (or the server
      // would die, as main does), so half the deadline discriminates that cleanly
      // while absorbing CI scheduler jitter under full-suite parallelism. The
      // decoupling is then PROVEN structurally (jitter-immune) by the pending
      // check below, which reads status while the lock is still provably held.
      const t0 = Date.now();
      const latencies = await Promise.all(
        all.map((h) =>
          callRpc(h, { jsonrpc: "2.0", id: 1, method: "initialize" }, { timeoutMs: 18_000 }).then(
            () => Date.now() - t0
          )
        )
      );
      const maxInit = Math.max(...latencies);
      assert.ok(
        maxInit < IDENTITY_DEADLINE_MS / 2,
        `initialize must return well before the identity deadline while contended (max ${maxInit}ms, bound ${IDENTITY_DEADLINE_MS / 2}ms)`
      );

      // Structural, jitter-IMMUNE decoupling proof: the lock has NOT been released
      // yet (the release is the next step), so identity CANNOT have resolved — the
      // product invariant forces `identity_pending`. It does not matter whether the
      // initialize round-trip above took 200 ms or 3 s under load; what matters is
      // that initialize returned AND identity is still pending while the lock is
      // held. A regression where initialize waited on identity would have hung the
      // call above (lock held) and timed out, not reached here.
      const held = await Promise.all(all.map((h) => readIdentityStatus(h, { timeoutMs: 15_000 })));
      assert.ok(
        held.every((s) => s?.state === "identity_pending"),
        "every connection is up but identity is still pending while the lock is held (transport decoupled from identity)"
      );

      // Controlled release — only AFTER the decoupling proof, so there is no race
      // between the release and the pending read above.
      await holder.stop();

      const finals = await Promise.all(
        all.map((h) =>
          waitForIdentity(h, (s) => s.state === "identity_ready" || s.state === "identity_failed", {
            timeoutMs: 40_000,
            pollMs: 400
          })
        )
      );
      const ready = finals.filter((s) => s?.state === "identity_ready");
      assert.equal(ready.length, all.length, "every identity resolves after release");

      // Same conversation → ONE identity + ONE binding (no duplicate).
      const sameReady = ready.slice(0, sameCount).length
        ? finals.slice(0, sameCount).filter((s) => s?.state === "identity_ready")
        : [];
      const sameInstances = new Set(sameReady.map((s) => s.instance));
      assert.equal(sameInstances.size, 1, "same conversation collapses to one identity");
      assert.equal(bindingsFor(root, SAME).length, 1, "exactly one binding for the shared conversation");

      // Distinct conversations → distinct identities.
      const distinctReady = finals.slice(sameCount).filter((s) => s?.state === "identity_ready");
      const distinctInstances = new Set(distinctReady.map((s) => s.instance));
      assert.equal(distinctInstances.size, distinctCount, "distinct conversations get distinct identities");
    } finally {
      holder.stop();
      await Promise.all(
        all.map((h) => {
          h.child.stdin.end();
          return stopChildren(h);
        })
      );
    }
  }
);
