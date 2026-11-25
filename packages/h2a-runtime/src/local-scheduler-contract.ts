/**
 * Local consumer mirror of the frozen `@sentropic/local-scheduler` v1 contract
 * (`SPEC_EVOL_LOCAL_SCHEDULED_TASKS.r3.md` §2, §3, §4, §6).
 *
 * Pure Node.js built-ins only (`node:crypto`, `node:fs`, `node:os`, `node:path`)
 * so both `@sentropic/h2a-runtime` and lazy `@sentropic/h2a` status readers can
 * evaluate task health and read-side state without loading heavy runtime deps.
 *
 * When `@sentropic/local-scheduler` is published, the real OS adapter and runner
 * are loaded dynamically through `local-scheduler-adapter.ts` while keeping
 * identical symbol names, schemas, and error codes.
 */

import { createHash } from "node:crypto";
import {
  accessSync,
  constants as fsConstants,
  lstatSync,
  readFileSync,
  readlinkSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Constants (§1.3, §2.1, §2.5, §4.2)
// ---------------------------------------------------------------------------

export const LOCAL_TASK_SPEC_V1 = 1 as const;
export const LOCAL_TASK_MANIFEST_V1 = 1 as const;
export const LOCAL_TASK_WITNESS_V1 = 1 as const;

export const ON_CALENDAR_PRESETS = ["hourly", "daily", "weekly", "monthly"] as const;

/**
 * Strict allow-list for custom systemd OnCalendar expressions:
 * - Presets: hourly | daily | weekly | monthly
 * - Custom: 1..64 ASCII chars in [0-9A-Za-z*,./:~ -], no '%', no leading '-', no trailing '\'.
 */
export const ON_CALENDAR_CUSTOM_REGEX = /^(?!-)[0-9A-Za-z*,./:~ -]{1,64}$/;

/** Loader/runtime-injection env vars forbidden in command.env, envAllowlist, child env, and unit env (§6.5). */
export const BLOCKED_LOADER_ENV_VARS = [
  "NODE_OPTIONS",
  "NODE_PATH",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
] as const;

export const PRESET_INTERVAL_MS: Readonly<Record<(typeof ON_CALENDAR_PRESETS)[number], number>> = {
  hourly: 3_600_000,
  daily: 86_400_000,
  weekly: 604_800_000,
  monthly: 2_678_400_000,
};

const DENIED_COMMAND_BIN_NAMES = new Set([
  "sh",
  "bash",
  "dash",
  "zsh",
  "fish",
  "ksh",
  "csh",
  "env",
  "python",
  "python3",
  "perl",
  "ruby",
  "awk",
  "xargs",
  "sudo",
  "su",
  "pkexec",
  "doas",
  "ssh",
  "curl",
  "wget",
]);

const NODE_DISALLOWED_INLINE_FLAGS = new Set([
  "-e",
  "--eval",
  "-p",
  "--print",
  "-r",
  "--require",
  "--import",
]);

const SECRET_ENV_NAME_PATTERNS: readonly RegExp[] = [
  /_(?:TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL)$/i,
  /CREDENTIAL/i,
  /^(?:ANTHROPIC|OPENAI|GEMINI|AWS)_/i,
  /^GITHUB_TOKEN$/i,
  /^NPM_TOKEN$/i,
];

const TASK_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const OWNER_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MEMORY_MAX_RE = /^(\d+)([KMG])$/;
const CPU_QUOTA_RE = /^(\d+)%$/;
const STRICT_UTC_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST_INIT_PID_NS = "pid:[4026531836]";
const CONTAINER_CGROUP_RE = /(?:user\.slice|docker|containerd|kubepods|lxc|podman|bwrap)/i;
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;
const GLOB_CHAR_RE = /[*?[]/;

const WITNESS_V1_ALLOWED_KEYS = new Set([
  "v",
  "taskId",
  "owner",
  "runId",
  "trigger",
  "host",
  "pid",
  "startedAt",
  "finishedAt",
  "durationMs",
  "outcome",
  "exitCode",
  "signal",
  "killSwitch",
  "refusal",
  "consecutiveFailures",
  "lastSuccessAt",
  "lastSuccessRunId",
  "summary",
  "logPath",
]);

// ---------------------------------------------------------------------------
// Error hierarchy & error codes (§4.2)
// ---------------------------------------------------------------------------

export type LocalSchedulerErrorCode =
  | "SYSTEMD_USER_UNAVAILABLE"
  | "INVALID_TASK_SPEC"
  | "INTERVAL_MISMATCH"
  | "UNMANAGED_UNIT"
  | "POLICY_REFUSED_SANDBOX"
  | "POLICY_REFUSED_ALLOWLIST"
  | "POLICY_REFUSED_FILE_MODE"
  | "POLICY_REFUSED_STATE_DIR"
  | "MANIFEST_CORRUPT"
  | "TASK_NOT_FOUND"
  | "SYSTEMCTL_FAILED";

export type LocalTaskRefusalReasonV1 = "sandbox" | "allowlist" | "file-mode" | "state-dir";

export class LocalSchedulerError extends Error {
  readonly code: LocalSchedulerErrorCode;
  readonly exitCode: 2 | 69 | 70 | 77;

  constructor(
    code: LocalSchedulerErrorCode,
    exitCode: 2 | 69 | 70 | 77,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LocalSchedulerError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export class SchedulerUnavailableError extends LocalSchedulerError {
  override readonly code = "SYSTEMD_USER_UNAVAILABLE" as const;
  readonly reason: "not-linux" | "no-systemctl" | "no-user-manager" | "timeout";
  override readonly exitCode = 69 as const;

  constructor(
    reason: "not-linux" | "no-systemctl" | "no-user-manager" | "timeout",
    message: string,
    options?: ErrorOptions,
  ) {
    super("SYSTEMD_USER_UNAVAILABLE", 69, message, options);
    this.name = "SchedulerUnavailableError";
    this.reason = reason;
  }
}

export class InvalidTaskSpecError extends LocalSchedulerError {
  override readonly code: "INVALID_TASK_SPEC" | "INTERVAL_MISMATCH";
  readonly field?: string;
  override readonly exitCode = 2 as const;

  constructor(
    code: "INVALID_TASK_SPEC" | "INTERVAL_MISMATCH",
    message: string,
    field?: string,
    options?: ErrorOptions,
  ) {
    super(code, 2, message, options);
    this.name = "InvalidTaskSpecError";
    this.code = code;
    if (field !== undefined) {
      this.field = field;
    }
  }
}

export class UnmanagedUnitError extends LocalSchedulerError {
  override readonly code = "UNMANAGED_UNIT" as const;
  readonly unitPath: string;
  override readonly exitCode = 2 as const;

  constructor(unitPath: string, message: string, options?: ErrorOptions) {
    super("UNMANAGED_UNIT", 2, message, options);
    this.name = "UnmanagedUnitError";
    this.unitPath = unitPath;
  }
}

export class PolicyRefusalError extends LocalSchedulerError {
  override readonly code:
    | "POLICY_REFUSED_SANDBOX"
    | "POLICY_REFUSED_ALLOWLIST"
    | "POLICY_REFUSED_FILE_MODE"
    | "POLICY_REFUSED_STATE_DIR";
  readonly refusal: LocalTaskRefusalReasonV1;
  override readonly exitCode = 77 as const;

  constructor(
    code:
      | "POLICY_REFUSED_SANDBOX"
      | "POLICY_REFUSED_ALLOWLIST"
      | "POLICY_REFUSED_FILE_MODE"
      | "POLICY_REFUSED_STATE_DIR",
    refusal: LocalTaskRefusalReasonV1,
    message: string,
    options?: ErrorOptions,
  ) {
    super(code, 77, message, options);
    this.name = "PolicyRefusalError";
    this.code = code;
    this.refusal = refusal;
  }
}

export class ManifestCorruptError extends LocalSchedulerError {
  override readonly code = "MANIFEST_CORRUPT" as const;
  readonly manifestPath: string;
  override readonly exitCode = 2 as const;

  constructor(manifestPath: string, message: string, options?: ErrorOptions) {
    super("MANIFEST_CORRUPT", 2, message, options);
    this.name = "ManifestCorruptError";
    this.manifestPath = manifestPath;
  }
}

export class TaskNotFoundError extends LocalSchedulerError {
  override readonly code = "TASK_NOT_FOUND" as const;
  readonly taskId: string;
  override readonly exitCode = 2 as const;

  constructor(taskId: string, message?: string, options?: ErrorOptions) {
    super(
      "TASK_NOT_FOUND",
      2,
      message ?? `Scheduled task "${taskId}" is not installed`,
      options,
    );
    this.name = "TaskNotFoundError";
    this.taskId = taskId;
  }
}

export class SystemctlFailedError extends LocalSchedulerError {
  override readonly code = "SYSTEMCTL_FAILED" as const;
  readonly command: readonly string[];
  readonly stderr: string;
  override readonly exitCode = 70 as const;

  constructor(
    command: readonly string[],
    stderr: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super("SYSTEMCTL_FAILED", 70, message, options);
    this.name = "SystemctlFailedError";
    this.command = command;
    this.stderr = stderr;
  }
}

// ---------------------------------------------------------------------------
// Types (§2.1, §2.3, §2.5, §2.6, §4.2)
// ---------------------------------------------------------------------------

export interface LocalTaskScheduleV1 {
  readonly onCalendar: string;
  readonly persistent: boolean;
  readonly randomizedDelaySec?: number;
  readonly accuracySec?: number;
  readonly expectedIntervalMs?: number;
  readonly graceMultiplier?: number;
}

export interface LocalTaskCommandV1 {
  readonly bin: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly envAllowlist?: readonly string[];
}

export interface LocalTaskResourcesV1 {
  readonly nice?: number;
  readonly ioSchedulingClass?: "idle" | "best-effort";
  readonly memoryMax?: string;
  readonly cpuQuota?: string;
  readonly tasksMax?: number;
}

export interface LocalTaskSpecV1 {
  readonly v: typeof LOCAL_TASK_SPEC_V1;
  readonly taskId: string;
  readonly owner: string;
  readonly description: string;
  readonly schedule: LocalTaskScheduleV1;
  readonly command: LocalTaskCommandV1;
  readonly timeoutMs: number;
  readonly killGraceMs?: number;
  readonly killSwitchEnv?: string;
  readonly resources?: LocalTaskResourcesV1;
}

export interface LocalTaskRunnerEntryV1 {
  readonly bin: string;
  readonly args: readonly string[];
}

export interface LocalTaskManifestV1 {
  readonly v: typeof LOCAL_TASK_MANIFEST_V1;
  readonly spec: LocalTaskSpecV1;
  readonly runner: LocalTaskRunnerEntryV1;
  readonly enabled: boolean;
  readonly installedAt: string;
  readonly enabledAt: string;
  readonly stateDir: string;
  readonly envFilePath: string;
  readonly expectedIntervalMs: number;
  readonly units: {
    readonly serviceSha256: string;
    readonly timerSha256: string;
  };
}

export type LocalTaskTriggerV1 = "systemd-timer" | "manual";

export type LocalTaskOutcomeV1 =
  | "succeeded"
  | "failed"
  | "timed_out"
  | "interrupted"
  | "skipped_disabled"
  | "refused_policy";

export interface LocalTaskKillSwitchMatchV1 {
  readonly scope: "global" | "task" | "alias";
  readonly name: string;
}

export interface LocalTaskWitnessV1 {
  readonly v: typeof LOCAL_TASK_WITNESS_V1;
  readonly taskId: string;
  readonly owner: string;
  readonly runId: string;
  readonly trigger: LocalTaskTriggerV1;
  readonly host: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly outcome: LocalTaskOutcomeV1;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly killSwitch?: LocalTaskKillSwitchMatchV1;
  readonly refusal?: LocalTaskRefusalReasonV1;
  readonly consecutiveFailures: number;
  readonly lastSuccessAt: string | null;
  readonly lastSuccessRunId: string | null;
  readonly summary?: string;
  readonly logPath?: string;
}

export type LocalTaskSkipEntryV1 =
  | {
      readonly v: 1;
      readonly runId: string;
      readonly at: string;
      readonly pid: number;
      readonly outcome: "skipped_locked";
    }
  | {
      readonly v: 1;
      readonly runId: string;
      readonly at: string;
      readonly pid: number;
      readonly outcome: "refused_policy";
      readonly refusal: "sandbox";
    };

export type LocalTaskHealthStatus =
  | "healthy"
  | "not_installed"
  | "unobservable"
  | "disabled"
  | "paused"
  | "pending_first_run"
  | "interrupted"
  | "failing"
  | "schedule_missed"
  | "clock_skew"
  | "witness_corrupt";

export interface StateDirObservabilityResult {
  readonly observable: boolean;
  readonly reason?: "absent-outside-host-namespace" | "inaccessible" | "not-a-directory";
}

export interface EvaluateTaskHealthInput {
  readonly stateDirObservable?: boolean;
  readonly manifest: LocalTaskManifestV1 | null | "corrupt";
  readonly witness: LocalTaskWitnessV1 | null | "corrupt";
  readonly persistedKillSwitch?: LocalTaskKillSwitchMatchV1 | null;
  readonly readerEnvKillSwitch?: LocalTaskKillSwitchMatchV1 | null;
  readonly nowIso: string;
  readonly clockSkewToleranceMs?: number;
}

export interface LocalTaskHealthVerdict {
  readonly status: LocalTaskHealthStatus;
  readonly severity: "ok" | "warning" | "critical";
  readonly overdueByMs?: number;
  readonly consecutiveFailures: number;
  readonly lastSuccessAt: string | null;
  readonly opsReason?: "job-failed" | "deadline-exceeded" | "schedule-missed" | "stale";
  readonly message: string;
  readonly hints: readonly string[];
}

export interface EnablePolicyV1 {
  readonly runner: LocalTaskRunnerEntryV1;
  readonly allowedBins: readonly string[];
  readonly allowedScripts?: readonly string[];
  readonly unitDir?: string;
  readonly stateDir?: string;
  readonly envFilePath?: string;
  readonly runtime?: boolean;
}

export interface EnableResultV1 {
  readonly manifest: LocalTaskManifestV1;
  readonly servicePath: string;
  readonly timerPath: string;
  readonly lingerEnabled: boolean | null;
  readonly lingerNotice?: string;
}

export interface DisableResultV1 {
  readonly taskId: string;
  readonly manifest: LocalTaskManifestV1;
}

export interface UninstallOptionsV1 {
  readonly purgeState?: boolean;
  readonly unitDir?: string;
  readonly stateDir?: string;
  readonly runtime?: boolean;
}

export interface UninstallResultV1 {
  readonly taskId: string;
  readonly removedUnits: readonly string[];
  readonly purgedState: boolean;
}

export interface SystemdRuntimeStateV1 {
  readonly timerUnitFileState: string;
  readonly timerActive: string;
  readonly nextElapse: string | null;
  readonly lastTrigger: string | null;
  readonly lastTriggerMonotonicUs: number | null;
  readonly serviceActive: string;
  readonly serviceResult: string | null;
  readonly execMainStatus: number | null;
  readonly execMainExitTimestamp: string | null;
  readonly execDiagnostic?: string;
}

export interface LocalTaskStatusV1 {
  readonly manifest: LocalTaskManifestV1 | null | "corrupt";
  readonly witness: LocalTaskWitnessV1 | null | "corrupt";
  readonly health: LocalTaskHealthVerdict;
  readonly systemd: SystemdRuntimeStateV1 | "unavailable";
  readonly lingerEnabled: boolean | null;
}

export interface OsSchedulerAdapter {
  enable(spec: LocalTaskSpecV1, policy: EnablePolicyV1): Promise<EnableResultV1>;
  disable(
    taskId: string,
    opts?: {
      readonly unitDir?: string;
      readonly stateDir?: string;
      readonly runtime?: boolean;
    },
  ): Promise<DisableResultV1>;
  status(
    taskId: string,
    opts?: { readonly stateDir?: string; readonly nowIso?: string },
  ): Promise<LocalTaskStatusV1>;
  uninstall(taskId: string, opts?: UninstallOptionsV1): Promise<UninstallResultV1>;
}

export interface FakeSchedulerAdapter extends OsSchedulerAdapter {
  setWitness(taskId: string, witness: LocalTaskWitnessV1 | null | "corrupt"): void;
  setPersistedEnvFile(text: string): void;
  setSystemdState(
    state: SystemdRuntimeStateV1 | "unavailable",
    lingerEnabled?: boolean | null,
  ): void;
  getRenderedUnits(taskId: string): { readonly service: string; readonly timer: string } | null;
}

export interface RunScheduledTaskOptionsV1 {
  readonly allowedBins: readonly string[];
  readonly allowedScripts?: readonly string[];
  readonly stateDir?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface RunScheduledTaskResultV1 {
  readonly outcome: LocalTaskOutcomeV1 | "skipped_locked" | "not_run";
  readonly exitCode: 0 | 1 | 2 | 70 | 77 | 124 | 130 | 143;
  readonly witness: LocalTaskWitnessV1 | null;
  readonly error?: { readonly code: LocalSchedulerErrorCode; readonly message: string };
}

// ---------------------------------------------------------------------------
// Path resolution & observability (§3.4, §4.2)
// ---------------------------------------------------------------------------

function resolveHomeDir(env: NodeJS.ProcessEnv): string {
  const fromEnv = env.HOME?.trim();
  return fromEnv ? resolve(fromEnv) : homedir();
}

export function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.SENTROPIC_LOCAL_SCHEDULER_STATE_DIR?.trim();
  if (override) {
    return resolve(override);
  }
  const xdgState = env.XDG_STATE_HOME?.trim();
  const stateBase = xdgState ? resolve(xdgState) : join(resolveHomeDir(env), ".local", "state");
  return join(stateBase, "sentropic", "local-scheduler");
}

export function resolveSchedulerEnvFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const xdgConfig = env.XDG_CONFIG_HOME?.trim();
  const configBase = xdgConfig ? resolve(xdgConfig) : join(resolveHomeDir(env), ".config");
  return join(configBase, "sentropic", "local-scheduler", "env");
}

export function assertHostPidNamespace(): void {
  if (process.platform !== "linux") {
    throw new PolicyRefusalError(
      "POLICY_REFUSED_SANDBOX",
      "sandbox",
      `host PID namespace proof failed: unsupported platform ${process.platform}`,
    );
  }
  let pidNs: string;
  let pid1Uid: number;
  let pid1Comm: string;
  let pid1Cgroup: string;
  try {
    pidNs = readlinkSync("/proc/self/ns/pid");
    pid1Uid = statSync("/proc/1").uid;
    pid1Comm = readFileSync("/proc/1/comm", "utf8").trim();
    pid1Cgroup = readFileSync("/proc/1/cgroup", "utf8");
  } catch (error) {
    throw new PolicyRefusalError(
      "POLICY_REFUSED_SANDBOX",
      "sandbox",
      `host PID namespace proof unreadable: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (pidNs !== HOST_INIT_PID_NS) {
    throw new PolicyRefusalError(
      "POLICY_REFUSED_SANDBOX",
      "sandbox",
      `refusing execution outside host init PID namespace (${pidNs} !== ${HOST_INIT_PID_NS})`,
    );
  }
  if (pid1Uid !== 0) {
    throw new PolicyRefusalError(
      "POLICY_REFUSED_SANDBOX",
      "sandbox",
      `refusing execution: /proc/1 uid is ${pid1Uid} (expected 0)`,
    );
  }
  if (pid1Comm !== "systemd" && pid1Comm !== "init") {
    throw new PolicyRefusalError(
      "POLICY_REFUSED_SANDBOX",
      "sandbox",
      `refusing execution: /proc/1/comm is "${pid1Comm}" (expected systemd or init)`,
    );
  }
  if (!pid1Cgroup.includes("0::/init.scope") || CONTAINER_CGROUP_RE.test(pid1Cgroup)) {
    throw new PolicyRefusalError(
      "POLICY_REFUSED_SANDBOX",
      "sandbox",
      `refusing execution: /proc/1/cgroup is not host init.scope`,
    );
  }
}

export function probeStateDirObservability(
  stateDir: string,
  deps: { readonly assertHostPid?: () => void } = {},
): StateDirObservabilityResult {
  try {
    const lst = lstatSync(stateDir);
    if (lst.isSymbolicLink() || !lst.isDirectory()) {
      return { observable: false, reason: "not-a-directory" };
    }
    accessSync(stateDir, fsConstants.R_OK);
    return { observable: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      try {
        (deps.assertHostPid ?? assertHostPidNamespace)();
        return { observable: true };
      } catch {
        return { observable: false, reason: "absent-outside-host-namespace" };
      }
    }
    if (code === "ENOTDIR") {
      return { observable: false, reason: "not-a-directory" };
    }
    return { observable: false, reason: "inaccessible" };
  }
}

// ---------------------------------------------------------------------------
// Env file parsing & kill-switch evaluation (§2.4)
// ---------------------------------------------------------------------------

function stripMatchingQuotes(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

export function parseSchedulerEnvFile(text: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!ENV_NAME_RE.test(key)) continue;
    const rawVal = trimmed.slice(eqIdx + 1).trim();
    out[key] = stripMatchingQuotes(rawVal);
  }
  return out;
}

export function readSchedulerEnvFile(
  envFilePath: string = resolveSchedulerEnvFilePath(),
): Readonly<Record<string, string>> | null {
  try {
    const lst = lstatSync(envFilePath);
    if (lst.isSymbolicLink() || !lst.isFile()) {
      return null;
    }
    const raw = readFileSync(envFilePath, "utf8");
    return parseSchedulerEnvFile(raw);
  } catch {
    return null;
  }
}

export function taskKillSwitchEnvName(taskId: string): string {
  const upperSnake = taskId.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return `SENTROPIC_TASK_${upperSnake}_OFF`;
}

function isKillSwitchValueActive(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}

export function evaluateKillSwitch(
  env: Readonly<Record<string, string | undefined>>,
  spec: Pick<LocalTaskSpecV1, "taskId" | "killSwitchEnv">,
): LocalTaskKillSwitchMatchV1 | null {
  if (isKillSwitchValueActive(env.SENTROPIC_LOCAL_SCHEDULER_OFF)) {
    return { scope: "global", name: "SENTROPIC_LOCAL_SCHEDULER_OFF" };
  }
  const perTaskVar = taskKillSwitchEnvName(spec.taskId);
  if (isKillSwitchValueActive(env[perTaskVar])) {
    return { scope: "task", name: perTaskVar };
  }
  if (spec.killSwitchEnv && isKillSwitchValueActive(env[spec.killSwitchEnv])) {
    return { scope: "alias", name: spec.killSwitchEnv };
  }
  return null;
}

export function isTaskKillSwitchActive(
  env: Readonly<Record<string, string | undefined>>,
  spec: Pick<LocalTaskSpecV1, "taskId" | "killSwitchEnv">,
): boolean {
  return evaluateKillSwitch(env, spec) !== null;
}

// ---------------------------------------------------------------------------
// Validation & unit rendering (§2.1, §3.1, §6.4, §6.5, §6.6)
// ---------------------------------------------------------------------------

export function isSecretEnvName(name: string): boolean {
  return SECRET_ENV_NAME_PATTERNS.some((re) => re.test(name));
}

export function isBlockedLoaderEnvVar(name: string): boolean {
  return (BLOCKED_LOADER_ENV_VARS as readonly string[]).includes(name);
}

function isStrictUtcIso(value: unknown): value is string {
  if (typeof value !== "string" || !STRICT_UTC_ISO_RE.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function parseMemoryBytes(raw: string): number | null {
  const m = MEMORY_MAX_RE.exec(raw);
  if (!m) return null;
  const qty = Number(m[1]);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const unit = m[2];
  if (unit === "K") return qty * 1024;
  if (unit === "M") return qty * 1024 * 1024;
  if (unit === "G") return qty * 1024 * 1024 * 1024;
  return null;
}

function assertCleanSingleLine(value: string, field: string, maxLen: number): void {
  if (value.length === 0 || value.length > maxLen) {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      `${field} must be 1..${maxLen} characters`,
      field,
    );
  }
  if (CONTROL_CHAR_RE.test(value) || value.includes("\n") || value.includes("\r")) {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      `${field} must not contain control characters or newlines`,
      field,
    );
  }
}

export function isDeniedCommandBin(binPath: string): boolean {
  const base = basename(binPath).toLowerCase();
  return DENIED_COMMAND_BIN_NAMES.has(base);
}

export function validateUnitPathToken(
  value: string,
  field: string,
  opts: { readonly rejectGlobs?: boolean } = {},
): void {
  if (
    !isAbsolute(value) ||
    CONTROL_CHAR_RE.test(value) ||
    value.includes('"') ||
    value.includes("\\")
  ) {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      `${field} must be an absolute path without control chars, quotes, or backslashes`,
      field,
    );
  }
  if (opts.rejectGlobs && GLOB_CHAR_RE.test(value)) {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      `${field} must not contain glob characters (*, ?, [)`,
      field,
    );
  }
}

export function validateTaskSpec(spec: unknown): LocalTaskSpecV1 {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new InvalidTaskSpecError("INVALID_TASK_SPEC", "task spec must be an object");
  }
  const s = spec as Record<string, unknown>;
  if (s.v !== LOCAL_TASK_SPEC_V1) {
    throw new InvalidTaskSpecError("INVALID_TASK_SPEC", `unsupported spec version ${String(s.v)}`, "v");
  }
  if (typeof s.taskId !== "string" || !TASK_ID_RE.test(s.taskId)) {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      "taskId must match /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/",
      "taskId",
    );
  }
  if (typeof s.owner !== "string" || !OWNER_RE.test(s.owner)) {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      "owner must match /^[a-z0-9][a-z0-9-]{0,31}$/",
      "owner",
    );
  }
  if (typeof s.description !== "string") {
    throw new InvalidTaskSpecError("INVALID_TASK_SPEC", "description must be a string", "description");
  }
  assertCleanSingleLine(s.description, "description", 120);
  if (s.description.includes("%") || s.description.includes("\\")) {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      "description must not contain '%' or '\\'",
      "description",
    );
  }

  if (!s.schedule || typeof s.schedule !== "object" || Array.isArray(s.schedule)) {
    throw new InvalidTaskSpecError("INVALID_TASK_SPEC", "schedule must be an object", "schedule");
  }
  const sched = s.schedule as Record<string, unknown>;
  if (typeof sched.onCalendar !== "string" || sched.onCalendar.length === 0) {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      "schedule.onCalendar must be a non-empty string",
      "schedule.onCalendar",
    );
  }
  const isPreset = (ON_CALENDAR_PRESETS as readonly string[]).includes(sched.onCalendar);
  if (
    !isPreset &&
    (!ON_CALENDAR_CUSTOM_REGEX.test(sched.onCalendar) || sched.onCalendar.endsWith("\\"))
  ) {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      `invalid OnCalendar expression "${sched.onCalendar}"`,
      "schedule.onCalendar",
    );
  }
  if (typeof sched.persistent !== "boolean") {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      "schedule.persistent must be a boolean",
      "schedule.persistent",
    );
  }
  if (
    sched.randomizedDelaySec !== undefined &&
    (typeof sched.randomizedDelaySec !== "number" ||
      !Number.isInteger(sched.randomizedDelaySec) ||
      sched.randomizedDelaySec < 0 ||
      sched.randomizedDelaySec > 3600)
  ) {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      "schedule.randomizedDelaySec must be an integer 0..3600",
      "schedule.randomizedDelaySec",
    );
  }
  if (
    sched.accuracySec !== undefined &&
    (typeof sched.accuracySec !== "number" ||
      !Number.isInteger(sched.accuracySec) ||
      sched.accuracySec < 1 ||
      sched.accuracySec > 3600)
  ) {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      "schedule.accuracySec must be an integer 1..3600",
      "schedule.accuracySec",
    );
  }
  if (
    sched.expectedIntervalMs !== undefined &&
    (typeof sched.expectedIntervalMs !== "number" ||
      !Number.isFinite(sched.expectedIntervalMs) ||
      sched.expectedIntervalMs < 60_000)
  ) {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      "schedule.expectedIntervalMs must be >= 60000",
      "schedule.expectedIntervalMs",
    );
  }
  if (
    sched.graceMultiplier !== undefined &&
    (typeof sched.graceMultiplier !== "number" ||
      !Number.isFinite(sched.graceMultiplier) ||
      sched.graceMultiplier < 1.1 ||
      sched.graceMultiplier > 5.0)
  ) {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      "schedule.graceMultiplier must be between 1.1 and 5.0",
      "schedule.graceMultiplier",
    );
  }

  if (!s.command || typeof s.command !== "object" || Array.isArray(s.command)) {
    throw new InvalidTaskSpecError("INVALID_TASK_SPEC", "command must be an object", "command");
  }
  const cmd = s.command as Record<string, unknown>;
  if (typeof cmd.bin !== "string" || !isAbsolute(cmd.bin)) {
    throw new InvalidTaskSpecError("INVALID_TASK_SPEC", "command.bin must be an absolute path", "command.bin");
  }
  validateUnitPathToken(cmd.bin, "command.bin");
  if (isDeniedCommandBin(cmd.bin)) {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      `command.bin "${cmd.bin}" is denylisted`,
      "command.bin",
    );
  }
  if (!Array.isArray(cmd.args) || cmd.args.length > 64) {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      "command.args must be an array of at most 64 strings",
      "command.args",
    );
  }
  for (let i = 0; i < cmd.args.length; i++) {
    const arg = cmd.args[i];
    if (typeof arg !== "string" || arg.length > 1024 || CONTROL_CHAR_RE.test(arg) || arg.endsWith("\\")) {
      throw new InvalidTaskSpecError(
        "INVALID_TASK_SPEC",
        `command.args[${i}] violates length/control/trailing-backslash rules`,
        `command.args[${i}]`,
      );
    }
  }
  if (basename(cmd.bin).toLowerCase() === "node") {
    for (const arg of cmd.args as string[]) {
      if (NODE_DISALLOWED_INLINE_FLAGS.has(arg) || arg.startsWith("--eval=") || arg.startsWith("--print=")) {
        throw new InvalidTaskSpecError(
          "INVALID_TASK_SPEC",
          `inline Node flag "${arg}" is forbidden`,
          "command.args",
        );
      }
      if (!arg.startsWith("-")) break;
    }
  }
  if (cmd.cwd !== undefined) {
    if (typeof cmd.cwd !== "string" || !isAbsolute(cmd.cwd) || CONTROL_CHAR_RE.test(cmd.cwd)) {
      throw new InvalidTaskSpecError(
        "INVALID_TASK_SPEC",
        "command.cwd must be a clean absolute path",
        "command.cwd",
      );
    }
  }
  if (cmd.env !== undefined) {
    if (!cmd.env || typeof cmd.env !== "object" || Array.isArray(cmd.env)) {
      throw new InvalidTaskSpecError("INVALID_TASK_SPEC", "command.env must be a string map", "command.env");
    }
    for (const [key, val] of Object.entries(cmd.env as Record<string, unknown>)) {
      if (!ENV_NAME_RE.test(key)) {
        throw new InvalidTaskSpecError("INVALID_TASK_SPEC", `invalid env key "${key}"`, "command.env");
      }
      if (isBlockedLoaderEnvVar(key)) {
        throw new InvalidTaskSpecError(
          "INVALID_TASK_SPEC",
          `blocked loader env var "${key}" is forbidden in command.env`,
          "command.env",
        );
      }
      if (isSecretEnvName(key)) {
        throw new InvalidTaskSpecError(
          "INVALID_TASK_SPEC",
          `secret-shaped env var "${key}" is forbidden in command.env`,
          "command.env",
        );
      }
      if (typeof val !== "string" || CONTROL_CHAR_RE.test(val)) {
        throw new InvalidTaskSpecError(
          "INVALID_TASK_SPEC",
          `command.env.${key} must be a string without control characters`,
          "command.env",
        );
      }
    }
  }
  if (cmd.envAllowlist !== undefined) {
    if (!Array.isArray(cmd.envAllowlist)) {
      throw new InvalidTaskSpecError(
        "INVALID_TASK_SPEC",
        "command.envAllowlist must be an array",
        "command.envAllowlist",
      );
    }
    for (const key of cmd.envAllowlist) {
      if (typeof key !== "string" || !ENV_NAME_RE.test(key)) {
        throw new InvalidTaskSpecError(
          "INVALID_TASK_SPEC",
          `invalid envAllowlist entry "${String(key)}"`,
          "command.envAllowlist",
        );
      }
      if (isBlockedLoaderEnvVar(key)) {
        throw new InvalidTaskSpecError(
          "INVALID_TASK_SPEC",
          `blocked loader env var "${key}" is forbidden in envAllowlist`,
          "command.envAllowlist",
        );
      }
      if (isSecretEnvName(key)) {
        throw new InvalidTaskSpecError(
          "INVALID_TASK_SPEC",
          `secret-shaped env var "${key}" is forbidden in envAllowlist`,
          "command.envAllowlist",
        );
      }
    }
  }

  if (
    typeof s.timeoutMs !== "number" ||
    !Number.isFinite(s.timeoutMs) ||
    s.timeoutMs < 5_000 ||
    s.timeoutMs > 7_200_000
  ) {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      "timeoutMs must be 5000..7200000",
      "timeoutMs",
    );
  }
  if (
    s.killGraceMs !== undefined &&
    (typeof s.killGraceMs !== "number" ||
      !Number.isFinite(s.killGraceMs) ||
      s.killGraceMs < 1_000 ||
      s.killGraceMs > 60_000)
  ) {
    throw new InvalidTaskSpecError(
      "INVALID_TASK_SPEC",
      "killGraceMs must be 1000..60000",
      "killGraceMs",
    );
  }
  if (s.killSwitchEnv !== undefined) {
    if (
      typeof s.killSwitchEnv !== "string" ||
      !ENV_NAME_RE.test(s.killSwitchEnv) ||
      isBlockedLoaderEnvVar(s.killSwitchEnv) ||
      isSecretEnvName(s.killSwitchEnv)
    ) {
      throw new InvalidTaskSpecError(
        "INVALID_TASK_SPEC",
        "killSwitchEnv must be a valid non-secret env variable name",
        "killSwitchEnv",
      );
    }
  }
  if (s.resources !== undefined) {
    if (!s.resources || typeof s.resources !== "object" || Array.isArray(s.resources)) {
      throw new InvalidTaskSpecError("INVALID_TASK_SPEC", "resources must be an object", "resources");
    }
    const res = s.resources as Record<string, unknown>;
    if (
      res.nice !== undefined &&
      (typeof res.nice !== "number" || !Number.isInteger(res.nice) || res.nice < 0 || res.nice > 19)
    ) {
      throw new InvalidTaskSpecError("INVALID_TASK_SPEC", "resources.nice must be 0..19", "resources.nice");
    }
    if (
      res.ioSchedulingClass !== undefined &&
      res.ioSchedulingClass !== "idle" &&
      res.ioSchedulingClass !== "best-effort"
    ) {
      throw new InvalidTaskSpecError(
        "INVALID_TASK_SPEC",
        "resources.ioSchedulingClass must be 'idle' or 'best-effort'",
        "resources.ioSchedulingClass",
      );
    }
    if (res.memoryMax !== undefined) {
      const bytes = typeof res.memoryMax === "string" ? parseMemoryBytes(res.memoryMax) : null;
      if (bytes === null || bytes < 64 * 1024 * 1024 || bytes > 4 * 1024 * 1024 * 1024) {
        throw new InvalidTaskSpecError(
          "INVALID_TASK_SPEC",
          "resources.memoryMax must be between 64M and 4G",
          "resources.memoryMax",
        );
      }
    }
    if (res.cpuQuota !== undefined) {
      const m = typeof res.cpuQuota === "string" ? CPU_QUOTA_RE.exec(res.cpuQuota) : null;
      const pct = m ? Number(m[1]) : Number.NaN;
      if (!Number.isFinite(pct) || pct < 5 || pct > 100) {
        throw new InvalidTaskSpecError(
          "INVALID_TASK_SPEC",
          "resources.cpuQuota must be 5%..100%",
          "resources.cpuQuota",
        );
      }
    }
    if (
      res.tasksMax !== undefined &&
      (typeof res.tasksMax !== "number" ||
        !Number.isInteger(res.tasksMax) ||
        res.tasksMax < 8 ||
        res.tasksMax > 512)
    ) {
      throw new InvalidTaskSpecError(
        "INVALID_TASK_SPEC",
        "resources.tasksMax must be 8..512",
        "resources.tasksMax",
      );
    }
  }

  return spec as LocalTaskSpecV1;
}

function escapeSystemdUnitPathToken(value: string): string {
  return value.replaceAll("%", "%%");
}

function escapeSystemdExecArg(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%")
    .replaceAll("$", "$$");
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function renderSystemdUnits(
  manifest: Omit<LocalTaskManifestV1, "units">,
): {
  readonly service: string;
  readonly timer: string;
  readonly serviceSha256: string;
  readonly timerSha256: string;
} {
  const { spec, runner, stateDir, envFilePath } = manifest;
  validateUnitPathToken(stateDir, "stateDir");
  validateUnitPathToken(envFilePath, "envFilePath", { rejectGlobs: true });
  validateUnitPathToken(runner.bin, "runner.bin");

  const nice = spec.resources?.nice ?? 15;
  const ioClass = spec.resources?.ioSchedulingClass ?? "idle";
  const memoryMax = spec.resources?.memoryMax ?? "512M";
  const cpuQuota = spec.resources?.cpuQuota ?? "50%";
  const tasksMax = spec.resources?.tasksMax ?? 64;
  const killGraceMs = spec.killGraceMs ?? 15_000;
  const timeoutStartSec = Math.ceil((spec.timeoutMs + killGraceMs) / 1000) + 30;
  const timeoutStopSec = Math.ceil(killGraceMs / 1000) + 15;
  const randomizedDelaySec = spec.schedule.randomizedDelaySec ?? 300;
  const accuracySec = spec.schedule.accuracySec ?? 60;

  const execTokens = [
    `"${escapeSystemdUnitPathToken(runner.bin)}"`,
    ...runner.args.map((arg, index) => {
      if (index === 0 && isAbsolute(arg)) {
        validateUnitPathToken(arg, "runner.args[0]");
        return `"${escapeSystemdUnitPathToken(arg).replaceAll("$", "$$")}"`;
      }
      return `"${escapeSystemdExecArg(arg)}"`;
    }),
    `"${escapeSystemdExecArg(spec.taskId)}"`,
  ];

  const header = [
    "# Managed-By: @sentropic/local-scheduler v1",
    `# Task-Id: ${spec.taskId}`,
    `# Owner: ${spec.owner}`,
  ];

  const serviceLines = [
    ...header,
    "[Unit]",
    `Description=Sentropic local scheduled task: ${spec.description} (${spec.taskId})`,
    "After=default.target",
    "",
    "[Service]",
    "Type=oneshot",
    "KillMode=mixed",
    "SuccessExitStatus=130 143",
    `Nice=${nice}`,
    `IOSchedulingClass=${ioClass}`,
    `MemoryMax=${memoryMax}`,
    `CPUQuota=${cpuQuota}`,
    `TasksMax=${tasksMax}`,
    "UMask=0077",
    "NoNewPrivileges=yes",
    "RestrictAddressFamilies=AF_UNIX",
    "LockPersonality=yes",
    "RestrictRealtime=yes",
    `TimeoutStartSec=${timeoutStartSec}`,
    `TimeoutStopSec=${timeoutStopSec}`,
    'Environment="PATH=/usr/bin:/bin"',
    `Environment="SENTROPIC_LOCAL_SCHEDULER_STATE_DIR=${escapeSystemdUnitPathToken(stateDir)}"`,
    `EnvironmentFile=-${escapeSystemdUnitPathToken(envFilePath)}`,
    `UnsetEnvironment=${BLOCKED_LOADER_ENV_VARS.join(" ")}`,
    `ExecStart=${execTokens.join(" ")}`,
    "StandardOutput=journal",
    "StandardError=journal",
    "",
  ];

  const timerLines = [
    ...header,
    "[Unit]",
    `Description=Timer for Sentropic local scheduled task: ${spec.taskId}`,
    "",
    "[Timer]",
    `OnCalendar=${spec.schedule.onCalendar}`,
    `Persistent=${spec.schedule.persistent ? "true" : "false"}`,
    `RandomizedDelaySec=${randomizedDelaySec}`,
    `AccuracySec=${accuracySec}`,
    `Unit=sentropic-task-${spec.taskId}.service`,
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ];

  const service = serviceLines.join("\n");
  const timer = timerLines.join("\n");
  return {
    service,
    timer,
    serviceSha256: sha256Text(service),
    timerSha256: sha256Text(timer),
  };
}

// ---------------------------------------------------------------------------
// Manifest & witness readers (§2.5, §4.2)
// ---------------------------------------------------------------------------

export function taskDirPath(stateDir: string, taskId: string): string {
  return join(stateDir, "tasks", taskId);
}

export function taskManifestPath(stateDir: string, taskId: string): string {
  return join(taskDirPath(stateDir, taskId), "manifest.json");
}

export function taskWitnessPath(stateDir: string, taskId: string): string {
  return join(taskDirPath(stateDir, taskId), "last-run.json");
}

export function readTaskManifest(
  stateDir: string,
  taskId: string,
): LocalTaskManifestV1 | null | "corrupt" {
  const manifestPath = taskManifestPath(stateDir, taskId);
  let lst;
  try {
    lst = lstatSync(manifestPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return null;
    }
    return "corrupt";
  }
  if (lst.isSymbolicLink() || !lst.isFile()) return "corrupt";
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    return "corrupt";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "corrupt";
  const m = parsed as Record<string, unknown>;
  if (
    m.v !== LOCAL_TASK_MANIFEST_V1 ||
    typeof m.enabled !== "boolean" ||
    !isStrictUtcIso(m.installedAt) ||
    !isStrictUtcIso(m.enabledAt) ||
    typeof m.stateDir !== "string" ||
    !isAbsolute(m.stateDir) ||
    typeof m.envFilePath !== "string" ||
    !isAbsolute(m.envFilePath) ||
    typeof m.expectedIntervalMs !== "number" ||
    !Number.isFinite(m.expectedIntervalMs) ||
    m.expectedIntervalMs < 60_000
  ) {
    return "corrupt";
  }
  if (!m.runner || typeof m.runner !== "object" || Array.isArray(m.runner)) return "corrupt";
  const runner = m.runner as Record<string, unknown>;
  if (
    typeof runner.bin !== "string" ||
    !isAbsolute(runner.bin) ||
    !Array.isArray(runner.args) ||
    !runner.args.every((a) => typeof a === "string")
  ) {
    return "corrupt";
  }
  if (!m.units || typeof m.units !== "object" || Array.isArray(m.units)) return "corrupt";
  const units = m.units as Record<string, unknown>;
  if (
    typeof units.serviceSha256 !== "string" ||
    typeof units.timerSha256 !== "string"
  ) {
    return "corrupt";
  }
  try {
    const validatedSpec = validateTaskSpec(m.spec);
    if (validatedSpec.taskId !== taskId) return "corrupt";
  } catch {
    return "corrupt";
  }
  return parsed as LocalTaskManifestV1;
}

export function isValidTaskWitnessV1(value: unknown, expectedTaskId?: string): value is LocalTaskWitnessV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const w = value as Record<string, unknown>;
  for (const key of Object.keys(w)) {
    if (!WITNESS_V1_ALLOWED_KEYS.has(key)) return false;
  }
  if (w.v !== LOCAL_TASK_WITNESS_V1) return false;
  if (typeof w.taskId !== "string" || !TASK_ID_RE.test(w.taskId)) return false;
  if (expectedTaskId !== undefined && w.taskId !== expectedTaskId) return false;
  if (typeof w.owner !== "string" || !OWNER_RE.test(w.owner)) return false;
  if (typeof w.runId !== "string" || !UUID_RE.test(w.runId)) return false;
  if (w.trigger !== "systemd-timer" && w.trigger !== "manual") return false;
  if (typeof w.host !== "string" || w.host.length === 0) return false;
  if (typeof w.pid !== "number" || !Number.isSafeInteger(w.pid) || w.pid <= 0) return false;
  if (!isStrictUtcIso(w.startedAt) || !isStrictUtcIso(w.finishedAt)) return false;
  if (
    typeof w.durationMs !== "number" ||
    !Number.isInteger(w.durationMs) ||
    w.durationMs < 0
  ) {
    return false;
  }
  const validOutcomes = new Set<LocalTaskOutcomeV1>([
    "succeeded",
    "failed",
    "timed_out",
    "interrupted",
    "skipped_disabled",
    "refused_policy",
  ]);
  if (typeof w.outcome !== "string" || !validOutcomes.has(w.outcome as LocalTaskOutcomeV1)) {
    return false;
  }
  if (w.exitCode !== null && (typeof w.exitCode !== "number" || !Number.isInteger(w.exitCode))) {
    return false;
  }
  if (w.signal !== null && typeof w.signal !== "string") return false;
  if (
    typeof w.consecutiveFailures !== "number" ||
    !Number.isInteger(w.consecutiveFailures) ||
    w.consecutiveFailures < 0
  ) {
    return false;
  }
  if (w.lastSuccessAt !== null && !isStrictUtcIso(w.lastSuccessAt)) return false;
  if (w.lastSuccessRunId !== null && (typeof w.lastSuccessRunId !== "string" || !UUID_RE.test(w.lastSuccessRunId))) {
    return false;
  }

  if (w.outcome === "skipped_disabled") {
    if (!w.killSwitch || typeof w.killSwitch !== "object" || Array.isArray(w.killSwitch)) {
      return false;
    }
    const ks = w.killSwitch as Record<string, unknown>;
    if (
      (ks.scope !== "global" && ks.scope !== "task" && ks.scope !== "alias") ||
      typeof ks.name !== "string" ||
      ks.name.length === 0
    ) {
      return false;
    }
  } else if (w.killSwitch !== undefined) {
    return false;
  }

  if (w.outcome === "refused_policy") {
    if (
      w.refusal !== "sandbox" &&
      w.refusal !== "allowlist" &&
      w.refusal !== "file-mode" &&
      w.refusal !== "state-dir"
    ) {
      return false;
    }
  } else if (w.refusal !== undefined) {
    return false;
  }

  if (w.summary !== undefined) {
    if (
      typeof w.summary !== "string" ||
      Buffer.byteLength(w.summary, "utf8") > 512 ||
      CONTROL_CHAR_RE.test(w.summary)
    ) {
      return false;
    }
  }
  if (w.logPath !== undefined && typeof w.logPath !== "string") {
    return false;
  }
  return true;
}

export function readTaskWitness(
  stateDir: string,
  taskId: string,
): LocalTaskWitnessV1 | null | "corrupt" {
  const witnessPath = taskWitnessPath(stateDir, taskId);
  let lst;
  try {
    lst = lstatSync(witnessPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return null;
    }
    return "corrupt";
  }
  if (lst.isSymbolicLink() || !lst.isFile()) return "corrupt";
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(witnessPath, "utf8")) as unknown;
  } catch {
    return "corrupt";
  }
  return isValidTaskWitnessV1(parsed, taskId) ? parsed : "corrupt";
}

// ---------------------------------------------------------------------------
// Pure dead-man, pause, and failure evaluator (§2.6)
// ---------------------------------------------------------------------------

function formatDurationCompact(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const hours = Math.floor(safe / 3_600_000);
  if (hours >= 48) return `${Math.floor(hours / 24)}d`;
  if (hours >= 1) return `${hours}h`;
  const mins = Math.max(1, Math.floor(safe / 60_000));
  return `${mins}m`;
}

function finalizeVerdict(
  base: Omit<LocalTaskHealthVerdict, "hints">,
  input: EvaluateTaskHealthInput,
): LocalTaskHealthVerdict {
  const hints: string[] = [];
  if (base.status === "not_installed") {
    hints.push("task is not installed");
  }
  if (input.readerEnvKillSwitch) {
    hints.push(
      `reader process env sets ${input.readerEnvKillSwitch.name}; this does not pause the systemd user timer`,
    );
  }
  if (
    input.persistedKillSwitch &&
    base.status !== "paused" &&
    base.status !== "disabled"
  ) {
    hints.push(
      `persisted env file sets ${input.persistedKillSwitch.name}; next scheduled tick will pause`,
    );
  }
  return { ...base, hints };
}

export function evaluateTaskHealth(input: EvaluateTaskHealthInput): LocalTaskHealthVerdict {
  // 1. Observability
  if (input.stateDirObservable === false) {
    return finalizeVerdict(
      {
        status: "unobservable",
        severity: "warning",
        consecutiveFailures: 0,
        lastSuccessAt: null,
        message: "Scheduler state directory is inaccessible from this environment.",
      },
      input,
    );
  }

  // 2. Installation & manifest integrity
  if (input.manifest === null) {
    return finalizeVerdict(
      {
        status: "not_installed",
        severity: "ok",
        consecutiveFailures: 0,
        lastSuccessAt: null,
        message: "Scheduled task is not installed.",
      },
      input,
    );
  }
  if (input.manifest === "corrupt") {
    return finalizeVerdict(
      {
        status: "witness_corrupt",
        severity: "critical",
        consecutiveFailures: 0,
        lastSuccessAt: null,
        opsReason: "stale",
        message: "Scheduled task manifest is corrupt.",
      },
      input,
    );
  }

  const validWitness =
    input.witness !== null && input.witness !== "corrupt" ? input.witness : null;

  // 3. Administrative disable
  if (!input.manifest.enabled) {
    return finalizeVerdict(
      {
        status: "disabled",
        severity: "ok",
        consecutiveFailures: validWitness?.consecutiveFailures ?? 0,
        lastSuccessAt: validWitness?.lastSuccessAt ?? null,
        message: `Scheduled task ${input.manifest.spec.taskId} is disabled.`,
      },
      input,
    );
  }

  // 4. Witness integrity
  if (input.witness === "corrupt") {
    return finalizeVerdict(
      {
        status: "witness_corrupt",
        severity: "critical",
        consecutiveFailures: 0,
        lastSuccessAt: null,
        opsReason: "stale",
        message: `Last-run witness for ${input.manifest.spec.taskId} is corrupt.`,
      },
      input,
    );
  }

  // 5. Deadline & freshness reference
  const nowMs = Date.parse(input.nowIso);
  const enabledMs = Date.parse(input.manifest.enabledAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(enabledMs)) {
    return finalizeVerdict(
      {
        status: "witness_corrupt",
        severity: "critical",
        consecutiveFailures: validWitness?.consecutiveFailures ?? 0,
        lastSuccessAt: validWitness?.lastSuccessAt ?? null,
        opsReason: "stale",
        message: "Invalid timestamp encountered while evaluating task health.",
      },
      input,
    );
  }
  const deadlineMs = Math.round(
    input.manifest.expectedIntervalMs * (input.manifest.spec.schedule.graceMultiplier ?? 1.5),
  );
  const skewMs = input.clockSkewToleranceMs ?? 300_000;
  const lastSuccessMs =
    validWitness?.lastSuccessAt !== null && validWitness?.lastSuccessAt !== undefined
      ? Date.parse(validWitness.lastSuccessAt)
      : Number.NaN;
  const freshnessRefMs = Number.isFinite(lastSuccessMs)
    ? Math.max(lastSuccessMs, enabledMs)
    : enabledMs;

  // 6. Null witness
  if (validWitness === null) {
    const elapsed = nowMs - enabledMs;
    if (elapsed <= deadlineMs) {
      return finalizeVerdict(
        {
          status: "pending_first_run",
          severity: "ok",
          consecutiveFailures: 0,
          lastSuccessAt: null,
          message: `Scheduled task ${input.manifest.spec.taskId} is enabled and awaiting its first run.`,
        },
        input,
      );
    }
    const overdueByMs = Math.max(0, elapsed - deadlineMs);
    return finalizeVerdict(
      {
        status: "schedule_missed",
        severity: "critical",
        overdueByMs,
        consecutiveFailures: 0,
        lastSuccessAt: null,
        opsReason: "schedule-missed",
        message: `Scheduled task ${input.manifest.spec.taskId} never ran within deadline (overdue by ${formatDurationCompact(overdueByMs)}).`,
      },
      input,
    );
  }

  // 7. Clock-skew guard
  const finishedMs = Date.parse(validWitness.finishedAt);
  if (
    !Number.isFinite(finishedMs) ||
    finishedMs - nowMs > skewMs ||
    (Number.isFinite(lastSuccessMs) && lastSuccessMs - nowMs > skewMs)
  ) {
    return finalizeVerdict(
      {
        status: "clock_skew",
        severity: "warning",
        consecutiveFailures: validWitness.consecutiveFailures,
        lastSuccessAt: validWitness.lastSuccessAt,
        opsReason: "stale",
        message: `Witness timestamp for ${input.manifest.spec.taskId} is more than ${formatDurationCompact(skewMs)} in the future.`,
      },
      input,
    );
  }

  // 8. Operator pause
  if (validWitness.outcome === "skipped_disabled") {
    if (nowMs - finishedMs <= deadlineMs) {
      const overdue = nowMs - freshnessRefMs > deadlineMs;
      const overdueByMs = overdue ? Math.max(0, nowMs - freshnessRefMs - deadlineMs) : undefined;
      return finalizeVerdict(
        {
          status: "paused",
          severity: overdue ? "warning" : "ok",
          ...(overdueByMs !== undefined ? { overdueByMs } : {}),
          consecutiveFailures: validWitness.consecutiveFailures,
          lastSuccessAt: validWitness.lastSuccessAt,
          message: `paused since ${validWitness.finishedAt} by ${validWitness.killSwitch?.name ?? "kill-switch"}; last success ${validWitness.lastSuccessAt ?? "never"}`,
        },
        input,
      );
    }
    // Dead-timer fallthrough (m-16): stale skipped_disabled witness past deadlineMs reaches step 10.
    const overdueByMs = Math.max(
      0,
      Math.max(nowMs - freshnessRefMs, nowMs - finishedMs) - deadlineMs,
    );
    return finalizeVerdict(
      {
        status: "schedule_missed",
        severity: "critical",
        overdueByMs,
        consecutiveFailures: validWitness.consecutiveFailures,
        lastSuccessAt: validWitness.lastSuccessAt,
        opsReason: "schedule-missed",
        message: `Scheduled task ${input.manifest.spec.taskId} missed its schedule (last pause tick at ${validWitness.finishedAt}, overdue by ${formatDurationCompact(overdueByMs)}).`,
      },
      input,
    );
  }

  // 9. Failure and interruption outcomes
  if (validWitness.outcome === "refused_policy") {
    return finalizeVerdict(
      {
        status: "failing",
        severity: "critical",
        consecutiveFailures: validWitness.consecutiveFailures,
        lastSuccessAt: validWitness.lastSuccessAt,
        opsReason: "job-failed",
        message: `Scheduled task ${input.manifest.spec.taskId} was refused by policy (${validWitness.refusal ?? "unknown"}).`,
      },
      input,
    );
  }

  if (validWitness.outcome === "timed_out") {
    return finalizeVerdict(
      {
        status: "failing",
        severity: "critical",
        consecutiveFailures: validWitness.consecutiveFailures,
        lastSuccessAt: validWitness.lastSuccessAt,
        opsReason: "deadline-exceeded",
        message: `Scheduled task ${input.manifest.spec.taskId} timed out after ${validWitness.durationMs}ms.`,
      },
      input,
    );
  }

  if (validWitness.outcome === "failed") {
    const overdue = nowMs - freshnessRefMs > deadlineMs;
    const isCritical = validWitness.consecutiveFailures >= 2 || overdue;
    const overdueByMs = overdue ? Math.max(0, nowMs - freshnessRefMs - deadlineMs) : undefined;
    return finalizeVerdict(
      {
        status: "failing",
        severity: isCritical ? "critical" : "warning",
        ...(overdueByMs !== undefined ? { overdueByMs } : {}),
        consecutiveFailures: validWitness.consecutiveFailures,
        lastSuccessAt: validWitness.lastSuccessAt,
        opsReason: "job-failed",
        message: `Scheduled task ${input.manifest.spec.taskId} failed (exit ${String(validWitness.exitCode)}, consecutive failures: ${validWitness.consecutiveFailures}).`,
      },
      input,
    );
  }

  if (validWitness.outcome === "interrupted") {
    if (nowMs - freshnessRefMs > deadlineMs) {
      const overdueByMs = Math.max(0, nowMs - freshnessRefMs - deadlineMs);
      return finalizeVerdict(
        {
          status: "schedule_missed",
          severity: "critical",
          overdueByMs,
          consecutiveFailures: validWitness.consecutiveFailures,
          lastSuccessAt: validWitness.lastSuccessAt,
          opsReason: "schedule-missed",
          message: `Scheduled task ${input.manifest.spec.taskId} missed its schedule after interruption (overdue by ${formatDurationCompact(overdueByMs)}).`,
        },
        input,
      );
    }
    return finalizeVerdict(
      {
        status: "interrupted",
        severity: "warning",
        consecutiveFailures: validWitness.consecutiveFailures,
        lastSuccessAt: validWitness.lastSuccessAt,
        message: `Last run of ${input.manifest.spec.taskId} was interrupted (${validWitness.signal ?? `exit ${String(validWitness.exitCode)}`}).`,
      },
      input,
    );
  }

  // 10. Dead-man freshness check
  if (nowMs - freshnessRefMs > deadlineMs) {
    const overdueByMs = Math.max(0, nowMs - freshnessRefMs - deadlineMs);
    return finalizeVerdict(
      {
        status: "schedule_missed",
        severity: "critical",
        overdueByMs,
        consecutiveFailures: validWitness.consecutiveFailures,
        lastSuccessAt: validWitness.lastSuccessAt,
        opsReason: "schedule-missed",
        message: `Scheduled task ${input.manifest.spec.taskId} is overdue by ${formatDurationCompact(overdueByMs)} (last success: ${validWitness.lastSuccessAt ?? "never"}).`,
      },
      input,
    );
  }

  // 11. Healthy
  return finalizeVerdict(
    {
      status: "healthy",
      severity: "ok",
      consecutiveFailures: validWitness.consecutiveFailures,
      lastSuccessAt: validWitness.lastSuccessAt,
      message: `Scheduled task ${input.manifest.spec.taskId} is healthy (last success: ${validWitness.lastSuccessAt ?? validWitness.finishedAt}).`,
    },
    input,
  );
}
