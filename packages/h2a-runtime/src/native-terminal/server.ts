import { createHash, randomUUID } from "node:crypto";
import { chmod, link, lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { basename, dirname, isAbsolute, join } from "node:path";

import {
  NativeTerminalHost,
  type NativeTerminalControllerActivity,
  type NativeTerminalControllerLease,
  type NativeTerminalCreateOptions,
} from "./host.js";
import {
  NATIVE_TERMINAL_MAX_FRAME_BYTES,
  NATIVE_TERMINAL_MAX_CONNECTIONS,
  NATIVE_TERMINAL_MAX_ERROR_MESSAGE_CHARS,
  NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS,
  NATIVE_TERMINAL_MAX_PENDING_RESPONSE_BYTES_PER_CONNECTION,
  NATIVE_TERMINAL_MAX_PENDING_RESPONSE_BYTES_TOTAL,
  NATIVE_TERMINAL_MAX_PENDING_RESPONSES_PER_CONNECTION,
  NATIVE_TERMINAL_PROTOCOL_VERSION,
  isNativeTerminalStopSignal,
  isRecord,
  parseNativeTerminalRequest,
  type NativeTerminalErrorResponse,
  type NativeTerminalRequest,
  type NativeTerminalResponse,
} from "./protocol.js";
import {
  assertNativeTerminalSocketPathWithinLimit,
  assertPrivateNativeTerminalSocketDirectory,
  inspectPrivateNativeTerminalSocket,
  sameNativeTerminalSocket,
  type NativeTerminalSocketIdentity,
} from "./socket-path.js";

type ConnectionContext = {
  readonly socket: Socket;
  readonly leases: Map<string, NativeTerminalControllerLease>;
  readonly responseBudget: ResponseQueueBudget;
  buffer: string;
  pendingResponseBytes: number;
  pendingResponses: number;
};

type ResponseQueueBudget = {
  pendingBytes: number;
};

const SOCKET_PUBLICATION_LOCK_TIMEOUT_MS = 5_000;
const SOCKET_PUBLICATION_LOCK_RETRY_MS = 25;
const SOCKET_PUBLICATION_LOCK_ID_FILE = ".h2a-native-terminal.lock-id";

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

function requiredIdentifier(value: unknown, label: string): string {
  const identifier = requiredString(value, label);
  if (identifier.length > NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS) {
    throw new TypeError(
      `${label} must contain at most ${NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS} characters`,
    );
  }
  return identifier;
}

function requiredInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value as number;
}

function requiredNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function controllerActivity(value: unknown): NativeTerminalControllerActivity {
  // A legacy request cannot prove that its holder is automation. Preserve the
  // operation, but record it on the human/unknown side so drive fails closed.
  if (value === undefined) return "human";
  if (value === "human" || value === "automation") return value;
  throw new TypeError("terminal controller activity must be human or automation");
}

function sessionId(params: unknown): string {
  return requiredIdentifier(requiredRecord(params, "params").id, "session id");
}

function controllerLease(value: unknown): NativeTerminalControllerLease {
  const lease = requiredRecord(value, "controller lease");
  if (lease.role !== "controller") throw new TypeError("invalid controller lease role");
  return {
    role: "controller",
    id: requiredIdentifier(lease.id, "controller lease session id"),
    generation: requiredIdentifier(lease.generation, "controller lease generation"),
    incarnation: requiredIdentifier(
      lease.incarnation,
      "controller lease incarnation",
    ),
    controllerId: requiredIdentifier(lease.controllerId, "controller lease id"),
    epoch: requiredInteger(lease.epoch, "controller lease epoch"),
  };
}

function sameLease(left: NativeTerminalControllerLease, right: NativeTerminalControllerLease): boolean {
  return left.id === right.id
    && left.generation === right.generation
    && left.incarnation === right.incarnation
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
    id: requiredIdentifier(options.id, "terminal session id"),
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
      return host.readOutput(
        requiredIdentifier(record.id, "session id"),
        afterSeq as number,
      );
    }
    case "attach-observer":
      return host.attachObserver(sessionId(params));
    case "acquire-controller": {
      const record = requiredRecord(params, "params");
      const lease = host.acquireController(
        requiredIdentifier(record.id, "session id"),
        requiredIdentifier(record.controllerId, "controller id"),
        controllerActivity(record.activity),
      );
      context.leases.set(lease.id, lease);
      return lease;
    }
    case "acquire-controller-if-no-recent-human": {
      const record = requiredRecord(params, "params");
      const lease = host.acquireAutomationControllerIfNoRecentHuman(
        requiredIdentifier(record.id, "session id"),
        requiredIdentifier(record.controllerId, "controller id"),
        requiredNonNegativeInteger(record.activityWindowMs, "human activity window"),
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
      const lease = ownedLease(context, record);
      if (
        record.signal !== undefined &&
        !isNativeTerminalStopSignal(record.signal)
      ) {
        throw new TypeError(
          "terminal stop signal must be SIGHUP, SIGINT, SIGTERM or SIGKILL",
        );
      }
      return host.stop(lease, record.signal);
    }
    case "stop-if-incarnation": {
      const record = requiredRecord(params, "params");
      if (
        record.signal !== undefined &&
        !isNativeTerminalStopSignal(record.signal)
      ) {
        throw new TypeError(
          "terminal stop signal must be SIGHUP, SIGINT, SIGTERM or SIGKILL",
        );
      }
      return host.stopIfIncarnation(
        requiredIdentifier(record.id, "session id"),
        requiredIdentifier(record.generation, "host generation"),
        requiredIdentifier(record.incarnation, "session incarnation"),
        record.signal,
      );
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

function safeResponseId(value: unknown): string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS
    ? value
    : "invalid";
}

function boundedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.length === 0) return "terminal operation failed";
  return message.slice(0, NATIVE_TERMINAL_MAX_ERROR_MESSAGE_CHARS);
}

function writeResponse(
  context: ConnectionContext,
  response: NativeTerminalResponse,
): boolean {
  let frame: string;
  try {
    frame = responseFrame(response);
  } catch {
    context.socket.destroy();
    return false;
  }
  const bytes = Buffer.byteLength(frame);
  if (
    context.socket.destroyed ||
    context.pendingResponses >=
      NATIVE_TERMINAL_MAX_PENDING_RESPONSES_PER_CONNECTION ||
    context.pendingResponseBytes + bytes >
      NATIVE_TERMINAL_MAX_PENDING_RESPONSE_BYTES_PER_CONNECTION ||
    context.responseBudget.pendingBytes + bytes >
      NATIVE_TERMINAL_MAX_PENDING_RESPONSE_BYTES_TOTAL
  ) {
    context.socket.destroy();
    return false;
  }
  context.pendingResponses += 1;
  context.pendingResponseBytes += bytes;
  context.responseBudget.pendingBytes += bytes;
  try {
    context.socket.write(frame, (error) => {
      releasePendingResponse(context, bytes);
      if (error) context.socket.destroy();
    });
    return true;
  } catch {
    releasePendingResponse(context, bytes);
    context.socket.destroy();
    return false;
  }
}

function releasePendingResponse(
  context: ConnectionContext,
  bytes: number,
): void {
  if (context.pendingResponses <= 0) return;
  context.pendingResponses -= 1;
  const released = Math.min(bytes, context.pendingResponseBytes);
  context.pendingResponseBytes -= released;
  context.responseBudget.pendingBytes = Math.max(
    0,
    context.responseBudget.pendingBytes - released,
  );
}

function releaseAllPendingResponses(context: ConnectionContext): void {
  context.responseBudget.pendingBytes = Math.max(
    0,
    context.responseBudget.pendingBytes - context.pendingResponseBytes,
  );
  context.pendingResponseBytes = 0;
  context.pendingResponses = 0;
}

function writeError(context: ConnectionContext, id: unknown, code: NativeTerminalErrorResponse["error"]["code"], error: unknown): boolean {
  const response: NativeTerminalErrorResponse = {
    version: NATIVE_TERMINAL_PROTOCOL_VERSION,
    id: safeResponseId(id),
    ok: false,
    error: {
      code,
      message: boundedErrorMessage(error),
    },
  };
  return writeResponse(context, response);
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
      if (!writeError(context, "invalid", "invalid-request", error)) return;
      continue;
    }
    let request: NativeTerminalRequest;
    try {
      request = parseNativeTerminalRequest(raw);
    } catch (error) {
      const id = isRecord(raw) ? raw.id : "invalid";
      if (!writeError(context, id, "invalid-request", error)) return;
      continue;
    }
    try {
      const response: NativeTerminalResponse = {
        version: NATIVE_TERMINAL_PROTOCOL_VERSION,
        id: request.id,
        ok: true,
        result: dispatch(host, context, request),
      };
      if (!writeResponse(context, response)) return;
    } catch (error) {
      if (!writeError(context, request.id, "operation-failed", error)) return;
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

async function socketPublicationLockSecret(socketPath: string): Promise<string> {
  if (process.platform !== "linux" || process.getuid === undefined) {
    throw new Error(
      "native terminal socket publication requires Linux abstract Unix sockets",
    );
  }
  const directory = dirname(socketPath);
  const identityPath = join(directory, SOCKET_PUBLICATION_LOCK_ID_FILE);
  const temporaryPath = join(
    directory,
    `.${SOCKET_PUBLICATION_LOCK_ID_FILE}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, `${randomUUID()}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    try {
      await link(temporaryPath, identityPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const identity = await lstat(identityPath);
  if (
    !identity.isFile()
    || identity.isSymbolicLink()
    || identity.uid !== process.getuid()
    || (identity.mode & 0o777) !== 0o600
  ) {
    throw new Error(
      `terminal socket publication lock identity is not a private owned file: ${identityPath}`,
    );
  }
  const secret = (await readFile(identityPath, "utf8")).trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(secret)) {
    throw new Error(
      `terminal socket publication lock identity is malformed: ${identityPath}`,
    );
  }
  return secret;
}

async function acquireSocketPublicationLock(socketPath: string): Promise<Server> {
  const secret = await socketPublicationLockSecret(socketPath);
  const address = `\0h2a-terminal-lock-${createHash("sha256")
    .update(`${process.getuid?.() ?? "unknown"}:${socketPath}:${secret}`)
    .digest("hex")}`;
  const deadline = Date.now() + SOCKET_PUBLICATION_LOCK_TIMEOUT_MS;
  for (;;) {
    const lock = createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        lock.once("error", reject);
        lock.listen(address, () => {
          lock.removeListener("error", reject);
          resolve();
        });
      });
      return lock;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "EADDRINUSE"
        || Date.now() >= deadline
      ) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, SOCKET_PUBLICATION_LOCK_RETRY_MS)
      );
    }
  }
}

async function withSocketPublicationLock<T>(
  socketPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = await acquireSocketPublicationLock(socketPath);
  try {
    return await operation();
  } finally {
    await new Promise<void>((resolve, reject) => {
      lock.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function removeStaleSocket(socketPath: string): Promise<void> {
  for (;;) {
    let stale: NativeTerminalSocketIdentity;
    try {
      stale = await inspectPrivateNativeTerminalSocket(socketPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (await socketAcceptsConnections(socketPath)) {
      throw new Error(
        `terminal host socket is already active: ${socketPath}`,
      );
    }
    try {
      const current = await inspectPrivateNativeTerminalSocket(socketPath);
      if (sameNativeTerminalSocket(stale, current)) {
        await unlink(socketPath);
        return;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function ensurePrivateSocketDirectory(socketPath: string): Promise<void> {
  const directory = dirname(socketPath);
  try {
    await assertPrivateNativeTerminalSocketDirectory(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await assertPrivateNativeTerminalSocketDirectory(socketPath);
  }
}

function stagingSocketPath(socketPath: string): string {
  const directory = dirname(socketPath);
  const stem = basename(socketPath).slice(0, 24).replace(/[^A-Za-z0-9_.-]/g, "_");
  const stagedPath = join(
    directory,
    `.${stem}.${process.pid}.${randomUUID().slice(0, 8)}.sock`,
  );
  // The staged name is longer than the published one; a publishable path can
  // still overflow the kernel sun_path budget at the bind step.
  assertNativeTerminalSocketPathWithinLimit(
    stagedPath,
    "terminal host staging socket path",
  );
  return stagedPath;
}

async function publishSocket(
  stagedPath: string,
  socketPath: string,
): Promise<NativeTerminalSocketIdentity> {
  const staged = await inspectPrivateNativeTerminalSocket(stagedPath);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await link(stagedPath, socketPath);
      const published = await inspectPrivateNativeTerminalSocket(socketPath);
      if (!sameNativeTerminalSocket(staged, published)) {
        throw new Error(
          "terminal host published socket identity does not match its staged socket",
        );
      }
      await unlink(stagedPath);
      return published;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await removeStaleSocket(socketPath);
    }
  }
  throw new Error("terminal host socket publication retry limit exceeded");
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

  const sockets = new Set<Socket>();
  const responseBudget: ResponseQueueBudget = { pendingBytes: 0 };
  const server: Server = createServer((socket) => {
    if (sockets.size >= NATIVE_TERMINAL_MAX_CONNECTIONS) {
      socket.destroy();
      return;
    }
    const context: ConnectionContext = {
      socket,
      leases: new Map(),
      responseBudget,
      buffer: "",
      pendingResponseBytes: 0,
      pendingResponses: 0,
    };
    sockets.add(socket);
    socket.setEncoding("utf8");
    socket.setNoDelay(true);
    socket.on("error", () => {
      // Per-connection transport failures are contained to this client.
    });
    socket.on("data", (chunk: string) => {
      try {
        consumeFrames(options.host, context, chunk);
      } catch {
        socket.destroy();
      }
    });
    socket.on("close", () => {
      releaseAllPendingResponses(context);
      releaseConnectionLeases(options.host, context);
      sockets.delete(socket);
    });
  });
  const stagedPath = stagingSocketPath(options.socketPath);
  let ownedSocket: NativeTerminalSocketIdentity;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(stagedPath, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    await chmod(stagedPath, 0o600);
    ownedSocket = await withSocketPublicationLock(
      options.socketPath,
      () => publishSocket(stagedPath, options.socketPath),
    );
  } catch (error) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      await unlink(stagedPath);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
        throw cleanupError;
      }
    }
    throw error;
  }
  let closing: Promise<void> | undefined;

  return Object.freeze({
    socketPath: options.socketPath,
    close(closeOptions = {}) {
      closing ??= (async () => {
        let stopError: unknown;
        if (closeOptions.stopSessions) {
          try {
            const signal = closeOptions.signal ?? "SIGTERM";
            if (!isNativeTerminalStopSignal(signal)) {
              throw new TypeError("invalid terminal host shutdown signal");
            }
            options.host.stopAll(signal);
          } catch (error) {
            stopError = error;
          }
        }
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
        await withSocketPublicationLock(options.socketPath, async () => {
          try {
            const current = await inspectPrivateNativeTerminalSocket(
              options.socketPath,
            );
            if (sameNativeTerminalSocket(current, ownedSocket)) {
              await unlink(options.socketPath);
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        });
        if (stopError !== undefined) throw stopError;
      })();
      return closing;
    },
  });
}
