/**
 * `h2a archive schedule` & `h2a archive _schedule-exec` command handlers (`§4.3`, `§4.4`).
 *
 * Bridges `h2a`'s Claude session archive one-shot pass (`h2a archive run --scheduled`)
 * to the `@sentropic/local-scheduler` consumer contract. Accepts an injected
 * `FakeSchedulerAdapter` / test runner in tests, and delegates production calls
 * through the single real-package resolution point (`local-scheduler-adapter.ts`).
 */

import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultLocalH2aRoot } from "./h2a-bridge.js";
import {
  resolveRealScheduledTaskRunner,
  resolveRealSchedulerAdapter,
  type LocalSchedulerImporter,
  type RunScheduledTaskByIdFn,
} from "./local-scheduler-adapter.js";
import {
  InvalidTaskSpecError,
  LOCAL_TASK_SPEC_V1,
  ON_CALENDAR_CUSTOM_REGEX,
  ON_CALENDAR_PRESETS,
  type DisableResultV1,
  type EnablePolicyV1,
  type EnableResultV1,
  type LocalTaskSpecV1,
  type LocalTaskStatusV1,
  type OsSchedulerAdapter,
  type RunScheduledTaskResultV1,
  type UninstallResultV1,
} from "./local-scheduler-contract.js";
import { DEFAULT_OLDER_THAN_DAYS } from "./session-archive.js";

export const H2A_ARCHIVE_TASK_ID = "h2a-session-archive" as const;
export const H2A_ARCHIVE_OWNER = "h2a" as const;
export const H2A_ARCHIVE_KILL_SWITCH_ENV = "H2A_ARCHIVE_OFF" as const;
export const H2A_ARCHIVE_UNIT_NAME = "sentropic-task-h2a-session-archive.service" as const;
export const H2A_LINGER_ENABLE_COMMAND = 'loginctl enable-linger "$USER"' as const;

export interface ArchiveScheduleDeps {
  readonly adapter?: OsSchedulerAdapter;
  readonly runner?: RunScheduledTaskByIdFn;
  readonly importer?: LocalSchedulerImporter;
  readonly env?: NodeJS.ProcessEnv;
  readonly nodeBin?: string;
  readonly h2aBinScript?: string;
  readonly stateDir?: string;
  readonly envFilePath?: string;
  readonly unitDir?: string;
  readonly runtime?: boolean;
}

export function resolveH2aEntrypointScript(explicitScript?: string): string {
  if (explicitScript) {
    return realpathSync(explicitScript);
  }
  const argv1 = process.argv[1];
  if (argv1) {
    try {
      return realpathSync(argv1);
    } catch {
      // Fall through to packaged/workspace fallback below.
    }
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(here, "..", "..", "h2a", "dist", "bin.js");
  if (existsSync(candidate)) {
    return realpathSync(candidate);
  }
  throw new InvalidTaskSpecError(
    "INVALID_TASK_SPEC",
    "unable to resolve canonical h2a CLI entrypoint script path",
    "policy.runner",
  );
}

export function validateCalendarOption(calendar: string | undefined): string {
  const value = (calendar ?? "daily").trim();
  const isPreset = (ON_CALENDAR_PRESETS as readonly string[]).includes(value);
  if (isPreset) return value;
  if (ON_CALENDAR_CUSTOM_REGEX.test(value) && !value.endsWith("\\")) {
    return value;
  }
  throw new InvalidTaskSpecError(
    "INVALID_TASK_SPEC",
    `invalid --calendar "${value}" (expected hourly|daily|weekly|monthly or valid systemd OnCalendar expression)`,
    "schedule.onCalendar",
  );
}

export function normalizeOlderThanFlag(olderThan: string | undefined): string {
  if (olderThan === undefined) return `${DEFAULT_OLDER_THAN_DAYS}d`;
  const trimmed = olderThan.trim();
  const match = /^(\d+(?:\.\d+)?)\s*d?$/i.exec(trimmed);
  if (!match) {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      `invalid --older-than "${olderThan}" (expected days like 14d)`,
      "command.args",
    );
  }
  const days = Number(match[1]);
  if (!Number.isFinite(days) || days < 0) {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      `--older-than must be >= 0`,
      "command.args",
    );
  }
  return `${days}d`;
}

export function buildH2aArchiveScheduleDescriptor(options: {
  readonly calendar?: string;
  readonly olderThan?: string;
  readonly deps?: ArchiveScheduleDeps;
} = {}): {
  readonly spec: LocalTaskSpecV1;
  readonly policy: EnablePolicyV1;
} {
  const deps = options.deps ?? {};
  const env = deps.env ?? process.env;
  const onCalendar = validateCalendarOption(options.calendar);
  const olderThanFlag = normalizeOlderThanFlag(options.olderThan);
  const nodeBin = realpathSync(deps.nodeBin ?? process.execPath);
  const h2aBinScript = resolveH2aEntrypointScript(deps.h2aBinScript);

  const activeH2aRoot = env.H2A_ROOT?.trim() ? resolve(env.H2A_ROOT) : defaultLocalH2aRoot();
  const capturedEnv: Record<string, string> = {
    H2A_ROOT: activeH2aRoot,
    ...(env.CLAUDE_CONFIG_DIR?.trim()
      ? { CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR.trim() }
      : {}),
  };

  const spec: LocalTaskSpecV1 = {
    v: LOCAL_TASK_SPEC_V1,
    taskId: H2A_ARCHIVE_TASK_ID,
    owner: H2A_ARCHIVE_OWNER,
    description: "h2a local CLI session archive (conservation-only)",
    schedule: {
      onCalendar,
      persistent: true,
      randomizedDelaySec: 600,
      accuracySec: 60,
      graceMultiplier: 1.5,
    },
    command: {
      bin: nodeBin,
      args: [
        h2aBinScript,
        "archive",
        "run",
        "--cli",
        "claude",
        "--older-than",
        olderThanFlag,
        "--max-duration",
        "1440s",
        "--scheduled",
      ],
      env: capturedEnv,
    },
    timeoutMs: 1_800_000,
    killGraceMs: 15_000,
    killSwitchEnv: H2A_ARCHIVE_KILL_SWITCH_ENV,
    resources: {
      nice: 15,
      ioSchedulingClass: "idle",
      memoryMax: "512M",
      cpuQuota: "50%",
      tasksMax: 64,
    },
  };

  const policy: EnablePolicyV1 = {
    runner: {
      bin: nodeBin,
      args: [h2aBinScript, "archive", "_schedule-exec"],
    },
    allowedBins: [nodeBin],
    allowedScripts: [h2aBinScript],
    ...(deps.unitDir !== undefined ? { unitDir: deps.unitDir } : {}),
    ...(deps.stateDir !== undefined ? { stateDir: deps.stateDir } : {}),
    ...(deps.envFilePath !== undefined ? { envFilePath: deps.envFilePath } : {}),
    ...(deps.runtime !== undefined ? { runtime: deps.runtime } : {}),
  };

  return { spec, policy };
}

async function getSchedulerAdapter(deps: ArchiveScheduleDeps): Promise<OsSchedulerAdapter> {
  if (deps.adapter) return deps.adapter;
  const resolverOpts: {
    stateDir?: string;
    envFilePath?: string;
    importer?: LocalSchedulerImporter;
  } = {};
  if (deps.stateDir !== undefined) resolverOpts.stateDir = deps.stateDir;
  if (deps.envFilePath !== undefined) resolverOpts.envFilePath = deps.envFilePath;
  if (deps.importer !== undefined) resolverOpts.importer = deps.importer;
  return resolveRealSchedulerAdapter(resolverOpts);
}

export async function runArchiveScheduleEnable(
  options: {
    readonly calendar?: string;
    readonly olderThan?: string;
  } = {},
  deps: ArchiveScheduleDeps = {},
): Promise<EnableResultV1> {
  const { spec, policy } = buildH2aArchiveScheduleDescriptor({ ...options, deps });
  const adapter = await getSchedulerAdapter(deps);
  return adapter.enable(spec, policy);
}

export async function runArchiveScheduleDisable(
  deps: ArchiveScheduleDeps = {},
): Promise<DisableResultV1> {
  const adapter = await getSchedulerAdapter(deps);
  const opts: { unitDir?: string; stateDir?: string; runtime?: boolean } = {};
  if (deps.unitDir !== undefined) opts.unitDir = deps.unitDir;
  if (deps.stateDir !== undefined) opts.stateDir = deps.stateDir;
  if (deps.runtime !== undefined) opts.runtime = deps.runtime;
  return adapter.disable(H2A_ARCHIVE_TASK_ID, opts);
}

export async function runArchiveScheduleStatus(
  options: { readonly nowIso?: string } = {},
  deps: ArchiveScheduleDeps = {},
): Promise<LocalTaskStatusV1> {
  const adapter = await getSchedulerAdapter(deps);
  const opts: { stateDir?: string; nowIso?: string } = {};
  if (deps.stateDir !== undefined) opts.stateDir = deps.stateDir;
  if (options.nowIso !== undefined) opts.nowIso = options.nowIso;
  return adapter.status(H2A_ARCHIVE_TASK_ID, opts);
}

export async function runArchiveScheduleUninstall(
  options: { readonly purgeState?: boolean } = {},
  deps: ArchiveScheduleDeps = {},
): Promise<UninstallResultV1> {
  const adapter = await getSchedulerAdapter(deps);
  const opts: {
    purgeState?: boolean;
    unitDir?: string;
    stateDir?: string;
    runtime?: boolean;
  } = {
    purgeState: options.purgeState === true,
  };
  if (deps.unitDir !== undefined) opts.unitDir = deps.unitDir;
  if (deps.stateDir !== undefined) opts.stateDir = deps.stateDir;
  if (deps.runtime !== undefined) opts.runtime = deps.runtime;
  return adapter.uninstall(H2A_ARCHIVE_TASK_ID, opts);
}

export async function runArchiveScheduleExec(
  taskId: string,
  deps: ArchiveScheduleDeps = {},
): Promise<RunScheduledTaskResultV1> {
  if (!taskId || taskId.trim().length === 0) {
    throw new InvalidTaskSpecError("INVALID_TASK_SPEC", "taskId is required", "taskId");
  }
  const runner =
    deps.runner ??
    (await resolveRealScheduledTaskRunner(
      deps.importer ? { importer: deps.importer } : {},
    ));
  const nodeBin = realpathSync(deps.nodeBin ?? process.execPath);
  const h2aBinScript = resolveH2aEntrypointScript(deps.h2aBinScript);
  const runOpts: {
    allowedBins: readonly string[];
    allowedScripts: readonly string[];
    stateDir?: string;
    env?: NodeJS.ProcessEnv;
  } = {
    allowedBins: [nodeBin],
    allowedScripts: [h2aBinScript],
  };
  if (deps.stateDir !== undefined) runOpts.stateDir = deps.stateDir;
  if (deps.env !== undefined) runOpts.env = deps.env;
  return runner(taskId, runOpts);
}

export function formatArchiveScheduleHumanStatus(status: LocalTaskStatusV1): string {
  const lines: string[] = [];
  const manifest = status.manifest;
  const witness = status.witness;
  const health = status.health;

  lines.push(`Archive schedule: ${H2A_ARCHIVE_TASK_ID}`);
  lines.push(`  health       : ${health.status} (${health.severity})`);
  lines.push(`  message      : ${health.message}`);
  lines.push(`  lastSuccess  : ${health.lastSuccessAt ?? "never"}`);
  lines.push(`  failures     : ${health.consecutiveFailures}`);
  if (health.overdueByMs !== undefined) {
    lines.push(`  overdueBy    : ${Math.round(health.overdueByMs / 3_600_000)}h (${health.overdueByMs}ms)`);
  }

  if (manifest && manifest !== "corrupt") {
    lines.push(
      `  schedule     : ${manifest.enabled ? "enabled" : "disabled"}  onCalendar=${manifest.spec.schedule.onCalendar}  persistent=${manifest.spec.schedule.persistent}`,
    );
    lines.push(`  stateDir     : ${manifest.stateDir}`);
    lines.push(`  envFilePath  : ${manifest.envFilePath}`);
  } else if (manifest === "corrupt") {
    lines.push(`  manifest     : corrupt`);
  } else {
    lines.push(`  manifest     : not installed`);
  }

  if (witness && witness !== "corrupt") {
    lines.push(
      `  lastWitness  : outcome=${witness.outcome} exitCode=${String(witness.exitCode)} finishedAt=${witness.finishedAt} durationMs=${witness.durationMs}`,
    );
  } else if (witness === "corrupt") {
    lines.push(`  lastWitness  : corrupt`);
  }

  if (status.systemd === "unavailable") {
    lines.push(`  systemd      : unavailable`);
  } else {
    lines.push(
      `  systemd      : timer=${status.systemd.timerUnitFileState}/${status.systemd.timerActive} service=${status.systemd.serviceActive} result=${status.systemd.serviceResult ?? "none"} execStatus=${String(status.systemd.execMainStatus)}`,
    );
    if (status.systemd.nextElapse) {
      lines.push(`  nextElapse   : ${status.systemd.nextElapse}`);
    }
    if (status.systemd.execDiagnostic) {
      lines.push(`  diagnostic   : ${status.systemd.execDiagnostic}`);
    }
  }

  if (status.lingerEnabled === false) {
    lines.push(
      `  linger       : disabled (runs while session is open; missed runs catch up via Persistent=true)`,
    );
    lines.push(`  lingerHint   : to run while logged out: ${H2A_LINGER_ENABLE_COMMAND}`);
  } else if (status.lingerEnabled === true) {
    lines.push(`  linger       : enabled`);
  } else {
    lines.push(`  linger       : unknown`);
  }

  if (health.hints.length > 0) {
    lines.push(`  hints:`);
    for (const hint of health.hints) {
      lines.push(`    - ${hint}`);
    }
  }

  if (
    health.status === "failing" ||
    health.status === "schedule_missed" ||
    health.status === "clock_skew" ||
    health.status === "witness_corrupt"
  ) {
    lines.push(`  logs         : journalctl --user -u ${H2A_ARCHIVE_UNIT_NAME}`);
  }

  return `${lines.join("\n")}\n`;
}
