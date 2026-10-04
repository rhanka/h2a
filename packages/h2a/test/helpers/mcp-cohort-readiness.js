import assert from "node:assert/strict";

import { callTool, parseToolJson, readIdentityStatus } from "./mcp-fix-lab.js";

/**
 * Drive the documented on-demand recovery after a contention fixture releases
 * its lock. Status reads alone never retry. Each connection gets at most ONE
 * new attempt, only for identity_timeout; permanent or repeated failures fail
 * the test. Callers set the lab-only retry interval to zero, leaving the real
 * 20 s attempt deadline and the cohort's existing overall budget untouched.
 */
export async function resolveCohortAfterRelease(handles, { timeoutMs = 40_000, pollMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return Promise.all(handles.map(async (h) => {
    let retried = false;
    const rpcBudget = () => {
      const remaining = deadline - Date.now();
      assert.ok(remaining > 0, `cohort did not reach identity_ready within ${timeoutMs}ms (pid ${h.pid})`);
      return { timeoutMs: remaining };
    };
    for (;;) {
      const status = await readIdentityStatus(h, rpcBudget());
      assert.ok(status, `missing identity status (pid ${h.pid})`);
      if (status.state === "identity_ready") return status;
      if (status.state === "identity_failed") {
        assert.equal(status.cause, "identity_timeout", JSON.stringify(status));
        assert.equal(status.retryable, true, JSON.stringify(status));
        assert.equal(retried, false, `second identity attempt failed: ${JSON.stringify(status)}`);
        retried = true;
        // The guard runs before the send handler: the call MUST return pending,
        // so it starts recovery without sending any message or opening a session.
        const retry = parseToolJson(await callTool(h, "h2a_send", {}, rpcBudget()));
        assert.equal(retry?.error, "identity_pending", JSON.stringify(retry));
        const next = await readIdentityStatus(h, rpcBudget());
        assert.ok(next?.state === "identity_pending" || next?.state === "identity_ready", JSON.stringify(next));
        assert.notEqual(next.attemptId, status.attemptId, "recovery must start a fresh attempt");
      } else {
        assert.equal(status.state, "identity_pending", JSON.stringify(status));
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, rpcBudget().timeoutMs)));
    }
  }));
}
