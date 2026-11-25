import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { registerArchiveCommand } from "./archive-cli.js";
import {
  buildH2aArchiveScheduleDescriptor,
  formatArchiveScheduleHumanStatus,
  H2A_ARCHIVE_TASK_ID,
  H2A_LINGER_ENABLE_COMMAND,
  runArchiveScheduleDisable,
  runArchiveScheduleEnable,
  runArchiveScheduleExec,
  runArchiveScheduleStatus,
  runArchiveScheduleUninstall,
} from "./archive-schedule.js";
import {
  createFakeSchedulerAdapter,
  LOCAL_SCHEDULER_NOT_INSTALLED_EXIT_CODE,
  LocalSchedulerNotInstalledError,
  resolveRealScheduledTaskRunner,
  resolveRealSchedulerAdapter,
} from "./local-scheduler-adapter.js";
import {
  BLOCKED_LOADER_ENV_VARS,
  evaluateKillSwitch,
  evaluateTaskHealth,
  InvalidTaskSpecError,
  isTaskKillSwitchActive,
  LOCAL_TASK_MANIFEST_V1,
  LOCAL_TASK_WITNESS_V1,
  parseSchedulerEnvFile,
  PolicyRefusalError,
  probeStateDirObservability,
  readSchedulerEnvFile,
  readTaskManifest,
  readTaskWitness,
  renderSystemdUnits,
  TaskNotFoundError,
  UnmanagedUnitError,
  type LocalTaskManifestV1,
  type LocalTaskWitnessV1,
  type RunScheduledTaskResultV1,
} from "./local-scheduler-contract.js";
import {
  ARCHIVE_ALERT_EXIT_CODE,
  DAY_MS,
  emitResumeArchiveNotices,
  emitResumeScheduleNotices,
  formatArchiveScheduleResumeBannerLines,
  formatArchiveScheduleStatusLines,
  isArchiveKillSwitchEnabled,
  readArchiveScheduleHealth,
  readClaudeArchiveAlerts,
  runArchivePassOnce,
  type ArchiveDeps,
} from "./session-archive.js";
import { projectStatusForH2a } from "./status-projection.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TEST_TMP_ROOT = join(REPO_ROOT, ".tmp", "archive-schedule-unit");

const FIXED_NOW_MS = Date.UTC(2026, 10, 25, 15, 0, 0);
const FIXED_NOW_ISO = new Date(FIXED_NOW_MS).toISOString();
const UUID_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN_UUID_1 = "11111111-1111-4111-8111-111111111111";

interface TestEnv {
  readonly root: string;
  readonly home: string;
  readonly stateDir: string;
  readonly envFilePath: string;
  readonly unitDir: string;
  readonly xdgData: string;
  readonly claudeDir: string;
  readonly h2aRoot: string;
  readonly nodeBin: string;
  readonly h2aBinScript: string;
  readonly env: NodeJS.ProcessEnv;
}

let activeRoots: string[] = [];

function createIsolatedTestEnv(): TestEnv {
  mkdirSync(TEST_TMP_ROOT, { recursive: true });
  const root = mkdtempSync(join(TEST_TMP_ROOT, "case-"));
  activeRoots.push(root);
  const home = join(root, "home");
  const xdgConfig = join(home, ".config");
  const xdgState = join(home, ".local", "state");
  const xdgData = join(home, ".local", "share");
  const stateDir = join(xdgState, "sentropic", "local-scheduler");
  const envFilePath = join(xdgConfig, "sentropic", "local-scheduler", "env");
  const unitDir = join(xdgConfig, "systemd", "user");
  const claudeDir = join(root, "claude-config");
  const h2aRoot = join(root, "h2a-root");
  const nodeBin = join(root, "node");
  const h2aBinScript = join(root, "fake-h2a-bin.js");
  mkdirSync(home, { recursive: true });
  mkdirSync(xdgConfig, { recursive: true });
  mkdirSync(xdgState, { recursive: true });
  mkdirSync(xdgData, { recursive: true });
  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(h2aRoot, { recursive: true });
  writeFileSync(nodeBin, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0]), { mode: 0o700 });
  writeFileSync(h2aBinScript, "#!/usr/bin/env node\nconsole.log('ok');\n", {
    encoding: "utf8",
    mode: 0o700,
  });
  return {
    root,
    home,
    stateDir,
    envFilePath,
    unitDir,
    xdgData,
    claudeDir,
    h2aRoot,
    nodeBin,
    h2aBinScript,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      XDG_CONFIG_HOME: xdgConfig,
      XDG_STATE_HOME: xdgState,
      XDG_DATA_HOME: xdgData,
      CLAUDE_CONFIG_DIR: claudeDir,
      H2A_ROOT: h2aRoot,
      SENTROPIC_LOCAL_SCHEDULER_STATE_DIR: stateDir,
    },
  };
}

function makeWitness(overrides: Partial<LocalTaskWitnessV1> = {}): LocalTaskWitnessV1 {
  return {
    v: LOCAL_TASK_WITNESS_V1,
    taskId: H2A_ARCHIVE_TASK_ID,
    owner: "h2a",
    runId: RUN_UUID_1,
    trigger: "systemd-timer",
    host: "workstation-test",
    pid: 4242,
    startedAt: new Date(FIXED_NOW_MS - 3_600_000 - 5_000).toISOString(),
    finishedAt: new Date(FIXED_NOW_MS - 3_600_000).toISOString(),
    durationMs: 5_000,
    outcome: "succeeded",
    exitCode: 0,
    signal: null,
    consecutiveFailures: 0,
    lastSuccessAt: new Date(FIXED_NOW_MS - 3_600_000).toISOString(),
    lastSuccessRunId: RUN_UUID_1,
    ...overrides,
  };
}

function makeManifest(box: TestEnv, overrides: Partial<LocalTaskManifestV1> = {}): LocalTaskManifestV1 {
  const { spec, policy } = buildH2aArchiveScheduleDescriptor({
    deps: {
      env: box.env,
      nodeBin: box.nodeBin,
      h2aBinScript: box.h2aBinScript,
      stateDir: box.stateDir,
      envFilePath: box.envFilePath,
    },
  });
  return {
    v: LOCAL_TASK_MANIFEST_V1,
    spec,
    runner: policy.runner,
    enabled: true,
    installedAt: new Date(FIXED_NOW_MS - 10 * DAY_MS).toISOString(),
    enabledAt: new Date(FIXED_NOW_MS - 10 * DAY_MS).toISOString(),
    stateDir: box.stateDir,
    envFilePath: box.envFilePath,
    expectedIntervalMs: 86_400_000,
    units: {
      serviceSha256: "a".repeat(64),
      timerSha256: "b".repeat(64),
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const root of activeRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  activeRoots = [];
});

afterAll(() => {
  rmSync(TEST_TMP_ROOT, { recursive: true, force: true });
});

describe("h2a archive schedule wiring & §4 contract (H1)", () => {
  it("supports full enable -> status -> disable -> re-enable -> uninstall lifecycle with FakeSchedulerAdapter", async () => {
    const box = createIsolatedTestEnv();
    let nowIso = new Date(FIXED_NOW_MS - 2 * 3_600_000).toISOString();
    const adapter = createFakeSchedulerAdapter({
      clock: () => nowIso,
      stateDir: box.stateDir,
      envFilePath: box.envFilePath,
    });
    const deps = {
      adapter,
      env: box.env,
      nodeBin: box.nodeBin,
      h2aBinScript: box.h2aBinScript,
      stateDir: box.stateDir,
      envFilePath: box.envFilePath,
      unitDir: box.unitDir,
    };

    const enabled = await runArchiveScheduleEnable({ calendar: "daily", olderThan: "14d" }, deps);
    expect(enabled.manifest.v).toBe(LOCAL_TASK_MANIFEST_V1);
    expect(enabled.manifest.enabled).toBe(true);
    expect(enabled.manifest.spec.schedule.onCalendar).toBe("daily");
    expect(enabled.manifest.spec.schedule.persistent).toBe(true);
    expect(enabled.manifest.spec.schedule.graceMultiplier).toBe(1.5);
    expect(enabled.manifest.spec.killSwitchEnv).toBe("H2A_ARCHIVE_OFF");
    expect(enabled.manifest.spec.command.args).toContain("--scheduled");
    expect(enabled.manifest.spec.command.args).toContain("--max-duration");
    expect(enabled.manifest.spec.command.env?.H2A_ROOT).toBe(box.h2aRoot);
    expect(enabled.manifest.spec.command.env?.CLAUDE_CONFIG_DIR).toBe(box.claudeDir);
    expect(enabled.lingerEnabled).toBe(false);
    expect(enabled.lingerNotice).toContain(H2A_LINGER_ENABLE_COMMAND);

    // Check file modes and unit isolation (H2A_ROOT never leaks into .service unit).
    const manifestPath = join(box.stateDir, "tasks", H2A_ARCHIVE_TASK_ID, "manifest.json");
    expect(statSync(manifestPath).mode & 0o777).toBe(0o600);
    expect(statSync(enabled.servicePath).mode & 0o777).toBe(0o600);
    expect(statSync(enabled.timerPath).mode & 0o777).toBe(0o600);

    const rendered = adapter.getRenderedUnits(H2A_ARCHIVE_TASK_ID);
    expect(rendered).not.toBeNull();
    expect(rendered!.service).toContain("Type=oneshot");
    expect(rendered!.service).toContain("KillMode=mixed");
    expect(rendered!.service).toContain("SuccessExitStatus=130 143");
    expect(rendered!.service).toContain(`UnsetEnvironment=${BLOCKED_LOADER_ENV_VARS.join(" ")}`);
    expect(rendered!.service).toContain("RestrictAddressFamilies=AF_UNIX");
    expect(rendered!.service).toContain(`"archive" "_schedule-exec" "${H2A_ARCHIVE_TASK_ID}"`);
    expect(rendered!.service).not.toContain("H2A_ROOT");
    expect(rendered!.service).not.toContain("CLAUDE_CONFIG_DIR");
    expect(rendered!.timer).toContain("OnCalendar=daily");
    expect(rendered!.timer).toContain("Persistent=true");

    // Production readers observe real manifest written by fake adapter.
    const diskManifest = readTaskManifest(box.stateDir, H2A_ARCHIVE_TASK_ID);
    expect(diskManifest).not.toBeNull();
    expect(diskManifest).not.toBe("corrupt");

    // Status right after enable -> pending_first_run + linger disabled indication.
    const pendingStatus = await runArchiveScheduleStatus({ nowIso }, deps);
    expect(pendingStatus.health.status).toBe("pending_first_run");
    expect(pendingStatus.lingerEnabled).toBe(false);
    const humanPending = formatArchiveScheduleHumanStatus(pendingStatus);
    expect(humanPending).toContain("linger       : disabled");
    expect(humanPending).toContain(H2A_LINGER_ENABLE_COMMAND);

    // Write real witness via fake adapter -> healthy.
    adapter.setWitness(H2A_ARCHIVE_TASK_ID, makeWitness());
    expect(readTaskWitness(box.stateDir, H2A_ARCHIVE_TASK_ID)).not.toBeNull();
    const healthyStatus = await runArchiveScheduleStatus({ nowIso: FIXED_NOW_ISO }, deps);
    expect(healthyStatus.health.status).toBe("healthy");
    expect(healthyStatus.health.severity).toBe("ok");

    // Disable keeps units & witness, updates manifest.enabled=false.
    const disabled = await runArchiveScheduleDisable(deps);
    expect(disabled.manifest.enabled).toBe(false);
    const disabledStatus = await runArchiveScheduleStatus({ nowIso: FIXED_NOW_ISO }, deps);
    expect(disabledStatus.health.status).toBe("disabled");

    // Re-enable preserves installedAt and updates enabledAt.
    nowIso = FIXED_NOW_ISO;
    const reEnabled = await runArchiveScheduleEnable({ calendar: "daily" }, deps);
    expect(reEnabled.manifest.installedAt).toBe(enabled.manifest.installedAt);
    expect(reEnabled.manifest.enabledAt).toBe(FIXED_NOW_ISO);

    // Uninstall without purge keeps witness; second uninstall is idempotent; purge removes state.
    const uninstalled1 = await runArchiveScheduleUninstall({ purgeState: false }, deps);
    expect(uninstalled1.removedUnits).toHaveLength(2);
    expect(readTaskManifest(box.stateDir, H2A_ARCHIVE_TASK_ID)).toBeNull();
    expect(readTaskWitness(box.stateDir, H2A_ARCHIVE_TASK_ID)).not.toBeNull();

    const uninstalled2 = await runArchiveScheduleUninstall({ purgeState: true }, deps);
    expect(uninstalled2.removedUnits).toHaveLength(0);
    expect(uninstalled2.purgedState).toBe(true);
    expect(readTaskWitness(box.stateDir, H2A_ARCHIVE_TASK_ID)).toBeNull();
  });

  it("refuses TaskNotFoundError on disable when absent and UnmanagedUnitError on foreign unit headers", async () => {
    const box = createIsolatedTestEnv();
    const adapter = createFakeSchedulerAdapter({
      stateDir: box.stateDir,
      envFilePath: box.envFilePath,
    });
    const deps = {
      adapter,
      env: box.env,
      nodeBin: box.nodeBin,
      h2aBinScript: box.h2aBinScript,
      stateDir: box.stateDir,
      envFilePath: box.envFilePath,
      unitDir: box.unitDir,
    };

    await expect(runArchiveScheduleDisable(deps)).rejects.toThrowError(TaskNotFoundError);

    mkdirSync(box.unitDir, { recursive: true, mode: 0o700 });
    chmodSync(box.unitDir, 0o700);
    writeFileSync(
      join(box.unitDir, `sentropic-task-${H2A_ARCHIVE_TASK_ID}.service`),
      "[Unit]\nDescription=Hand-written unit\n",
      "utf8",
    );
    await expect(runArchiveScheduleEnable({}, deps)).rejects.toThrowError(UnmanagedUnitError);
  });

  it("rejects invalid calendar specs, loader-env injection, and secret env vars", async () => {
    const box = createIsolatedTestEnv();
    const adapter = createFakeSchedulerAdapter({
      stateDir: box.stateDir,
      envFilePath: box.envFilePath,
    });
    const deps = {
      adapter,
      env: box.env,
      nodeBin: box.nodeBin,
      h2aBinScript: box.h2aBinScript,
      stateDir: box.stateDir,
      envFilePath: box.envFilePath,
      unitDir: box.unitDir,
    };

    await expect(runArchiveScheduleEnable({ calendar: "-bad-leading-dash" }, deps)).rejects.toThrowError(
      InvalidTaskSpecError,
    );
    await expect(runArchiveScheduleEnable({ calendar: "daily\nExecStart=/bin/sh" }, deps)).rejects.toThrowError(
      InvalidTaskSpecError,
    );

    const { spec, policy } = buildH2aArchiveScheduleDescriptor({ deps });
    await expect(
      adapter.enable(
        {
          ...spec,
          command: { ...spec.command, env: { NODE_OPTIONS: "--require=/nonexistent/evil.js" } },
        },
        policy,
      ),
    ).rejects.toThrowError(InvalidTaskSpecError);

    await expect(
      adapter.enable(
        {
          ...spec,
          command: { ...spec.command, env: { ANTHROPIC_API_KEY: "secret" } },
        },
        policy,
      ),
    ).rejects.toThrowError(InvalidTaskSpecError);

    await expect(
      adapter.enable(spec, { ...policy, allowedScripts: [] }),
    ).rejects.toThrowError(InvalidTaskSpecError);

    await expect(
      adapter.enable(spec, { ...policy, allowedBins: ["/nonexistent/bin"] }),
    ).rejects.toThrowError(PolicyRefusalError);
  });

  it("fails closed with clear 'local-scheduler not installed' error (exit 69) when real package is absent", async () => {
    const box = createIsolatedTestEnv();

    await expect(resolveRealSchedulerAdapter()).rejects.toThrowError(LocalSchedulerNotInstalledError);
    await expect(resolveRealScheduledTaskRunner()).rejects.toThrowError(LocalSchedulerNotInstalledError);

    for (const fn of [
      () => runArchiveScheduleEnable({}, { env: box.env, h2aBinScript: box.h2aBinScript }),
      () => runArchiveScheduleDisable({ env: box.env }),
      () => runArchiveScheduleStatus({}, { env: box.env }),
      () => runArchiveScheduleUninstall({}, { env: box.env }),
      () => runArchiveScheduleExec(H2A_ARCHIVE_TASK_ID, { env: box.env, h2aBinScript: box.h2aBinScript }),
    ]) {
      let caught: unknown;
      try {
        await fn();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(LocalSchedulerNotInstalledError);
      expect((caught as LocalSchedulerNotInstalledError).exitCode).toBe(
        LOCAL_SCHEDULER_NOT_INSTALLED_EXIT_CODE,
      );
      expect((caught as LocalSchedulerNotInstalledError).message).toMatch(/local-scheduler not installed/i);
    }

    // Verify single resolution point works when an importer supplies the package exports.
    const fakeAdapter = createFakeSchedulerAdapter({
      stateDir: box.stateDir,
      envFilePath: box.envFilePath,
    });
    const resolvedAdapter = await resolveRealSchedulerAdapter({
      importer: async (spec) => {
        expect(spec).toBe("@sentropic/local-scheduler/systemd");
        return { createSystemdUserAdapter: () => fakeAdapter };
      },
    });
    expect(resolvedAdapter).toBe(fakeAdapter);

    // Non-missing-package import errors are propagated rather than masked as not-installed (NB-3).
    await expect(
      resolveRealSchedulerAdapter({
        importer: async () => {
          throw new SyntaxError("unexpected token in installed package");
        },
      }),
    ).rejects.toThrowError(SyntaxError);
    await expect(
      resolveRealSchedulerAdapter({
        importer: async () => {
          throw Object.assign(
            new Error("Cannot find package 'missing-dep' imported from @sentropic/local-scheduler"),
            { code: "ERR_MODULE_NOT_FOUND" },
          );
        },
      }),
    ).rejects.toThrowError(/missing-dep/);
    await expect(
      resolveRealSchedulerAdapter({
        importer: async () => {
          throw Object.assign(
            new Error("Cannot find package '@sentropic/local-scheduler/systemd'"),
            { code: "ERR_MODULE_NOT_FOUND" },
          );
        },
      }),
    ).rejects.toThrowError(LocalSchedulerNotInstalledError);
  });

  it("B-1: structurally recognizes foreign-class scheduler errors (69, 70, 77, 2) via importer seam in schedule CLI and _schedule-exec", async () => {
    const box = createIsolatedTestEnv();
    class ForeignSchedulerError extends Error {
      readonly code: string;
      readonly exitCode: number;
      constructor(code: string, exitCode: number, message: string) {
        super(message);
        this.name = "ForeignSchedulerError";
        this.code = code;
        this.exitCode = exitCode;
      }
    }

    const cases: ReadonlyArray<{
      readonly subcommand: "enable" | "disable" | "status" | "uninstall";
      readonly code: string;
      readonly exitCode: 2 | 69 | 70 | 77;
      readonly message: string;
      readonly plainObject?: boolean;
    }> = [
      {
        subcommand: "disable",
        code: "SYSTEMD_USER_UNAVAILABLE",
        exitCode: 69,
        message: "systemd --user manager unavailable (foreign)",
      },
      {
        subcommand: "enable",
        code: "SYSTEMCTL_FAILED",
        exitCode: 70,
        message: "systemctl enable failed (foreign)",
      },
      {
        subcommand: "uninstall",
        code: "POLICY_REFUSED_SANDBOX",
        exitCode: 77,
        message: "host PID namespace refused (foreign)",
      },
      {
        subcommand: "status",
        code: "POLICY_REFUSED_ALLOWLIST",
        exitCode: 77,
        message: "plain structural object refusal (foreign)",
        plainObject: true,
      },
      {
        subcommand: "disable",
        code: "TASK_NOT_FOUND",
        exitCode: 2,
        message: "task not installed (foreign)",
      },
    ];

    for (const tc of cases) {
      const throwForeign = () => {
        if (tc.plainObject) {
          throw { code: tc.code, exitCode: tc.exitCode, message: tc.message };
        }
        throw new ForeignSchedulerError(tc.code, tc.exitCode, tc.message);
      };

      let stdoutText = "";
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        stdoutText += String(chunk);
        return true;
      });
      const savedExitCode = process.exitCode;
      process.exitCode = undefined;
      try {
        const program = new Command();
        registerArchiveCommand(program, {
          env: box.env,
          nodeBin: box.nodeBin,
          h2aBinScript: box.h2aBinScript,
          stateDir: box.stateDir,
          envFilePath: box.envFilePath,
          unitDir: box.unitDir,
          importer: async (specifier) => {
            expect(specifier).toBe("@sentropic/local-scheduler/systemd");
            return {
              createSystemdUserAdapter: () => ({
                enable: async () => throwForeign(),
                disable: async () => throwForeign(),
                status: async () => throwForeign(),
                uninstall: async () => throwForeign(),
              }),
            };
          },
        });
        await program.parseAsync(["node", box.h2aBinScript, "archive", "schedule", tc.subcommand, "--json"]);
        expect(process.exitCode).toBe(tc.exitCode);
        const body = JSON.parse(stdoutText);
        expect(body).toEqual({
          ok: false,
          errorCode: tc.code,
          exitCode: tc.exitCode,
          error: tc.message,
        });
      } finally {
        process.exitCode = savedExitCode;
        stdoutSpy.mockRestore();
      }
    }

    // _schedule-exec catch also recognizes foreign-class scheduler errors (69, 70, 77) via importer seam.
    for (const tc of [
      { code: "SYSTEMD_USER_UNAVAILABLE", exitCode: 69, message: "systemd unavailable in runner" },
      { code: "SYSTEMCTL_FAILED", exitCode: 70, message: "runner internal failure" },
      { code: "POLICY_REFUSED_FILE_MODE", exitCode: 77, message: "bad manifest mode" },
    ]) {
      let stderrText = "";
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
        stderrText += String(chunk);
        return true;
      });
      const savedExitCode = process.exitCode;
      process.exitCode = undefined;
      try {
        const program = new Command();
        registerArchiveCommand(program, {
          env: box.env,
          nodeBin: box.nodeBin,
          h2aBinScript: box.h2aBinScript,
          stateDir: box.stateDir,
          importer: async (specifier) => {
            expect(specifier).toBe("@sentropic/local-scheduler/runner");
            return {
              runScheduledTaskById: async () => {
                throw new ForeignSchedulerError(tc.code, tc.exitCode, tc.message);
              },
            };
          },
        });
        await program.parseAsync(["node", box.h2aBinScript, "archive", "_schedule-exec", H2A_ARCHIVE_TASK_ID]);
        expect(process.exitCode).toBe(tc.exitCode);
        expect(stderrText).toContain(`[local-scheduler] ${tc.code}: ${tc.message}`);
      } finally {
        process.exitCode = savedExitCode;
        stderrSpy.mockRestore();
      }
    }
  });

  it("propagates all contract exit codes and error diagnostics in _schedule-exec", async () => {
    const box = createIsolatedTestEnv();
    const cases: ReadonlyArray<RunScheduledTaskResultV1> = [
      { outcome: "succeeded", exitCode: 0, witness: makeWitness() },
      {
        outcome: "skipped_disabled",
        exitCode: 0,
        witness: makeWitness({ outcome: "skipped_disabled", killSwitch: { scope: "alias", name: "H2A_ARCHIVE_OFF" } }),
      },
      { outcome: "skipped_locked", exitCode: 0, witness: null },
      { outcome: "failed", exitCode: 1, witness: makeWitness({ outcome: "failed", exitCode: 1, consecutiveFailures: 1 }) },
      {
        outcome: "not_run",
        exitCode: 2,
        witness: null,
        error: { code: "TASK_NOT_FOUND", message: "manifest absent" },
      },
      {
        outcome: "not_run",
        exitCode: 70,
        witness: null,
        error: { code: "SYSTEMCTL_FAILED", message: "io failure" },
      },
      {
        outcome: "refused_policy",
        exitCode: 77,
        witness: null,
        error: { code: "POLICY_REFUSED_SANDBOX", message: "outside host init ns" },
      },
      {
        outcome: "timed_out",
        exitCode: 124,
        witness: makeWitness({ outcome: "timed_out", exitCode: null, signal: "SIGKILL" }),
      },
      {
        outcome: "interrupted",
        exitCode: 130,
        witness: makeWitness({ outcome: "interrupted", exitCode: null, signal: "SIGINT" }),
      },
      {
        outcome: "interrupted",
        exitCode: 143,
        witness: makeWitness({ outcome: "interrupted", exitCode: null, signal: "SIGTERM" }),
      },
    ];

    for (const expected of cases) {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const savedExitCode = process.exitCode;
      process.exitCode = undefined;
      try {
        const program = new Command();
        registerArchiveCommand(program, {
          env: box.env,
          nodeBin: box.nodeBin,
          h2aBinScript: box.h2aBinScript,
          runner: async (taskId, opts) => {
            expect(taskId).toBe(H2A_ARCHIVE_TASK_ID);
            expect(opts.allowedBins).toContain(box.nodeBin);
            expect(opts.allowedScripts).toContain(box.h2aBinScript);
            return expected;
          },
        });
        await program.parseAsync(["node", box.h2aBinScript, "archive", "_schedule-exec", H2A_ARCHIVE_TASK_ID]);
        expect(process.exitCode).toBe(expected.exitCode);
        if (expected.error) {
          const stderrText = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
          expect(stderrText).toContain(`[local-scheduler] ${expected.error.code}: ${expected.error.message}`);
        }
      } finally {
        process.exitCode = savedExitCode;
        stderrSpy.mockRestore();
      }
    }
  });

  it("evaluates health truth table: >36h overdue, global/task/alias kill-switches, dead-timer pause, failures, and unobservability", () => {
    const box = createIsolatedTestEnv();
    const manifest = makeManifest(box, {
      enabledAt: new Date(FIXED_NOW_MS - 40 * 3_600_000).toISOString(),
    });

    // Overdue > 36h on daily cadence (36h = 129_600_000 ms).
    const at35h = new Date(FIXED_NOW_MS - 35 * 3_600_000).toISOString();
    expect(
      evaluateTaskHealth({
        stateDirObservable: true,
        manifest,
        witness: makeWitness({ finishedAt: at35h, lastSuccessAt: at35h }),
        nowIso: FIXED_NOW_ISO,
      }).status,
    ).toBe("healthy");

    const at37h = new Date(FIXED_NOW_MS - 37 * 3_600_000).toISOString();
    const missed = evaluateTaskHealth({
      stateDirObservable: true,
      manifest,
      witness: makeWitness({ finishedAt: at37h, lastSuccessAt: at37h }),
      nowIso: FIXED_NOW_ISO,
    });
    expect(missed.status).toBe("schedule_missed");
    expect(missed.severity).toBe("critical");
    expect(missed.overdueByMs).toBe(3_600_000);
    expect(missed.opsReason).toBe("schedule-missed");

    // Global, per-task, and alias kill-switches + env-file parser.
    const parsedEnv = parseSchedulerEnvFile(
      [
        "# comment",
        "; semicolon comment",
        "SENTROPIC_LOCAL_SCHEDULER_OFF=1",
        'SENTROPIC_TASK_H2A_SESSION_ARCHIVE_OFF="true"',
        "H2A_ARCHIVE_OFF='yes'",
        "malformed-line",
      ].join("\n"),
    );
    expect(evaluateKillSwitch(parsedEnv, manifest.spec)).toEqual({
      scope: "global",
      name: "SENTROPIC_LOCAL_SCHEDULER_OFF",
    });
    expect(
      evaluateKillSwitch(
        {
          SENTROPIC_LOCAL_SCHEDULER_OFF: "0",
          SENTROPIC_TASK_H2A_SESSION_ARCHIVE_OFF: "1",
          H2A_ARCHIVE_OFF: "1",
        },
        manifest.spec,
      ),
    ).toEqual({
      scope: "task",
      name: "SENTROPIC_TASK_H2A_SESSION_ARCHIVE_OFF",
    });
    expect(
      evaluateKillSwitch(
        {
          SENTROPIC_LOCAL_SCHEDULER_OFF: "false",
          SENTROPIC_TASK_H2A_SESSION_ARCHIVE_OFF: "",
          H2A_ARCHIVE_OFF: "1",
        },
        manifest.spec,
      ),
    ).toEqual({
      scope: "alias",
      name: "H2A_ARCHIVE_OFF",
    });
    expect(isTaskKillSwitchActive({ H2A_ARCHIVE_OFF: "0" }, manifest.spec)).toBe(false);

    // Fresh skipped_disabled witness: paused/ok within 36h, paused/warning after 36h since lastSuccessAt.
    const pausedFresh = evaluateTaskHealth({
      stateDirObservable: true,
      manifest,
      witness: makeWitness({
        outcome: "skipped_disabled",
        finishedAt: new Date(FIXED_NOW_MS - 1 * 3_600_000).toISOString(),
        lastSuccessAt: at37h,
        killSwitch: { scope: "global", name: "SENTROPIC_LOCAL_SCHEDULER_OFF" },
      }),
      nowIso: FIXED_NOW_ISO,
    });
    expect(pausedFresh.status).toBe("paused");
    expect(pausedFresh.severity).toBe("warning");

    // m-16: Stale skipped_disabled witness (timer died > 36h ago without re-enable) falls through to step 10 -> schedule_missed/critical.
    const pausedDeadTimer = evaluateTaskHealth({
      stateDirObservable: true,
      manifest,
      witness: makeWitness({
        outcome: "skipped_disabled",
        finishedAt: at37h,
        lastSuccessAt: at37h,
        killSwitch: { scope: "task", name: "SENTROPIC_TASK_H2A_SESSION_ARCHIVE_OFF" },
      }),
      nowIso: FIXED_NOW_ISO,
    });
    expect(pausedDeadTimer.status).toBe("schedule_missed");
    expect(pausedDeadTimer.severity).toBe("critical");

    // NB-1 / §7.1(d): Re-enable after long pause uses enabledAt in step 10 -> healthy/ok (never false schedule_missed).
    const reEnabledAfterLongPause = evaluateTaskHealth({
      stateDirObservable: true,
      manifest: makeManifest(box, {
        enabledAt: new Date(FIXED_NOW_MS - 1 * 3_600_000).toISOString(),
      }),
      witness: makeWitness({
        outcome: "skipped_disabled",
        finishedAt: new Date(FIXED_NOW_MS - 40 * 3_600_000).toISOString(),
        lastSuccessAt: new Date(FIXED_NOW_MS - 50 * 3_600_000).toISOString(),
        killSwitch: { scope: "task", name: "SENTROPIC_TASK_H2A_SESSION_ARCHIVE_OFF" },
      }),
      nowIso: FIXED_NOW_ISO,
    });
    expect(reEnabledAfterLongPause.status).toBe("healthy");
    expect(reEnabledAfterLongPause.severity).toBe("ok");

    // Exact 36h boundary (129_600_000 ms is healthy; +1 ms is schedule_missed/critical).
    const atExact36h = new Date(FIXED_NOW_MS - 129_600_000).toISOString();
    expect(
      evaluateTaskHealth({
        stateDirObservable: true,
        manifest,
        witness: makeWitness({ finishedAt: atExact36h, lastSuccessAt: atExact36h }),
        nowIso: FIXED_NOW_ISO,
      }).status,
    ).toBe("healthy");
    const at36hPlus1Ms = new Date(FIXED_NOW_MS - 129_600_001).toISOString();
    const missedBy1Ms = evaluateTaskHealth({
      stateDirObservable: true,
      manifest,
      witness: makeWitness({ finishedAt: at36hPlus1Ms, lastSuccessAt: at36hPlus1Ms }),
      nowIso: FIXED_NOW_ISO,
    });
    expect(missedBy1Ms.status).toBe("schedule_missed");
    expect(missedBy1Ms.severity).toBe("critical");
    expect(missedBy1Ms.overdueByMs).toBe(1);

    // Single failure within deadline -> failing/warning.
    const singleFailureWithinDeadline = evaluateTaskHealth({
      stateDirObservable: true,
      manifest,
      witness: makeWitness({
        outcome: "failed",
        exitCode: 1,
        consecutiveFailures: 1,
        finishedAt: new Date(FIXED_NOW_MS - 3_600_000).toISOString(),
        lastSuccessAt: at35h,
      }),
      nowIso: FIXED_NOW_ISO,
    });
    expect(singleFailureWithinDeadline.status).toBe("failing");
    expect(singleFailureWithinDeadline.severity).toBe("warning");
    expect(singleFailureWithinDeadline.opsReason).toBe("job-failed");

    // Single failure past deadline -> failing/critical; reader-process env kill-switch NEVER downgrades failing.
    const failingPastDeadline = evaluateTaskHealth({
      stateDirObservable: true,
      manifest,
      witness: makeWitness({
        outcome: "failed",
        exitCode: 1,
        consecutiveFailures: 1,
        finishedAt: new Date(FIXED_NOW_MS - 3_600_000).toISOString(),
        lastSuccessAt: at37h,
      }),
      readerEnvKillSwitch: { scope: "alias", name: "H2A_ARCHIVE_OFF" },
      nowIso: FIXED_NOW_ISO,
    });
    expect(failingPastDeadline.status).toBe("failing");
    expect(failingPastDeadline.severity).toBe("critical");
    expect(failingPastDeadline.hints.some((h) => h.includes("does not pause the systemd user timer"))).toBe(true);

    // timed_out and refused_policy -> failing/critical with distinct opsReason.
    const timedOutHealth = evaluateTaskHealth({
      stateDirObservable: true,
      manifest,
      witness: makeWitness({
        outcome: "timed_out",
        exitCode: null,
        signal: "SIGKILL",
        consecutiveFailures: 1,
        finishedAt: new Date(FIXED_NOW_MS - 3_600_000).toISOString(),
        lastSuccessAt: at35h,
      }),
      nowIso: FIXED_NOW_ISO,
    });
    expect(timedOutHealth.status).toBe("failing");
    expect(timedOutHealth.severity).toBe("critical");
    expect(timedOutHealth.opsReason).toBe("deadline-exceeded");

    const refusedHealth = evaluateTaskHealth({
      stateDirObservable: true,
      manifest,
      witness: makeWitness({
        outcome: "refused_policy",
        refusal: "allowlist",
        exitCode: 77,
        consecutiveFailures: 1,
        finishedAt: new Date(FIXED_NOW_MS - 3_600_000).toISOString(),
        lastSuccessAt: at35h,
      }),
      nowIso: FIXED_NOW_ISO,
    });
    expect(refusedHealth.status).toBe("failing");
    expect(refusedHealth.severity).toBe("critical");
    expect(refusedHealth.opsReason).toBe("job-failed");

    // interrupted within deadline -> warning; interrupted past deadline -> schedule_missed/critical.
    const interruptedFresh = evaluateTaskHealth({
      stateDirObservable: true,
      manifest,
      witness: makeWitness({
        outcome: "interrupted",
        exitCode: null,
        signal: "SIGTERM",
        finishedAt: new Date(FIXED_NOW_MS - 3_600_000).toISOString(),
        lastSuccessAt: at35h,
      }),
      nowIso: FIXED_NOW_ISO,
    });
    expect(interruptedFresh.status).toBe("interrupted");
    expect(interruptedFresh.severity).toBe("warning");

    const interruptedOverdue = evaluateTaskHealth({
      stateDirObservable: true,
      manifest,
      witness: makeWitness({
        outcome: "interrupted",
        exitCode: null,
        signal: "SIGTERM",
        finishedAt: new Date(FIXED_NOW_MS - 3_600_000).toISOString(),
        lastSuccessAt: at37h,
      }),
      nowIso: FIXED_NOW_ISO,
    });
    expect(interruptedOverdue.status).toBe("schedule_missed");
    expect(interruptedOverdue.severity).toBe("critical");

    // clock_skew (> 5 min future) -> warning/stale.
    const futureIso = new Date(FIXED_NOW_MS + 6 * 60_000).toISOString();
    const clockSkewFinished = evaluateTaskHealth({
      stateDirObservable: true,
      manifest,
      witness: makeWitness({ finishedAt: futureIso, lastSuccessAt: at35h }),
      nowIso: FIXED_NOW_ISO,
    });
    expect(clockSkewFinished.status).toBe("clock_skew");
    expect(clockSkewFinished.severity).toBe("warning");
    expect(clockSkewFinished.opsReason).toBe("stale");

    const clockSkewLastSuccess = evaluateTaskHealth({
      stateDirObservable: true,
      manifest,
      witness: makeWitness({ finishedAt: at35h, lastSuccessAt: futureIso }),
      nowIso: FIXED_NOW_ISO,
    });
    expect(clockSkewLastSuccess.status).toBe("clock_skew");
    expect(clockSkewLastSuccess.severity).toBe("warning");

    // witness_corrupt for both manifest and witness -> critical/stale.
    const corruptManifest = evaluateTaskHealth({
      stateDirObservable: true,
      manifest: "corrupt",
      witness: null,
      nowIso: FIXED_NOW_ISO,
    });
    expect(corruptManifest.status).toBe("witness_corrupt");
    expect(corruptManifest.severity).toBe("critical");
    expect(corruptManifest.opsReason).toBe("stale");

    const corruptWitness = evaluateTaskHealth({
      stateDirObservable: true,
      manifest,
      witness: "corrupt",
      nowIso: FIXED_NOW_ISO,
    });
    expect(corruptWitness.status).toBe("witness_corrupt");
    expect(corruptWitness.severity).toBe("critical");
    expect(corruptWitness.opsReason).toBe("stale");

    // m-25: ExecStart= escapes $ -> $$ in both runner.bin and runner.args[0], while Environment= keeps $ literal.
    const renderedWithDollar = renderSystemdUnits({
      spec: manifest.spec,
      runner: {
        bin: "/opt/node$1/bin/node",
        args: ["/opt/app$2/bin.js", "archive", "_schedule-exec"],
      },
      enabled: true,
      installedAt: manifest.installedAt,
      enabledAt: manifest.enabledAt,
      stateDir: "/home/user/.local/state/dir$3",
      envFilePath: "/home/user/.config/dir$4/env",
      expectedIntervalMs: manifest.expectedIntervalMs,
    });
    expect(renderedWithDollar.service).toContain(
      'ExecStart="/opt/node$$1/bin/node" "/opt/app$$2/bin.js" "archive" "_schedule-exec" "h2a-session-archive"',
    );
    expect(renderedWithDollar.service).toContain(
      'Environment="SENTROPIC_LOCAL_SCHEDULER_STATE_DIR=/home/user/.local/state/dir$3"',
    );
    expect(renderedWithDollar.service).toContain("EnvironmentFile=-/home/user/.config/dir$4/env");

    // probeStateDirObservability ENOENT inside vs outside host PID namespace.
    const absentDir = join(box.root, "absent-state-dir");
    expect(
      probeStateDirObservability(absentDir, {
        assertHostPid: () => {
          throw new PolicyRefusalError("POLICY_REFUSED_SANDBOX", "sandbox", "bwrap");
        },
      }),
    ).toEqual({ observable: false, reason: "absent-outside-host-namespace" });
    expect(probeStateDirObservability(absentDir, { assertHostPid: () => {} })).toEqual({
      observable: true,
    });
  });

  it("surfaces scheduler health in status projection and resume banners, and respects X-3 single dead-man source", async () => {
    const box = createIsolatedTestEnv();
    const adapter = createFakeSchedulerAdapter({
      clock: () => new Date(FIXED_NOW_MS - 50 * 3_600_000).toISOString(),
      stateDir: box.stateDir,
      envFilePath: box.envFilePath,
    });
    await runArchiveScheduleEnable(
      { calendar: "daily" },
      {
        adapter,
        env: box.env,
        nodeBin: box.nodeBin,
        h2aBinScript: box.h2aBinScript,
        stateDir: box.stateDir,
        envFilePath: box.envFilePath,
        unitDir: box.unitDir,
      },
    );

    // Also test global & task kill-switch persisted in env file via readSchedulerEnvFile.
    adapter.setPersistedEnvFile("SENTROPIC_LOCAL_SCHEDULER_OFF=1\n");
    expect(readSchedulerEnvFile(box.envFilePath)?.SENTROPIC_LOCAL_SCHEDULER_OFF).toBe("1");

    // Simulate > 36h overdue witness while engine last-run.json is 60h old (X-3: no duplicate engine overdue).
    const overdueIso = new Date(FIXED_NOW_MS - 40 * 3_600_000).toISOString();
    adapter.setWitness(
      H2A_ARCHIVE_TASK_ID,
      makeWitness({
        startedAt: overdueIso,
        finishedAt: overdueIso,
        lastSuccessAt: overdueIso,
      }),
    );
    const engineDir = join(box.xdgData, "h2a", "session-archives");
    mkdirSync(engineDir, { recursive: true });
    writeFileSync(
      join(engineDir, "last-run.json"),
      JSON.stringify({
        schemaVersion: 1,
        cli: "claude",
        status: "ok",
        startedAt: new Date(FIXED_NOW_MS - 60 * 3_600_000).toISOString(),
        finishedAt: new Date(FIXED_NOW_MS - 60 * 3_600_000).toISOString(),
        durationMs: 100,
        scanned: 0,
        archived: 0,
        skippedIdempotent: 0,
        skippedLiveOrRecent: 0,
        skippedBlocked: 0,
        alertsCount: 0,
      }),
      "utf8",
    );

    const engineAlerts = readClaudeArchiveAlerts({ env: box.env, nowMs: FIXED_NOW_MS });
    expect(engineAlerts.some((a) => a.kind === "archive-pass-overdue")).toBe(false);

    const snapOverdue = readArchiveScheduleHealth({ env: box.env, nowMs: FIXED_NOW_MS });
    expect(snapOverdue.health.status).toBe("schedule_missed");
    expect(snapOverdue.persistedKillSwitch?.name).toBe("SENTROPIC_LOCAL_SCHEDULER_OFF");

    const statusLines = formatArchiveScheduleStatusLines(snapOverdue);
    expect(statusLines.join("\n")).toMatch(/CRITICAL.*schedule_missed/);
    expect(statusLines.join("\n")).toContain("h2a archive schedule status");

    const resumeLines = formatArchiveScheduleResumeBannerLines(snapOverdue);
    expect(resumeLines.length).toBeGreaterThanOrEqual(3);

    // Healthy schedule is silent on resume and compact on status.
    adapter.setPersistedEnvFile("");
    adapter.setWitness(H2A_ARCHIVE_TASK_ID, makeWitness());
    const snapHealthy = readArchiveScheduleHealth({ env: box.env, nowMs: FIXED_NOW_MS });
    expect(snapHealthy.health.status).toBe("healthy");
    expect(formatArchiveScheduleStatusLines(snapHealthy)[0]).toMatch(/^archive-schedule: ok \(last run 1h ago\)/);
    expect(formatArchiveScheduleResumeBannerLines(snapHealthy)).toEqual([]);

    // Status projection (human detail path) integrates scheduler line in warnings.
    vi.stubEnv("SENTROPIC_LOCAL_SCHEDULER_STATE_DIR", box.stateDir);
    vi.stubEnv("HOME", box.home);
    vi.stubEnv("XDG_DATA_HOME", box.xdgData);
    vi.stubEnv("XDG_CONFIG_HOME", join(box.home, ".config"));
    vi.stubEnv("CLAUDE_CONFIG_DIR", box.claudeDir);
    try {
      const proj = await projectStatusForH2a({ includeManagedInventory: true, includeDelegations: false });
      expect(proj.warnings.some((w) => w.includes("archive-schedule: ok"))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }

    // emitResumeArchiveNotices emits banner when failing/overdue, silent when healthy.
    const healthyErr = new PassThrough();
    let healthyText = "";
    healthyErr.on("data", (c) => {
      healthyText += String(c);
    });
    emitResumeArchiveNotices(
      { status: "already-on-disk", alerts: [] },
      healthyErr,
      { scheduleHealthOptions: { env: box.env, nowMs: FIXED_NOW_MS } },
    );
    expect(healthyText).toBe("");

    adapter.setWitness(H2A_ARCHIVE_TASK_ID, makeWitness({ finishedAt: overdueIso, lastSuccessAt: overdueIso }));
    const overdueErr = new PassThrough();
    let overdueText = "";
    overdueErr.on("data", (c) => {
      overdueText += String(c);
    });
    emitResumeScheduleNotices({ env: box.env, nowMs: FIXED_NOW_MS }, overdueErr);
    expect(overdueText).toMatch(/CRITICAL.*schedule_missed/);

    // NB-2: Disabling the scheduled task re-enables the engine 48h `archive-pass-overdue` alert.
    await runArchiveScheduleDisable({
      adapter,
      env: box.env,
      stateDir: box.stateDir,
      unitDir: box.unitDir,
    });
    const alertsWhenDisabled = readClaudeArchiveAlerts({ env: box.env, nowMs: FIXED_NOW_MS });
    expect(alertsWhenDisabled.some((a) => a.kind === "archive-pass-overdue")).toBe(true);

    // NB-4: H2A_ARCHIVE_OFF follows §2.4 truthiness (any non-empty value except "0" and "false").
    for (const activeVal of ["1", "true", "yes", "on", "no", "off", " YES "]) {
      expect(isArchiveKillSwitchEnabled({ H2A_ARCHIVE_OFF: activeVal })).toBe(true);
    }
    for (const inactiveVal of ["0", "false", "FALSE", "  0  ", "", "   ", undefined]) {
      expect(
        isArchiveKillSwitchEnabled(
          inactiveVal === undefined ? {} : { H2A_ARCHIVE_OFF: inactiveVal },
        ),
      ).toBe(false);
    }
  });

  it("scheduled archive pass honors H2A_ARCHIVE_OFF, maxDurationMs soft budget, and scheduled exit-0 on remaining alerts", () => {
    const box = createIsolatedTestEnv();
    const workspace = join(box.root, "proj");
    const projectDir = join(box.claudeDir, "projects", workspace.replaceAll("/", "-"));
    mkdirSync(workspace, { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    // Session 1: eligible to archive; Session 2: within 24h grace (<14d alert remains).
    const s1 = join(projectDir, `${UUID_1}.jsonl`);
    const s2 = join(projectDir, `${UUID_2}.jsonl`);
    writeFileSync(s1, `${JSON.stringify({ cwd: workspace })}\n`, "utf8");
    writeFileSync(s2, `${JSON.stringify({ cwd: workspace })}\n`, "utf8");
    const dtOld = new Date(FIXED_NOW_MS - 21 * DAY_MS);
    const dtRecent = new Date(FIXED_NOW_MS - 1 * 3_600_000);
    utimesSync(s1, dtOld, dtOld);
    utimesSync(s2, dtOld, dtOld);
    const s2Companion = join(projectDir, UUID_2, "note.txt");
    mkdirSync(dirname(s2Companion), { recursive: true });
    writeFileSync(s2Companion, "recent", "utf8");
    utimesSync(s2Companion, dtRecent, dtRecent);
    utimesSync(s2, dtOld, dtOld);

    let tick = FIXED_NOW_MS;
    const deps: ArchiveDeps = {
      nowMs: () => tick,
      probeHostPidNamespace: () => ({ ok: true }),
      statfs: () => ({ bsize: 4096, blocks: 50_000_000, bavail: 40_000_000 }),
      registryPath: join(box.home, ".config", "sentropic", "h2a", "registry.json"),
      leasesPath: join(box.home, ".config", "sentropic", "h2a", "session-leases.json"),
      readProcView: () => ({ currentBootId: "test-boot", processes: new Map(), entries: [] }),
      isPidAlive: () => false,
      tmuxHasSession: () => false,
      nativeSessionLiveness: () => false,
    };

    // Scheduled mode exits 0 on ok pass even when <14d alert persists on blocked session.
    const schedPass = runArchivePassOnce({
      env: box.env,
      deps,
      scheduled: true,
    });
    expect(schedPass.ok).toBe(true);
    expect(schedPass.exitCode).toBe(0);
    expect(schedPass.alerts.some((a) => a.kind === "purge-imminent")).toBe(true);

    // Non-scheduled manual pass still returns ARCHIVE_ALERT_EXIT_CODE (4).
    const manualPass = runArchivePassOnce({
      env: box.env,
      deps,
    });
    expect(manualPass.ok).toBe(true);
    expect(manualPass.exitCode).toBe(ARCHIVE_ALERT_EXIT_CODE);

    // Soft duration budget stops cleanly with ok: true when elapsed >= maxDurationMs.
    const s3 = join(projectDir, "33333333-3333-4333-8333-333333333333.jsonl");
    writeFileSync(s3, `${JSON.stringify({ cwd: workspace })}\n`, "utf8");
    utimesSync(s3, dtOld, dtOld);
    const budgetPass = runArchivePassOnce({
      env: box.env,
      deps: {
        ...deps,
        nowMs: () => {
          tick += 10_000;
          return tick;
        },
      },
      maxDurationMs: 5_000,
      scheduled: true,
    });
    expect(budgetPass.ok).toBe(true);
    expect(budgetPass.exitCode).toBe(0);
    expect(budgetPass.runResult?.stoppedForDurationBudget).toBe(true);
  });
});
