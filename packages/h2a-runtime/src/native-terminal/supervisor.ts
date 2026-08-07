import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { NativeTerminalClient } from "./client.js";
import {
  NATIVE_TERMINAL_DEFAULT_MAX_SESSIONS,
  NATIVE_TERMINAL_DEFAULT_REQUEST_TIMEOUT_MS,
  NATIVE_TERMINAL_HEALTH_TIMEOUT_MS,
  NATIVE_TERMINAL_MAX_REPLAY_BYTES_PER_SESSION,
  NATIVE_TERMINAL_MAX_SESSIONS,
  NATIVE_TERMINAL_PROTOCOL_VERSION,
} from "./protocol.js";

const NATIVE_TERMINAL_SPAWN_BACKOFF_BASE_MS = 250;
const NATIVE_TERMINAL_SPAWN_BACKOFF_MAX_MS = 5_000;
const NATIVE_TERMINAL_STARTUP_TIMEOUT_MS = 5_000;
const NATIVE_TERMINAL_MAX_STARTUP_DIAGNOSTIC_BYTES = 4_096;

export type NativeTerminalHostSpawn = (options: {
  socketPath: string;
  generation: string;
  replayBytesPerSession: number;
  maxSessions: number;
}) => ChildProcess;

function defaultSpawnHost(options: {
  socketPath: string;
  generation: string;
  replayBytesPerSession: number;
  maxSessions: number;
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

async function connectHealthy(
  socketPath: string,
  requestTimeoutMs: number,
): Promise<NativeTerminalClient> {
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
    return client;
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
    this.#socketPath = options.socketPath;
    this.#generationFactory = options.generationFactory ?? randomUUID;
    this.#replayBytesPerSession = options.replayBytesPerSession;
    this.#maxSessions = maxSessions;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#spawnHost = options.spawnHost ?? defaultSpawnHost;
    this.#now = options.now ?? Date.now;
  }

  get spawnedPid(): number | undefined {
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
      this.#resetSpawnBackoff();
      return connected;
    } catch {
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
        this.#spawnError = undefined;
        this.#spawnDiagnostic = "";
        this.#spawned = this.#spawnHost({
          socketPath: this.#socketPath,
          generation,
          replayBytesPerSession: this.#replayBytesPerSession,
          maxSessions: this.#maxSessions,
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
    const startupDeadline = Date.now() + NATIVE_TERMINAL_STARTUP_TIMEOUT_MS;
    while (Date.now() < startupDeadline) {
      try {
        const connected = await connectHealthy(
          this.#socketPath,
          this.#requestTimeoutMs,
        );
        this.#resetSpawnBackoff();
        return connected;
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
    this.#recordSpawnFailure(error);
    throw error;
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
