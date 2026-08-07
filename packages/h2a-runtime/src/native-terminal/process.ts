#!/usr/bin/env node
import { randomUUID } from "node:crypto";

import { NativeTerminalHost } from "./host.js";
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
      default:
        throw new Error(`unknown native terminal host argument: ${flag ?? "<missing>"}`);
    }
  }
  if (!socketPath) throw new Error("--socket is required");
  return { socketPath, generation, replayBytesPerSession, maxSessions };
}

export async function runNativeTerminalHostProcess(argv: ReadonlyArray<string>): Promise<void> {
  const options = parseNativeTerminalHostArgs(argv);
  const host = new NativeTerminalHost({
    generation: options.generation,
    replayBytesPerSession: options.replayBytesPerSession,
    maxSessions: options.maxSessions,
    spawner: nodePtySpawner,
  });
  const server = await startNativeTerminalHostServer({ socketPath: options.socketPath, host });
  process.stdout.write(`${JSON.stringify({
    kind: "h2a.native-terminal.ready",
    version: 1,
    generation: host.generation,
    pid: process.pid,
    socketPath: server.socketPath,
  })}\n`);

  let shutdown: Promise<void> | undefined;
  const stop = (signal: string): void => {
    shutdown ??= (async () => {
      let gracefulError: unknown;
      try {
        await server.close({ stopSessions: true, signal: "SIGTERM" });
      } catch (error) {
        gracefulError = error;
      }
      if (!await waitForTerminalDrain(host, GRACEFUL_DRAIN_MS)) {
        try {
          host.forceStopAll("SIGKILL");
        } catch {
          // The post-kill drain check below is authoritative: a raced exit may
          // make node-pty report an error even though no terminal remains.
        }
        if (!await waitForTerminalDrain(host, FORCED_DRAIN_MS)) {
          throw new Error("terminal sessions did not exit after forced shutdown");
        }
      }
      if (gracefulError !== undefined) throw gracefulError;
    })();
    void shutdown.then(
      () => { process.exitCode = 0; },
      (error) => {
        process.stderr.write(`[h2a-pty-host] shutdown failed after ${signal}: ${String(error)}\n`);
        process.exitCode = 1;
      },
    );
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGHUP", () => stop("SIGHUP"));
}

function isEntryPoint(): boolean {
  const argv1 = process.argv[1];
  return argv1 !== undefined && import.meta.url === new URL(`file://${argv1}`).href;
}

if (isEntryPoint()) {
  runNativeTerminalHostProcess(process.argv).catch((error: unknown) => {
    process.stderr.write(`[h2a-pty-host] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
