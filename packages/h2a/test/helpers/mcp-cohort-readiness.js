import assert from "node:assert/strict";

import { callTool, parseToolJson, readIdentityStatus } from "./mcp-fix-lab.js";

/**
 * Drive the documented on-demand recovery after a contention fixture releases
 * its lock. Status reads can now retry; the signed call below also supports
 * historical binaries where only guarded tools retry. Permanent failures fail
 * immediately; repeated timeouts fail unless the cohort made forward progress
 * (strictly more ready connections) within the bounded overall budget. Polling
 * runs with bounded concurrency so recovering an expired 36-connection cohort
 * does not trigger a second 36-worker fork storm on constrained runners.
 */
export async function resolveCohortAfterRelease(
  handles,
  { timeoutMs = 60_000, pollMs = 250, concurrency = 6, maxRetries = 3, progressCount } = {}
) {
  const deadline = Date.now() + timeoutMs;
  const results = new Array(handles.length);
  let nextIdx = 0;
  let readyCount = 0;
  const observedProgress = () => Math.max(readyCount, progressCount ? progressCount() : 0);

  async function resolveOne(h) {
    let retries = 0;
    let lastFailedAtProgress = -1;
    const rpcBudget = () => {
      const remaining = deadline - Date.now();
      assert.ok(
        remaining > 0,
        `cohort did not reach identity_ready within ${timeoutMs}ms (pid ${h.pid}, ready ${readyCount}/${handles.length})`
      );
      return { timeoutMs: remaining };
    };
    for (;;) {
      const status = await readIdentityStatus(h, rpcBudget());
      assert.ok(status, `missing identity status (pid ${h.pid})`);
      if (status.state === "identity_ready") {
        readyCount += 1;
        return status;
      }
      if (status.state === "identity_failed") {
        assert.equal(status.cause, "identity_timeout", JSON.stringify(status));
        assert.equal(status.retryable, true, JSON.stringify(status));
        const currentProgress = observedProgress();
        if (retries > 0) {
          assert.ok(
            retries < maxRetries && currentProgress > lastFailedAtProgress,
            `second identity attempt failed: ${JSON.stringify(status)}`
          );
        }
        lastFailedAtProgress = currentProgress;
        retries += 1;
        // On current binaries, `h2a_identity_status` already kicks a fresh
        // attempt while returning the first-failure snapshot for registry/.lock
        // timeouts. Re-read status first so a fast recovery to `identity_ready`
        // cannot race a redundant `h2a_send` call; fall back to `h2a_send` only
        // for historical binaries where status reads do not trigger retry.
        let next = await readIdentityStatus(h, rpcBudget());
        if (next?.state === "identity_failed" && next.attemptId === status.attemptId) {
          // The guard runs before the send handler: the call MUST return pending,
          // so it starts recovery without sending any message or opening a session.
          const retry = parseToolJson(await callTool(h, "h2a_send", {}, rpcBudget()));
          assert.equal(retry?.error, "identity_pending", JSON.stringify(retry));
          next = await readIdentityStatus(h, rpcBudget());
        }
        assert.ok(next?.state === "identity_pending" || next?.state === "identity_ready", JSON.stringify(next));
        assert.notEqual(next.attemptId, status.attemptId, "recovery must start a fresh attempt");
        if (next.state === "identity_ready") {
          readyCount += 1;
          return next;
        }
      } else {
        assert.equal(status.state, "identity_pending", JSON.stringify(status));
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, rpcBudget().timeoutMs)));
    }
  }

  const limit = Math.max(1, Math.min(concurrency, handles.length));
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (nextIdx < handles.length) {
        const idx = nextIdx++;
        results[idx] = await resolveOne(handles[idx]);
      }
    })
  );
  return results;
}
