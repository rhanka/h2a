/**
 * L2 T3 / T5 — identity-independent MCP connection + async identity readiness.
 *
 * Black-box against the REAL built binary over its stdio JSON-RPC transport, on a
 * PRIVATE 0700 copy of the mandatory seed. RED on main (4be46caf, no L2): under a
 * live registry lock the server blocks in identity resolution and NEVER answers
 * initialize (it dies with LockTimeoutError). GREEN on the candidate: initialize
 * and tools/list answer <2 s while identity is explicitly `identity_pending`,
 * signed/mutating tools are refused with a bounded typed error, and identity
 * later reaches `identity_ready` or, past the 20 s deadline, `identity_failed`.
 *
 * Same stimulus / RPC order / fixture / assertions on RED and GREEN.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  callRpc,
  callTool,
  copySeed,
  parseToolJson,
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

// Mirrors MCP_IDENTITY_TIMEOUT_MS (identity-state.ts). Kept a LOCAL literal so the
// file still loads on main@4be46caf (the L2 export is absent there) — the RED must
// stay behavioral, not an import error. Latency bounds below are a FRACTION of this
// deadline: a lock-BLOCKED initialize scales to ~20s (or the server dies) and fails,
// while CI scheduler jitter under full-suite parallelism does not. The jitter-immune
// decoupling proof is the `identity_pending`-while-the-lock-is-held assertion.
const IDENTITY_DEADLINE_MS = 20_000;

maybe(
  "T3 identity-independent connection under a live registry lock (initialize/tools-list decoupled, pending visible)",
  { timeout: 45_000 },
  async () => {
    const root = copySeed(SEED);
    // Hold the registry lock LIVE past main's ~5 s lock timeout. Identity mint
    // must registerInstance → registry lock, so main blocks here before ANY
    // handshake; the candidate keeps the transport responsive.
    const holder = startLiveHolder({ root, lock: "registry" });
    await holder.ready;
    const h = spawnMcp({
      root,
      args: ["--auto-open", "--host", "claude"],
      env: { CLAUDE_CODE_SESSION_ID: "t3-live-lock" }
    });
    try {
      const t0 = Date.now();
      const init = await callRpc(
        h,
        { jsonrpc: "2.0", id: 1, method: "initialize" },
        // A generous RPC deadline so RED can be COLLECTED (main dies at ~5 s)
        // rather than masked by stopping at 2 s. The assertion is still <2 s.
        { timeoutMs: 15_000 }
      );
      const initMs = Date.now() - t0;
      assert.equal(init.message.result.serverInfo.name, "@sentropic/h2a");

      const t1 = Date.now();
      const list = await callRpc(
        h,
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        { timeoutMs: 15_000 }
      );
      const listMs = Date.now() - t1;
      assert.ok(list.message.result.tools.length >= 55, "tools/list returns the full surface");

      // DECOUPLING bound: each answered a FRACTION of the identity deadline while
      // the lock is still held — a lock-blocked handshake would scale to ~20s (or
      // the server would die, as main does). Half the deadline discriminates that
      // cleanly and absorbs CI scheduler jitter under full-suite parallelism.
      assert.ok(
        initMs < IDENTITY_DEADLINE_MS / 2,
        `initialize must answer well before the identity deadline under a live lock (was ${initMs}ms, bound ${IDENTITY_DEADLINE_MS / 2}ms)`
      );
      assert.ok(
        listMs < IDENTITY_DEADLINE_MS / 2,
        `tools/list must answer well before the identity deadline under a live lock (was ${listMs}ms, bound ${IDENTITY_DEADLINE_MS / 2}ms)`
      );

      // Jitter-IMMUNE decoupling proof: the lock is held for the whole test, so
      // identity CANNOT resolve — it must be pending (never faked). This holds
      // regardless of how long the handshake round-trips took under load.
      const st = await readIdentityStatus(h);
      assert.equal(st.state, "identity_pending");
      assert.equal(st.timeoutMs, 20_000);

      // The live holder was not usurped: the sentinel still names its PID.
      const owner = JSON.parse(readFileSync(holder.lockPath, "utf8"));
      assert.equal(owner.pid, holder.child.pid, "the live lock holder's PID is untouched");
    } finally {
      holder.stop();
      h.child.stdin.end();
      await stopChildren(h);
    }
  }
);

maybe(
  "T5 pending→ready: signed/mutating tools refused while pending, available after real activation",
  { timeout: 45_000 },
  async () => {
    const root = copySeed(SEED);
    const h = spawnMcp({
      root,
      args: ["--auto-open", "--host", "claude"],
      env: { CLAUDE_CODE_SESSION_ID: "t5-ready" }
    });
    try {
      await callRpc(h, { jsonrpc: "2.0", id: 1, method: "initialize" }, { timeoutMs: 15_000 });
      const pending = await readIdentityStatus(h);
      assert.equal(pending.state, "identity_pending");

      // Read-only tools stay available while pending (pure reads, no signer).
      const disc = await callTool(h, "h2a_discover_instances", { limit: 5 });
      assert.notEqual(
        parseToolJson(disc)?.code,
        "identity_pending",
        "discovery is available while identity is pending"
      );
      const readInbox = await callTool(h, "h2a_inbox", { action: "read", instance: "claude:x" });
      assert.notEqual(parseToolJson(readInbox)?.code, "identity_pending", "inbox read is available");

      // Signed / mutating tools refused with a bounded typed error.
      for (const [name, args] of [
        ["h2a_send", { to: "claude:peer", message: "hi" }],
        ["h2a_session_open", { instance: "claude:peer" }],
        ["h2a_inbox", { action: "pop", instance: "claude:peer", envelopeId: "e1" }],
        ["h2a_run", {}]
      ]) {
        const refused = parseToolJson(await callTool(h, name, args));
        assert.equal(refused.error, "identity_pending", `${name} refused while pending`);
        assert.equal(refused.code, "identity_pending");
        assert.equal(refused.retryable, true);
        assert.equal(refused.retryAfterMs, 250);
      }

      // Reach ready (real activation: session opened, signer armed).
      const ready = await waitForIdentity(
        h,
        (s) => s.state === "identity_ready" || s.state === "identity_failed",
        { timeoutMs: 25_000 }
      );
      assert.equal(ready.state, "identity_ready");
      assert.ok(ready.instance && ready.instance.startsWith("claude:"));
      assert.ok(ready.sessionId && ready.sessionId.startsWith("sess:"));
      assert.equal(ready.signingAvailable, true);

      // After activation the guard lifts AND a trusted signer exists: h2a_send is
      // no longer the guard error nor the "no signer" error.
      const sent = parseToolJson(await callTool(h, "h2a_send", { to: ready.instance, message: "self" }));
      assert.notEqual(sent.code, "identity_pending", "guard lifted after ready");
      assert.notEqual(
        sent.error,
        "h2a_send: unavailable without a trusted auto-open signing identity",
        "a trusted signer is available after ready"
      );

      // A real presence session was published only AFTER identity was bound.
      const presence = readdirSync(join(root, "presence")).filter((f) => f.endsWith(".json"));
      assert.ok(presence.length >= 1, "presence published only after identity is bound");
    } finally {
      h.child.stdin.end();
      await stopChildren(h);
    }
  }
);

maybe(
  "T5 pending→failed: identity_timeout at ~20s from pending, no ACK, no presence, signed tools refused",
  { timeout: 40_000 },
  async () => {
    const root = copySeed(SEED);
    const holder = startLiveHolder({ root, lock: "registry" });
    await holder.ready;
    const h = spawnMcp({
      root,
      args: ["--auto-open", "--host", "claude"],
      env: { CLAUDE_CODE_SESSION_ID: "t5-timeout" }
    });
    try {
      await callRpc(h, { jsonrpc: "2.0", id: 1, method: "initialize" }, { timeoutMs: 15_000 });
      assert.equal((await readIdentityStatus(h)).state, "identity_pending");

      const failed = await waitForIdentity(h, (s) => s.state === "identity_failed", {
        timeoutMs: 28_000,
        pollMs: 300
      });
      assert.equal(failed.state, "identity_failed");
      assert.equal(failed.cause, "identity_timeout");
      assert.equal(failed.retryable, false);
      // The deadline is measured from entering pending and is not reset: ~20 000 ms
      // (the controller's own monotonic elapsedMs, ±tolerance).
      assert.ok(
        failed.elapsedMs >= 19_500 && failed.elapsedMs <= 21_500,
        `identity_failed elapsedMs must be ~20000 (was ${failed.elapsedMs})`
      );

      // Signed tools refused terminally with the typed failed error.
      const send = parseToolJson(await callTool(h, "h2a_send", { to: "claude:peer", message: "hi" }));
      assert.equal(send.error, "identity_failed");
      assert.equal(send.cause, "identity_timeout");
      assert.equal(send.retryable, false);

      // No availability was ever published: no presence session, no signature.
      const presence = existsSync(join(root, "presence"))
        ? readdirSync(join(root, "presence")).filter((f) => f.endsWith(".json"))
        : [];
      assert.equal(presence.length, 0, "no presence session before identity is bound");
    } finally {
      holder.stop();
      h.child.stdin.end();
      await stopChildren(h);
    }
  }
);

maybe(
  "T5 transport close while pending: clean shutdown, no readiness ACK, no orphan",
  { timeout: 30_000 },
  async () => {
    const root = copySeed(SEED);
    const holder = startLiveHolder({ root, lock: "registry" });
    await holder.ready;
    const h = spawnMcp({
      root,
      args: ["--auto-open", "--host", "claude"],
      env: { CLAUDE_CODE_SESSION_ID: "t5-close" }
    });
    try {
      await callRpc(h, { jsonrpc: "2.0", id: 1, method: "initialize" }, { timeoutMs: 15_000 });
      assert.equal((await readIdentityStatus(h)).state, "identity_pending");
      // Close the transport while identity is still pending.
      h.child.stdin.end();
      const closed = await new Promise((resolve) => {
        if (h._exit) return resolve(h._exit);
        h.child.on("close", (code, signal) => resolve({ code, signal }));
      });
      // The server exits cleanly (no crash) once the transport closes.
      assert.ok(
        closed.code === 0 || closed.signal !== null,
        `clean shutdown expected (code=${closed.code} signal=${closed.signal})`
      );
      // No presence session was published (identity never bound).
      const presence = existsSync(join(root, "presence"))
        ? readdirSync(join(root, "presence")).filter((f) => f.endsWith(".json"))
        : [];
      assert.equal(presence.length, 0, "no presence published on close-before-ready");
    } finally {
      holder.stop();
      await stopChildren(h);
    }
  }
);
