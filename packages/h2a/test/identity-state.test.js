/**
 * L2 F1 — the identity controller's activation-vs-deadline boundary.
 *
 * A CANDIDATE-ONLY unit test (imports the L2 `identity-state` controller, which
 * does not exist on main@4be46caf — so it is green coverage of the new module's
 * contract, not a RED-on-main witness). It pins the F1 fix directly with injected
 * seams (clock + worker double): a FULLY-SUCCESSFUL activation that crosses the
 * deadline must become terminal-`identity_ready`, never a `identity_failed` that
 * leaves a live ACK / presence / signer behind it; and a FAILED activation must
 * become `identity_failed` with no live signer.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createIdentityController } from "../dist/runtime/mcp/index.js";

/** A worker double whose `onResolved` callback the test drives manually. */
function fakeWorker() {
  const handle = { resolved: undefined, cancelledWith: undefined };
  return {
    handle,
    make: () => ({
      onResolved: (cb) => {
        handle.resolved = cb;
      },
      onError: () => {},
      onExitWithoutResult: () => {},
      cancel: (reason) => {
        handle.cancelledWith = reason;
      }
    })
  };
}

const request = { root: "/tmp/h2a-f1-unit", host: "agent", cwd: "/tmp/h2a-f1-unit" };
// An override-shaped identity (empty key paths) so the controller skips path
// validation and calls `activate` directly.
const identity = { instance: "agent:x", host: "agent", action: "override", privateKeyPath: "", publicKeyPath: "" };

test("F1: a successful activation that crosses the deadline is terminal-ready (no wedged failed state)", () => {
  const w = fakeWorker();
  // Injected monotonic clock (ns). Activation advances it PAST the deadline.
  let clockNs = 0n;
  let activateCalls = 0;
  const controller = createIdentityController({
    request,
    timeoutMs: 5_000, // the REAL backstop timer; far beyond this ms-fast test
    nowNs: () => clockNs,
    spawnWorker: w.make,
    activate: () => {
      activateCalls += 1;
      // Simulate a slow activation: elapsed now crosses the 5 s deadline.
      clockNs = 6_000n * 1_000_000n;
      return { ok: true, sessionId: "sess:f1", signer: { instance: identity.instance, privateKeyPem: "PEM" } };
    }
  });
  controller.start();
  assert.equal(controller.status().state, "identity_pending");
  // The worker resolves within the deadline (clock still 0 at the pre-check).
  w.handle.resolved(identity);
  const st = controller.status();
  assert.equal(activateCalls, 1, "activation runs exactly once");
  // WITHOUT the F1 fix, the post-activation deadline re-check would have failed
  // here (elapsed 6000 ≥ 5000), wedging a live ACK+presence behind `failed`.
  assert.equal(st.state, "identity_ready", "a successful activation is terminal-ready");
  assert.equal(st.signingAvailable, true);
  assert.ok(controller.signer(), "the live signer is available after ready");
});

test("F1: a failed activation becomes identity_failed with no live signer", () => {
  const w = fakeWorker();
  let clockNs = 0n;
  const controller = createIdentityController({
    request,
    timeoutMs: 5_000,
    nowNs: () => clockNs,
    spawnWorker: w.make,
    activate: () => ({ ok: false, cause: "readiness_ack_failed", message: "ACK write failed" })
  });
  controller.start();
  w.handle.resolved(identity);
  const st = controller.status();
  assert.equal(st.state, "identity_failed");
  assert.equal(st.cause, "readiness_ack_failed");
  assert.equal(st.retryable, false);
  assert.equal(controller.signer(), undefined, "no live signer on a failed activation");
});

test("F1: a worker result that arrives AFTER the deadline never activates", () => {
  const w = fakeWorker();
  let clockNs = 0n;
  let activateCalls = 0;
  const controller = createIdentityController({
    request,
    timeoutMs: 5_000,
    nowNs: () => clockNs,
    spawnWorker: w.make,
    activate: () => {
      activateCalls += 1;
      return { ok: true, sessionId: "sess:late", signer: undefined };
    }
  });
  controller.start();
  // The deadline elapses BEFORE the worker resolves.
  clockNs = 6_000n * 1_000_000n;
  w.handle.resolved(identity);
  const st = controller.status();
  assert.equal(activateCalls, 0, "a late result never activates");
  assert.equal(st.state, "identity_failed");
  assert.equal(st.cause, "identity_timeout");
});

// --- Bounded on-demand retry for a TRANSIENT identity failure (0.97.9) ---
// A dead/contended/expired lock surfaces as identity_timeout and latches identity_failed;
// pre-fix this was terminal for the process lifetime (retryable:false, no retry()), so every
// later tool call returned the memoized failure. These pin the fix RED-first: they call
// controller.retry() (which did not exist) and expect identity_timeout to be retryable.

// Drive a first attempt to identity_failed(identity_timeout) via the late-result path
// (clock crosses the deadline before the worker resolves), then return the controller + clock.
function failedTransientController({ retryMinIntervalMs }) {
  const w = fakeWorker();
  const clock = { ns: 0n };
  let activateCalls = 0;
  const controller = createIdentityController({
    request,
    timeoutMs: 5_000,
    retryMinIntervalMs,
    nowNs: () => clock.ns,
    spawnWorker: w.make,
    activate: () => {
      activateCalls += 1;
      return { ok: true, sessionId: "sess:retry", signer: { instance: identity.instance, privateKeyPem: "PEM" } };
    }
  });
  controller.start();
  clock.ns = 6_000n * 1_000_000n; // past the 5s deadline
  w.handle.resolved(identity); // late result → fail("identity_timeout")
  const st = controller.status();
  assert.equal(st.state, "identity_failed");
  assert.equal(st.cause, "identity_timeout");
  assert.equal(st.retryable, true, "identity_timeout is a TRANSIENT (retryable) failure");
  return { controller, clock, w, activateCalls: () => activateCalls };
}

test("retry: a transient identity_failed re-attempts on demand after the min interval and reaches ready (no restart)", () => {
  const { controller, clock, w } = failedTransientController({ retryMinIntervalMs: 30_000 });
  const firstAttempt = controller.status().attemptId;

  // Within the interval: retry is refused, the memoized failure is kept.
  assert.equal(controller.retry(), false, "no re-attempt within the min interval");
  assert.equal(controller.status().state, "identity_failed");

  // Past the interval: a tool call re-attempts (state → pending, NEW attemptId), no restart.
  clock.ns += 31_000n * 1_000_000n;
  assert.equal(controller.retry(), true, "a re-attempt is kicked once the interval elapsed");
  const pending = controller.status();
  assert.equal(pending.state, "identity_pending");
  assert.notEqual(pending.attemptId, firstAttempt, "the re-attempt has a fresh attemptId");

  // The re-attempt's worker resolves within its deadline → identity_ready, same process.
  w.handle.resolved(identity);
  const ready = controller.status();
  assert.equal(ready.state, "identity_ready", "the session self-recovers to ready without a restart");
  assert.ok(controller.signer(), "the live signer is available after self-recovery");
});

test("retry: one attempt at a time — a second retry while pending is a no-op", () => {
  const { controller, clock } = failedTransientController({ retryMinIntervalMs: 0 });
  assert.equal(controller.retry(), true, "first retry kicks");
  assert.equal(controller.status().state, "identity_pending");
  assert.equal(controller.retry(), false, "a second retry while pending never starts a concurrent attempt");
});

test("retry: a PERMANENT identity_failed never re-attempts (stays terminal)", () => {
  const w = fakeWorker();
  const clock = { ns: 0n };
  const controller = createIdentityController({
    request,
    timeoutMs: 5_000,
    retryMinIntervalMs: 0, // even with zero interval, a permanent cause must not retry
    nowNs: () => clock.ns,
    spawnWorker: w.make,
    activate: () => ({ ok: false, cause: "storage_permission_denied", message: "EACCES" })
  });
  controller.start();
  w.handle.resolved(identity); // activation fails permanently
  const st = controller.status();
  assert.equal(st.state, "identity_failed");
  assert.equal(st.cause, "storage_permission_denied");
  assert.equal(st.retryable, false, "a permanent cause is not retryable");
  assert.equal(controller.retry(), false, "a permanent failure never re-attempts");
  assert.equal(controller.status().state, "identity_failed", "still terminal");
});
