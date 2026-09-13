import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  chainRelauncher,
  headlessRelauncher,
  localTmuxRelauncher,
} from "../dist/index.js";
import {
  decideRelaunchSafety,
  planRelaunch,
  tryAcquireResumeLaunchClaim,
} from "../../h2a-runtime/dist/relaunch.js";
import { killLocalSession } from "../../h2a-runtime/dist/tmux.js";

import {
  MESH_TARGET_B_PENDING_REASON,
  assertScenarioPhase,
  runTwinTargetScenario,
} from "./twin-target-characterization.js";

const INSTANCE = "codex:m07-worker";
const CONVERSATION = "0199-m07-conversation";

function deadCandidate(overrides = {}) {
  return {
    slug: "m07-worker",
    name: "h2a-m07-worker",
    profile: "codex",
    convId: CONVERSATION,
    dead: true,
    activatable: false,
    indeterminate: false,
    activelyWorking: false,
    ...overrides,
  };
}

function finding(hostKind, command = `codex resume ${CONVERSATION}`, overrides = {}) {
  const launchContext = {
    cwd: "/work/m07",
    command: "codex",
    resumeCommand: command,
    ...(hostKind === "local-tmux"
      ? { tmux: { session: "h2a-m07-worker", window: "agent", pane: "0" } }
      : {}),
  };
  return {
    instance: INSTANCE,
    reason: "stopped",
    workStatus: "paused",
    relanceCount: 0,
    launchContext,
    ...overrides,
  };
}

function clone(value) {
  return structuredClone(value);
}

function createNativeScenarioAdapter({
  hostKind,
  apply,
  actuatorResult = true,
  partialEffect = false,
  registrationState = "known",
  custodyState = "not-consumed",
  oq2Available = false,
}) {
  const logs = [];
  const calls = { run: [], spawnDetached: [] };
  const terminalInputs = [];
  const targetState = {
    old: { generation: "generation-1", status: "terminated" },
    replacement: null,
    recoveries: 0,
  };
  const durableState = {
    registration: registrationState,
    registrationGeneration: 1,
    oq2Available,
    custodyState,
    receipts: [],
  };

  const recordLogicalEffect = (text, layout) => {
    if (terminalInputs.length > 0) return;
    terminalInputs.push({ text, layout });
    targetState.replacement = {
      generation: "generation-2",
      status: "active",
      command: text,
    };
    targetState.recoveries += 1;
  };

  const runtime = {
    run(file, args) {
      calls.run.push([file, ...args]);
      if (args.includes("-l") && (actuatorResult || partialEffect)) {
        recordLogicalEffect(args.at(-1), args[args.indexOf("-t") + 1]);
      }
      return actuatorResult;
    },
    spawnDetached(command, options) {
      calls.spawnDetached.push({ command, cwd: options.cwd });
      if (actuatorResult || partialEffect) {
        recordLogicalEffect(
          typeof command === "string"
            ? command
            : [command.file, ...command.args].join(" "),
          options.cwd ?? command.cwd,
        );
      }
      return actuatorResult;
    },
    notify(line) {
      logs.push(line);
    },
  };
  const relauncher = hostKind === "local-tmux"
    ? localTmuxRelauncher({ runtime, log: (line) => logs.push(line) })
    : headlessRelauncher({ runtime, log: (line) => logs.push(line) });
  const plan = planRelaunch([deadCandidate()]);

  return {
    calls,
    resolveTarget: () => ({
      kind: hostKind === "local-tmux" ? "tmux-pane" : "detached-process",
      instance: INSTANCE,
      registrationState,
      action: clone(plan.actions[0]),
    }),
    observeTargetState: () => clone(targetState),
    observeDurableState: () => clone(durableState),
    observeTerminalInputs: () => clone(terminalInputs),
    async invoke() {
      // The reusable runner requires process-shaped fields. This adapter marks
      // them as a test projection: planRelaunch returns an object and the
      // relaunchers return a boolean; neither primitive owns CLI output, an
      // exit code, a typed contract outcome, or a receipt. The real runtime
      // CLI orchestration stays an explicit CI-only seam below.
      if (!apply) {
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
          typedOutcome: {
            source: "characterization/native-plan-object",
            code: "PLAN_HAS_ONE_ACTION",
            contractGrade: false,
            cliObserved: false,
          },
          receipts: [],
        };
      }

      const ok = await relauncher.relance(
        finding(hostKind, plan.actions[0].cmd, {
          registrationGeneration: durableState.registrationGeneration,
          custodyState,
          oq2Available,
        }),
      );
      return {
        stdout: "",
        stderr: `${logs.join("\n")}${logs.length ? "\n" : ""}`,
        exitCode: ok ? 0 : 1,
        typedOutcome: {
          source: "characterization/native-relauncher-boolean",
          code: ok ? "RELAUNCHED_TRUE" : "RELAUNCHED_FALSE",
          contractGrade: false,
          cliObserved: false,
        },
        receipts: [],
        ...(partialEffect
          ? {
              reconciliation: {
                effectIndependentlyObserved: true,
                reconciled: false,
                blindReplay: true,
              },
            }
          : {}),
      };
    },
  };
}

async function eventually(read, accept, label) {
  let last;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    last = await read();
    if (accept(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${label} did not become observable; last=${JSON.stringify(last)}`);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function assertOneCurrentGeneration(lifecycle) {
  assert.equal(lifecycle.old.status, "terminated", "the old process must stay terminated");
  assert.equal(
    lifecycle.replacements.filter((replacement) => replacement.status === "active").length,
    1,
    "exactly one replacement generation may be active",
  );
  assert.equal(
    lifecycle.replacements.length,
    1,
    "retry must not cause a second recovery/process bounce",
  );
}

function faultOutcomes(phase) {
  switch (phase) {
    case "F1":
      return [
        { effect: false, returned: false, receipt: false },
        { effect: true, returned: true, receipt: true },
      ];
    case "F2":
      return [
        { effect: true, returned: false, receipt: false },
        { effect: true, returned: true, receipt: true },
      ];
    case "F3":
      return [
        { effect: true, returned: true, receipt: true },
        { effect: true, returned: true, receipt: true },
      ];
    default:
      throw new Error(`unknown M07 phase ${phase}`);
  }
}

async function exerciseRetryFault(hostKind, phase, mode) {
  const outcomes = faultOutcomes(phase);
  const lifecycle = {
    old: { generation: 1, status: "active" },
    registrationGeneration: 1,
    attempts: [],
    replacements: [],
    nativeReceipts: [],
  };
  let nextOutcome = 0;
  let activeOutcome;

  const applyOutcome = (command) => {
    const outcome = outcomes[Math.min(nextOutcome, outcomes.length - 1)];
    nextOutcome += 1;
    lifecycle.old.status = "terminated";
    lifecycle.attempts.push({
      registrationGeneration: lifecycle.registrationGeneration,
      command,
    });
    if (outcome.effect) {
      for (const replacement of lifecycle.replacements) replacement.status = "superseded";
      lifecycle.replacements.push({
        generation: lifecycle.registrationGeneration,
        status: "active",
        command,
      });
    }
    if (outcome.receipt) {
      // This is an actuator-side marker only. The native relauncher return
      // surface below exposes no receipt and cannot reconcile it on retry.
      lifecycle.nativeReceipts.push(`unexposed-${nextOutcome}`);
    }
    activeOutcome = outcome;
    return outcome.returned;
  };

  const runtime = {
    run(_file, args) {
      if (args.includes("-l")) return applyOutcome(args.at(-1));
      return activeOutcome?.returned ?? false;
    },
    spawnDetached(command) {
      const display = typeof command === "string"
        ? command
        : [command.file, ...command.args].join(" ");
      return applyOutcome(display);
    },
  };
  const createWorker = () => hostKind === "local-tmux"
    ? localTmuxRelauncher({ runtime })
    : headlessRelauncher({ runtime });
  const firstWorker = createWorker();
  const firstFinding = finding(hostKind, "codex resume old-generation", {
    registrationGeneration: 1,
  });
  const secondFinding = finding(hostKind, "codex resume current-generation", {
    registrationGeneration: 2,
  });

  if (mode === "restart") {
    await firstWorker.relance(firstFinding);
    lifecycle.registrationGeneration = 2;
    await createWorker().relance(secondFinding);
  } else {
    lifecycle.registrationGeneration = 2;
    await Promise.all([
      firstWorker.relance(firstFinding),
      createWorker().relance(secondFinding),
    ]);
  }
  return lifecycle;
}

for (const hostKind of ["local-tmux", "local-native"]) {
  test(`should prove M07 dry-run has zero effects for ${hostKind} Target-A`, async () => {
    const native = createNativeScenarioAdapter({ hostKind, apply: false });
    const result = await runTwinTargetScenario({
      scenario: `M07 exact-target ${hostKind} dry-run`,
      phase: "dry-run",
      hostKind,
      input: {
        exactTarget: INSTANCE,
        apply: false,
        registrationState: "known",
      },
      native,
    });

    assertScenarioPhase(result);
    assert.equal(result.targetA.typedOutcome.code, "PLAN_HAS_ONE_ACTION");
    assert.equal(result.targetA.typedOutcome.cliObserved, false);
    assert.equal(result.targetA.exitCode, 0);
    assert.equal(result.targetA.stdout, "");
    assert.equal(result.targetA.stderr, "");
    assert.deepEqual(result.targetA.receipts, []);
    assert.deepEqual(result.targetB, {
      state: "pending",
      reason: MESH_TARGET_B_PENDING_REASON,
    });
    assert.equal(native.calls.run.length, 0);
    assert.equal(native.calls.spawnDetached.length, 0);
  });

  test(`should prove M07 apply produces exactly one observed recovery for ${hostKind} Target-A`, async () => {
    const native = createNativeScenarioAdapter({ hostKind, apply: true });
    const result = await runTwinTargetScenario({
      scenario: `M07 exact-target ${hostKind} apply`,
      phase: "accepted-success",
      hostKind,
      input: {
        exactTarget: INSTANCE,
        apply: true,
        registrationState: "known",
      },
      native,
    });

    assertScenarioPhase(result);
    assert.equal(result.targetA.finalTargetState.old.status, "terminated");
    assert.equal(result.targetA.finalTargetState.recoveries, 1);
    assert.equal(result.targetA.finalTargetState.replacement.generation, "generation-2");
    assert.equal(result.targetA.typedOutcome.code, "RELAUNCHED_TRUE");
    assert.equal(result.targetA.typedOutcome.contractGrade, false);
    assert.equal(result.targetA.typedOutcome.cliObserved, false);
    assert.deepEqual(result.targetA.receipts, []);

    if (hostKind === "local-tmux") {
      assert.deepEqual(native.calls.run, [
        [
          "tmux",
          "send-keys",
          "-t",
          "h2a-m07-worker:agent.0",
          "-l",
          `codex resume ${CONVERSATION}`,
        ],
        ["tmux", "send-keys", "-t", "h2a-m07-worker:agent.0", "Enter"],
        ["tmux", "send-keys", "-t", "h2a-m07-worker:agent.0", "Enter"],
      ]);
    } else {
      assert.deepEqual(native.calls.spawnDetached, [
        { command: `codex resume ${CONVERSATION}`, cwd: "/work/m07" },
      ]);
    }
  });
}

test("should characterize M07 known, unknown, live, dead, parked, and indeterminate target states", () => {
  const states = {
    live: deadCandidate({
      dead: false,
      activatable: true,
      activelyWorking: true,
      livenessReason: "live working CLI — never killed (even with --force)",
    }),
    dead: deadCandidate(),
    parked: deadCandidate({
      dead: false,
      activatable: true,
      activelyWorking: false,
      livenessReason: "live parked CLI worker is activatable — never force-killed",
    }),
    unknown: deadCandidate({
      dead: false,
      activatable: false,
      indeterminate: true,
      activelyWorking: true,
      livenessReason: "liveness indeterminate: worker/CPU probe failed",
    }),
  };
  const observed = {};
  for (const [state, candidate] of Object.entries(states)) {
    const plan = planRelaunch([candidate], { force: true });
    observed[state] = {
      actions: plan.actions.length,
      skipped: plan.skipped.length,
      reason: plan.skipped[0]?.reason,
    };
  }
  const unknownTarget = planRelaunch([], { force: true });

  assert.deepEqual(observed, {
    live: {
      actions: 0,
      skipped: 1,
      reason: "live working CLI — never killed (even with --force)",
    },
    dead: { actions: 1, skipped: 0, reason: undefined },
    parked: {
      actions: 0,
      skipped: 1,
      reason: "live parked CLI worker is activatable — never force-killed",
    },
    unknown: {
      actions: 0,
      skipped: 1,
      reason: "liveness indeterminate: worker/CPU probe failed",
    },
  });
  assert.deepEqual(unknownTarget, { actions: [], skipped: [] });
});

test("should characterize M07 fail-closed liveness sampling at the dead, parked, live, and unknown boundaries", () => {
  const dead = decideRelaunchSafety({
    pane: "%7",
    paneCommand: "bash",
    panePid: 100,
    firstWorkerPid: 100,
    secondWorkerPid: 100,
    firstCpuMs: 10,
    secondCpuMs: 10,
    elapsedMs: 250,
  });
  const parked = decideRelaunchSafety({
    pane: "%7",
    paneCommand: "bash",
    panePid: 100,
    firstWorkerPid: 101,
    secondWorkerPid: 101,
    firstCpuMs: 10,
    secondCpuMs: 20,
    elapsedMs: 250,
  });
  const live = decideRelaunchSafety({
    pane: "%7",
    paneCommand: "bash",
    panePid: 100,
    firstWorkerPid: 101,
    secondWorkerPid: 101,
    firstCpuMs: 10,
    secondCpuMs: 30,
    elapsedMs: 250,
  });
  const unknown = decideRelaunchSafety({
    pane: "%7",
    paneCommand: "bash",
    panePid: 100,
    firstWorkerPid: 101,
    secondWorkerPid: 102,
    firstCpuMs: 10,
    secondCpuMs: 30,
    elapsedMs: 250,
  });

  assert.deepEqual(dead, {
    dead: true,
    activatable: false,
    indeterminate: false,
    activelyWorking: false,
    reason: "no live CLI worker descendant",
    identity: { pane: "%7", panePid: 100 },
  });
  assert.deepEqual(
    {
      dead: parked.dead,
      activatable: parked.activatable,
      indeterminate: parked.indeterminate,
      activelyWorking: parked.activelyWorking,
      rateMsPerSecond: parked.rateMsPerSecond,
    },
    {
      dead: false,
      activatable: true,
      indeterminate: false,
      activelyWorking: false,
      rateMsPerSecond: 40,
    },
  );
  assert.equal(live.activatable, true);
  assert.equal(live.activelyWorking, true);
  assert.equal(live.rateMsPerSecond, 80);
  assert.equal(unknown.indeterminate, true);
  assert.equal(unknown.activelyWorking, true);
});

test("should characterize missing registration, missing conversation, and missing resume command", async () => {
  const missingRegistration = planRelaunch([], { force: true });
  const missingConversation = planRelaunch([
    deadCandidate({ convId: undefined }),
  ], { force: true });
  const missingResume = planRelaunch([
    deadCandidate({ profile: "shell" }),
  ], { force: true });

  assert.deepEqual(missingRegistration, { actions: [], skipped: [] });
  assert.equal(missingConversation.actions.length, 0);
  assert.match(missingConversation.skipped[0].reason, /no convId/);
  assert.equal(missingResume.actions.length, 0);
  assert.match(missingResume.skipped[0].reason, /has no resume form/);

  const calls = [];
  const noLaunchContext = chainRelauncher(
    localTmuxRelauncher({ runtime: { run: (...args) => void calls.push(args) } }),
    headlessRelauncher({
      runtime: {
        spawnDetached: (...args) => void calls.push(args),
      },
    }),
  );
  assert.equal(
    await noLaunchContext.relance({
      instance: INSTANCE,
      reason: "stopped",
      workStatus: "paused",
      relanceCount: 0,
    }),
    false,
  );
  assert.deepEqual(calls, []);
});

for (const hostKind of ["local-tmux", "local-native"]) {
  test(`should expose M07 ${hostKind} post-effect actuator failure without a false green`, async () => {
    const native = createNativeScenarioAdapter({
      hostKind,
      apply: true,
      actuatorResult: false,
      partialEffect: true,
    });
    const result = await runTwinTargetScenario({
      scenario: `M07 ${hostKind} partial actuator failure`,
      phase: "post-effect-failure",
      hostKind,
      input: { exactTarget: INSTANCE, apply: true },
      native,
    });

    assert.equal(result.targetA.exitCode, 1);
    assert.equal(result.targetA.finalTargetState.recoveries, 1);
    assert.equal(result.targetA.terminalInputs.length, 1);
    assert.equal(result.targetA.reconciliation.effectIndependentlyObserved, true);
    assert.throws(
      () => assertScenarioPhase(result),
      /post-effect failure must be reconciled/,
      "a visible but unreconciled recovery cannot satisfy the phase oracle",
    );
  });
}

test("should characterize native OQ2 and custody inputs as unconsumed by the current relaunch adapters", async () => {
  const admitted = createNativeScenarioAdapter({
    hostKind: "local-tmux",
    apply: true,
    oq2Available: true,
    custodyState: "authorized-current-generation",
  });
  const revoked = createNativeScenarioAdapter({
    hostKind: "local-tmux",
    apply: true,
    oq2Available: false,
    custodyState: "revoked",
  });
  const admittedResult = await runTwinTargetScenario({
    scenario: "M07 OQ2 available with current custody",
    phase: "accepted-success",
    hostKind: "local-tmux",
    input: { oq2Available: true, custodyState: "authorized-current-generation" },
    native: admitted,
  });
  const revokedResult = await runTwinTargetScenario({
    scenario: "M07 OQ2 unavailable with revoked custody",
    phase: "accepted-success",
    hostKind: "local-tmux",
    input: { oq2Available: false, custodyState: "revoked" },
    native: revoked,
  });

  assertScenarioPhase(admittedResult);
  assertScenarioPhase(revokedResult);
  assert.equal(admittedResult.targetA.terminalInputs.length, 1);
  assert.equal(revokedResult.targetA.terminalInputs.length, 1);
  assert.throws(
    () => assertScenarioPhase({ ...revokedResult, phase: "pre-admission-refusal" }),
    /zero-effect phase changed target state/,
    "the oracle must expose that revoked custody is not an admission input natively",
  );
});

test("should characterize M07 layout selection and resume-command precedence", async () => {
  const calls = { run: [], spawnDetached: [] };
  const runtime = {
    run(file, args) {
      calls.run.push([file, ...args]);
      return true;
    },
    spawnDetached(command, options) {
      calls.spawnDetached.push({ command, cwd: options.cwd });
      return true;
    },
  };
  const tmux = localTmuxRelauncher({ runtime });
  const native = headlessRelauncher({ runtime });
  const tmuxFinding = finding("local-tmux", "codex resume exact-tmux");
  tmuxFinding.launchContext.command = "codex fresh";
  const nativeFinding = finding("local-native", "codex resume exact-native");
  nativeFinding.launchContext.command = "codex fresh";
  nativeFinding.launchContext.cwd = "/layout/native";

  assert.equal(await tmux.relance(tmuxFinding), true);
  assert.equal(await native.relance(nativeFinding), true);
  assert.deepEqual(calls.run[0], [
    "tmux",
    "send-keys",
    "-t",
    "h2a-m07-worker:agent.0",
    "-l",
    "codex resume exact-tmux",
  ]);
  assert.deepEqual(calls.spawnDetached, [
    { command: "codex resume exact-native", cwd: "/layout/native" },
  ]);
});

test("should characterize local-native relaunch as detached with NO_CONTROLLING_TERMINAL", async () => {
  assert.equal(process.platform, "linux", "M07 detached process characterization requires Linux");
  const directory = mkdtempSync(join(tmpdir(), "h2a-m07-no-tty-"));
  const observerPath = join(directory, "observe-no-tty.mjs");
  const outputPath = join(directory, "outcome.json");
  const source = String.raw`
import { readFileSync, writeFileSync } from "node:fs";
const raw = readFileSync("/proc/self/stat", "utf8");
const end = raw.lastIndexOf(") ");
const fields = raw.slice(end + 2).split(" ");
const ttyNr = Number(fields[4]);
writeFileSync(process.argv[2], JSON.stringify({
  code: ttyNr === 0 ? "NO_CONTROLLING_TERMINAL" : "CONTROLLING_TERMINAL_PRESENT",
  stdinIsTTY: process.stdin.isTTY === true,
  stdoutIsTTY: process.stdout.isTTY === true,
  ttyNr,
}));
`;
  writeFileSync(observerPath, source);
  try {
    const command = [process.execPath, observerPath, outputPath]
      .map(shellQuote)
      .join(" ");
    const relauncher = headlessRelauncher();
    const detachedFinding = finding("local-native", command);
    detachedFinding.launchContext.cwd = directory;
    assert.equal(
      await relauncher.relance(detachedFinding),
      true,
    );
    const observed = await eventually(
      () => existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, "utf8")) : undefined,
      (value) => value !== undefined,
      "detached local-native relaunch",
    );
    assert.deepEqual(observed, {
      code: "NO_CONTROLLING_TERMINAL",
      stdinIsTTY: false,
      stdoutIsTTY: false,
      ttyNr: 0,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("should fence an old tmux kill identity after pane generation changes", () => {
  let samples = 0;
  const current = {
    pane: "%current",
    paneCommand: "bash",
    panePid: 202,
    firstWorkerPid: 202,
    secondWorkerPid: 202,
    firstCpuMs: 0,
    secondCpuMs: 0,
    elapsedMs: 250,
  };
  const killed = killLocalSession(
    "h2a-m07-worker",
    { pane: "%old", panePid: 101 },
    {
      resolvePane: () => {
        samples += 1;
        return current.pane;
      },
      panePid: () => current.panePid,
      paneCommand: () => current.paneCommand,
      observe: () => ({
        worker: { pid: current.panePid, startTime: 1 },
        cpuMs: 0,
      }),
      sleep: () => undefined,
      now: (() => {
        let tick = 0;
        return () => (tick += 250);
      })(),
    },
  );

  assert.equal(killed, false);
  assert.equal(samples, 1);
});

test("should serialize same-conversation resume claims but expose no durable completion receipt", () => {
  const directory = mkdtempSync(join(tmpdir(), "h2a-m07-claim-"));
  try {
    const first = tryAcquireResumeLaunchClaim(CONVERSATION, { root: directory });
    assert.ok(first);
    assert.equal(
      tryAcquireResumeLaunchClaim(CONVERSATION, { root: directory }),
      undefined,
      "a concurrent retry must not launch the same conversation",
    );
    const other = tryAcquireResumeLaunchClaim("different-conversation", { root: directory });
    assert.ok(other);
    other.release();
    first.release();

    const afterRelease = tryAcquireResumeLaunchClaim(CONVERSATION, { root: directory });
    assert.ok(
      afterRelease,
      "claim release forgets completion and permits a later replay after a lost receipt",
    );
    afterRelease.release();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const hostKind of ["local-tmux", "local-native"]) {
  for (const phase of ["F1", "F2", "F3"]) {
    test(`should characterize M07 ${hostKind} ${phase} restart and concurrent retry reconciliation`, async () => {
      const restarted = await exerciseRetryFault(hostKind, phase, "restart");
      const concurrent = await exerciseRetryFault(hostKind, phase, "concurrent");

      assert.equal(restarted.old.status, "terminated");
      assert.equal(concurrent.old.status, "terminated");
      assert.equal(restarted.attempts.length, 2);
      assert.equal(concurrent.attempts.length, 2);
      assert.deepEqual(
        restarted.attempts.map((attempt) => attempt.registrationGeneration),
        [1, 2],
      );
      assert.deepEqual(
        concurrent.attempts.map((attempt) => attempt.command),
        ["codex resume old-generation", "codex resume current-generation"],
      );

      if (phase === "F1") {
        assertOneCurrentGeneration(restarted);
        assertOneCurrentGeneration(concurrent);
      } else {
        assert.equal(restarted.replacements.length, 2);
        assert.equal(concurrent.replacements.length, 2);
        assert.equal(
          restarted.replacements.filter((replacement) => replacement.status === "active").length,
          1,
        );
        assert.throws(
          () => assertOneCurrentGeneration(restarted),
          /second recovery\/process bounce/,
          "the native boolean relauncher cannot reconcile a created replacement after receipt loss",
        );
        assert.throws(
          () => assertOneCurrentGeneration(concurrent),
          /second recovery\/process bounce/,
          "concurrent native retries have no generation-bound idempotency key",
        );
      }
    });
  }
}

test("should expose stale-generation relaunch replay rather than claiming current-generation safety", async () => {
  for (const hostKind of ["local-tmux", "local-native"]) {
    const effects = [];
    const runtime = {
      run(_file, args) {
        if (args.includes("-l")) effects.push(args.at(-1));
        return true;
      },
      spawnDetached(command) {
        effects.push(typeof command === "string" ? command : command.file);
        return true;
      },
    };
    const relauncher = hostKind === "local-tmux"
      ? localTmuxRelauncher({ runtime })
      : headlessRelauncher({ runtime });

    assert.equal(
      await relauncher.relance(finding(hostKind, "codex resume current", {
        registrationGeneration: 2,
      })),
      true,
    );
    assert.equal(
      await relauncher.relance(finding(hostKind, "codex resume stale", {
        registrationGeneration: 1,
      })),
      true,
    );
    assert.deepEqual(effects, ["codex resume current", "codex resume stale"]);
  }
});

test.todo(
  "M07 Target-B differential parity — pending enlarged cluster-mesh contract and capability bundle",
);
test.todo(
  "M07 exact runtime CLI apply/dry-run output and exit parity — h2a-runtime orchestration path remains CI-only",
);
test.todo(
  "M07 OQ2 and custody admission — native relaunch adapters do not consume registration holder, epoch, or revocation evidence",
);
test.todo(
  "M07 contract-grade typed outcome and receipt parity — native relaunch surfaces expose boolean success only",
);
test.todo(
  "M07 crash between termination and recovery — native CLI has no durable transaction that can rediscover a removed exact target",
);
test.todo(
  "M07 F2/F3 lost-receipt retry — reconcile terminated old and possibly-created replacement without a second recovery",
);
test.todo(
  "M07 re-registration generation binding — stale relaunch findings can still dispatch after the current generation",
);
test.todo(
  "M07 local-native terminal outcome parity — detached fallback proves NO_CONTROLLING_TERMINAL but returns no typed terminal outcome",
);
