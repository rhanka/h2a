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
