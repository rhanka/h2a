import assert from "node:assert/strict";
import { StringDecoder } from "node:string_decoder";

export const CHARACTERIZATION_HOST_KINDS = Object.freeze([
  "local-tmux",
  "local-native",
]);

export const CHARACTERIZATION_PHASES = Object.freeze([
  "read-only",
  "dry-run",
  "pre-admission-refusal",
  "accepted-success",
  "post-effect-failure",
]);

export const MESH_TARGET_B_PENDING_REASON =
  "Target-B requires the enlarged @sentropic/cluster-mesh 0.9.0 contract and capability bundle";

function clone(value) {
  return structuredClone(value);
}

function requireOwn(record, key, label) {
  assert.ok(
    Object.prototype.hasOwnProperty.call(record, key),
    `${label} must record ${key}`,
  );
}

function assertObservationShape(observation, label) {
  for (const key of [
    "inputs",
    "targetResolution",
    "stdout",
    "stderr",
    "exitCode",
    "finalTargetState",
    "durableState",
    "typedOutcome",
    "receipts",
    "terminalInputs",
  ]) {
    requireOwn(observation, key, label);
  }
  assert.equal(typeof observation.stdout, "string", `${label}.stdout`);
  assert.equal(typeof observation.stderr, "string", `${label}.stderr`);
  assert.ok(Number.isInteger(observation.exitCode), `${label}.exitCode`);
  assert.ok(
    observation.typedOutcome && typeof observation.typedOutcome === "object",
    `${label}.typedOutcome`,
  );
  assert.ok(Array.isArray(observation.receipts), `${label}.receipts`);
  assert.ok(Array.isArray(observation.terminalInputs), `${label}.terminalInputs`);
}

async function executeTarget(targetName, adapter, input) {
  const beforeTargetState = clone(await adapter.observeTargetState());
  const beforeDurableState = clone(await adapter.observeDurableState());
  const targetResolution = clone(await adapter.resolveTarget(input));
  const invocation = await adapter.invoke(input, targetResolution);
  const observation = {
    target: targetName,
    inputs: clone(input),
    targetResolution,
    stdout: invocation.stdout,
    stderr: invocation.stderr,
    exitCode: invocation.exitCode,
    finalTargetState: clone(await adapter.observeTargetState()),
    durableState: clone(await adapter.observeDurableState()),
    typedOutcome: clone(invocation.typedOutcome),
    receipts: clone(invocation.receipts),
    terminalInputs: clone(await adapter.observeTerminalInputs()),
    beforeTargetState,
    beforeDurableState,
    reconciliation: clone(invocation.reconciliation ?? null),
  };
  assertObservationShape(observation, targetName);
  return observation;
}

/**
 * Scenario-and-phase twin-target runner used by migration characterization.
 * Lot 1 intentionally supplies only native Target-A. Target-B is represented
 * as a named pending seam; passing no candidate can never look like parity.
 */
export async function runTwinTargetScenario({
  scenario,
  phase,
  hostKind,
  input,
  native,
  candidate,
  candidatePendingReason = MESH_TARGET_B_PENDING_REASON,
}) {
  assert.ok(typeof scenario === "string" && scenario.length > 0, "scenario is required");
  assert.ok(CHARACTERIZATION_PHASES.includes(phase), `unknown phase: ${phase}`);
  assert.ok(CHARACTERIZATION_HOST_KINDS.includes(hostKind), `unknown host kind: ${hostKind}`);

  const targetA = await executeTarget("Target-A/native", native, input);
  const targetB = candidate
    ? await executeTarget("Target-B/mesh", candidate, input)
    : {
        state: "pending",
        reason: candidatePendingReason,
      };

  return {
    scenario,
    phase,
    hostKind,
    targetA,
    targetB,
  };
}

function zeroMutation(observation) {
  assert.deepEqual(
    observation.finalTargetState,
    observation.beforeTargetState,
    "zero-effect phase changed target state",
  );
  assert.deepEqual(
    observation.durableState,
    observation.beforeDurableState,
    "zero-effect phase changed durable state",
  );
  assert.equal(observation.terminalInputs.length, 0, "zero-effect phase emitted terminal input");
}

/** Enforce the matrix's phase-aware effect oracle against one target. */
export function assertScenarioPhase(result, target = result.targetA) {
  switch (result.phase) {
    case "read-only":
    case "dry-run":
    case "pre-admission-refusal":
      zeroMutation(target);
      return;
    case "accepted-success":
      assert.equal(target.exitCode, 0, "accepted success must exit zero");
      assert.equal(
        target.terminalInputs.length,
        1,
        "accepted direct drive must produce exactly one non-empty terminal input",
      );
      return;
    case "post-effect-failure":
      assert.ok(
        target.terminalInputs.length > 0,
        "post-effect failure must retain independently observed effect evidence",
      );
      assert.equal(
        target.reconciliation?.effectIndependentlyObserved,
        true,
        "post-effect failure must independently observe the effect",
      );
      assert.equal(
        target.reconciliation?.reconciled,
        true,
        "post-effect failure must be reconciled",
      );
      assert.equal(
        target.reconciliation?.blindReplay,
        false,
        "post-effect failure must not authorize blind replay",
      );
      return;
    default:
      assert.fail(`unhandled phase: ${result.phase}`);
  }
}

function parityProjection(observation) {
  return {
    inputs: observation.inputs,
    targetResolution: observation.targetResolution,
    stdout: observation.stdout,
    stderr: observation.stderr,
    exitCode: observation.exitCode,
    finalTargetState: observation.finalTargetState,
    durableState: observation.durableState,
    typedOutcome: observation.typedOutcome,
    receipts: observation.receipts,
    terminalInputs: observation.terminalInputs,
    reconciliation: observation.reconciliation,
  };
}

/** Compare every field named by the matrix once Target-B becomes available. */
export function assertTwinTargetParity(result) {
  assert.notEqual(
    result.targetB.state,
    "pending",
    `Target-B parity is pending: ${result.targetB.reason}`,
  );
  assert.deepEqual(parityProjection(result.targetB), parityProjection(result.targetA));
}

/** Reassemble arbitrary byte chunks without corrupting a split UTF-8 code point. */
export function decodeObservedUtf8Chunks(chunks) {
  const decoder = new StringDecoder("utf8");
  return chunks.map((chunk) => decoder.write(chunk)).join("") + decoder.end();
}
