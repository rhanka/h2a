import assert from "node:assert/strict";
import test from "node:test";

import {
  MESH_TARGET_B_PENDING_REASON,
  assertScenarioPhase,
  assertTwinTargetParity,
  decodeObservedUtf8Chunks,
  runTwinTargetScenario,
} from "./twin-target-characterization.js";

function memoryTarget({ mutate = false, postEffectFailure = false } = {}) {
  const state = { terminalInputs: [] };
  const durable = { receiptIds: [] };
  return {
    resolveTarget: () => ({ kind: "fixture", id: "isolated-target-a" }),
    observeTargetState: () => ({ terminalInputCount: state.terminalInputs.length }),
    observeDurableState: () => ({ receiptIds: [...durable.receiptIds] }),
    observeTerminalInputs: () => [...state.terminalInputs],
    invoke(input) {
      if (mutate) state.terminalInputs.push({ bytesBase64: input.bytesBase64 });
      return {
        stdout: postEffectFailure ? "" : "fixture output\n",
        stderr: postEffectFailure ? "receipt persistence failed\n" : "",
        exitCode: postEffectFailure ? 2 : 0,
        typedOutcome: {
          source: "fixture",
          code: postEffectFailure ? "POST_EFFECT_FAILURE" : "ACCEPTED",
        },
        receipts: [],
        reconciliation: postEffectFailure
          ? {
              effectIndependentlyObserved: true,
              reconciled: true,
              blindReplay: false,
            }
          : null,
      };
    },
  };
}

for (const phase of ["read-only", "dry-run", "pre-admission-refusal"]) {
  test(`should require zero mutation for ${phase} scenarios`, async () => {
    const result = await runTwinTargetScenario({
      scenario: `oracle-${phase}`,
      phase,
      hostKind: "local-tmux",
      input: { bytesBase64: "bm8gZWZmZWN0" },
      native: memoryTarget(),
    });

    assertScenarioPhase(result);
    assert.deepEqual(result.targetB, {
      state: "pending",
      reason: MESH_TARGET_B_PENDING_REASON,
    });
  });
}

test("should require exactly one independently observed input for accepted success", async () => {
  const result = await runTwinTargetScenario({
    scenario: "oracle-accepted-success",
    phase: "accepted-success",
    hostKind: "local-native",
    input: { bytesBase64: "b25lIGlucHV0" },
    native: memoryTarget({ mutate: true }),
  });

  assertScenarioPhase(result);
  assert.equal(result.targetA.finalTargetState.terminalInputCount, 1);
});

test("should retain and reconcile an observed effect after a post-effect failure", async () => {
  const result = await runTwinTargetScenario({
    scenario: "oracle-post-effect-failure",
    phase: "post-effect-failure",
    hostKind: "local-native",
    input: { bytesBase64: "cGFydGlhbCBlZmZlY3Q=" },
    native: memoryTarget({ mutate: true, postEffectFailure: true }),
  });

  assertScenarioPhase(result);
  assert.equal(result.targetA.exitCode, 2);
  assert.equal(result.targetA.terminalInputs.length, 1);
});

test("should refuse a false parity claim while Target-B is pending", async () => {
  const result = await runTwinTargetScenario({
    scenario: "target-b-pending",
    phase: "accepted-success",
    hostKind: "local-tmux",
    input: { bytesBase64: "aW5wdXQ=" },
    native: memoryTarget({ mutate: true }),
  });

  assert.throws(
    () => assertTwinTargetParity(result),
    /Target-B parity is pending.*cluster-mesh 0\.9\.0/,
  );
});

test("should preserve a chunked escape sequence and split UTF-8 code point", () => {
  const text = "before \u001b[31m🧭\u001b[0m après";
  const encoded = Buffer.from(text, "utf8");
  const marker = Buffer.from("🧭", "utf8");
  const escapeAt = encoded.indexOf(Buffer.from("\u001b[31m")) + 1;
  const utf8At = encoded.indexOf(marker) + 2;
  const chunks = [
    encoded.subarray(0, escapeAt),
    encoded.subarray(escapeAt, utf8At),
    encoded.subarray(utf8At),
  ];

  assert.equal(decodeObservedUtf8Chunks(chunks), text);
});
