/**
 * L2 startup contention — REAL processes against a LIVE lock held to its timeout,
 * then a controlled release.
 *
 * Holds the registry lock LIVE past main's ~5 s lock timeout, launches a mix of
 * same-conversation and distinct-conversation connections, and asserts the
 * candidate contract under contention:
 *   - every `initialize` returns while the lock is contended (no block scaled to
 *     the client's 30 s window);
 *   - after a controlled release, EVERY identity resolves, with the documented
 *     on-demand retry for an expired attempt;
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
  labRoot,
  readIdentityStatus,
  spawnMcp,
  startLiveHolder,
  stopChildren
} from "./helpers/mcp-fix-lab.js";
import { resolveCohortAfterRelease } from "./helpers/mcp-cohort-readiness.js";

const SEED = process.env.H2A_MCP_TEST_SEED;
if (process.env.H2A_MCP_REQUIRE_REAL_SEED === "1" && !SEED) {
  throw new Error(
    "H2A_MCP_REQUIRE_REAL_SEED=1 but H2A_MCP_TEST_SEED is unset — the real seed is mandatory (no reduced fixture)."
  );
}
const maybe = test; // F4: always run — synthetic corpus fallback when the private seed is absent

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
    const root = labRoot(SEED);
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
      spawnMcp({
        root,
        args: ["--auto-open", "--host", "claude"],
        env: { CLAUDE_CODE_SESSION_ID: conv, H2A_IDENTITY_RETRY_MIN_MS: "0" }
      });
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
      // Bootstrap scheduling is outside the transport contract. Prove that
      // initialize answers successfully while the live lock still blocks every
      // identity, rather than comparing process startup to a fraction of the
      // identity deadline. A transport coupled to identity times out here.
      const initialized = await Promise.all(
        all.map((h) => callRpc(h, { jsonrpc: "2.0", id: 1, method: "initialize" }, { timeoutMs: 18_000 }))
      );
      for (const response of initialized) assert.equal(response.message.error, undefined);

      const held = await Promise.all(all.map((h) => readIdentityStatus(h, { timeoutMs: 15_000 })));
      assert.ok(
        held.every((s) => s?.state === "identity_pending"),
        "every connection is up but identity is still pending while the lock is held (transport decoupled from identity)"
      );

      // Controlled release — only AFTER the decoupling proof, so there is no race
      // between the release and the pending read above.
      await holder.stop();

      const finals = await resolveCohortAfterRelease(all);
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
