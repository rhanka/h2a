#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { NativeTerminalHost, readProcessStartTime } from "./host.js";
import { writeHostLogLine } from "./crash-safe-log.js";
import { HOST_FAULT_COUNTERS, recordHostFault } from "./fault-counters.js";
import { createHostJournalWriter, getRuntimeVersion, type HostJournalEntry } from "./journal.js";
import { nodePtySpawner } from "../pty.js";
import {
  NATIVE_TERMINAL_MAX_FRAME_BYTES,
} from "./protocol.js";
import {
  createNativeTerminalLeaseContext,
  executeNativeTerminalHostRequest,
  releaseNativeTerminalLeases,
  type NativeTerminalLeaseContext,
} from "./server.js";
import { assertNativeTerminalSocketPathWithinLimit } from "./socket-path.js";
import { NativeTerminalPublicationRefusal } from "./publication-refusal.js";
import {
  OWNER_PROTOCOL_VERSION,
  decodeOwnerFrame,
} from "./owner-protocol.js";
import { parseNativeTerminalHostArgs } from "./process.js";

/**
 * Phase B (lot B2): typed refusal for the owner/frontend split on any
 * platform without the Linux product substrate. Lot BM ports darwin; until
 * then the split fails closed here instead of reaching the abstract-socket
 * publication lock. Pinned by `supervisor.test.ts` (darwin-only case).
 */
export class OwnerFrontendDarwinRefusal extends Error {
  readonly exitCode = 3;
  constructor() {
    super(
      "native terminal owner/frontend split requires Linux socket publication (macOS substrate lands in lot BM)",
    );
    this.name = "OwnerFrontendDarwinRefusal";
  }
}

export function assertOwnerFrontendSupported(platform: string = process.platform): void {
  if (platform !== "linux") throw new OwnerFrontendDarwinRefusal();
}

const OWNER_STARTUP_TIMEOUT_MS = 10_000;
const FRONTEND_ABSENCE_FATAL_MS = 10_000;
const SHUTDOWN_CLOSE_WAIT_MS = 10_000;
const FWD_CONNECT_ATTEMPTS = 20;
const FWD_CONNECT_RETRY_MS = 250;
const FRONTEND_SPAWN_WINDOW_MS = 10_000;
const FRONTEND_SPAWN_MAX_IN_WINDOW = 5;
const DRAIN_POLL_MS = 25;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.length === 0) return "terminal operation failed";
  return message.slice(0, 1_024);
}

/** Private owner↔frontend↔keeper channel framing: newline-delimited JSON. */
function encodeFwdFrame(message: Record<string, unknown>): string {
  const frame = `${JSON.stringify(message)}\n`;
  if (Buffer.byteLength(frame) > NATIVE_TERMINAL_MAX_FRAME_BYTES) {
    throw new RangeError("forward channel frame exceeds the frame limit");
  }
  return frame;
}

type FwdConnectionRole = "frontend" | "keeper";

type FwdConnection = {
  socket: Socket;
  buffer: string;
  role: FwdConnectionRole | undefined;
  peerPid: number | undefined;
  /** Owner-side lease contexts, one per client connection of this peer. */
  contexts: Map<string, NativeTerminalLeaseContext>;
};

function forwardSocketPath(publicSocketPath: string): string {
  const path = join(dirname(publicSocketPath), `.fwd-${process.pid}.sock`);
  assertNativeTerminalSocketPathWithinLimit(path, "terminal owner forward socket path");
  return path;
}

async function bindForwardServer(fwdPath: string): Promise<Server> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(fwdPath, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") {
      server.close();
      throw error;
    }
    // Same-pid stale socket from a dead owner: reclaim once, fail if live.
    const probe = connect(fwdPath);
    const live = await new Promise<boolean>((resolve) => {
      probe.once("connect", () => resolve(true));
      probe.once("error", () => resolve(false));
    });
    probe.destroy();
    server.close();
    if (live) throw new Error(`terminal owner forward socket is live: ${fwdPath}`);
    unlinkSync(fwdPath);
    const retry = createServer();
    await new Promise<void>((resolve, reject) => {
      retry.once("error", reject);
      retry.listen(fwdPath, () => {
        retry.removeListener("error", reject);
        resolve();
      });
    });
    return retry;
  }
  return server;
}

type OwnerRuntime = {
  host: NativeTerminalHost;
  fwdPath: string;
  fwdServer: Server;
  frontendModule: string;
  socketPath: string;
  codePath: string;
};

export async function runNativeTerminalOwnerProcess(argv: ReadonlyArray<string>): Promise<void> {
  assertOwnerFrontendSupported();
  const startTime = readProcessStartTime(process.pid) ?? "unknown";
  const codePath = process.argv[1] ?? fileURLToPath(import.meta.url);
  const frontendModule = fileURLToPath(new URL("./frontend-process.js", import.meta.url));
  let options: ReturnType<typeof parseNativeTerminalHostArgs> | undefined;
  let cause: Extract<HostJournalEntry, { event: "exit" }>["cause"] = "unknown";
  const identity = () => ({ pid: process.pid, startTime, generation: options?.generation ?? "unknown" } as const);
  const journal = createHostJournalWriter();
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
    const fwdPath = forwardSocketPath(options.socketPath);
    const fwdServer = await bindForwardServer(fwdPath);
    const runtime: OwnerRuntime = {
      host,
      fwdPath,
      fwdServer,
      frontendModule,
      socketPath: options.socketPath,
      codePath,
    };

    let shutdown: Promise<void> | undefined;
    let draining = false;
    let everHadFrontend = false;
    let frontendAbsentSince: number | undefined;
    let frontendSpawnChild: ChildProcess | undefined;
    const spawnAttempts: number[] = [];
    const fwdConns = new Set<FwdConnection>();

    const frontends = (): FwdConnection[] => [...fwdConns].filter((conn) => conn.role === "frontend");
    const keepers = (): FwdConnection[] => [...fwdConns].filter((conn) => conn.role === "keeper");

    const sendFwd = (conn: FwdConnection, message: Record<string, unknown>): void => {
      try {
        conn.socket.write(encodeFwdFrame(message));
      } catch {
        try { conn.socket.destroy(); } catch { /* already gone */ }
      }
    };

    const releaseConnContexts = (conn: FwdConnection): void => {
      for (const context of conn.contexts.values()) {
        try {
          releaseNativeTerminalLeases(host, context);
        } catch {
          // Disconnect cleanup is idempotent; exit/stop already fences leases.
        }
      }
      conn.contexts.clear();
    };

    const helloFrame = (): Record<string, unknown> => ({
      kind: "hello",
      ownerProtocolVersion: OWNER_PROTOCOL_VERSION,
      generation: host.generation,
      ownerPid: process.pid,
      ownerVersion: getRuntimeVersion(),
      ownerCodePath: codePath,
      draining,
    });

    const onFwdFrame = (conn: FwdConnection, frame: Record<string, unknown>): void => {
      if (conn.role === undefined) {
        if (frame.kind !== "hello" || (frame.role !== "frontend" && frame.role !== "keeper")) {
          writeHostLogLine("terminal owner forward channel violated hello order; closing");
          try { conn.socket.destroy(); } catch { /* already gone */ }
          return;
        }
        conn.role = frame.role;
        conn.peerPid = typeof frame.frontendPid === "number"
          ? frame.frontendPid
          : typeof frame.keeperPid === "number"
            ? frame.keeperPid
            : undefined;
        if (conn.role === "frontend") {
          everHadFrontend = true;
          frontendAbsentSince = undefined;
          // Hand lifecycle to the forward channel from here on: the
          // spawn-time child handle only matters before the first hello.
          frontendSpawnChild = undefined;
          if (startupResolve !== undefined) {
            startupResolve();
            startupResolve = undefined;
          }
        }
        return;
      }
      if (conn.role === "keeper") return;
      if (frame.kind === "closed") {
        const connId = frame.connId;
        if (typeof connId === "string") {
          const context = conn.contexts.get(connId);
          if (context !== undefined) {
            conn.contexts.delete(connId);
            try {
              releaseNativeTerminalLeases(host, context);
            } catch {
              // Idempotent disconnect cleanup.
            }
          }
        }
        return;
      }
      if (frame.kind !== "request") return;
      const { connId, reqId, frame: inner } = frame;
      if (typeof connId !== "string" || typeof reqId !== "string" || typeof inner !== "string") return;
      let context = conn.contexts.get(connId);
      if (context === undefined) {
        context = createNativeTerminalLeaseContext();
        conn.contexts.set(connId, context);
      }
      try {
        const request = decodeOwnerFrame(inner);
        const result = executeNativeTerminalHostRequest(host, context, request);
        sendFwd(conn, { kind: "response", connId, reqId, ok: true, result });
      } catch (error) {
        sendFwd(conn, { kind: "response", connId, reqId, ok: false, message: boundedMessage(error) });
      }
    };

    const onFwdData = (conn: FwdConnection, chunk: string): void => {
      conn.buffer += chunk;
      for (;;) {
        const newline = conn.buffer.indexOf("\n");
        if (newline < 0) break;
        const line = conn.buffer.slice(0, newline);
        conn.buffer = conn.buffer.slice(newline + 1);
        if (line.length === 0) continue;
        if (Buffer.byteLength(line) > NATIVE_TERMINAL_MAX_FRAME_BYTES) {
          try { conn.socket.destroy(); } catch { /* already gone */ }
          return;
        }
        let frame: unknown;
        try {
          frame = JSON.parse(line);
        } catch {
          try { conn.socket.destroy(); } catch { /* already gone */ }
          return;
        }
        if (!isRecord(frame)) {
          try { conn.socket.destroy(); } catch { /* already gone */ }
          return;
        }
        try {
          onFwdFrame(conn, frame);
        } catch (error) {
          writeHostLogLine(`terminal owner forward frame failed: ${boundedMessage(error)}`);
        }
      }
    };

    fwdServer.on("connection", (socket: Socket) => {
      socket.setEncoding("utf8");
      socket.setNoDelay(true);
      const conn: FwdConnection = { socket, buffer: "", role: undefined, peerPid: undefined, contexts: new Map() };
      fwdConns.add(conn);
      socket.on("data", (chunk: string) => onFwdData(conn, chunk));
      socket.on("error", () => {});
      socket.on("close", () => {
        fwdConns.delete(conn);
        releaseConnContexts(conn);
        if (conn.role === "frontend" && frontends().length === 0 && frontendAbsentSince === undefined) {
          frontendAbsentSince = Date.now();
        }
        if (conn.role === "keeper" && !draining && shutdown === undefined) {
          // A keeper died while frontends may still serve: ask a live
          // frontend to seat a replacement from its own listener copy.
          // (The frontend that spawned it also reseats directly; the
          // first order to land wins, reseatKeeper is idempotent.)
          for (const frontend of frontends()) {
            sendFwd(frontend, { kind: "reseat-keeper" });
          }
        }
      });
      try {
        socket.write(encodeFwdFrame(helloFrame()));
      } catch {
        try { socket.destroy(); } catch { /* already gone */ }
      }
    });
    fwdServer.on("error", (error) => {
      writeHostLogLine(`terminal owner forward server error: ${String(error)}`);
    });

    const spawnBindFrontend = (): ChildProcess => {
      const child = spawn(process.execPath, [
        frontendModule,
        "--socket",
        runtime.socketPath,
        "--owner-socket",
        runtime.fwdPath,
      ], {
        cwd: dirname(frontendModule),
        env: process.env,
        stdio: ["ignore", "ignore", "inherit"],
      });
      child.on("error", (error) => {
        writeHostLogLine(`terminal owner failed to spawn frontend: ${String(error)}`);
      });
      return child;
    };

    const orderKeeperSpawn = (): void => {
      const keeperConns = keepers();
      if (keeperConns.length === 0 || draining || shutdown !== undefined) return;
      if (!noteSpawnAttempt()) return;
      for (const keeper of keeperConns) {
        sendFwd(keeper, { kind: "spawn-frontend" });
      }
    };

    const fallbackBindFrontend = (): void => {
      if (draining || shutdown !== undefined || frontendSpawnChild !== undefined) return;
      // No keeper left to hand a listener copy to: bind a fresh frontend
      // directly. The publication reclaim path absorbs the stale endpoint;
      // the inode changes, but sessions and leases survive untouched.
      if (!noteSpawnAttempt()) return;
      writeHostLogLine("terminal owner binding a fresh frontend (no keeper left)");
      trackSpawnedFrontend(spawnBindFrontend());
    };

    let startupResolve: (() => void) | undefined;
    const startupWait = new Promise<void>((resolve) => {
      startupResolve = resolve;
    });
    const startupTimeout = delay(OWNER_STARTUP_TIMEOUT_MS);

    const noteSpawnAttempt = (): boolean => {
      const now = Date.now();
      while (spawnAttempts.length > 0 && now - spawnAttempts[0]! > FRONTEND_SPAWN_WINDOW_MS) {
        spawnAttempts.shift();
      }
      if (spawnAttempts.length >= FRONTEND_SPAWN_MAX_IN_WINDOW) {
        writeHostLogLine(
          `frontend spawn limit reached (${FRONTEND_SPAWN_MAX_IN_WINDOW} in ${FRONTEND_SPAWN_WINDOW_MS}ms); staying frontend-less`,
        );
        return false;
      }
      spawnAttempts.push(now);
      return true;
    };

    const trackSpawnedFrontend = (child: ChildProcess): void => {
      frontendSpawnChild = child;
      child.on("exit", (code) => {
        if (frontendSpawnChild !== child) return;
        frontendSpawnChild = undefined;
        // An owner-spawned frontend died before its hello: most often a
        // publication refusal (second owner) or a lost endpoint race.
        // Propagate fail-closed instead of lingering half-born.
        cause = "startupError";
        const exitCode = code === 3 ? 3 : 1;
        void journal.flush().finally(() => process.exit(exitCode));
      });
    };

    if (noteSpawnAttempt()) {
      trackSpawnedFrontend(spawnBindFrontend());
    }

    const startupRaced = await Promise.race([
      startupWait.then(() => "ready" as const),
      startupTimeout.then(() => "timeout" as const),
    ]);
    if (startupRaced === "timeout" && startupResolve !== undefined) {
      throw new Error("terminal owner started no frontend in time");
    }

    process.stdout.write(`${JSON.stringify({
      kind: "h2a.native-terminal.ready",
      version: 1,
      generation: host.generation,
      pid: process.pid,
      socketPath: options.socketPath,
    })}\n`);

    const absenceWatch = setInterval(() => {
      if (draining || shutdown !== undefined) return;
      if (frontends().length > 0 || frontendAbsentSince === undefined) return;
      if (Date.now() - frontendAbsentSince < FRONTEND_ABSENCE_FATAL_MS) {
        // No frontend for a while: with a keeper, nudge it to spawn one
        // (same inode); without, bind one directly (fresh inode, same
        // sessions) while the spawn budget lasts.
        if (keepers().length > 0) orderKeeperSpawn();
        else fallbackBindFrontend();
        return;
      }
      writeHostLogLine("terminal owner has no frontend; stopping sessions and exiting");
      void stop("frontend-absent", true);
    }, 1_000);
    absenceWatch.unref?.();

    const broadcast = (message: Record<string, unknown>): void => {
      for (const conn of [...fwdConns]) sendFwd(conn, message);
    };

    const waitForSessionsDrained = async (): Promise<void> => {
      for (;;) {
        if (host.list().every((session) => session.status === "exited")) return;
        await delay(DRAIN_POLL_MS);
      }
    };

    const waitForFwdClose = async (sockets: Socket[], timeoutMs: number): Promise<void> => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (sockets.every((socket) => socket.destroyed)) return;
        if (Date.now() >= deadline) return;
        await delay(DRAIN_POLL_MS);
      }
    };

    const stop = (signal: string | undefined, stopSessions: boolean): void => {
      if (signal !== undefined && signal !== "frontend-absent") {
        journal.write({ event: "signal", ...identity(), signal });
      }
      if (shutdown !== undefined) return;
      cause = "signal";
      shutdown = (async () => {
        if (stopSessions) {
          // Broken endpoint class: sessions cannot be served again.
          try { host.stopAll("SIGTERM"); } catch { /* already stopping */ }
        } else {
          // Explicit stop drains: live sessions run until they end, and
          // only the empty owner exits — never a session kill to empty
          // it (D5). The endpoint stops admitting at once: frontends
          // reject new sessions while draining.
          draining = true;
          broadcast({ kind: "draining", draining: true });
          await waitForSessionsDrained();
        }
        // Withdraw service: frontends close (rolling back publication on
        // the orderly path) and exit; keepers stop once frontend-less.
        broadcast({ kind: "shutdown" });
        await waitForFwdClose([...fwdConns].map((conn) => conn.socket), SHUTDOWN_CLOSE_WAIT_MS);
        for (const conn of [...fwdConns]) {
          try { conn.socket.destroy(); } catch { /* already gone */ }
        }
        await new Promise<void>((resolve) => fwdServer.close(() => resolve()));
        try { unlinkSync(fwdPath); } catch { /* already gone */ }
      })();
      void shutdown.then(
        async () => {
          cause = "clean-stop";
          clearInterval(absenceWatch);
          journal.write({ event: "stop", ...identity(), clean: true });
          process.exitCode = 0;
          await journal.flush();
        },
        (error) => {
          clearInterval(absenceWatch);
          journal.write({ event: "stop", ...identity(), clean: false });
          if (!writeHostLogLine(`shutdown failed: ${String(error)}`)) {
            recordHostFault(HOST_FAULT_COUNTERS.processShutdownWriteFailed);
          }
          process.exitCode = 1;
        },
      );
    };
    process.once("SIGINT", () => stop("SIGINT", false));
    process.once("SIGTERM", () => stop("SIGTERM", false));
    process.once("SIGHUP", () => stop("SIGHUP", false));
  } catch (error) {
    cause = "startupError";
    journal.write({ event: "startupError", ...identity(), error: "[REDACTED]",
      stack: error instanceof Error ? error.stack : undefined, codePath });
    await journal.flush();
    throw error;
  }
}

type KeeperArgs = {
  ownerSocket: string;
  frontendModule: string;
};

function parseKeeperArgs(argv: ReadonlyArray<string>): KeeperArgs {
  let ownerSocket: string | undefined;
  let frontendModule: string | undefined;
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--keeper") continue;
    if (flag === "--owner-socket") {
      if (!value) throw new Error("--owner-socket requires a path");
      ownerSocket = value;
      index += 1;
      continue;
    }
    if (flag === "--frontend-module") {
      if (!value) throw new Error("--frontend-module requires a path");
      frontendModule = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown keeper argument: ${flag ?? "<missing>"}`);
  }
  if (ownerSocket === undefined) throw new Error("--owner-socket is required");
  if (frontendModule === undefined) throw new Error("--frontend-module is required");
  if (!isAbsolute(ownerSocket)) throw new Error("keeper owner socket path must be absolute");
  return { ownerSocket, frontendModule };
}

/**
 * Phase B (lot B2): the listener keeper. It inherits the listening FD
 * (conventionally fd 3) from the frontend that bound it and never wraps,
 * polls, reads or accepts on it — so the socket (and its backlog) survives
 * every frontend replacement with the same inode (D3), while the frontend
 * is never its sole holder (D24). It spawns replacement frontends on the
 * owner's order and dies with the owner (forward-channel close) or on
 * `stop`.
 */
export async function runNativeTerminalKeeper(argv: ReadonlyArray<string>): Promise<void> {
  assertOwnerFrontendSupported();
  const args = parseKeeperArgs(argv);
  const { fstatSync } = await import("node:fs");
  let fdStat: { isSocket(): boolean };
  try {
    fdStat = fstatSync(3);
  } catch {
    throw new Error("terminal keeper has no listening FD at fd 3");
  }
  if (!fdStat.isSocket()) throw new Error("terminal keeper fd 3 is not a socket");

  let channel: Socket | undefined;
  let buffer = "";
  let frontend: ChildProcess | undefined;
  let stopping = false;

  const exit = (code: number): void => {
    try { channel?.destroy(); } catch { /* already gone */ }
    try { frontend?.kill("SIGTERM"); } catch { /* already gone */ }
    process.exit(code);
  };

  const spawnFrontend = (): void => {
    if (stopping || frontend !== undefined) return;
    const child = spawn(process.execPath, [
      args.frontendModule,
      "--listen-fd",
      "3",
      "--owner-socket",
      args.ownerSocket,
    ], {
      cwd: dirname(args.frontendModule),
      env: process.env,
      stdio: ["ignore", "ignore", "inherit", 3],
    });
    frontend = child;
    child.on("error", (error) => {
      writeHostLogLine(`terminal keeper failed to spawn frontend: ${String(error)}`);
      frontend = undefined;
      channel?.write(encodeFwdFrame({ kind: "frontend-spawn-failed", message: boundedMessage(error) }));
    });
    child.on("exit", (code, signal) => {
      if (frontend !== child) return;
      frontend = undefined;
      if (stopping) return;
      writeHostLogLine(`terminal keeper frontend exited (${code ?? signal ?? "unknown"}); awaiting owner order`);
    });
    try {
      channel?.write(encodeFwdFrame({ kind: "frontend-spawned", pid: child.pid ?? -1 }));
    } catch {
      // The owner learns liveness from the frontend's own hello.
    }
  };

  const connectForward = async (): Promise<Socket> => {
    for (let attempt = 0; attempt < FWD_CONNECT_ATTEMPTS; attempt += 1) {
      const socket = connect(args.ownerSocket);
      const connected = await new Promise<boolean>((resolve) => {
        socket.once("connect", () => resolve(true));
        socket.once("error", () => resolve(false));
      });
      if (connected) {
        socket.setEncoding("utf8");
        socket.setNoDelay(true);
        return socket;
      }
      socket.destroy();
      await delay(FWD_CONNECT_RETRY_MS);
    }
    throw new Error("terminal keeper could not reach its owner");
  };

  channel = await connectForward();
  channel.on("error", () => {});
  channel.on("close", () => {
    if (!stopping) exit(1);
  });
  channel.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.length === 0) continue;
      let frame: unknown;
      try {
        frame = JSON.parse(line);
      } catch {
        exit(1);
        return;
      }
      if (!isRecord(frame)) {
        exit(1);
        return;
      }
      if (frame.kind === "hello") continue;
      if (frame.kind === "stop") {
        stopping = true;
        exit(0);
        return;
      }
      if (frame.kind === "spawn-frontend") {
        spawnFrontend();
      }
    }
  });
  try {
    channel.write(encodeFwdFrame({ kind: "hello", role: "keeper", keeperPid: process.pid }));
  } catch {
    exit(1);
  }
  process.once("SIGTERM", () => {
    stopping = true;
    exit(0);
  });
  process.once("SIGINT", () => {
    stopping = true;
    exit(0);
  });
  process.on("disconnect", () => exit(1));
  await new Promise<void>(() => {});
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
  const main = process.argv.includes("--keeper") ? runNativeTerminalKeeper(process.argv) : runNativeTerminalOwnerProcess(process.argv);
  main.catch((error: unknown) => {
    const refusal = error instanceof NativeTerminalPublicationRefusal || error instanceof OwnerFrontendDarwinRefusal
      ? error
      : undefined;
    const label = refusal instanceof NativeTerminalPublicationRefusal ? refusal.code : refusal?.name;
    if (!writeHostLogLine(`fatal${label !== undefined ? ` [${label}]` : ""}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)) {
      recordHostFault(HOST_FAULT_COUNTERS.processFatalWriteFailed);
    }
    process.exitCode = refusal !== undefined ? refusal.exitCode : 1;
  });
}

