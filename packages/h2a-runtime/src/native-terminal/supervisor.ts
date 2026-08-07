import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { NativeTerminalClient } from "./client.js";
import {
  NATIVE_TERMINAL_MAX_REPLAY_BYTES_PER_SESSION,
  NATIVE_TERMINAL_PROTOCOL_VERSION,
} from "./protocol.js";

export type NativeTerminalHostSpawn = (options: {
  socketPath: string;
  generation: string;
  replayBytesPerSession: number;
}) => ChildProcess;

function defaultSpawnHost(options: {
  socketPath: string;
  generation: string;
  replayBytesPerSession: number;
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
  ], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  return child;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function connectHealthy(socketPath: string): Promise<NativeTerminalClient> {
  const client = await NativeTerminalClient.connect(socketPath);
  let timeout: NodeJS.Timeout | undefined;
  try {
    const ping = await Promise.race([
      client.ping(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("native terminal host ping timed out")),
          1_000,
        );
        timeout.unref();
      }),
    ]);
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
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export class NativeTerminalHostSupervisor {
  readonly #socketPath: string;
  readonly #generationFactory: () => string;
  readonly #replayBytesPerSession: number;
  readonly #spawnHost: NativeTerminalHostSpawn;
  #client: NativeTerminalClient | undefined;
  #connecting: Promise<NativeTerminalClient> | undefined;
  #spawned: ChildProcess | undefined;
  #spawnError: Error | undefined;
  #lastSpawnGeneration: string | undefined;

  constructor(options: {
    socketPath: string;
    replayBytesPerSession: number;
    spawnHost?: NativeTerminalHostSpawn;
    generationFactory?: () => string;
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
    this.#socketPath = options.socketPath;
    this.#generationFactory = options.generationFactory ?? randomUUID;
    this.#replayBytesPerSession = options.replayBytesPerSession;
    this.#spawnHost = options.spawnHost ?? defaultSpawnHost;
  }

  get spawnedPid(): number | undefined {
    return this.#spawned?.pid;
  }

  async client(): Promise<NativeTerminalClient> {
    if (this.#client) {
      try {
        await this.#client.ping();
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
      return await connectHealthy(this.#socketPath);
    } catch {
      if (!this.#spawned || this.#spawned.exitCode !== null || this.#spawned.signalCode !== null) {
        const generation = this.#generationFactory();
        if (generation.trim().length === 0) {
          throw new Error("native terminal host generation must not be empty");
        }
        if (generation === this.#lastSpawnGeneration) {
          throw new Error("native terminal host generation must change after a restart");
        }
        this.#lastSpawnGeneration = generation;
        this.#spawnError = undefined;
        this.#spawned = this.#spawnHost({
          socketPath: this.#socketPath,
          generation,
          replayBytesPerSession: this.#replayBytesPerSession,
        });
        const spawned = this.#spawned;
        spawned.once("error", (error) => {
          if (this.#spawned === spawned) this.#spawnError = error;
        });
      }
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        return await connectHealthy(this.#socketPath);
      } catch (error) {
        lastError = error;
      }
      if (this.#spawnError) {
        throw new Error(`native terminal host failed to start: ${this.#spawnError.message}`);
      }
      if (this.#spawned?.exitCode !== null || this.#spawned.signalCode !== null) {
        throw new Error(`native terminal host exited before accepting connections (${this.#spawned?.exitCode ?? this.#spawned?.signalCode ?? "unknown"})`);
      }
      await delay(25);
    }
    throw new Error(`native terminal host did not become ready: ${String(lastError)}`);
  }
}
