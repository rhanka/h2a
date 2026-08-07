import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { dirname, isAbsolute } from "node:path";

import {
  NativeTerminalHost,
  type NativeTerminalControllerLease,
  type NativeTerminalCreateOptions,
} from "./host.js";
import {
  NATIVE_TERMINAL_MAX_FRAME_BYTES,
  NATIVE_TERMINAL_PROTOCOL_VERSION,
  isRecord,
  parseNativeTerminalRequest,
  type NativeTerminalErrorResponse,
  type NativeTerminalRequest,
  type NativeTerminalResponse,
} from "./protocol.js";

type ConnectionContext = {
  readonly socket: Socket;
  readonly leases: Map<string, NativeTerminalControllerLease>;
  buffer: string;
};

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requiredInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value as number;
}

function sessionId(params: unknown): string {
  return requiredString(requiredRecord(params, "params").id, "session id");
}

function controllerLease(value: unknown): NativeTerminalControllerLease {
  const lease = requiredRecord(value, "controller lease");
  if (lease.role !== "controller") throw new TypeError("invalid controller lease role");
  return {
    role: "controller",
    id: requiredString(lease.id, "controller lease session id"),
    generation: requiredString(lease.generation, "controller lease generation"),
    controllerId: requiredString(lease.controllerId, "controller lease id"),
    epoch: requiredInteger(lease.epoch, "controller lease epoch"),
  };
}

function sameLease(left: NativeTerminalControllerLease, right: NativeTerminalControllerLease): boolean {
  return left.id === right.id
    && left.generation === right.generation
    && left.controllerId === right.controllerId
    && left.epoch === right.epoch;
}

function ownedLease(context: ConnectionContext, params: unknown): NativeTerminalControllerLease {
  const lease = controllerLease(requiredRecord(params, "params").lease);
  const owned = context.leases.get(lease.id);
  if (!owned || !sameLease(owned, lease)) {
    throw new Error("controller lease is not owned by this connection");
  }
  return lease;
}

function createOptions(params: unknown): NativeTerminalCreateOptions {
  const options = requiredRecord(params, "create params");
  if (!Array.isArray(options.args) || !options.args.every((arg) => typeof arg === "string")) {
    throw new TypeError("terminal args must be an array of strings");
  }
  const environment = requiredRecord(options.env, "terminal env");
  if (!Object.values(environment).every((value) => typeof value === "string")) {
    throw new TypeError("terminal env values must be strings");
  }
  return {
    id: requiredString(options.id, "terminal session id"),
    command: requiredString(options.command, "terminal command"),
    args: options.args,
    cwd: requiredString(options.cwd, "terminal cwd"),
    env: environment as Record<string, string>,
    cols: requiredInteger(options.cols, "terminal cols"),
    rows: requiredInteger(options.rows, "terminal rows"),
  };
}

function releaseConnectionLeases(host: NativeTerminalHost, context: ConnectionContext): void {
  for (const lease of context.leases.values()) {
    try {
      host.releaseController(lease);
    } catch {
      // Exit/stop already fences the lease. Disconnect cleanup is idempotent.
    }
  }
  context.leases.clear();
}

function dispatch(host: NativeTerminalHost, context: ConnectionContext, request: NativeTerminalRequest): unknown {
  const params = request.params;
  switch (request.operation) {
    case "ping":
      return {
        generation: host.generation,
        hostPid: process.pid,
        protocolVersion: NATIVE_TERMINAL_PROTOCOL_VERSION,
      };
    case "create":
      return host.create(createOptions(params));
    case "list":
      return host.list();
    case "state":
      return host.state(sessionId(params));
    case "read-output": {
      const record = requiredRecord(params, "params");
      const afterSeq = record.afterSeq;
      if (!Number.isSafeInteger(afterSeq) || (afterSeq as number) < 0) {
        throw new TypeError("afterSeq must be a non-negative safe integer");
      }
      return host.readOutput(requiredString(record.id, "session id"), afterSeq as number);
    }
    case "attach-observer":
      return host.attachObserver(sessionId(params));
    case "acquire-controller": {
      const record = requiredRecord(params, "params");
      const lease = host.acquireController(
        requiredString(record.id, "session id"),
        requiredString(record.controllerId, "controller id"),
      );
      context.leases.set(lease.id, lease);
      return lease;
    }
    case "release-controller": {
      const lease = ownedLease(context, params);
      const result = host.releaseController(lease);
      context.leases.delete(lease.id);
      return result;
    }
    case "write": {
      const record = requiredRecord(params, "params");
      const lease = ownedLease(context, record);
      host.write(lease, requiredString(record.data, "terminal input"));
      return null;
    }
    case "resize": {
      const record = requiredRecord(params, "params");
      const lease = ownedLease(context, record);
      host.resize(
        lease,
        requiredInteger(record.cols, "terminal cols"),
        requiredInteger(record.rows, "terminal rows"),
      );
      return null;
    }
    case "stop": {
      const record = requiredRecord(params, "params");
      const id = requiredString(record.id, "session id");
      if (record.signal !== undefined && typeof record.signal !== "string") {
        throw new TypeError("terminal stop signal must be a string");
      }
      return host.stop(id, record.signal as string | undefined);
    }
  }
}

function responseFrame(response: NativeTerminalResponse): string {
  const frame = `${JSON.stringify(response)}\n`;
  if (Buffer.byteLength(frame) > NATIVE_TERMINAL_MAX_FRAME_BYTES) {
    throw new RangeError("terminal response exceeds the frame limit");
  }
  return frame;
}

function writeError(context: ConnectionContext, id: string, code: NativeTerminalErrorResponse["error"]["code"], error: unknown): void {
  const response: NativeTerminalErrorResponse = {
    version: NATIVE_TERMINAL_PROTOCOL_VERSION,
    id,
    ok: false,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error),
    },
  };
  context.socket.write(responseFrame(response));
}

function consumeFrames(host: NativeTerminalHost, context: ConnectionContext, chunk: string): void {
  context.buffer += chunk;
  for (;;) {
    const newline = context.buffer.indexOf("\n");
    if (newline < 0) break;
    const line = context.buffer.slice(0, newline);
    context.buffer = context.buffer.slice(newline + 1);
    if (line.length === 0) continue;
    if (Buffer.byteLength(line) > NATIVE_TERMINAL_MAX_FRAME_BYTES) {
      writeError(context, "invalid", "invalid-request", new Error("terminal request exceeds the frame limit"));
      context.socket.destroy();
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      writeError(context, "invalid", "invalid-request", error);
      continue;
    }
    let request: NativeTerminalRequest;
    try {
      request = parseNativeTerminalRequest(raw);
    } catch (error) {
      const id = isRecord(raw) && typeof raw.id === "string" ? raw.id : "invalid";
      writeError(context, id, "invalid-request", error);
      continue;
    }
    try {
      const response: NativeTerminalResponse = {
        version: NATIVE_TERMINAL_PROTOCOL_VERSION,
        id: request.id,
        ok: true,
        result: dispatch(host, context, request),
      };
      context.socket.write(responseFrame(response));
    } catch (error) {
      writeError(context, request.id, "operation-failed", error);
    }
  }
  if (Buffer.byteLength(context.buffer) > NATIVE_TERMINAL_MAX_FRAME_BYTES) {
    writeError(context, "invalid", "invalid-request", new Error("terminal request exceeds the frame limit"));
    context.socket.destroy();
  }
}

async function socketAcceptsConnections(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function removeStaleSocket(socketPath: string): Promise<void> {
  try {
    const info = await lstat(socketPath);
    if (!info.isSocket()) throw new Error(`terminal host path exists and is not a socket: ${socketPath}`);
    if (await socketAcceptsConnections(socketPath)) {
      throw new Error(`terminal host socket is already active: ${socketPath}`);
    }
    await unlink(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function ensurePrivateSocketDirectory(socketPath: string): Promise<void> {
  const directory = dirname(socketPath);
  try {
    const info = await lstat(directory);
    if (!info.isDirectory()) throw new Error(`terminal host socket parent is not a directory: ${directory}`);
    if ((info.mode & 0o077) !== 0) {
      throw new Error(`terminal host socket parent must not be accessible by group or others: ${directory}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
  }
}

export type NativeTerminalHostServer = Readonly<{
  socketPath: string;
  close(options?: { stopSessions?: boolean; signal?: string }): Promise<void>;
}>;

export async function startNativeTerminalHostServer(options: {
  socketPath: string;
  host: NativeTerminalHost;
}): Promise<NativeTerminalHostServer> {
  if (!isAbsolute(options.socketPath)) throw new Error("terminal host socket path must be absolute");
  await ensurePrivateSocketDirectory(options.socketPath);
  await removeStaleSocket(options.socketPath);

  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    const context: ConnectionContext = { socket, leases: new Map(), buffer: "" };
    sockets.add(socket);
    socket.setEncoding("utf8");
    socket.setNoDelay(true);
    socket.on("data", (chunk: string) => consumeFrames(options.host, context, chunk));
    socket.on("close", () => {
      releaseConnectionLeases(options.host, context);
      sockets.delete(socket);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socketPath, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  await chmod(options.socketPath, 0o600);
  const ownedSocket = await lstat(options.socketPath);
  let closing: Promise<void> | undefined;

  return Object.freeze({
    socketPath: options.socketPath,
    close(closeOptions = {}) {
      closing ??= (async () => {
        let stopError: unknown;
        if (closeOptions.stopSessions) {
          try {
            options.host.stopAll(closeOptions.signal ?? "SIGTERM");
          } catch (error) {
            stopError = error;
          }
        }
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
        try {
          const current = await lstat(options.socketPath);
          if (current.dev === ownedSocket.dev && current.ino === ownedSocket.ino) {
            await unlink(options.socketPath);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (stopError !== undefined) throw stopError;
      })();
      return closing;
    },
  });
}
