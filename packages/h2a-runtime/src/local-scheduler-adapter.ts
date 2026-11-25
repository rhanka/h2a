/**
 * Local scheduler adapter runtime bridge + `FakeSchedulerAdapter` (`§4.2`, `§4.4`).
 *
 * Single resolution point for `@sentropic/local-scheduler` while the npm
 * package is not yet published: attempting to resolve the real adapter or
 * runner throws `LocalSchedulerNotInstalledError` ("local-scheduler not installed",
 * documented exit code 69 / EX_UNAVAILABLE) without installing anything.
 *
 * `createFakeSchedulerAdapter({ stateDir })` implements the §4.2 disk-backed
 * test contract using real `0700`/`0600` atomic file writes while skipping
 * only `systemd --user` invocations and the host PID namespace guard.
 */

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync as nodeReadSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import {
  evaluateKillSwitch,
  evaluateTaskHealth,
  InvalidTaskSpecError,
  isDeniedCommandBin,
  LOCAL_TASK_MANIFEST_V1,
  ManifestCorruptError,
  ON_CALENDAR_PRESETS,
  PolicyRefusalError,
  PRESET_INTERVAL_MS,
  probeStateDirObservability,
  readSchedulerEnvFile,
  readTaskManifest,
  readTaskWitness,
  renderSystemdUnits,
  resolveSchedulerEnvFilePath,
  resolveStateDir,
  TaskNotFoundError,
  taskDirPath,
  taskManifestPath,
  taskWitnessPath,
  UnmanagedUnitError,
  validateTaskSpec,
  validateUnitPathToken,
  type DisableResultV1,
  type EnablePolicyV1,
  type EnableResultV1,
  type FakeSchedulerAdapter,
  type LocalTaskManifestV1,
  type LocalTaskSpecV1,
  type LocalTaskStatusV1,
  type LocalTaskWitnessV1,
  type OsSchedulerAdapter,
  type RunScheduledTaskOptionsV1,
  type RunScheduledTaskResultV1,
  type SystemdRuntimeStateV1,
  type UninstallOptionsV1,
  type UninstallResultV1,
} from "./local-scheduler-contract.js";

export const LOCAL_SCHEDULER_PACKAGE_NAME = "@sentropic/local-scheduler" as const;
export const LOCAL_SCHEDULER_NOT_INSTALLED_EXIT_CODE = 69 as const;

const LOCAL_SCHEDULER_EXIT_CODES = new Set<number>([2, 69, 70, 77]);

export interface LocalSchedulerLikeError {
  readonly code: string;
  readonly exitCode: 2 | 69 | 70 | 77;
  readonly message?: string;
}

/**
 * Structural recognizer for `@sentropic/local-scheduler` errors across module
 * boundaries (plus `LocalSchedulerNotInstalledError`), avoiding `instanceof`
 * coupling to the local contract mirror.
 */
export function isLocalSchedulerLikeError(error: unknown): error is LocalSchedulerLikeError {
  if (error instanceof LocalSchedulerNotInstalledError) {
    return true;
  }
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: unknown; exitCode?: unknown };
  return (
    typeof candidate.code === "string" &&
    candidate.code.length > 0 &&
    typeof candidate.exitCode === "number" &&
    LOCAL_SCHEDULER_EXIT_CODES.has(candidate.exitCode)
  );
}

function isMissingLocalSchedulerModuleError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") {
    return false;
  }
  const message = (error as { message?: unknown }).message;
  if (typeof message === "string") {
    const missingMatch = /Cannot find (?:package|module) ['"]([^'"]+)['"]/.exec(message);
    if (missingMatch) {
      const missingPkg = missingMatch[1] ?? "";
      return (
        missingPkg === LOCAL_SCHEDULER_PACKAGE_NAME ||
        missingPkg.startsWith(`${LOCAL_SCHEDULER_PACKAGE_NAME}/`)
      );
    }
  }
  return true;
}

export class LocalSchedulerNotInstalledError extends Error {
  readonly code = "LOCAL_SCHEDULER_NOT_INSTALLED" as const;
  readonly exitCode = LOCAL_SCHEDULER_NOT_INSTALLED_EXIT_CODE;
  readonly packageName = LOCAL_SCHEDULER_PACKAGE_NAME;

  constructor(message?: string, options?: ErrorOptions) {
    super(
      message ??
        `local-scheduler not installed: ${LOCAL_SCHEDULER_PACKAGE_NAME} is not available yet. Run manual passes with \`h2a archive run --cli claude\` until ${LOCAL_SCHEDULER_PACKAGE_NAME} is published and wired.`,
      options,
    );
    this.name = "LocalSchedulerNotInstalledError";
  }
}

export type LocalSchedulerImporter = (specifier: string) => Promise<unknown>;

export type RunScheduledTaskByIdFn = (
  taskId: string,
  opts: RunScheduledTaskOptionsV1,
) => Promise<RunScheduledTaskResultV1>;

/**
 * Single resolution point for the external `@sentropic/local-scheduler` package.
 * Never installs packages or modifies global state; throws `LocalSchedulerNotInstalledError`
 * (exit 69) while the package is absent, while propagating non-missing-module errors directly.
 */
export async function resolveLocalSchedulerSubpath(
  subpath: "" | "/systemd" | "/runner",
  importer?: LocalSchedulerImporter,
): Promise<unknown> {
  const specifier: string = `${LOCAL_SCHEDULER_PACKAGE_NAME}${subpath}`;
  try {
    return importer ? await importer(specifier) : await import(specifier);
  } catch (error) {
    if (error instanceof LocalSchedulerNotInstalledError || isLocalSchedulerLikeError(error)) {
      throw error;
    }
    if (!isMissingLocalSchedulerModuleError(error)) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new LocalSchedulerNotInstalledError(
      `local-scheduler not installed: cannot resolve "${specifier}" (${detail}). Run manual passes with \`h2a archive run --cli claude\` until ${LOCAL_SCHEDULER_PACKAGE_NAME} is published.`,
      { cause: error },
    );
  }
}

export async function resolveRealSchedulerAdapter(opts: {
  readonly stateDir?: string;
  readonly envFilePath?: string;
  readonly importer?: LocalSchedulerImporter;
} = {}): Promise<OsSchedulerAdapter> {
  const mod = (await resolveLocalSchedulerSubpath("/systemd", opts.importer)) as {
    readonly createSystemdUserAdapter?: (adapterOpts?: {
      readonly stateDir?: string;
      readonly envFilePath?: string;
    }) => OsSchedulerAdapter;
  } | null;
  if (!mod || typeof mod.createSystemdUserAdapter !== "function") {
    throw new LocalSchedulerNotInstalledError(
      `local-scheduler not installed: "${LOCAL_SCHEDULER_PACKAGE_NAME}/systemd" does not export createSystemdUserAdapter()`,
    );
  }
  const adapterOpts: { stateDir?: string; envFilePath?: string } = {};
  if (opts.stateDir !== undefined) adapterOpts.stateDir = opts.stateDir;
  if (opts.envFilePath !== undefined) adapterOpts.envFilePath = opts.envFilePath;
  return mod.createSystemdUserAdapter(adapterOpts);
}

export async function resolveRealScheduledTaskRunner(opts: {
  readonly importer?: LocalSchedulerImporter;
} = {}): Promise<RunScheduledTaskByIdFn> {
  const mod = (await resolveLocalSchedulerSubpath("/runner", opts.importer)) as {
    readonly runScheduledTaskById?: RunScheduledTaskByIdFn;
  } | null;
  if (!mod || typeof mod.runScheduledTaskById !== "function") {
    throw new LocalSchedulerNotInstalledError(
      `local-scheduler not installed: "${LOCAL_SCHEDULER_PACKAGE_NAME}/runner" does not export runScheduledTaskById()`,
    );
  }
  return mod.runScheduledTaskById;
}

// ---------------------------------------------------------------------------
// Production-parity atomic file helpers & policy checks for FakeSchedulerAdapter
// ---------------------------------------------------------------------------

function ensureDir0700(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dirPath, 0o700);
  } catch {
    // Ignore on filesystems that disallow chmod.
  }
}

function fsyncFd(filePath: string): void {
  const fd = openSync(filePath, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDirBestEffort(dirPath: string): void {
  try {
    const fd = openSync(dirPath, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Best-effort directory durability.
  }
}

function writeAtomic0600(targetPath: string, content: string): void {
  const parent = dirname(targetPath);
  ensureDir0700(parent);
  const nonce = randomBytes(6).toString("hex");
  const tmpPath = join(parent, `.${basename(targetPath)}.${process.pid}.${nonce}.tmp`);
  writeFileSync(tmpPath, content, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(tmpPath, 0o600);
    fsyncFd(tmpPath);
    renameSync(tmpPath, targetPath);
    fsyncDirBestEffort(parent);
  } catch (error) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // Ignore unwind failure.
    }
    throw error;
  }
}

function isNodeInterpreter(canonicalBin: string): boolean {
  try {
    if (canonicalBin === realpathSync(process.execPath)) return true;
  } catch {
    // Fall back to basename check.
  }
  return basename(canonicalBin) === "node";
}

function validateExecutableEntry(
  entry: { readonly bin: string; readonly args: readonly string[] },
  policy: EnablePolicyV1,
  label: "command" | "runner",
): void {
  validateUnitPathToken(entry.bin, `${label}.bin`);
  let canonicalBin: string;
  try {
    canonicalBin = realpathSync(entry.bin);
  } catch (error) {
    throw new PolicyRefusalError(
      "POLICY_REFUSED_ALLOWLIST",
      "allowlist",
      `${label}.bin does not resolve on disk: ${entry.bin}`,
      { cause: error },
    );
  }
  const binStat = statSync(canonicalBin);
  if (!binStat.isFile()) {
    throw new PolicyRefusalError(
      "POLICY_REFUSED_FILE_MODE",
      "file-mode",
      `${label}.bin is not a regular file: ${canonicalBin}`,
    );
  }
  if ((binStat.mode & 0o022) !== 0) {
    throw new PolicyRefusalError(
      "POLICY_REFUSED_FILE_MODE",
      "file-mode",
      `${label}.bin must not be group/world writable: ${canonicalBin}`,
    );
  }
  if ((binStat.mode & 0o100) === 0) {
    throw new PolicyRefusalError(
      "POLICY_REFUSED_FILE_MODE",
      "file-mode",
      `${label}.bin is not executable by owner: ${canonicalBin}`,
    );
  }
  const currentUid = typeof process.getuid === "function" ? process.getuid() : 0;
  if (binStat.uid !== currentUid && binStat.uid !== 0) {
    throw new PolicyRefusalError(
      "POLICY_REFUSED_FILE_MODE",
      "file-mode",
      `${label}.bin must be owned by current user or root: ${canonicalBin}`,
    );
  }
  if (isDeniedCommandBin(canonicalBin)) {
    throw new PolicyRefusalError(
      "POLICY_REFUSED_ALLOWLIST",
      "allowlist",
      `${label}.bin "${canonicalBin}" is denylisted`,
    );
  }

  const canonicalAllowedBins = new Set(
    policy.allowedBins.map((b) => {
      try {
        return realpathSync(b);
      } catch {
        return resolve(b);
      }
    }),
  );
  if (!canonicalAllowedBins.has(canonicalBin)) {
    throw new PolicyRefusalError(
      "POLICY_REFUSED_ALLOWLIST",
      "allowlist",
      `${label}.bin "${canonicalBin}" is not in allowedBins`,
    );
  }

  // Shebang check for non-ELF files (§6.5).
  const fd = openSync(canonicalBin, "r");
  try {
    const header = Buffer.alloc(256);
    const readCount = nodeReadSync(fd, header, 0, header.length, 0);
    const isElf =
      readCount >= 4 &&
      header[0] === 0x7f &&
      header[1] === 0x45 &&
      header[2] === 0x4c &&
      header[3] === 0x46;
    if (!isElf && readCount >= 2 && header[0] === 0x23 && header[1] === 0x21) {
      const firstLine = header.subarray(2, readCount).toString("utf8").split(/\r?\n/)[0]?.trim() ?? "";
      const interp = firstLine.split(/\s+/)[0] ?? "";
      if (!isAbsolute(interp) || isDeniedCommandBin(interp)) {
        throw new PolicyRefusalError(
          "POLICY_REFUSED_ALLOWLIST",
          "allowlist",
          `${label}.bin has disallowed shebang interpreter "${interp}"`,
        );
      }
    }
  } finally {
    closeSync(fd);
  }

  if (isNodeInterpreter(canonicalBin)) {
    const scriptArg = entry.args[0];
    if (!scriptArg || !isAbsolute(scriptArg)) {
      throw new InvalidTaskSpecError(
        "INVALID_TASK_SPEC",
        `${label}.args[0] must be an absolute script path when bin is Node`,
        `${label}.args`,
      );
    }
    if (!policy.allowedScripts || policy.allowedScripts.length === 0) {
      throw new InvalidTaskSpecError(
        "INVALID_TASK_SPEC",
        "policy.allowedScripts is mandatory when bin is a Node interpreter",
        "allowedScripts",
      );
    }
    let canonicalScript: string;
    try {
      canonicalScript = realpathSync(scriptArg);
    } catch (error) {
      throw new PolicyRefusalError(
        "POLICY_REFUSED_ALLOWLIST",
        "allowlist",
        `${label} entry script does not exist: ${scriptArg}`,
        { cause: error },
      );
    }
    const scriptStat = statSync(canonicalScript);
    if (!scriptStat.isFile() || (scriptStat.mode & 0o022) !== 0) {
      throw new PolicyRefusalError(
        "POLICY_REFUSED_FILE_MODE",
        "file-mode",
        `${label} script has unsafe file type or mode: ${canonicalScript}`,
      );
    }
    if (scriptStat.uid !== currentUid && scriptStat.uid !== 0) {
      throw new PolicyRefusalError(
        "POLICY_REFUSED_FILE_MODE",
        "file-mode",
        `${label} script must be owned by current user or root: ${canonicalScript}`,
      );
    }
    const canonicalAllowedScripts = new Set(
      policy.allowedScripts.map((s) => {
        try {
          return realpathSync(s);
        } catch {
          return resolve(s);
        }
      }),
    );
    if (!canonicalAllowedScripts.has(canonicalScript)) {
      throw new PolicyRefusalError(
        "POLICY_REFUSED_ALLOWLIST",
        "allowlist",
        `${label} script "${canonicalScript}" is not in allowedScripts`,
      );
    }
  }
}

function assertSafeExistingUnitDir(unitDir: string): void {
  let lst;
  try {
    lst = lstatSync(unitDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      ensureDir0700(unitDir);
      return;
    }
    throw error;
  }
  if (lst.isSymbolicLink() || !lst.isDirectory()) {
    throw new PolicyRefusalError(
      "POLICY_REFUSED_FILE_MODE",
      "file-mode",
      `unitDir is not a regular directory: ${unitDir}`,
    );
  }
  const currentUid = typeof process.getuid === "function" ? process.getuid() : 0;
  if (lst.uid !== currentUid) {
    throw new PolicyRefusalError(
      "POLICY_REFUSED_FILE_MODE",
      "file-mode",
      `unitDir is not owned by current user: ${unitDir}`,
    );
  }
  if ((lst.mode & 0o022) !== 0) {
    throw new PolicyRefusalError(
      "POLICY_REFUSED_FILE_MODE",
      "file-mode",
      `unitDir must not be group/world writable: ${unitDir}`,
    );
  }
}

function assertManagedUnitIfExists(unitPath: string, taskId: string): void {
  if (!existsSync(unitPath)) return;
  const lst = lstatSync(unitPath);
  if (lst.isSymbolicLink() || !lst.isFile()) {
    throw new UnmanagedUnitError(unitPath, `refusing to overwrite non-regular unit: ${unitPath}`);
  }
  const content = readFileSync(unitPath, "utf8");
  const hasManaged = content.includes("# Managed-By: @sentropic/local-scheduler");
  const hasTaskId = content.includes(`# Task-Id: ${taskId}`);
  if (!hasManaged || !hasTaskId) {
    throw new UnmanagedUnitError(
      unitPath,
      `refusing to overwrite or remove unmanaged systemd unit: ${unitPath}`,
    );
  }
}

function computeFakeExpectedIntervalMs(spec: LocalTaskSpecV1): number {
  const onCal = spec.schedule.onCalendar;
  const presetKey = onCal as (typeof ON_CALENDAR_PRESETS)[number];
  if ((ON_CALENDAR_PRESETS as readonly string[]).includes(onCal)) {
    const nominal = PRESET_INTERVAL_MS[presetKey];
    if (spec.schedule.expectedIntervalMs !== undefined) {
      const relDiff = Math.abs(spec.schedule.expectedIntervalMs - nominal) / nominal;
      if (relDiff > 0.1) {
        throw new InvalidTaskSpecError(
          "INTERVAL_MISMATCH",
          `schedule.expectedIntervalMs (${spec.schedule.expectedIntervalMs}) deviates >10% from ${onCal} (${nominal})`,
          "schedule.expectedIntervalMs",
        );
      }
    }
    return nominal;
  }
  return spec.schedule.expectedIntervalMs ?? 86_400_000;
}

function applySystemdExecDiagnostics(
  state: SystemdRuntimeStateV1 | "unavailable",
): SystemdRuntimeStateV1 | "unavailable" {
  if (state === "unavailable") return "unavailable";
  if (state.execDiagnostic !== undefined) return state;
  if (state.execMainStatus === 203) {
    return {
      ...state,
      execDiagnostic: "runner binary moved or not executable (203/EXEC); re-run enable",
    };
  }
  if (state.execMainStatus === 77) {
    return {
      ...state,
      execDiagnostic: "host PID guard refused under systemd; check unit sandboxing",
    };
  }
  return state;
}

export function createFakeSchedulerAdapter(opts: {
  readonly clock?: () => string;
  readonly stateDir?: string;
  readonly envFilePath?: string;
} = {}): FakeSchedulerAdapter {
  const clock = opts.clock ?? (() => new Date().toISOString());
  const defaultStateDir = opts.stateDir ? resolve(opts.stateDir) : resolveStateDir(process.env);
  const defaultEnvFilePath = opts.envFilePath
    ? resolve(opts.envFilePath)
    : opts.stateDir
      ? join(defaultStateDir, "env")
      : resolveSchedulerEnvFilePath(process.env);

  // Per m-32 (c), create stateDir (0700) at construction so `not_installed` is reachable inside containers.
  ensureDir0700(defaultStateDir);

  let configuredSystemd: SystemdRuntimeStateV1 | "unavailable" | undefined;
  let configuredLinger: boolean | null = false;
  const renderedUnits = new Map<string, { readonly service: string; readonly timer: string }>();

  return {
    async enable(spec: LocalTaskSpecV1, policy: EnablePolicyV1): Promise<EnableResultV1> {
      const validSpec = validateTaskSpec(spec);
      const effectiveStateDir = policy.stateDir ? resolve(policy.stateDir) : defaultStateDir;
      const effectiveEnvFilePath = policy.envFilePath
        ? resolve(policy.envFilePath)
        : defaultEnvFilePath;

      validateUnitPathToken(effectiveStateDir, "policy.stateDir");
      validateUnitPathToken(effectiveEnvFilePath, "policy.envFilePath", { rejectGlobs: true });

      const expectedIntervalMs = computeFakeExpectedIntervalMs(validSpec);
      validateExecutableEntry(policy.runner, policy, "runner");
      validateExecutableEntry(validSpec.command, policy, "command");

      ensureDir0700(effectiveStateDir);
      ensureDir0700(taskDirPath(effectiveStateDir, validSpec.taskId));

      const unitBaseDir = policy.unitDir
        ? resolve(policy.unitDir)
        : join(effectiveStateDir, "fake-units");
      if (policy.unitDir) {
        assertSafeExistingUnitDir(unitBaseDir);
      } else {
        ensureDir0700(unitBaseDir);
      }

      const servicePath = join(unitBaseDir, `sentropic-task-${validSpec.taskId}.service`);
      const timerPath = join(unitBaseDir, `sentropic-task-${validSpec.taskId}.timer`);
      assertManagedUnitIfExists(servicePath, validSpec.taskId);
      assertManagedUnitIfExists(timerPath, validSpec.taskId);

      const previous = readTaskManifest(effectiveStateDir, validSpec.taskId);
      const nowIso = clock();
      const installedAt =
        previous !== null && previous !== "corrupt" ? previous.installedAt : nowIso;

      const baseManifest: Omit<LocalTaskManifestV1, "units"> = {
        v: LOCAL_TASK_MANIFEST_V1,
        spec: validSpec,
        runner: policy.runner,
        enabled: true,
        installedAt,
        enabledAt: nowIso,
        stateDir: effectiveStateDir,
        envFilePath: effectiveEnvFilePath,
        expectedIntervalMs,
      };
      const units = renderSystemdUnits(baseManifest);
      renderedUnits.set(validSpec.taskId, { service: units.service, timer: units.timer });

      writeAtomic0600(servicePath, units.service);
      writeAtomic0600(timerPath, units.timer);

      const manifest: LocalTaskManifestV1 = {
        ...baseManifest,
        units: {
          serviceSha256: units.serviceSha256,
          timerSha256: units.timerSha256,
        },
      };
      writeAtomic0600(
        taskManifestPath(effectiveStateDir, validSpec.taskId),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );

      const lingerNotice =
        configuredLinger === false
          ? 'systemd user linger is disabled (session-open execution; missed runs catch up via Persistent=true). For logged-out runs: loginctl enable-linger "$USER"'
          : undefined;

      return {
        manifest,
        servicePath,
        timerPath,
        lingerEnabled: configuredLinger,
        ...(lingerNotice !== undefined ? { lingerNotice } : {}),
      };
    },

    async disable(taskId, opts): Promise<DisableResultV1> {
      const effectiveStateDir = opts?.stateDir ? resolve(opts.stateDir) : defaultStateDir;
      const manifestPath = taskManifestPath(effectiveStateDir, taskId);
      const manifest = readTaskManifest(effectiveStateDir, taskId);
      if (manifest === null) {
        throw new TaskNotFoundError(taskId);
      }
      if (manifest === "corrupt") {
        throw new ManifestCorruptError(manifestPath, `Corrupt manifest at ${manifestPath}`);
      }
      if (opts?.unitDir) {
        const unitBase = resolve(opts.unitDir);
        assertManagedUnitIfExists(join(unitBase, `sentropic-task-${taskId}.service`), taskId);
        assertManagedUnitIfExists(join(unitBase, `sentropic-task-${taskId}.timer`), taskId);
      }
      const updated: LocalTaskManifestV1 = {
        ...manifest,
        enabled: false,
      };
      writeAtomic0600(manifestPath, `${JSON.stringify(updated, null, 2)}\n`);
      return { taskId, manifest: updated };
    },

    async status(taskId, opts): Promise<LocalTaskStatusV1> {
      const effectiveStateDir = opts?.stateDir ? resolve(opts.stateDir) : defaultStateDir;
      const obs = probeStateDirObservability(effectiveStateDir);
      const manifest = obs.observable ? readTaskManifest(effectiveStateDir, taskId) : null;
      const witness = obs.observable ? readTaskWitness(effectiveStateDir, taskId) : null;
      const effectiveEnvPath =
        manifest && manifest !== "corrupt" ? manifest.envFilePath : defaultEnvFilePath;
      const persistedEnv = readSchedulerEnvFile(effectiveEnvPath);
      const specRef =
        manifest && manifest !== "corrupt"
          ? manifest.spec
          : { taskId, killSwitchEnv: "H2A_ARCHIVE_OFF" };
      const health = evaluateTaskHealth({
        stateDirObservable: obs.observable,
        manifest,
        witness,
        persistedKillSwitch: persistedEnv ? evaluateKillSwitch(persistedEnv, specRef) : null,
        readerEnvKillSwitch: evaluateKillSwitch(process.env, specRef),
        nowIso: opts?.nowIso ?? clock(),
      });

      const defaultSystemd: SystemdRuntimeStateV1 =
        manifest && manifest !== "corrupt"
          ? {
              timerUnitFileState: manifest.enabled ? "enabled" : "disabled",
              timerActive: manifest.enabled ? "active" : "inactive",
              nextElapse: manifest.enabled ? "next-tick" : null,
              lastTrigger: witness && witness !== "corrupt" ? witness.startedAt : null,
              lastTriggerMonotonicUs: null,
              serviceActive: "inactive",
              serviceResult:
                witness && witness !== "corrupt"
                  ? witness.outcome === "succeeded" ||
                    witness.outcome === "skipped_disabled" ||
                    witness.outcome === "interrupted"
                    ? "success"
                    : "exit-code"
                  : null,
              execMainStatus: witness && witness !== "corrupt" ? witness.exitCode : null,
              execMainExitTimestamp: witness && witness !== "corrupt" ? witness.finishedAt : null,
            }
          : {
              timerUnitFileState: "not-found",
              timerActive: "inactive",
              nextElapse: null,
              lastTrigger: null,
              lastTriggerMonotonicUs: null,
              serviceActive: "inactive",
              serviceResult: null,
              execMainStatus: null,
              execMainExitTimestamp: null,
            };

      const systemd = applySystemdExecDiagnostics(configuredSystemd ?? defaultSystemd);

      return {
        manifest,
        witness,
        health,
        systemd,
        lingerEnabled: configuredLinger,
      };
    },

    async uninstall(taskId, opts?: UninstallOptionsV1): Promise<UninstallResultV1> {
      const effectiveStateDir = opts?.stateDir ? resolve(opts.stateDir) : defaultStateDir;
      const unitBaseDir = opts?.unitDir
        ? resolve(opts.unitDir)
        : join(effectiveStateDir, "fake-units");
      const servicePath = join(unitBaseDir, `sentropic-task-${taskId}.service`);
      const timerPath = join(unitBaseDir, `sentropic-task-${taskId}.timer`);

      assertManagedUnitIfExists(servicePath, taskId);
      assertManagedUnitIfExists(timerPath, taskId);

      const removedUnits: string[] = [];
      for (const unitPath of [timerPath, servicePath]) {
        if (existsSync(unitPath)) {
          rmSync(unitPath, { force: true });
          removedUnits.push(unitPath);
        }
      }
      renderedUnits.delete(taskId);

      const manifestPath = taskManifestPath(effectiveStateDir, taskId);
      if (existsSync(manifestPath)) {
        rmSync(manifestPath, { force: true });
      }

      const purgedState = opts?.purgeState === true;
      const taskDir = taskDirPath(effectiveStateDir, taskId);
      if (purgedState && existsSync(taskDir)) {
        rmSync(taskDir, { recursive: true, force: true });
      } else if (existsSync(taskDir)) {
        try {
          if (readdirSync(taskDir).length === 0) {
            rmSync(taskDir, { recursive: true, force: true });
          }
        } catch {
          // Ignore directory cleanup errors.
        }
      }

      return {
        taskId,
        removedUnits,
        purgedState,
      };
    },

    setWitness(taskId: string, witness: LocalTaskWitnessV1 | null | "corrupt"): void {
      const witnessPath = taskWitnessPath(defaultStateDir, taskId);
      if (witness === null) {
        rmSync(witnessPath, { force: true });
        return;
      }
      if (witness === "corrupt") {
        writeAtomic0600(witnessPath, "{corrupt-witness\n");
        return;
      }
      writeAtomic0600(witnessPath, `${JSON.stringify(witness, null, 2)}\n`);
    },

    setPersistedEnvFile(text: string): void {
      writeAtomic0600(defaultEnvFilePath, text);
    },

    setSystemdState(
      state: SystemdRuntimeStateV1 | "unavailable",
      lingerEnabled?: boolean | null,
    ): void {
      configuredSystemd = state;
      if (lingerEnabled !== undefined) {
        configuredLinger = lingerEnabled;
      }
    },

    getRenderedUnits(taskId: string): { readonly service: string; readonly timer: string } | null {
      return renderedUnits.get(taskId) ?? null;
    },
  };
}
