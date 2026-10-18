#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { connect, createServer, type Server, type Socket } from "node:net";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { writeHostLogLine } from "./crash-safe-log.js";
import {
  NATIVE_TERMINAL_MAX_FRAME_BYTES,
  NATIVE_TERMINAL_PROTOCOL_VERSION,
  type NativeTerminalRequest,
} from "./protocol.js";
import {
  nativeTerminalListenFd,
  publishNativeTerminalListener,
  serveNativeTerminalConnections,
  type NativeTerminalConnectionEvents,
  type NativeTerminalConnectionServing,
  type NativeTerminalListenerFailure,
  type NativeTerminalPublishedListener,
} from "./server.js";
import {
  OWNER_PROTOCOL_VERSION,
  encodeOwnerFrame,
} from "./owner-protocol.js";
import { getRuntimeVersion } from "./journal.js";
import { assertOwnerFrontendSupported, OwnerFrontendDarwinRefusal } from "./owner-process.js";
import { NativeTerminalPublicationRefusal } from "./publication-refusal.js";

const FWD_CONNECT_ATTEMPTS = 20;
const FWD_CONNECT_RETRY_MS = 250;
const KEEPER_SPAWN_ATTEMPTS = 3;
const KEEPER_SPAWN_RETRY_MS = 250;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length === 0 ? "unknown error" : message.slice(0, 1_024);
}

type FrontendArgs = {
  socketPath: string | undefined;
  ownerSocket: string;
  listenFd: number | undefined;
};

function parseFrontendArgs(argv: ReadonlyArray<string>): FrontendArgs {
  let socketPath: string | undefined;
  let ownerSocket: string | undefined;
  let listenFd: number | undefined;
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--socket") {
      if (!value) throw new Error("--socket requires a path");
      socketPath = value;
      index += 1;
      continue;
    }
    if (flag === "--owner-socket") {
      if (!value) throw new Error("--owner-socket requires a path");
      ownerSocket = value;
      index += 1;
      continue;
    }
    if (flag === "--listen-fd") {
      if (!value) throw new Error("--listen-fd requires a descriptor number");
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("--listen-fd must be a file descriptor number");
      listenFd = parsed;
      index += 1;
      continue;
    }
    throw new Error(`unknown frontend argument: ${flag ?? "<missing>"}`);
  }
  if (ownerSocket === undefined) throw new Error("--owner-socket is required");
  if (!isAbsolute(ownerSocket)) throw new Error("frontend owner socket path must be absolute");
  if (socketPath === undefined && listenFd === undefined) {
    throw new Error("frontend needs --socket (bind) or --listen-fd (adopt)");
  }
  if (socketPath !== undefined && listenFd !== undefined) {
    throw new Error("frontend takes either --socket or --listen-fd, never both");
  }
  return { socketPath, ownerSocket, listenFd };
}

type OwnerHello = {
  ownerProtocolVersion: number;
  generation: string;
  ownerPid: number;
  ownerVersion: string;
  ownerCodePath: string;
  draining: boolean;
};

type PendingForward = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

export async function runNativeTerminalFrontend(argv: ReadonlyArray<string>): Promise<void> {
  assertOwnerFrontendSupported();
  const args = parseFrontendArgs(argv);
  const frontendVersion = getRuntimeVersion();
  const frontendCodePath = process.argv[1] ?? fileURLToPath(import.meta.url);
  const keeperModule = fileURLToPath(new URL("./owner-process.js", import.meta.url));

  let serving: NativeTerminalConnectionServing | undefined;
  let published: NativeTerminalPublishedListener | undefined;
  let adoptedServer: Server | undefined;
  let shuttingDown = false;
  let draining = false;
  let hello: OwnerHello | undefined;
  let channel: Socket | undefined;
  let channelBuffer = "";
  let keeper: ChildProcess | undefined;
  const pending = new Map<string, PendingForward>();

  const fail = (message: string, exitCode: number): never => {
    writeHostLogLine(`terminal frontend fatal: ${message}`);
    process.exit(exitCode);
  };

  const closeServing = async (rollback: boolean): Promise<void> => {
    shuttingDown = true;
    for (const entry of pending.values()) {
      entry.reject(new Error("terminal frontend is stopping"));
    }
    pending.clear();
    if (published !== undefined) {
      if (rollback) {
        try {
          await published.close();
        } catch {
          // Best effort: the endpoint may already be gone.
        }
      } else {
        try {
          published.stopServing();
        } catch {
          // Best effort.
        }
      }
    } else {
      try { serving?.close(); } catch { /* already gone */ }
      if (adoptedServer !== undefined) {
        await new Promise<void>((resolve) => adoptedServer!.close(() => resolve()));
      }
    }
  };

  // The owner going away ends the frontend: without its owner a frontend
  // serves nothing and must never linger.
  const onOwnerGone = (why: string): void => {
    if (shuttingDown) return;
    writeHostLogLine(`terminal owner is gone (${why}); frontend exiting`);
    process.exit(1);
  };

  const forward = (connId: string, request: NativeTerminalRequest): Promise<unknown> => {
    if (channel === undefined || channel.destroyed) {
      return Promise.reject(new Error("terminal owner is gone"));
    }
    const reqId = randomUUID();
    const frame = encodeOwnerFrame({
      version: OWNER_PROTOCOL_VERSION,
      id: reqId,
      operation: request.operation,
      ...(request.params !== undefined ? { params: request.params } : {}),
    });
    return new Promise((resolve, reject) => {
      pending.set(reqId, { resolve, reject });
      try {
        channel!.write(`${JSON.stringify({ kind: "request", connId, reqId, frame })}\n`);
      } catch (error) {
        pending.delete(reqId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const onListenerFailure = (failure: NativeTerminalListenerFailure): void => {
    writeHostLogLine(`terminal frontend listener failure: ${failure.kind}`);
    const exitCode = failure.kind === "unknown" ? 3 : 0;
    void closeServing(true).finally(() => process.exit(exitCode));
  };

  // Paused until the owner's hello arrives: queued connections wait in
  // the backlog instead of failing against a channel-less frontend.
  const serveEvents: NativeTerminalConnectionEvents = {
    execute: async (connection, request) => {
        if (draining && request.operation === "create") {
          throw new Error("terminal owner is draining: not accepting new sessions");
        }
        const result = await forward(connection.id, request);
        if (request.operation !== "ping" || hello === undefined) return result;
        const base = (result ?? {}) as Record<string, unknown>;
        return {
          ...base,
          hostPid: hello.ownerPid,
          protocolVersion: NATIVE_TERMINAL_PROTOCOL_VERSION,
          owner: {
            pid: hello.ownerPid,
            version: hello.ownerVersion,
            codePath: hello.ownerCodePath,
          },
          frontend: {
            pid: process.pid,
            version: frontendVersion,
            codePath: frontendCodePath,
          },
        };
      },
    closed: (connection) => {
      try {
        channel?.write(`${JSON.stringify({ kind: "closed", connId: connection.id })}\n`);
      } catch {
        // The owner is gone; onOwnerGone handles the exit.
      }
    },
  };

  const failKeeperless = (): never => {
    // Fail closed (D24): a frontend that cannot seat its keeper must not
    // serve as the listener's sole holder.
    writeHostLogLine("terminal frontend could not seat its listener keeper");
    process.exit(3);
  };

  const reseatKeeper = (listenFd: number, remaining: number): void => {
    if (shuttingDown || keeper !== undefined) return;
    let child: ChildProcess;
    try {
      child = spawn(process.execPath, [
        keeperModule,
        "--keeper",
        "--owner-socket",
        args.ownerSocket,
        "--frontend-module",
        fileURLToPath(import.meta.url),
      ], {
        cwd: dirname(keeperModule),
        env: process.env,
        stdio: ["ignore", "ignore", "inherit", listenFd],
      });
    } catch (error) {
      if (shuttingDown) return;
      writeHostLogLine(`terminal frontend failed to spawn keeper: ${boundedError(error)}`);
      if (remaining <= 0) failKeeperless();
      setTimeout(() => reseatKeeper(listenFd, remaining - 1), KEEPER_SPAWN_RETRY_MS).unref?.();
      return;
    }
    keeper = child;
    child.on("error", (error) => {
      writeHostLogLine(`terminal frontend keeper spawn error: ${boundedError(error)}`);
    });
    child.on("exit", () => {
      if (keeper !== child || shuttingDown) return;
      keeper = undefined;
      // Our keeper died first: seat a replacement so this frontend is
      // never the listener's sole holder (D24). Giving up exits
      // fail-closed through the same path.
      if (remaining <= 0) failKeeperless();
      else setTimeout(() => reseatKeeper(listenFd, remaining - 1), KEEPER_SPAWN_RETRY_MS).unref?.();
    });
  };

  const ensureKeeper = async (listenFd: number): Promise<void> => {
    reseatKeeper(listenFd, KEEPER_SPAWN_ATTEMPTS);
    const deadline = Date.now() + KEEPER_SPAWN_ATTEMPTS * KEEPER_SPAWN_RETRY_MS + 1_000;
    for (;;) {
      if (keeper !== undefined) return;
      if (Date.now() > deadline) failKeeperless();
      await delay(50);
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
    fail("terminal frontend could not reach its owner", 1);
    throw new Error("unreachable");
  };

  if (args.socketPath !== undefined) {
    published = await publishNativeTerminalListener({
      socketPath: args.socketPath,
      onListenerFailure,
      serve: serveEvents,
    });
    // The keeper holds a raw copy of the listener from birth: same inode
    // across every later frontend replacement (D3), never the frontend
    // alone (D24).
    await ensureKeeper(nativeTerminalListenFd(published.server));
  } else {
    const server = createServer();
    adoptedServer = server;
    serving = serveNativeTerminalConnections(server, serveEvents, { startPaused: true });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen({ fd: args.listenFd! }, () => {
        server.removeListener("error", reject);
        resolve();
      });
    }).catch((error: unknown) => {
      fail(`terminal frontend could not adopt its listener: ${error instanceof Error ? error.message : String(error)}`, 3);
    });
    server.on("error", (error) => {
      // The keeper-held listener stays alive; only this generation ends.
      // Sessions survive in the owner; the keeper seats a replacement.
      writeHostLogLine(`terminal frontend adopted-listener error: ${String(error)}; exiting`);
      process.exit(1);
    });
  }

  channel = await connectForward();
  channel.on("error", () => {});
  channel.on("close", () => onOwnerGone("forward channel closed"));
  channel.on("data", (chunk: string) => {
    channelBuffer += chunk;
    for (;;) {
      const newline = channelBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = channelBuffer.slice(0, newline);
      channelBuffer = channelBuffer.slice(newline + 1);
      if (line.length === 0) continue;
      if (Buffer.byteLength(line) > NATIVE_TERMINAL_MAX_FRAME_BYTES) {
        onOwnerGone("oversize frame");
        return;
      }
      let frame: unknown;
      try {
        frame = JSON.parse(line);
      } catch {
        onOwnerGone("invalid frame");
        return;
      }
      if (!isRecord(frame)) {
        onOwnerGone("invalid frame");
        return;
      }
      if (frame.kind === "hello") {
        if (
          frame.ownerProtocolVersion !== OWNER_PROTOCOL_VERSION ||
          typeof frame.generation !== "string" ||
          typeof frame.ownerPid !== "number"
        ) {
          fail("terminal frontend rejected its owner hello", 3);
        }
        hello = {
          ownerProtocolVersion: frame.ownerProtocolVersion as number,
          generation: frame.generation as string,
          ownerPid: frame.ownerPid as number,
          ownerVersion: typeof frame.ownerVersion === "string" ? frame.ownerVersion : "unknown",
          ownerCodePath: typeof frame.ownerCodePath === "string" ? frame.ownerCodePath : "unknown",
          draining: frame.draining === true,
        };
        draining = hello.draining;
        if (published !== undefined) published.resume();
        else serving?.resume();
        continue;
      }
      if (frame.kind === "response" && typeof frame.reqId === "string") {
        const entry = pending.get(frame.reqId);
        if (entry === undefined) continue;
        pending.delete(frame.reqId);
        if (frame.ok) entry.resolve(frame.result);
        else entry.reject(new Error(typeof frame.message === "string" ? frame.message : "terminal operation failed"));
        continue;
      }
      if (frame.kind === "draining") {
        draining = frame.draining === true;
        continue;
      }
      if (frame.kind === "reseat-keeper") {
        // Our keeper died without us noticing (sibling generation): seat
        // a replacement from our own listener copy.
        const fd = published !== undefined ? nativeTerminalListenFd(published.server) : args.listenFd;
        if (fd === undefined) continue;
        reseatKeeper(fd, KEEPER_SPAWN_ATTEMPTS);
        continue;
      }
      if (frame.kind === "shutdown") {
        // Drain end: withdraw the endpoint (rollback) and exit. Sessions
        // already ended in the owner; nothing is stranded.
        void closeServing(true).finally(() => process.exit(0));
        return;
      }
    }
  });
  try {
    channel.write(`${JSON.stringify({
      kind: "hello",
      role: "frontend",
      frontendPid: process.pid,
      frontendVersion,
      frontendCodePath: frontendCodePath,
    })}\n`);
  } catch {
    onOwnerGone("hello write failed");
  }

  // Keeper reseating after this point runs through the exit handler
  // installed in reseatKeeper (fail-closed when seating gives up).

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      // A bare signal is not a drain: exit now WITHOUT rolling back, so
      // the keeper-held endpoint stays published for the replacement.
      void closeServing(false).finally(() => process.exit(0));
    });
  }
  process.on("uncaughtExceptionMonitor", (error: Error) => {
    writeHostLogLine(`terminal frontend uncaught exception: ${error.stack ?? error.message}`);
  });
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
  runNativeTerminalFrontend(process.argv).catch((error: unknown) => {
    const refusal = error instanceof NativeTerminalPublicationRefusal || error instanceof OwnerFrontendDarwinRefusal
      ? error
      : undefined;
    const label = refusal instanceof NativeTerminalPublicationRefusal ? refusal.code : refusal?.name;
    if (!writeHostLogLine(`fatal${label !== undefined ? ` [${label}]` : ""}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)) {
      try {
        process.stderr.write(`terminal frontend fatal: ${String(error)}\n`);
      } catch {
        // stderr is gone; the exit code still reports the failure.
      }
    }
    process.exitCode = refusal !== undefined ? refusal.exitCode : 1;
  });
}
