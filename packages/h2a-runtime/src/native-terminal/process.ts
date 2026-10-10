#!/usr/bin/env node
import { randomUUID } from "node:crypto";

import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { NativeTerminalHost, readProcessStartTime } from "./host.js";
import { createHostJournalWriter, getRuntimeVersion, type HostJournalEntry } from "./journal.js";
import { nodePtySpawner } from "../pty.js";
import {
  NATIVE_TERMINAL_DEFAULT_MAX_SESSIONS,
  NATIVE_TERMINAL_MAX_REPLAY_BYTES_PER_SESSION,
  NATIVE_TERMINAL_MAX_SESSIONS,
} from "./protocol.js";
import { startNativeTerminalHostServer } from "./server.js";

type ProcessOptions = {
  socketPath: string;
  generation: string;
  replayBytesPerSession: number;
  maxSessions: number;
  /** Durable pgid store; defaults to the real registry path when omitted. */
  registryPath?: string;
};

const GRACEFUL_DRAIN_MS = 500;
const FORCED_DRAIN_MS = 500;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForTerminalDrain(host: NativeTerminalHost, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (host.list().some((session) => session.status !== "exited")) {
    if (Date.now() >= deadline) return false;
    await delay(25);
  }
  return true;
}

function parsePositiveInteger(raw: string | undefined, label: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  if (value > NATIVE_TERMINAL_MAX_REPLAY_BYTES_PER_SESSION) {
    throw new Error(`${label} must not exceed ${NATIVE_TERMINAL_MAX_REPLAY_BYTES_PER_SESSION}`);
  }
  return value;
}

function parseMaxSessions(raw: string | undefined): number {
  const value = Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > NATIVE_TERMINAL_MAX_SESSIONS
  ) {
    throw new Error(
      `--max-sessions must be between 1 and ${NATIVE_TERMINAL_MAX_SESSIONS}`,
    );
  }
  return value;
}

export function parseNativeTerminalHostArgs(argv: ReadonlyArray<string>): ProcessOptions {
  let socketPath: string | undefined;
  let generation: string = randomUUID();
  let replayBytesPerSession = 4 * 1024 * 1024;
  let maxSessions = NATIVE_TERMINAL_DEFAULT_MAX_SESSIONS;
  let registryPath: string | undefined;
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--socket":
        if (!value) throw new Error("--socket requires a path");
        socketPath = value;
        index += 1;
        break;
      case "--generation":
        if (!value) throw new Error("--generation requires a value");
        generation = value;
        index += 1;
        break;
      case "--replay-bytes":
        replayBytesPerSession = parsePositiveInteger(value, "--replay-bytes");
        index += 1;
        break;
      case "--max-sessions":
        maxSessions = parseMaxSessions(value);
        index += 1;
        break;
      case "--registry-path":
        if (!value) throw new Error("--registry-path requires a path");
        registryPath = value;
        index += 1;
        break;
      default:
        throw new Error(`unknown native terminal host argument: ${flag ?? "<missing>"}`);
    }
  }
  if (!socketPath) throw new Error("--socket is required");
  return {
    socketPath,
    generation,
    replayBytesPerSession,
    maxSessions,
    ...(registryPath !== undefined ? { registryPath } : {}),
  };
}

export async function runNativeTerminalHostProcess(argv: ReadonlyArray<string>): Promise<void> {
  const startTime = readProcessStartTime(process.pid) ?? "unknown";
  const codePath = process.argv[1] ?? fileURLToPath(import.meta.url);
  let options: ProcessOptions | undefined;
  let cause: Extract<HostJournalEntry, { event: "exit" }>["cause"] = "unknown";
  const identity = () => ({ pid: process.pid, startTime, generation: options?.generation ?? "unknown" } as const);
  const journal = createHostJournalWriter();
  // Exit callbacks only enqueue observations. The independent writer has its
  // own bounded drain; the monitor preserves Node's fatal behavior.
  process.on("exit", (exitCode) => {
    journal.write({ event: "exit", ...identity(), exitCode, cause });
  });
  process.on("uncaughtExceptionMonitor", (error: Error, origin) => {
    cause = origin === "unhandledRejection" ? "unhandledRejection" : "uncaughtException";
    journal.write({ event: cause, ...identity(), error: error.message, stack: error.stack, codePath });
  });

  try {
    options = parseNativeTerminalHostArgs(argv);
    journal.write({
      event: "start",
      ...identity(),
      version: getRuntimeVersion(),
      codePath,
      socket: options.socketPath,
    });

    const host = new NativeTerminalHost({
      generation: options.generation,
      replayBytesPerSession: options.replayBytesPerSession,
      maxSessions: options.maxSessions,
      spawner: nodePtySpawner,
      socketPath: options.socketPath,
      ...(options.registryPath !== undefined ? { registryPath: options.registryPath } : {}),
    });
    const initialization = new AbortController();
    const serverReady = startNativeTerminalHostServer({
      socketPath: options.socketPath, host, signal: initialization.signal,
    });

    let shutdown: Promise<void> | undefined;
    const stop = (signal: string): void => {
      journal.write({
        event: "signal",
        ...identity(),
        signal,
      });
      if (shutdown !== undefined) return;
      cause = "signal";
      shutdown = (async () => {
        initialization.abort();
        let gracefulError: unknown;
        // Begin terminal shutdown independently of publication/rollback.
        try { host.stopAll("SIGTERM"); }
        catch (error) { gracefulError = error; }
        const closeServer = serverReady.then(server => server.close()).catch((error: unknown) => {
          if (error !== initialization.signal.reason) gracefulError = error;
        });
        try {
          if (!await waitForTerminalDrain(host, GRACEFUL_DRAIN_MS)) {
            try {
              await host.forceStopAll("SIGKILL");
            } catch {
              // The post-kill drain check below is authoritative: a raced exit may
              // make node-pty report an error even though no terminal remains.
            }
            if (!await waitForTerminalDrain(host, FORCED_DRAIN_MS)) {
              throw new Error("terminal sessions did not exit after forced shutdown");
            }
          }
        } finally { await closeServer; }
        if (gracefulError !== undefined) throw gracefulError;
      })();
      void shutdown.then(
        async () => {
          cause = "clean-stop";
          journal.write({
            event: "stop",
            ...identity(),
            clean: true,
          });
          process.exitCode = 0;
          await journal.flush();
        },
        (error) => {
          journal.write({
            event: "stop",
            ...identity(),
            clean: false,
          });
          process.stderr.write(`[h2a-pty-host] shutdown failed after ${signal}: ${String(error)}\n`);
          process.exitCode = 1;
        },
      );
    };
    process.once("SIGINT", () => stop("SIGINT"));
    process.once("SIGTERM", () => stop("SIGTERM"));
    process.once("SIGHUP", () => stop("SIGHUP"));
    // The socket can be visible before its owner record has finished. Install
    // termination handlers before that asynchronous publication window.
    const server = await serverReady.catch((error: unknown) => {
      if (shutdown !== undefined && error === initialization.signal.reason) return undefined;
      throw error;
    });
    if (shutdown !== undefined) {
      await shutdown;
      return;
    }
    process.stdout.write(`${JSON.stringify({
      kind: "h2a.native-terminal.ready",
      version: 1,
      generation: host.generation,
      pid: process.pid,
      socketPath: server!.socketPath,
    })}\n`);
  } catch (error) {
    cause = "startupError";
    journal.write({ event: "startupError", ...identity(), error: "[REDACTED]",
      stack: error instanceof Error ? error.stack : undefined, codePath });
    await journal.flush();
    throw error;
  }
}

function isEntryPoint(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(argv1)).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  runNativeTerminalHostProcess(process.argv).catch((error: unknown) => {
    process.stderr.write(`[h2a-pty-host] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
