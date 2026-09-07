import assert from "node:assert/strict";
import test from "node:test";

import { createH2aClusterMeshOuter } from "../dist/index.js";

const now = new Date("2026-08-31T12:00:00.000Z");
const actuatorRef = "h2a-pty:v1:a1-session";
const registration = {
  registrationId: "registration-a1",
  generationId: "generation-a1",
  principalId: "workload-a1",
  workspaceId: "workspace-a1",
  custodyHolderPrincipalId: "workload-a1",
  custodyEpoch: 1,
  actuatorRef,
  status: "active",
  expiresAt: "2026-09-01T12:00:00.000Z",
  leaseExpiresAt: "2026-09-01T12:00:00.000Z"
};

test("should drive the real h2a adapter through the cluster-mesh OUTER path", async () => {
  let storedRegistration = null;
  let targetState = "alive";
  let phase = "A";
  let driveCalls = 0;
  let wakeCalls = 0;
  let relaunchCalls = 0;
  let lostRegistrationId;
  const commands = new Map();
  const receipts = [];
  const resolutions = [];
  const target = {
    kind: "tmux",
    target: "a1-session:0.1",
    instance: "a1-session",
    launchContext: {
      cwd: "/hermetic-fixture",
      command: "agent start",
      resumeCommand: "agent resume",
      tmux: { session: "a1-session", window: "0", pane: "1" }
    }
  };
  const contextFor = (invocationId) => ({
    invocationId,
    correlationId: invocationId,
    generationId: "generation-a1",
    principal: {
      principalId: "workload-a1",
      kind: "workload",
      verifierId: "hermetic-test"
    },
    workspace: {
      bindingId: "binding-a1",
      workspaceId: "workspace-a1",
      revision: "1"
    },
    scopes: ["session:drive"],
    policyRevision: "1",
    issuedAt: now.toISOString(),
    registration: {
      registrationId: registration.registrationId,
      generationId: registration.generationId,
      workspaceId: registration.workspaceId,
      actuatorRef,
      custodyEpoch: 1,
      expiresAt: registration.expiresAt
    },
    custody: {
      custodyId: "custody-a1",
      holderPrincipalId: "workload-a1",
      epoch: 1
    }
  });
  const store = {
    async enqueueCommand(command) {
      if (commands.has(command.commandId)) return false;
      commands.set(command.commandId, command);
      return true;
    },
    async updateCommand(commandId, update) {
      const command = commands.get(commandId);
      if (command === undefined) return false;
      commands.set(commandId, { ...command, ...update });
      return true;
    },
    async markRegistrationLost(registrationId, lostAt) {
      lostRegistrationId = registrationId;
      storedRegistration = { ...registration, status: "lost", lostAt };
      return true;
    }
  };
  const ok = (c) => c.json({ ok: true });
  const { router } = createH2aClusterMeshOuter({
    generationId: "generation-a1",
    config: { capacity: { poolSize: 4 } },
    context: {
      async verify(request) {
        return contextFor(request.invocationId);
      }
    },
    registrations: {
      async find() {
        return storedRegistration;
      }
    },
    store,
    receipts: {
      async append(receipt) {
        receipts.push(receipt);
      }
    },
    handlers: {
      current: ok,
      refresh: ok,
      extensionToken: ok,
      logout: ok,
      logoutAll: ok,
      list: ok
    },
    devices: { issue: ok, poll: ok, approve: ok },
    projection: { session: "/", device: "/device", control: "/control" },
    author: {
      async ensureAuthor() {
        return { ok: true };
      }
    },
    actuator: {
      resolveActuationTarget(ref, observedRegistration) {
        resolutions.push({
          consumer: observedRegistration === undefined ? "probe" : "actuate",
          ref,
          registered: observedRegistration !== undefined
        });
        return target;
      },
      async probeAliveness() {
        return targetState;
      },
      drivers: {
        drive: {
          async drive() {
            driveCalls += 1;
            phase = "B";
            return true;
          }
        },
        wake: {
          async drive() {
            wakeCalls += 1;
            return true;
          }
        }
      },
      relaunchers: {
        "native-terminal": { async relance() { return true; } },
        tmux: {
          async relance() {
            relaunchCalls += 1;
            return true;
          }
        },
        opaque: { async relance() { return true; } }
      },
      now: () => now.getTime()
    },
    now: () => now
  });
  const act = (action, commandId) => router.request(`/control/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      commandId,
      targetRegistrationId: registration.registrationId,
      idempotencyKey: `key-${commandId}`
    })
  });

  const missing = await act("drive", "command-missing");
  assert.deepEqual(
    [missing.status, await missing.json()],
    [409, { error: "missing_registration" }]
  );

  storedRegistration = registration;
  const driven = await act("drive", "command-drive");
  const drivenBody = await driven.json();
  assert.deepEqual([driven.status, drivenBody.status], [200, "acted"]);
  assert.equal(phase, "B");
  assert.match(drivenBody.effectRef, /^h2a-pty:acted:drive:/);
  assert.ok(receipts.some(
    (receipt) => receipt.stage === "acted" && receipt.effectRef === drivenBody.effectRef
  ));

  const relaunched = await act("relaunch", "command-relaunch");
  const relaunchBody = await relaunched.json();
  assert.deepEqual([relaunched.status, relaunchBody.status], [200, "acted"]);
  assert.deepEqual(relaunchBody.actedTargets, ["a1-session:0.1"]);
  assert.equal(relaunchCalls, 1);

  targetState = "dead";
  const lost = await act("wake", "command-dead");
  assert.deepEqual(
    [lost.status, await lost.json()],
    [409, { error: "actuator_unavailable" }]
  );
  assert.equal(lostRegistrationId, registration.registrationId);
  assert.equal(storedRegistration.status, "lost");
  assert.equal(driveCalls, 1);
  assert.equal(wakeCalls, 0);
  assert.ok(resolutions.some(({ registered }) => registered));
  assert.ok(resolutions.every(({ ref }) => ref === actuatorRef));
});
