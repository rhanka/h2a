import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createH2aPtyActuator,
  createH2aSessionTargetState,
  resolveActuationTarget,
  writePresence
} from "../dist/index.js";

const registration = {
  registrationId: "registration-1",
  generationId: "generation-1",
  principalId: "principal-1",
  workspaceId: "workspace-1",
  custodyHolderPrincipalId: "principal-1",
  custodyEpoch: 1,
  actuatorRef: "h2a-pty:v1:worker",
  status: "active",
  expiresAt: "2000-01-01T00:00:00.000Z",
  leaseExpiresAt: "2000-01-01T00:00:00.000Z"
};

function tmuxTarget(overrides = {}) {
  return {
    kind: "tmux",
    target: "worker:2.1",
    instance: "codex:worker",
    host: "codex",
    launchContext: {
      cwd: "/workspace",
      command: "codex",
      resumeCommand: "codex resume conversation-1",
      tmux: { session: "worker", window: "2", pane: "1" }
    },
    ...overrides
  };
}

test("should resolve the same stable ref to the newest tmux pane after relaunch", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-pty-actuator-resolve-"));
  const previousRoot = process.env.H2A_ROOT;
  process.env.H2A_ROOT = root;
  const now = Date.parse("2026-08-30T12:00:10.000Z");
  const session = (sessionId, heartbeatAt, pane) => ({
    sessionId,
    instance: "worker",
    host: "codex",
    startedAt: "2026-08-30T12:00:00.000Z",
    heartbeatAt,
    state: "live",
    interests: { scopes: [], negotiations: [] },
    subscribedTopics: [],
    launchContext: {
      cwd: "/workspace",
      command: "codex",
      tmux: { session: "managed-worker", window: "2", pane }
    }
  });
  try {
    writePresence(root, session("sess:old", "2026-08-30T12:00:05.000Z", "1"));
    writePresence(root, session("sess:new", "2026-08-30T12:00:09.000Z", "7"));

    const target = resolveActuationTarget(
      "h2a-pty:v1:worker",
      registration,
      now
    );

    assert.equal(target.kind, "tmux");
    assert.equal(target.target, "managed-worker:2.7");
  } finally {
    if (previousRoot === undefined) delete process.env.H2A_ROOT;
    else process.env.H2A_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  }
});

test("should report dead and issue no drive when the resolved target has exited", async () => {
  const target = {
    kind: "native-terminal",
    sessionId: "worker",
    instance: "codex:worker"
  };
  const driverCalls = [];
  const probeCalls = [];
  const deps = {
    resolveActuationTarget: () => target,
    probeAliveness: async (probed) => {
      probeCalls.push(probed);
      return "dead";
    },
    drivers: {
      drive: {
        drive(request) {
          driverCalls.push(request);
          return true;
        }
      }
    },
    now: () => 1_000
  };
  const actuator = createH2aPtyActuator(deps);
  const state = createH2aSessionTargetState(deps);

  assert.equal(await actuator.isAvailable(registration.actuatorRef), false);
  assert.equal(await state.inspect(registration.actuatorRef), "dead");
  const result = await actuator.actuate({
    registration,
    action: "drive",
    commandRef: "command-ref-1"
  });

  assert.deepEqual(result.actedTargets, []);
  assert.match(result.effectRef, /^h2a-pty:failed:drive:/);
  assert.equal(driverCalls.length, 0);
  assert.equal(probeCalls.length, 3);
});

test("should report an absent target dead and return an empty receipt", async () => {
  let driverCalls = 0;
  const deps = {
    resolveActuationTarget: () => null,
    probeAliveness: async () => {
      throw new Error("an unresolved target must not be probed");
    },
    drivers: {
      wake: { drive: () => void (driverCalls += 1) || true }
    },
    now: () => 2_000
  };
  const actuator = createH2aPtyActuator(deps);
  const state = createH2aSessionTargetState(deps);

  assert.equal(await actuator.isAvailable(registration.actuatorRef), false);
  assert.equal(await state.inspect(registration.actuatorRef), "dead");
  const result = await actuator.actuate({
    registration,
    action: "wake",
    commandRef: "command-ref-2"
  });

  assert.deepEqual(result.actedTargets, []);
  assert.equal(driverCalls, 0);
});

test("should never relaunch when no command was recorded", async () => {
  let relaunchCalls = 0;
  const target = tmuxTarget({
    launchContext: undefined
  });
  const actuator = createH2aPtyActuator({
    resolveActuationTarget: () => target,
    probeAliveness: async () => "dead",
    relaunchers: {
      tmux: { relance: () => void (relaunchCalls += 1) || true }
    },
    now: () => 3_000
  });

  const result = await actuator.actuate({
    registration,
    action: "relaunch",
    commandRef: "must-not-be-used-as-a-launch-command"
  });

  assert.deepEqual(result.actedTargets, []);
  assert.match(result.effectRef, /^h2a-pty:deferred:relaunch:/);
  assert.equal(relaunchCalls, 0);
});

test("should return a real target receipt for successful drive and wake effects", async () => {
  const target = tmuxTarget();
  const calls = [];
  const driver = {
    drive(request) {
      calls.push(request);
      return true;
    }
  };
  const deps = {
    resolveActuationTarget: () => target,
    probeAliveness: async () => "alive",
    drivers: { drive: driver, wake: driver },
    now: () => 4_000
  };
  const actuator = createH2aPtyActuator(deps);
  const state = createH2aSessionTargetState(deps);

  assert.equal(await actuator.isAvailable(registration.actuatorRef), true);
  assert.equal(await state.inspect(registration.actuatorRef), "alive");
  for (const action of ["drive", "wake"]) {
    const result = await actuator.actuate({
      registration,
      action,
      commandRef: `command-ref-${action}`
    });
    assert.deepEqual(result.actedTargets, [target.target]);
    assert.match(result.effectRef, new RegExp(`^h2a-pty:acted:${action}:`));
  }
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.instructionLine), [
    "command-ref-drive",
    "command-ref-wake"
  ]);
});

test("should return an empty receipt when a driver reports no effect", async () => {
  const target = tmuxTarget();
  const actuator = createH2aPtyActuator({
    resolveActuationTarget: () => target,
    probeAliveness: async () => "alive",
    drivers: { drive: { drive: () => false } },
    now: () => 5_000
  });

  const result = await actuator.actuate({
    registration,
    action: "drive",
    commandRef: "command-ref-failed"
  });

  assert.deepEqual(result.actedTargets, []);
  assert.match(result.effectRef, /^h2a-pty:failed:drive:/);
});

test("should relaunch exactly once when a recorded command produces an effect", async () => {
  const target = tmuxTarget();
  const findings = [];
  const actuator = createH2aPtyActuator({
    resolveActuationTarget: () => target,
    probeAliveness: async () => "dead",
    relaunchers: {
      tmux: {
        relance(finding) {
          findings.push(finding);
          return true;
        }
      }
    },
    now: () => 6_000
  });

  const result = await actuator.actuate({
    registration,
    action: "relaunch",
    commandRef: "command-ref-relaunch"
  });

  assert.deepEqual(result.actedTargets, [target.target]);
  assert.match(result.effectRef, /^h2a-pty:acted:relaunch:/);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].instance, target.instance);
  assert.equal(findings[0].launchContext.resumeCommand, "codex resume conversation-1");
});
