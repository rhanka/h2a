import { once } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { readState as readHandoverState } from "./handover/state.js";
import { startCentralMcpServer } from "./mcp-central.js";
import { centralStateDirectory } from "./mcp-central-discovery.js";
import { canonicalCentralRoot } from "./mcp-central-policy.js";
import { resolveRoot } from "./mcp/serve.js";

const CENTRAL_SERVE_CONFIG_ERROR_PREFIXES = [
  "prefix_owner_mismatch",
  "foreign_installation_authority",
  "authority_profile_unqualified",
  "authority_reference_invalid",
  "authority_reference_required",
  "authority_namespace_mismatch",
  "selected_entry_required",
  "legacy_prefix_mismatch",
  "successor_failed",
  "central MCP root must be an absolute path",
  "H2A_MCP_CENTRAL_ENDPOINT"
] as const;

const CENTRAL_SERVE_DISK_ERRNOS = new Set(["EACCES", "EPERM", "EROFS", "ENOSPC", "EDQUOT", "EIO"]);
const CENTRAL_SERVE_DISK_PREFIXES = [
  "private_directory_required",
  "private_state_required",
  "private_lock_required"
] as const;

function extractErrorCodes(error: unknown): string[] {
  const codes: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) codes.push(code);
    current = (current as { cause?: unknown }).cause;
  }
  return codes;
}

function matchesPrefix(value: string, prefix: string): boolean {
  return value === prefix || value.startsWith(`${prefix}:`) || value.startsWith(`${prefix} `) || value.startsWith(prefix);
}

/**
 * Closed exit-code classification for `h2a mcp-central-serve` (L3 §3.3, B-10):
 *   0 — operator pause / normal stop
 *   2 — permanent configuration / qualification failure (RestartPreventExitStatus=2 3)
 *   3 — permanent disk / permissions failure (RestartPreventExitStatus=2 3)
 *   1 — transient / crash / watchdog freeze (restarted by systemd Restart=on-failure)
 */
export function classifyCentralServeExitCode(error: unknown): 0 | 1 | 2 | 3 {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const codes = extractErrorCodes(error);
  if (matchesPrefix(message, "deferred_paused") || codes.includes("deferred_paused")) return 0;
  for (const prefix of CENTRAL_SERVE_CONFIG_ERROR_PREFIXES) {
    if (matchesPrefix(message, prefix) || codes.includes(prefix)) return 2;
  }
  for (const code of codes) {
    if (CENTRAL_SERVE_DISK_ERRNOS.has(code)) return 3;
  }
  for (const prefix of CENTRAL_SERVE_DISK_PREFIXES) {
    if (matchesPrefix(message, prefix) || codes.includes(prefix)) return 3;
  }
  return 1;
}

function isCentralOperatorPaused(runtimeBaseFlag: string | undefined, env: NodeJS.ProcessEnv): boolean {
  const paths = { ...(runtimeBaseFlag ? { runtimeBase: runtimeBaseFlag } : {}), env };
  try {
    const stateDir = centralStateDirectory(paths);
    const pausePath = join(stateDir, "operator-stop.json");
    if (!existsSync(pausePath)) return false;
    try {
      return readHandoverState(pausePath, "pause")?.value.paused === true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    timer.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * `h2a mcp-central-serve` — the opt-in, one-per-UID Streamable HTTP MCP
 * process without pulling the full CLI monolith on startup.
 */
export async function runCentralMcpServe(
  flags: Record<string, string>,
  io: {
    stderr: NodeJS.WritableStream;
    cwd?: () => string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    physicalPrefix?: string;
    standbyPollMs?: number;
    watchdogIntervalMs?: number;
    watchdogTimeoutMs?: number;
    watchdogMaxFailures?: number;
    probeOptions?: Record<string, unknown>;
    evictionOptions?: Record<string, unknown>;
    onStateChange?: (state: "ACQUIRING" | "STANDBY" | "SERVING" | "STOPPING") => void;
  } = { stderr: process.stderr }
): Promise<number> {
  const cwd = io.cwd ?? (() => process.cwd());
  const env = io.env ?? process.env;
  const supervised = flags.supervised === "true";
  const root = supervised ? (flags.root ? resolveRoot(flags, cwd) : canonicalCentralRoot(env)) : resolveRoot(flags, cwd);
  const runtimeBaseFlag = flags["runtime-base"];
  try {
    if (!supervised) {
      const started = await startCentralMcpServer({
        root,
        env,
        automatic: flags["auto-start"] === "true",
        ...(io.physicalPrefix ? { physicalPrefix: io.physicalPrefix } : {}),
        ...(io.probeOptions ? { probeOptions: io.probeOptions } : {}),
        ...(io.evictionOptions ? { evictionOptions: io.evictionOptions } : {}),
        ...(flags["handover-id"] ? { successor: { handoverId: flags["handover-id"],
          transactionEpoch: Number(flags["transaction-epoch"]), attempt: Number(flags["successor-attempt"]) } } : {}),
        runtimeBase: runtimeBaseFlag
      });
      if (started.kind === "reused") {
        io.stderr.write(
          `h2a mcp-central-serve: reusing live central MCP at ${started.endpoint}\n`
        );
        return 0;
      }
      io.stderr.write(
        `h2a mcp-central-serve: listening on ${started.endpoint} (generation ${started.generation})\n`
      );
      if (!io.signal) await started.closed;
      else if (!io.signal.aborted) await Promise.race([once(io.signal, "abort"), started.closed]);
      await started.stop();
      return 0;
    }

    // Supervised closed state machine: ACQUIRING -> STANDBY | SERVING -> STOPPING (L3 §3.3, B-10).
    const { startSupervisorWatchdog } = await import("./handover/supervisor-watchdog.js");
    const {
      currentIdentity,
      observeProcess,
      probeOwnerHealth,
      readMarkerObservation
    } = await import("./handover/admission.js");
    const standbyPollMs = io.standbyPollMs ?? 2_000;
    let state: "ACQUIRING" | "STANDBY" | "SERVING" | "STOPPING" = "ACQUIRING";
    let reusedEndpoint = "";
    let reusedMarkerPath = "";

    for (;;) {
      if (io.signal?.aborted) return 0;
      if (state === "ACQUIRING") {
        io.onStateChange?.("ACQUIRING");
        if (isCentralOperatorPaused(runtimeBaseFlag, env)) {
          io.stderr.write("h2a mcp-central-serve: operator pause active (operator-stop.json), exiting 0\n");
          return 0;
        }
        const started = await startCentralMcpServer({
          root,
          env,
          automatic: true,
          idleTimeoutMs: 0,
          ...(io.physicalPrefix ? { physicalPrefix: io.physicalPrefix } : {}),
          ...(io.probeOptions ? { probeOptions: io.probeOptions } : {}),
          ...(io.evictionOptions ? { evictionOptions: io.evictionOptions } : {}),
          ...(flags["handover-id"] ? { successor: { handoverId: flags["handover-id"],
            transactionEpoch: Number(flags["transaction-epoch"]), attempt: Number(flags["successor-attempt"]) } } : {}),
          runtimeBase: runtimeBaseFlag
        });
        if (started.kind === "reused") {
          reusedEndpoint = started.endpoint;
          reusedMarkerPath = started.markerPath;
          io.stderr.write(
            `h2a mcp-central-serve: live central MCP already healthy at ${started.endpoint}; entering STANDBY\n`
          );
          state = "STANDBY";
          continue;
        }
        state = "SERVING";
        io.onStateChange?.("SERVING");
        io.stderr.write(
          `h2a mcp-central-serve: listening on ${started.endpoint} (generation ${started.generation})\n`
        );
        let watchdog: ReturnType<typeof startSupervisorWatchdog> | undefined;
        try {
          watchdog = startSupervisorWatchdog({
            endpoint: started.endpoint,
            ...(io.watchdogIntervalMs !== undefined ? { intervalMs: io.watchdogIntervalMs } : {}),
            ...(io.watchdogTimeoutMs !== undefined ? { timeoutMs: io.watchdogTimeoutMs } : {}),
            ...(io.watchdogMaxFailures !== undefined ? { maxFailures: io.watchdogMaxFailures } : {})
          });
          if (!io.signal) await started.closed;
          else if (!io.signal.aborted) await Promise.race([once(io.signal, "abort"), started.closed]);
        } finally {
          state = "STOPPING";
          io.onStateChange?.("STOPPING");
          await watchdog?.stop();
          await started.stop();
        }
        return 0;
      }

      if (state === "STANDBY") {
        io.onStateChange?.("STANDBY");
        for (;;) {
          await sleepAbortable(standbyPollMs, io.signal);
          if (io.signal?.aborted) return 0;
          if (isCentralOperatorPaused(runtimeBaseFlag, env)) {
            io.stderr.write("h2a mcp-central-serve: operator pause active in STANDBY, exiting 0\n");
            return 0;
          }
          let observed;
          try {
            observed = readMarkerObservation(reusedMarkerPath);
          } catch (readErr) {
            if ((readErr as NodeJS.ErrnoException)?.code === "ENOENT") observed = undefined;
            else throw readErr;
          }
          if (!observed) {
            io.stderr.write(`h2a mcp-central-serve: marker absent (was ${reusedEndpoint}); transitioning STANDBY -> ACQUIRING\n`);
            state = "ACQUIRING";
            break;
          }
          const probe = await probeOwnerHealth(
            reusedMarkerPath,
            observed,
            { domain: { canonicalRoot: root }, frame: currentIdentity(), observe: observeProcess },
            io.probeOptions
          );
          if (probe.status === "healthy" || probe.status === "starting") continue;
          if (probe.status === "unknown") throw new Error("owner_liveness_unknown");
          io.stderr.write(`h2a mcp-central-serve: observed owner status=${probe.status}; transitioning STANDBY -> ACQUIRING\n`);
          state = "ACQUIRING";
          break;
        }
      }
    }
  } catch (error) {
    io.stderr.write(`h2a mcp-central-serve: ${(error as Error).message}\n`);
    return classifyCentralServeExitCode(error);
  }
}
