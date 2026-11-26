import { spawn, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

export const FOCUS_BUILD_RESULT_DEFAULT_WAIT_MS = 15_000;
export const FOCUS_BUILD_RESULT_MAX_WAIT_MS = 20_000;
export const FOCUS_SYNC_WAIT_MS_DEFAULT = 20_000;
export const FOCUS_WORKER_TIMEOUT_MS_DEFAULT = 120_000;
export const FOCUS_WORKER_KILL_GRACE_MS_DEFAULT = 1_000;
export const FOCUS_WORKER_MAX_OLD_SPACE_MB_DEFAULT = 512;
export const FOCUS_MAX_CONCURRENT_JOBS_DEFAULT = 4;
export const FOCUS_JOB_RETENTION_MS_DEFAULT = 3_600_000;
export const FOCUS_MAX_RETAINED_JOBS_DEFAULT = 64;
export const FOCUS_WORKER_RESULT_MARKER = "__H2A_FOCUS_WORKER_RESULT__:";

export type FocusBuildJobState = "queued" | "running" | "succeeded" | "failed";

export interface FocusRefusal {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly sectionId?: string;
  readonly slot?: string;
  readonly entityId?: string;
  readonly neededPx?: number;
  readonly allocatedPx?: number;
  readonly text?: string;
}

export interface FocusPublishRequestSpec {
  readonly federation?: string;
  readonly workspaceRef?: string;
  readonly artifactId?: string;
  readonly previousManifest?: string;
  readonly expectedCurrentReleaseId?: string | null;
  readonly title?: string;
  readonly description?: string;
  readonly icon?: string;
  readonly idempotencyKey?: string;
}

export interface FocusPublishOutcomeSummary {
  readonly federation: string;
  readonly workspaceRef: string;
  readonly bindingName: string;
  readonly artifactId: string;
  readonly releaseId?: string;
  readonly digest?: string;
  readonly stableUrl?: string;
  readonly versionUrl?: string;
  readonly files: readonly string[];
  readonly restricted: true;
}

export interface FocusBuildWorkerOptions {
  readonly renderer?: "svelte" | "vue";
  readonly mode?: "decision" | "report";
  readonly target?: "document" | "artifact";
  readonly themeCss?: string;
  readonly themeId?: string;
}

export interface FocusBuildJobRecord {
  readonly version: 1;
  readonly jobId: string;
  readonly state: FocusBuildJobState;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly startedAtMs?: number;
  readonly finishedAtMs?: number;
  readonly pid?: number;
  readonly workspaceRoot: string;
  readonly input: string;
  readonly output?: string;
  readonly publish?: FocusPublishRequestSpec;
  readonly options: FocusBuildWorkerOptions;
  readonly bytes?: number;
  readonly warnings?: readonly string[];
  readonly publishResult?: FocusPublishOutcomeSummary;
  readonly error?: string;
  readonly refusals?: readonly FocusRefusal[];
}

export interface FocusWorkerPayload {
  readonly jobId: string;
  readonly workspaceRoot: string;
  readonly input: string;
  readonly output?: string;
  readonly publish?: FocusPublishRequestSpec;
  readonly options: FocusBuildWorkerOptions;
}

export type FocusWorkerResult =
  | {
      readonly ok: true;
      readonly output?: string;
      readonly bytes: number;
      readonly warnings: readonly string[];
      readonly publish?: FocusPublishOutcomeSummary;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly refusals: readonly FocusRefusal[];
    };

export type FocusBuildSubmitResult =
  | {
      readonly ok: true;
      readonly jobId: string;
      readonly state: "queued";
      [key: string]: unknown;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly refusals: readonly FocusRefusal[];
      [key: string]: unknown;
    };

export type FocusBuildJobResultResponse =
  | {
      readonly ok: true;
      readonly jobId: string;
      readonly state: "queued" | "running";
      readonly output?: string;
      [key: string]: unknown;
    }
  | {
      readonly ok: true;
      readonly jobId: string;
      readonly state: "succeeded";
      readonly output?: string;
      readonly bytes: number;
      readonly warnings: readonly string[];
      readonly publish?: FocusPublishOutcomeSummary;
      [key: string]: unknown;
    }
  | {
      readonly ok: false;
      readonly jobId?: string;
      readonly state?: "failed";
      readonly error: string;
      readonly refusals: readonly FocusRefusal[];
      [key: string]: unknown;
    };

export interface FocusBuildManagerOptions {
  /** Durable central state root (`<stateRoot>/focus-jobs/`). */
  readonly stateRoot: string;
  /** Optional base environment forwarded to worker child processes. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Max concurrent active (`queued` + `running`) jobs allowed cleanly cleanly. */
  readonly maxConcurrentJobs?: number;
  /** Retention window for terminal (`succeeded` / `failed`) job journal entries. */
  readonly retentionMs?: number;
  /** Maximum number of terminal job entries retained on disk. */
  readonly maxRetainedJobs?: number;
  /** Per-worker timeout budget in ms before SIGTERM -> SIGKILL. */
  readonly workerTimeoutMs?: number;
  /** Grace delay between SIGTERM and SIGKILL in ms. */
  readonly killGraceMs?: number;
  /** Worker child V8 `--max-old-space-size` MB budget. */
  readonly workerMaxOldSpaceMb?: number;
  /** Bounded wait used by backward-compatible `h2a_focus_build` before returning pending `jobId`. */
  readonly syncBuildWaitMs?: number;
  /** Override worker entrypoint (isolated tests only). */
  readonly workerScript?: string;
  /** Injectable wall-clock function (tests). */
  readonly now?: () => number;
}

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_WORKER_SCRIPT = fileURLToPath(new URL("./focus-worker.js", import.meta.url));
const MAX_WORKER_STDIO_BYTES = 2 * 1024 * 1024;

function envPositiveInt(
  name: string,
  env: Readonly<Record<string, string | undefined>> | undefined
): number | undefined {
  const raw = env?.[name] ?? process.env[name];
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function isPidAlive(pid: number | undefined): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

export function isValidFocusJobId(value: unknown): value is string {
  return typeof value === "string" && JOB_ID_PATTERN.test(value);
}

export function clampBuildResultWaitMs(waitMs: number | undefined): number {
  if (waitMs === undefined) return FOCUS_BUILD_RESULT_DEFAULT_WAIT_MS;
  return Math.max(0, Math.min(FOCUS_BUILD_RESULT_MAX_WAIT_MS, Math.trunc(waitMs)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatTerminalRecord(record: FocusBuildJobRecord): FocusBuildJobResultResponse {
  if (record.state === "succeeded") {
    return {
      ok: true,
      jobId: record.jobId,
      state: "succeeded",
      ...(record.output !== undefined ? { output: record.output } : {}),
      bytes: record.bytes ?? 0,
      warnings: record.warnings ?? [],
      ...(record.publishResult !== undefined ? { publish: record.publishResult } : {})
    };
  }
  if (record.state === "failed") {
    const error = record.error ?? "Focus build failed";
    const refusals =
      record.refusals && record.refusals.length > 0
        ? record.refusals
        : [{ code: "build_refused", message: error }];
    return {
      ok: false,
      jobId: record.jobId,
      state: "failed",
      error,
      refusals
    };
  }
  return {
    ok: true,
    jobId: record.jobId,
    state: record.state,
    ...(record.output !== undefined ? { output: record.output } : {})
  };
}

function parseWorkerResultStdout(stdoutText: string): FocusWorkerResult | undefined {
  const lines = stdoutText.split(/\r?\n/u);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.startsWith(FOCUS_WORKER_RESULT_MARKER)) continue;
    try {
      const parsed = JSON.parse(line.slice(FOCUS_WORKER_RESULT_MARKER.length)) as unknown;
      if (!isRecord(parsed) || typeof parsed.ok !== "boolean") return undefined;
      if (parsed.ok) {
        return {
          ok: true,
          ...(typeof parsed.output === "string" ? { output: parsed.output } : {}),
          bytes: typeof parsed.bytes === "number" ? parsed.bytes : 0,
          warnings: Array.isArray(parsed.warnings)
            ? parsed.warnings.filter((w): w is string => typeof w === "string")
            : [],
          ...(isRecord(parsed.publish) ? { publish: parsed.publish as unknown as FocusPublishOutcomeSummary } : {})
        };
      }
      const message = typeof parsed.error === "string" && parsed.error.length > 0
        ? parsed.error
        : "Focus build worker refused input";
      const refusals = Array.isArray(parsed.refusals) && parsed.refusals.length > 0
        ? (parsed.refusals as FocusRefusal[])
        : [{ code: "build_refused", message }];
      return { ok: false, error: message, refusals };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function buildWorkerEnvironment(
  baseEnv: Readonly<Record<string, string | undefined>> | undefined
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env, ...(baseEnv ?? {}) };
  // Never propagate central attachment / stdio readiness secrets into build workers.
  for (const key of Object.keys(merged)) {
    if (key.startsWith("H2A_MCP_READY_") || key.startsWith("H2A_NATIVE_") || merged[key] === undefined) {
      delete merged[key];
    }
  }
  return merged;
}

interface ActiveWorkerHandle {
  readonly jobId: string;
  readonly child: ChildProcessByStdio<Writable, Readable, Readable>;
  readonly timeoutTimer: ReturnType<typeof setTimeout>;
  killTimer?: ReturnType<typeof setTimeout>;
  timedOut: boolean;
}

/**
 * Manages asynchronous Focus builds off the MCP/central event loop using bounded
 * child Node worker processes backed by a durable JSON job journal in central state.
 */
export class FocusBuildManager {
  readonly stateRoot: string;
  readonly jobsDir: string;
  readonly maxConcurrentJobs: number;
  readonly retentionMs: number;
  readonly maxRetainedJobs: number;
  readonly workerTimeoutMs: number;
  readonly killGraceMs: number;
  readonly workerMaxOldSpaceMb: number;
  readonly syncBuildWaitMs: number;
  private readonly baseEnv: Readonly<Record<string, string | undefined>> | undefined;
  private readonly workerScript: string;
  private readonly now: () => number;
  private readonly inMemory = new Map<string, FocusBuildJobRecord>();
  private readonly pendingQueue: Array<{
    jobId: string;
    env?: Readonly<Record<string, string | undefined>>;
  }> = [];
  private readonly dispatchingJobIds = new Set<string>();
  private readonly activeWorkers = new Map<string, ActiveWorkerHandle>();
  private readonly waiters = new Map<string, Set<() => void>>();
  private closed = false;
  private dispatchScheduled = false;

  constructor(options: FocusBuildManagerOptions) {
    this.stateRoot = options.stateRoot;
    this.jobsDir = join(options.stateRoot, "focus-jobs");
    this.baseEnv = options.env;
    this.workerScript = options.workerScript ?? DEFAULT_WORKER_SCRIPT;
    this.now = options.now ?? (() => Date.now());
    this.maxConcurrentJobs =
      options.maxConcurrentJobs ??
      envPositiveInt("H2A_FOCUS_MAX_CONCURRENT_JOBS", options.env) ??
      FOCUS_MAX_CONCURRENT_JOBS_DEFAULT;
    this.retentionMs =
      options.retentionMs ??
      envPositiveInt("H2A_FOCUS_JOB_TTL_MS", options.env) ??
      FOCUS_JOB_RETENTION_MS_DEFAULT;
    this.maxRetainedJobs =
      options.maxRetainedJobs ??
      envPositiveInt("H2A_FOCUS_MAX_RETAINED_JOBS", options.env) ??
      FOCUS_MAX_RETAINED_JOBS_DEFAULT;
    this.workerTimeoutMs =
      options.workerTimeoutMs ??
      envPositiveInt("H2A_FOCUS_BUILD_TIMEOUT_MS", options.env) ??
      FOCUS_WORKER_TIMEOUT_MS_DEFAULT;
    this.killGraceMs = options.killGraceMs ?? FOCUS_WORKER_KILL_GRACE_MS_DEFAULT;
    this.workerMaxOldSpaceMb =
      options.workerMaxOldSpaceMb ??
      envPositiveInt("H2A_FOCUS_WORKER_MAX_MB", options.env) ??
      FOCUS_WORKER_MAX_OLD_SPACE_MB_DEFAULT;
    this.syncBuildWaitMs =
      options.syncBuildWaitMs ??
      envPositiveInt("H2A_FOCUS_SYNC_WAIT_MS", options.env) ??
      FOCUS_SYNC_WAIT_MS_DEFAULT;
  }

  private jobPath(jobId: string): string {
    return join(this.jobsDir, `${jobId}.json`);
  }

  private writeRecord(record: FocusBuildJobRecord): void {
    mkdirSync(this.jobsDir, { recursive: true, mode: 0o700 });
    const target = this.jobPath(record.jobId);
    const temp = `${target}.tmp.${process.pid}.${randomUUID()}`;
    try {
      writeFileSync(temp, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: "wx" });
      renameSync(temp, target);
    } finally {
      rmSync(temp, { force: true });
    }
    this.inMemory.set(record.jobId, record);
  }

  private readDiskRecord(jobId: string): FocusBuildJobRecord | undefined {
    if (!isValidFocusJobId(jobId)) return undefined;
    const path = this.jobPath(jobId);
    if (!existsSync(path)) return undefined;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (!isRecord(parsed) || parsed.version !== 1 || !isValidFocusJobId(parsed.jobId)) {
        return undefined;
      }
      return parsed as unknown as FocusBuildJobRecord;
    } catch {
      return undefined;
    }
  }

  private loadReconciledRecord(jobId: string): FocusBuildJobRecord | undefined {
    const disk = this.readDiskRecord(jobId);
    const mem = this.inMemory.get(jobId);
    let record: FocusBuildJobRecord | undefined;
    if (disk && mem) {
      record = disk.updatedAtMs >= mem.updatedAtMs ? disk : mem;
    } else {
      record = disk ?? mem;
    }
    if (!record) return undefined;
    if (
      (record.state === "queued" || record.state === "running") &&
      !this.activeWorkers.has(jobId) &&
      !this.dispatchingJobIds.has(jobId)
    ) {
      const isLocallyQueued = this.pendingQueue.some((item) => item.jobId === jobId);
      if (!isLocallyQueued && (record.pid === undefined || !isPidAlive(record.pid))) {
        const failedAt = this.now();
        const message = "Focus build worker exited unexpectedly before recording a result";
        const reconciled: FocusBuildJobRecord = {
          ...record,
          state: "failed",
          updatedAtMs: failedAt,
          finishedAtMs: failedAt,
          error: message,
          refusals: [{ code: "worker_lost", message }]
        };
        try {
          this.writeRecord(reconciled);
        } catch {
          this.inMemory.set(jobId, reconciled);
        }
        return reconciled;
      }
    }
    return record;
  }

  private listDiskJobIds(): string[] {
    if (!existsSync(this.jobsDir)) return [];
    const ids: string[] = [];
    for (const name of readdirSync(this.jobsDir)) {
      if (!name.endsWith(".json")) continue;
      const stem = name.slice(0, -5);
      if (isValidFocusJobId(stem)) ids.push(stem);
    }
    return ids;
  }

  private countActiveJobs(): number {
    const seen = new Set<string>();
    let active = 0;
    for (const jobId of this.activeWorkers.keys()) {
      seen.add(jobId);
      active++;
    }
    for (const queued of this.pendingQueue) {
      if (!seen.has(queued.jobId)) {
        seen.add(queued.jobId);
        active++;
      }
    }
    for (const diskId of this.listDiskJobIds()) {
      if (seen.has(diskId)) continue;
      const rec = this.loadReconciledRecord(diskId);
      if (rec && (rec.state === "queued" || rec.state === "running")) {
        seen.add(diskId);
        active++;
      }
    }
    return active;
  }

  /** Remove expired or excess terminal journal entries so disk usage stays bounded. */
  sweepExpiredJobs(): void {
    const currentNow = this.now();
    const terminal: FocusBuildJobRecord[] = [];
    const seen = new Set<string>();
    for (const id of [...this.inMemory.keys(), ...this.listDiskJobIds()]) {
      if (seen.has(id)) continue;
      seen.add(id);
      const rec = this.loadReconciledRecord(id);
      if (!rec) continue;
      if (rec.state === "succeeded" || rec.state === "failed") {
        const finished = rec.finishedAtMs ?? rec.updatedAtMs;
        if (currentNow - finished >= this.retentionMs) {
          this.deleteJobRecord(rec.jobId);
        } else {
          terminal.push(rec);
        }
      }
    }
    if (terminal.length > this.maxRetainedJobs) {
      terminal.sort((a, b) => (a.finishedAtMs ?? a.updatedAtMs) - (b.finishedAtMs ?? b.updatedAtMs));
      const excess = terminal.length - this.maxRetainedJobs;
      for (let i = 0; i < excess; i++) {
        this.deleteJobRecord(terminal[i]!.jobId);
      }
    }
  }

  private deleteJobRecord(jobId: string): void {
    this.inMemory.delete(jobId);
    rmSync(this.jobPath(jobId), { force: true });
  }

  private notifyWaiters(jobId: string): void {
    const set = this.waiters.get(jobId);
    if (!set) return;
    this.waiters.delete(jobId);
    for (const wake of set) wake();
  }

  private finishJob(
    record: FocusBuildJobRecord,
    outcome: FocusWorkerResult
  ): void {
    const finishedAt = this.now();
    const next: FocusBuildJobRecord = outcome.ok
      ? {
          version: 1,
          jobId: record.jobId,
          state: "succeeded",
          createdAtMs: record.createdAtMs,
          updatedAtMs: finishedAt,
          startedAtMs: record.startedAtMs ?? finishedAt,
          finishedAtMs: finishedAt,
          workspaceRoot: record.workspaceRoot,
          input: record.input,
          ...(record.output !== undefined ? { output: record.output } : {}),
          ...(record.publish !== undefined ? { publish: record.publish } : {}),
          options: record.options,
          bytes: outcome.bytes,
          warnings: outcome.warnings,
          ...(outcome.publish !== undefined ? { publishResult: outcome.publish } : {})
        }
      : {
          version: 1,
          jobId: record.jobId,
          state: "failed",
          createdAtMs: record.createdAtMs,
          updatedAtMs: finishedAt,
          startedAtMs: record.startedAtMs ?? finishedAt,
          finishedAtMs: finishedAt,
          workspaceRoot: record.workspaceRoot,
          input: record.input,
          ...(record.output !== undefined ? { output: record.output } : {}),
          ...(record.publish !== undefined ? { publish: record.publish } : {}),
          options: record.options,
          error: outcome.error,
          refusals: outcome.refusals
        };
    try {
      this.writeRecord(next);
    } catch {
      this.inMemory.set(record.jobId, next);
    }
    this.sweepExpiredJobs();
    this.notifyWaiters(record.jobId);
    this.scheduleDispatch();
  }

  private scheduleDispatch(): void {
    if (this.closed || this.dispatchScheduled) return;
    this.dispatchScheduled = true;
    setImmediate(() => {
      this.dispatchScheduled = false;
      this.dispatchPending();
    });
  }

  private dispatchPending(): void {
    if (this.closed) return;
    while (this.pendingQueue.length > 0 && this.activeWorkers.size < this.maxConcurrentJobs) {
      const nextItem = this.pendingQueue.shift()!;
      this.dispatchingJobIds.add(nextItem.jobId);
      try {
        const record = this.loadReconciledRecord(nextItem.jobId);
        if (!record || record.state !== "queued") continue;
        this.spawnWorker(record, nextItem.env);
      } finally {
        this.dispatchingJobIds.delete(nextItem.jobId);
      }
    }
  }

  private spawnWorker(
    queuedRecord: FocusBuildJobRecord,
    perJobEnv: Readonly<Record<string, string | undefined>> | undefined
  ): void {
    const startedAt = this.now();
    const payload: FocusWorkerPayload = {
      jobId: queuedRecord.jobId,
      workspaceRoot: queuedRecord.workspaceRoot,
      input: queuedRecord.input,
      ...(queuedRecord.output !== undefined ? { output: queuedRecord.output } : {}),
      ...(queuedRecord.publish !== undefined ? { publish: queuedRecord.publish } : {}),
      options: queuedRecord.options
    };
    const runningRecord: FocusBuildJobRecord = {
      ...queuedRecord,
      state: "running",
      startedAtMs: startedAt,
      updatedAtMs: startedAt
    };

    let child: ChildProcessByStdio<Writable, Readable, Readable>;
    try {
      child = spawn(
        process.execPath,
        [`--max-old-space-size=${this.workerMaxOldSpaceMb}`, this.workerScript],
        {
          cwd: queuedRecord.workspaceRoot,
          env: buildWorkerEnvironment(perJobEnv ?? this.baseEnv),
          stdio: ["pipe", "pipe", "pipe"]
        }
      );
    } catch (error) {
      const message = `Failed to launch Focus build worker: ${error instanceof Error ? error.message : String(error)}`;
      this.finishJob(runningRecord, {
        ok: false,
        error: message,
        refusals: [{ code: "worker_spawn_failed", message }]
      });
      return;
    }

    const withPid: FocusBuildJobRecord = {
      ...runningRecord,
      ...(child.pid !== undefined ? { pid: child.pid } : {})
    };
    try {
      this.writeRecord(withPid);
    } catch {
      this.inMemory.set(withPid.jobId, withPid);
    }

    let stdoutBuf = "";
    let stderrBuf = "";
    let settled = false;

    const timeoutTimer = setTimeout(() => {
      activeHandle.timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* child already dead */
      }
      activeHandle.killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, this.killGraceMs);
      activeHandle.killTimer.unref?.();
    }, this.workerTimeoutMs);
    timeoutTimer.unref?.();

    const activeHandle: ActiveWorkerHandle = {
      jobId: withPid.jobId,
      child,
      timeoutTimer,
      timedOut: false
    };
    this.activeWorkers.set(withPid.jobId, activeHandle);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8");
      if (stdoutBuf.length > MAX_WORKER_STDIO_BYTES) {
        stdoutBuf = stdoutBuf.slice(-MAX_WORKER_STDIO_BYTES);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
      if (stderrBuf.length > MAX_WORKER_STDIO_BYTES) {
        stderrBuf = stderrBuf.slice(-MAX_WORKER_STDIO_BYTES);
      }
    });

    const finalizeOnce = (code: number | null, signal: NodeJS.Signals | null, spawnErr?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(activeHandle.timeoutTimer);
      if (activeHandle.killTimer) clearTimeout(activeHandle.killTimer);
      this.activeWorkers.delete(withPid.jobId);

      if (this.closed) {
        const msg = "Focus build aborted because the MCP server closed";
        this.finishJob(withPid, {
          ok: false,
          error: msg,
          refusals: [{ code: "server_closed", message: msg }]
        });
        return;
      }

      if (activeHandle.timedOut) {
        const msg = `Focus build worker exceeded time budget of ${this.workerTimeoutMs}ms and was terminated`;
        this.finishJob(withPid, {
          ok: false,
          error: msg,
          refusals: [{ code: "build_timeout", message: msg }]
        });
        return;
      }

      if (spawnErr) {
        const msg = `Focus build worker failed: ${spawnErr.message}`;
        this.finishJob(withPid, {
          ok: false,
          error: msg,
          refusals: [{ code: "worker_failed", message: msg }]
        });
        return;
      }

      const parsed = parseWorkerResultStdout(stdoutBuf);
      if (parsed) {
        this.finishJob(withPid, parsed);
        return;
      }

      const detail = stderrBuf.trim().split(/\r?\n/u).at(-1)?.slice(0, 300);
      const exitDesc = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      const msg = detail
        ? `Focus build worker exited (${exitDesc}): ${detail}`
        : `Focus build worker exited (${exitDesc}) without producing a result`;
      this.finishJob(withPid, {
        ok: false,
        error: msg,
        refusals: [{ code: "worker_failed", message: msg }]
      });
    };

    child.once("error", (error) => finalizeOnce(null, null, error));
    child.once("close", (code, signal) => finalizeOnce(code, signal));

    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(payload));
  }

  submit(params: {
    readonly workspaceRoot: string;
    readonly input: string;
    readonly output?: string;
    readonly publish?: FocusPublishRequestSpec;
    readonly options?: FocusBuildWorkerOptions;
    readonly env?: Readonly<Record<string, string | undefined>>;
  }): FocusBuildSubmitResult {
    if (this.closed) {
      const msg = "Focus build manager is closed";
      return { ok: false, error: msg, refusals: [{ code: "server_closed", message: msg }] };
    }
    this.sweepExpiredJobs();
    const active = this.countActiveJobs();
    if (active >= this.maxConcurrentJobs) {
      const msg = `Too many concurrent Focus build jobs (${active}/${this.maxConcurrentJobs}); wait for an active job to complete`;
      return {
        ok: false,
        error: msg,
        refusals: [{ code: "too_many_jobs", message: msg }]
      };
    }

    const jobId = randomUUID();
    const createdAt = this.now();
    const record: FocusBuildJobRecord = {
      version: 1,
      jobId,
      state: "queued",
      createdAtMs: createdAt,
      updatedAtMs: createdAt,
      workspaceRoot: params.workspaceRoot,
      input: params.input,
      ...(params.output !== undefined ? { output: params.output } : {}),
      ...(params.publish !== undefined ? { publish: params.publish } : {}),
      options: params.options ?? {}
    };
    this.writeRecord(record);
    this.pendingQueue.push({ jobId, ...(params.env ? { env: params.env } : {}) });
    this.scheduleDispatch();

    return {
      ok: true,
      jobId,
      state: "queued"
    };
  }

  async getResult(jobId: string, waitMs?: number): Promise<FocusBuildJobResultResponse> {
    if (!isValidFocusJobId(jobId)) {
      const msg = "Invalid Focus build jobId";
      return {
        ok: false,
        error: msg,
        refusals: [{ code: "invalid_arguments", path: "$.jobId", message: msg }]
      };
    }

    const boundedWaitMs = clampBuildResultWaitMs(waitMs);
    this.sweepExpiredJobs();

    let current = this.loadReconciledRecord(jobId);
    if (!current) {
      const msg = `Focus build job not found or expired: ${jobId}`;
      return {
        ok: false,
        jobId,
        error: msg,
        refusals: [{ code: "job_not_found", message: msg }]
      };
    }

    if (current.state === "succeeded" || current.state === "failed" || boundedWaitMs === 0) {
      return formatTerminalRecord(current);
    }

    const deadline = this.now() + boundedWaitMs;
    const isLocallyOwned =
      this.activeWorkers.has(jobId) || this.pendingQueue.some((item) => item.jobId === jobId);

    if (isLocallyOwned) {
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          this.waiters.get(jobId)?.delete(wake);
          resolve();
        }, boundedWaitMs);

        let set = this.waiters.get(jobId);
        if (!set) {
          set = new Set();
          this.waiters.set(jobId, set);
        }
        set.add(wake);

        const fresh = this.loadReconciledRecord(jobId);
        if (fresh && (fresh.state === "succeeded" || fresh.state === "failed")) {
          this.waiters.get(jobId)?.delete(wake);
          wake();
        }
      });
    } else {
      while (this.now() < deadline && !this.closed) {
        current = this.loadReconciledRecord(jobId);
        if (!current) {
          const msg = `Focus build job not found or expired: ${jobId}`;
          return { ok: false, jobId, error: msg, refusals: [{ code: "job_not_found", message: msg }] };
        }
        if (current.state === "succeeded" || current.state === "failed") {
          return formatTerminalRecord(current);
        }
        const remaining = Math.max(1, Math.min(40, deadline - this.now()));
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
    }

    const latest = this.loadReconciledRecord(jobId);
    if (!latest) {
      const msg = `Focus build job not found or expired: ${jobId}`;
      return { ok: false, jobId, error: msg, refusals: [{ code: "job_not_found", message: msg }] };
    }
    return formatTerminalRecord(latest);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.pendingQueue.length = 0;
    for (const jobId of [...this.waiters.keys()]) {
      this.notifyWaiters(jobId);
    }
    const handles = [...this.activeWorkers.values()];
    if (handles.length === 0) return;

    await Promise.all(
      handles.map(
        (handle) =>
          new Promise<void>((resolve) => {
            clearTimeout(handle.timeoutTimer);
            const done = () => resolve();
            if (handle.child.exitCode !== null || handle.child.signalCode !== null) {
              resolve();
              return;
            }
            handle.child.once("close", done);
            try {
              handle.child.kill("SIGTERM");
            } catch {
              resolve();
              return;
            }
            const forceTimer = setTimeout(() => {
              try {
                handle.child.kill("SIGKILL");
              } catch {
                /* ignore */
              }
              resolve();
            }, this.killGraceMs);
            forceTimer.unref?.();
          })
      )
    );
  }
}

export function createFocusBuildManager(options: FocusBuildManagerOptions): FocusBuildManager {
  return new FocusBuildManager(options);
}
