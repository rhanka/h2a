import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { NativeTerminalClient } from "./client.js";
import {
  defaultOwnerHostProbe,
  reconcileDeadHostOrphans,
  type NativeTerminalOwnerHostProbe,
  type NativeTerminalReapOutcome,
} from "./host.js";
import {
  NATIVE_TERMINAL_DEFAULT_MAX_SESSIONS,
  NATIVE_TERMINAL_DEFAULT_REQUEST_TIMEOUT_MS,
  NATIVE_TERMINAL_HEALTH_TIMEOUT_MS,
  NATIVE_TERMINAL_MAX_REPLAY_BYTES_PER_SESSION,
  NATIVE_TERMINAL_MAX_SESSIONS,
  NATIVE_TERMINAL_PROTOCOL_VERSION,
  type NativeTerminalPing,
  type NativeTerminalStopSignal,
} from "./protocol.js";

const NATIVE_TERMINAL_SPAWN_BACKOFF_BASE_MS = 250;
const NATIVE_TERMINAL_SPAWN_BACKOFF_MAX_MS = 5_000;
const NATIVE_TERMINAL_STARTUP_TIMEOUT_MS = 5_000;
const NATIVE_TERMINAL_SPAWN_TERMINATION_GRACE_MS = 1_000;
const NATIVE_TERMINAL_MAX_STARTUP_DIAGNOSTIC_BYTES = 4_096;

export type NativeTerminalHostSpawn = (options: {
  socketPath: string;
  generation: string;
  replayBytesPerSession: number;
  maxSessions: number;
  /** Durable pgid store; defaults to the real registry path when omitted. */
  registryPath?: string;
}) => ChildProcess;

function defaultSpawnHost(options: {
  socketPath: string;
  generation: string;
  replayBytesPerSession: number;
  maxSessions: number;
  registryPath?: string;
}): ChildProcess {
  const entry = fileURLToPath(new URL("./process.js", import.meta.url));
  const child = spawn(process.execPath, [
    entry,
    "--socket",
    options.socketPath,
    "--generation",
    options.generation,
    "--replay-bytes",
    String(options.replayBytesPerSession),
    "--max-sessions",
    String(options.maxSessions),
    ...(options.registryPath !== undefined
      ? ["--registry-path", options.registryPath]
      : []),
  ], {
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: process.env,
  });
  (child.stderr as NodeJS.ReadableStream & { unref?(): void } | null)?.unref?.();
  child.unref();
  return child;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function childExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function childGone(child: ChildProcess): boolean {
  if (childExited(child)) return true;
  if (child.pid === undefined) return false;
  try {
    process.kill(child.pid, 0);
    return false;
  } catch (error) {
    // Only ESRCH proves absence. EPERM means that a process exists but is not
    // signalable by this caller, so its ownership must remain intact.
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (childExited(child)) return true;
  return Promise.race([
    once(child, "exit").then(() => true),
    delay(timeoutMs).then(() => false),
  ]);
}

async function connectHealthy(
  socketPath: string,
  requestTimeoutMs: number,
): Promise<Readonly<{
  client: NativeTerminalClient;
  ping: NativeTerminalPing;
}>> {
  const client = await NativeTerminalClient.connect(socketPath, {
    connectTimeoutMs: NATIVE_TERMINAL_HEALTH_TIMEOUT_MS,
    requestTimeoutMs,
  });
  try {
    const ping = await client.ping(NATIVE_TERMINAL_HEALTH_TIMEOUT_MS);
    if (
      ping.protocolVersion !== NATIVE_TERMINAL_PROTOCOL_VERSION
      || typeof ping.generation !== "string"
      || ping.generation.trim().length === 0
      || !Number.isSafeInteger(ping.hostPid)
      || ping.hostPid <= 0
    ) {
      throw new Error("native terminal host returned an invalid ping");
    }
    return { client, ping };
  } catch (error) {
    client.close();
    throw error;
  }
}

export class NativeTerminalHostSupervisor {
  readonly #socketPath: string;
  readonly #generationFactory: () => string;
  readonly #replayBytesPerSession: number;
  readonly #maxSessions: number;
  readonly #requestTimeoutMs: number;
  readonly #spawnHost: NativeTerminalHostSpawn;
  readonly #now: () => number;
  readonly #startupTimeoutMs: number;
  readonly #spawnTerminationGraceMs: number;
  readonly #registryPath: string | undefined;
  readonly #ownerProbe: NativeTerminalOwnerHostProbe;
  readonly #reapOrphan:
    | ((
        sessionId: string,
        pgid: number,
        signal: NativeTerminalStopSignal,
      ) => Promise<NativeTerminalReapOutcome>)
    | undefined;
  readonly #log: (line: string) => void;
  #client: NativeTerminalClient | undefined;
  #connecting: Promise<NativeTerminalClient> | undefined;
  #spawned: ChildProcess | undefined;
  #spawnError: Error | undefined;
  #spawnDiagnostic = "";
  #consecutiveSpawnFailures = 0;
  #nextSpawnAllowedAt = 0;
  #lastSpawnFailure: Error | undefined;
  #lastSpawnGeneration: string | undefined;

  constructor(options: {
    socketPath: string;
    replayBytesPerSession: number;
    maxSessions?: number;
    requestTimeoutMs?: number;
    spawnHost?: NativeTerminalHostSpawn;
    generationFactory?: () => string;
    now?: () => number;
    startupTimeoutMs?: number;
    spawnTerminationGraceMs?: number;
    /** Durable pgid store forwarded to a spawned host; defaults to the real registry path. */
    registryPath?: string;
    /** Injectable so tests never touch a real /proc; defaults to the real probe. */
    ownerProbe?: NativeTerminalOwnerHostProbe;
    /** Injectable so tests never send real signals; defaults to a throwaway
     * NativeTerminalHost's real reapOrphan (see reconcileDeadHostOrphans). */
    reapOrphan?: (
      sessionId: string,
      pgid: number,
      signal: NativeTerminalStopSignal,
    ) => Promise<NativeTerminalReapOutcome>;
    /** Diagnostic sink for the orphan-reconcile pass; defaults to prefixed stderr. */
    log?: (line: string) => void;
  }) {
    if (
      !Number.isSafeInteger(options.replayBytesPerSession)
      || options.replayBytesPerSession <= 0
      || options.replayBytesPerSession > NATIVE_TERMINAL_MAX_REPLAY_BYTES_PER_SESSION
    ) {
      throw new RangeError(
        `replayBytesPerSession must be between 1 and ${NATIVE_TERMINAL_MAX_REPLAY_BYTES_PER_SESSION}`,
      );
    }
    const maxSessions =
      options.maxSessions ?? NATIVE_TERMINAL_DEFAULT_MAX_SESSIONS;
    if (
      !Number.isSafeInteger(maxSessions) ||
      maxSessions <= 0 ||
      maxSessions > NATIVE_TERMINAL_MAX_SESSIONS
    ) {
      throw new RangeError(
        `maxSessions must be between 1 and ${NATIVE_TERMINAL_MAX_SESSIONS}`,
      );
    }
    const requestTimeoutMs =
      options.requestTimeoutMs ?? NATIVE_TERMINAL_DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new RangeError(
        "requestTimeoutMs must be a positive safe integer",
      );
    }
    const startupTimeoutMs =
      options.startupTimeoutMs ?? NATIVE_TERMINAL_STARTUP_TIMEOUT_MS;
    const spawnTerminationGraceMs =
      options.spawnTerminationGraceMs ??
      NATIVE_TERMINAL_SPAWN_TERMINATION_GRACE_MS;
    for (const [label, value] of [
      ["startupTimeoutMs", startupTimeoutMs],
      ["spawnTerminationGraceMs", spawnTerminationGraceMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive safe integer`);
      }
    }
    this.#socketPath = options.socketPath;
    this.#generationFactory = options.generationFactory ?? randomUUID;
    this.#replayBytesPerSession = options.replayBytesPerSession;
    this.#maxSessions = maxSessions;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#spawnHost = options.spawnHost ?? defaultSpawnHost;
    this.#now = options.now ?? Date.now;
    this.#startupTimeoutMs = startupTimeoutMs;
    this.#spawnTerminationGraceMs = spawnTerminationGraceMs;
    this.#registryPath = options.registryPath;
    this.#ownerProbe = options.ownerProbe ?? defaultOwnerHostProbe;
    this.#reapOrphan = options.reapOrphan;
    this.#log =
      options.log ??
      ((line) => {
        process.stderr.write(`[h2a-pty-supervisor] ${line}\n`);
      });
  }

  get spawnedPid(): number | undefined {
    this.#clearGoneSpawn();
    return this.#spawned?.pid;
  }

  async client(): Promise<NativeTerminalClient> {
    if (this.#client) {
      try {
        await this.#client.ping(NATIVE_TERMINAL_HEALTH_TIMEOUT_MS);
        return this.#client;
      } catch {
        this.#client.close();
        this.#client = undefined;
      }
    }
    this.#connecting ??= this.#connectOrStart().finally(() => {
      this.#connecting = undefined;
    });
    this.#client = await this.#connecting;
    return this.#client;
  }

  disconnect(): void {
    this.#client?.close();
    this.#client = undefined;
  }

  async #connectOrStart(): Promise<NativeTerminalClient> {
    try {
      const connected = await connectHealthy(
        this.#socketPath,
        this.#requestTimeoutMs,
      );
      return await this.#adoptHealthyConnection(connected);
    } catch {
      this.#clearGoneSpawn();
      if (!this.#spawned || this.#spawned.exitCode !== null || this.#spawned.signalCode !== null) {
        const now = this.#now();
        if (now < this.#nextSpawnAllowedAt) {
          const remaining = this.#nextSpawnAllowedAt - now;
          throw new Error(
            `native terminal host restart backoff active for ${remaining}ms after: ${this.#lastSpawnFailure?.message ?? "startup failure"}`,
          );
        }
        const generation = this.#generationFactory();
        if (generation.trim().length === 0) {
          throw new Error("native terminal host generation must not be empty");
        }
        if (generation === this.#lastSpawnGeneration) {
          throw new Error("native terminal host generation must change after a restart");
        }
        this.#lastSpawnGeneration = generation;
        // TAKEOVER point: we are about to spawn a REPLACEMENT host because
        // the previous connection attempt failed and no live owned spawn
        // exists. This is the moment a stale registry might exist — and
        // exactly the moment a lost connection must NOT be mistaken for
        // proof of death. Reconcile FIRST: reap only entries whose owning
        // host is independently PROVEN dead (see reconcileDeadHostOrphans);
        // best-effort — a reconcile failure must never block spawning the
        // replacement host.
        await this.#reconcileDeadHostOrphans();
        this.#spawnError = undefined;
        this.#spawnDiagnostic = "";
        this.#spawned = this.#spawnHost({
          socketPath: this.#socketPath,
          generation,
          replayBytesPerSession: this.#replayBytesPerSession,
          maxSessions: this.#maxSessions,
          ...(this.#registryPath !== undefined ? { registryPath: this.#registryPath } : {}),
        });
        const spawned = this.#spawned;
        spawned.stderr?.setEncoding("utf8");
        spawned.stderr?.on("data", (chunk: string | Buffer) => {
          const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
          this.#spawnDiagnostic = (
            this.#spawnDiagnostic + text
          ).slice(-NATIVE_TERMINAL_MAX_STARTUP_DIAGNOSTIC_BYTES);
        });
        spawned.once("error", (error) => {
          if (this.#spawned === spawned) this.#spawnError = error;
        });
      }
    }

    let lastError: unknown;
    const startupDeadline = Date.now() + this.#startupTimeoutMs;
    while (Date.now() < startupDeadline) {
      try {
        const connected = await connectHealthy(
          this.#socketPath,
          this.#requestTimeoutMs,
        );
        return await this.#adoptHealthyConnection(connected);
      } catch (error) {
        lastError = error;
      }
      if (this.#spawnError) {
        const error = new Error(
          `native terminal host failed to start: ${this.#spawnError.message}`,
        );
        this.#recordSpawnFailure(error);
        throw error;
      }
      if (this.#spawned?.exitCode !== null || this.#spawned.signalCode !== null) {
        const diagnostic = this.#spawnDiagnostic.trim();
        const error = new Error(
          `native terminal host exited before accepting connections (${this.#spawned?.exitCode ?? this.#spawned?.signalCode ?? "unknown"})${diagnostic ? `: ${diagnostic}` : ""}`,
        );
        this.#recordSpawnFailure(error);
        throw error;
      }
      await delay(25);
    }
    const error = new Error(
      `native terminal host did not become ready: ${String(lastError)}`,
    );
    const spawned = this.#spawned;
    if (spawned && !childExited(spawned)) {
      try {
        await this.#terminateOwnedSpawn(spawned);
      } catch (terminationError) {
        const combined = new Error(
          `${error.message}; failed to reap owned child: ${String(terminationError)}`,
        );
        this.#recordSpawnFailure(combined);
        throw combined;
      }
    }
    this.#recordSpawnFailure(error);
    throw error;
  }

  async #adoptHealthyConnection(connected: Readonly<{
    client: NativeTerminalClient;
    ping: NativeTerminalPing;
  }>): Promise<NativeTerminalClient> {
    const spawned = this.#spawned;
    if (
      spawned &&
      !childExited(spawned) &&
      spawned.pid !== connected.ping.hostPid
    ) {
      try {
        await this.#terminateOwnedSpawn(spawned);
      } catch (error) {
        connected.client.close();
        throw new Error(
          `native terminal host adoption could not reap losing owned child: ${String(error)}`,
        );
      }
    } else if (spawned && childExited(spawned) && this.#spawned === spawned) {
      this.#spawned = undefined;
    }
    this.#resetSpawnBackoff();
    return connected.client;
  }

  async #terminateOwnedSpawn(spawned: ChildProcess): Promise<void> {
    if (this.#spawned !== spawned) return;
    if (!childExited(spawned)) {
      spawned.kill("SIGTERM");
      if (
        !await waitForChildExit(spawned, this.#spawnTerminationGraceMs)
      ) {
        spawned.kill("SIGKILL");
        if (
          !await waitForChildExit(spawned, this.#spawnTerminationGraceMs)
        ) {
          // Node can observe the OS process as gone before it delivers the
          // ChildProcess "exit" event. After escalation, ESRCH is therefore
          // sufficient proof that there is no owned host left to reap.
          if (!childGone(spawned)) {
            throw new Error("owned native terminal host did not exit after SIGKILL");
          }
        }
      }
    }
    if (this.#spawned === spawned) this.#spawned = undefined;
  }

  #clearGoneSpawn(): void {
    if (this.#spawned && childGone(this.#spawned)) {
      this.#spawned = undefined;
    }
  }

  /**
   * Run one `reconcileDeadHostOrphans` pass against the shared registry
   * (see host.ts for the full contract). Best-effort: any failure here is
   * logged and swallowed — a reconcile hiccup must never prevent spawning
   * the replacement host that this takeover already needs.
   */
  async #reconcileDeadHostOrphans(): Promise<void> {
    try {
      await reconcileDeadHostOrphans({
        ...(this.#registryPath !== undefined ? { registryPath: this.#registryPath } : {}),
        ownerProbe: this.#ownerProbe,
        ...(this.#reapOrphan !== undefined ? { reap: this.#reapOrphan } : {}),
        log: this.#log,
      });
    } catch (error) {
      this.#log(
        `native-terminal orphan reconcile failed (continuing to spawn a replacement host regardless): ${String(error)}`,
      );
    }
  }

  #recordSpawnFailure(error: Error): void {
    this.#consecutiveSpawnFailures += 1;
    const delayMs = Math.min(
      NATIVE_TERMINAL_SPAWN_BACKOFF_BASE_MS *
        2 ** (this.#consecutiveSpawnFailures - 1),
      NATIVE_TERMINAL_SPAWN_BACKOFF_MAX_MS,
    );
    this.#nextSpawnAllowedAt = this.#now() + delayMs;
    this.#lastSpawnFailure = error;
  }

  #resetSpawnBackoff(): void {
    this.#consecutiveSpawnFailures = 0;
    this.#nextSpawnAllowedAt = 0;
    this.#lastSpawnFailure = undefined;
  }
}
