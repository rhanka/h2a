import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { chmod, link, lstat, mkdir, open, readFile, rename, unlink, writeFile, type FileHandle } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { writeHostLogLine } from "./crash-safe-log.js";
import { HOST_FAULT_COUNTERS, recordHostFault } from "./fault-counters.js";
import {
  NativeTerminalHost,
  defaultOwnerHostProbe,
  readProcessStartTime,
  type NativeTerminalControllerActivity,
  type NativeTerminalControllerLease,
  type NativeTerminalCreateOptions,
  type NativeTerminalOwnerHostProbe,
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
  NATIVE_TERMINAL_SOCKET_MAX_PATH_BYTES,
  assertNativeTerminalSocketPathWithinLimit,
  assertPrivateNativeTerminalSocketDirectory,
  inspectPrivateNativeTerminalSocket,
  sameNativeTerminalSocket,
  type NativeTerminalSocketIdentity,
} from "./socket-path.js";
import { listNativeTerminalPgidEntries, loadRegistry } from "../registry.js";
import {
  classifyDurableProcFrame,
  readProcessFrame,
  type DurableProcFrame,
  type ReadProcessFrame,
} from "../proc-identity.js";

import { NativeTerminalPublicationRefusal } from "./publication-refusal.js";

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
const SOCKET_PUBLICATION_CLEANUP_TIMEOUT_MS = 100;

async function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation;
  let aborted: (() => void) | undefined;
  try {
    const result = await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        aborted = () => reject(signal.reason);
        if (signal.aborted) aborted();
        else signal.addEventListener("abort", aborted, { once: true });
      }),
    ]);
    signal.throwIfAborted();
    return result;
  } finally {
    if (aborted !== undefined) signal.removeEventListener("abort", aborted);
  }
}

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
    ...(options.launchFence !== undefined ? { launchFence: {
      generation: requiredIdentifier(requiredRecord(options.launchFence, "launch fence").generation, "launch generation"),
      incarnation: requiredIdentifier(requiredRecord(options.launchFence, "launch fence").incarnation, "launch incarnation"),
    } } : {}),
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
        launchFence: true,
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
      if (record.takeover !== undefined && typeof record.takeover !== "boolean") {
        throw new TypeError("terminal controller takeover must be a boolean");
      }
      const lease = host.acquireController(
        requiredIdentifier(record.id, "session id"),
        requiredIdentifier(record.controllerId, "controller id"),
        controllerActivity(record.activity),
        {
          ...(record.takeover !== undefined ? { takeover: record.takeover as boolean } : {}),
          ...(record.pid !== undefined ? { pid: requiredInteger(record.pid, "controller pid") } : {}),
          ...(record.tty !== undefined ? { tty: requiredString(record.tty, "controller tty") } : {}),
        },
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
      recordHostFault(HOST_FAULT_COUNTERS.hostClientFrameDestroys);
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
    recordHostFault(HOST_FAULT_COUNTERS.hostClientFrameDestroys);
    context.socket.destroy();
  }
}


async function socketPublicationLockSecret(socketPath: string, signal?: AbortSignal): Promise<string> {
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
    await abortable(writeFile(temporaryPath, `${randomUUID()}\n`, {
      flag: "wx",
      mode: 0o600,
      signal,
    }), signal);
    await abortable(chmod(temporaryPath, 0o600), signal);
    try {
      await abortable(link(temporaryPath, identityPath), signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    try {
      await abortable(unlink(temporaryPath), signal);
    } catch (error) {
      if (signal?.aborted) unlinkIfPresent(temporaryPath);
      else if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const identity = await abortable(lstat(identityPath), signal);
  if (
    !identity.isFile()
    || identity.isSymbolicLink()
    || identity.uid !== process.getuid()
    || (identity.mode & 0o777) !== 0o600
  ) {
    // T4: a lock-id that is not a private owned file is a coded refusal,
    // never an undifferentiated startup crash.
    throw new NativeTerminalPublicationRefusal("H2A_PUBLICATION_LOCK_ID_MALFORMED");
  }
  const secret = (await abortable(readFile(identityPath, "utf8"), signal)).trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(secret)) {
    throw new NativeTerminalPublicationRefusal("H2A_PUBLICATION_LOCK_ID_MALFORMED");
  }
  return secret;
}

async function acquireSocketPublicationLock(socketPath: string, signal?: AbortSignal): Promise<Server> {
  const secret = await socketPublicationLockSecret(socketPath, signal);
  const address = `\0h2a-terminal-lock-${createHash("sha256")
    .update(`${process.getuid?.() ?? "unknown"}:${socketPath}:${secret}`)
    .digest("hex")}`;
  const deadline = Date.now() + SOCKET_PUBLICATION_LOCK_TIMEOUT_MS;
  for (;;) {
    signal?.throwIfAborted();
    const lock = createServer(socket => socket.destroy());
    try {
      await abortable(new Promise<void>((resolve, reject) => {
        lock.once("error", reject);
        lock.listen(address, () => {
          lock.removeListener("error", reject);
          resolve();
        });
      }), signal);
      return lock;
    } catch (error) {
      lock.close();
      if (
        (error as NodeJS.ErrnoException).code !== "EADDRINUSE"
        || Date.now() >= deadline
      ) {
        throw error;
      }
      await abortable(new Promise((resolve) =>
        setTimeout(resolve, SOCKET_PUBLICATION_LOCK_RETRY_MS)
      ), signal);
    }
  }
}

async function withSocketPublicationLock<T>(
  socketPath: string,
  operation: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new NativeTerminalPublicationRefusal("H2A_PUBLICATION_LOCK_TIMEOUT")),
    SOCKET_PUBLICATION_LOCK_TIMEOUT_MS);
  const boundedSignal = signal === undefined ? deadline.signal : AbortSignal.any([signal, deadline.signal]);
  try {
    const lock = await acquireSocketPublicationLock(socketPath, boundedSignal);
    try {
      boundedSignal.throwIfAborted();
      return await operation(boundedSignal);
    } finally {
      await abortable(new Promise<void>((resolve, reject) => {
        lock.close((error) => error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
      }), AbortSignal.timeout(SOCKET_PUBLICATION_CLEANUP_TIMEOUT_MS));
    }
  } finally {
    clearTimeout(timer);
  }
}

function unlinkIfPresent(path: string): void {
  try { unlinkSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

function unlinkOwnedPath(path: string, owned: NativeTerminalSocketIdentity): void {
  try {
    const current = lstatSync(path);
    if (sameNativeTerminalSocket(current, owned)) unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function rollbackEndpoint(socketPath: string, owned: NativeTerminalSocketIdentity): void {
  unlinkOwnedPath(socketPath, owned);
  const ownerPath = `${socketPath}.owner`;
  try {
    const identity = lstatSync(ownerPath);
    if (!identity.isFile() || identity.uid !== process.getuid?.() || (identity.mode & 0o777) !== 0o600) return;
    const owner = JSON.parse(readFileSync(ownerPath, "utf8")) as EndpointOwner;
    if (owner.pid === process.pid && owner.startTime === readProcessStartTime(process.pid)
      && sameNativeTerminalSocket(owner, owned)) unlinkOwnedPath(ownerPath, identity);
  } catch { /* Unknown sidecar ownership is never cleanup authority. */ }
}

type EndpointOwner = NativeTerminalSocketIdentity & {
  pid: number;
  startTime: number;
  bootId: string;
  pidNamespace: string;
  /**
   * The publisher's machine id (machine-id(5)), the anchor that makes a
   * sidecar written by a PREVIOUS boot of THIS machine provable dead after a
   * reboot (see `classifyDurableProcFrame`): without it, "same namespace,
   * different boot" is also what another machine sharing the socket directory
   * looks like. Absent on sidecars written before 0.98.5: across a boot
   * boundary such a sidecar is UNATTRIBUTED — no death proof, and (migration,
   * spec v3 option A) no longer a refusal either: recovery rests on the
   * durable rows of the previous boot or the cold path, and the next
   * publication re-stamps this anchor.
   */
  machineId?: string;
  nsNet?: string;
  bootTimeMs?: number;
};

async function recordEndpointOwner(socketPath: string, socket: NativeTerminalSocketIdentity,
  processOwner = { pid: process.pid, startTime: readProcessStartTime(process.pid) },
  signal: AbortSignal | undefined,
  frame: DurableProcFrame,
  /**
   * Stamp a frame OTHER than the reader's current one: used only by the
   * proof-preservation pass, which re-records an identity that a durable row
   * already PROVED dead at a PREVIOUS boot of this machine. Every stamped
   * value (pid, start-time, boot, namespace, machine) then comes from that
   * one row — a coherent epoch — never a mix of a dead boot's numbers with
   * the current boot's frame.
   */
  stampFrame?: DurableProcFrame,
): Promise<void> {
  signal?.throwIfAborted();
  if (process.env.H2A_TEST_FAIL_OWNER_WRITE) {
    throw new Error("simulated failure recording endpoint owner");
  }
  const { pid, startTime } = processOwner;
  frame = stampFrame ?? frame;
  if (startTime === undefined || frame.bootId === undefined || frame.pidNamespace === undefined) {
    throw new Error("cannot certify native host process identity");
  }
  const temporary = `${socketPath}.owner.${process.pid}.${randomUUID()}.tmp`;
  let file: FileHandle | undefined;
  try {
    const openedFile = await abortable(open(temporary, "wx", 0o600).then((opened) => {
      if (signal?.aborted) {
        // A cancelled open may finish after rollback. Its unique pathname and
        // descriptor still belong to this publication, never to a successor.
        try {
          unlinkOwnedPath(temporary, fstatSync(opened.fd));
        } finally { void opened.close().catch(() => {}); }
        signal.throwIfAborted();
      }
      file = opened;
      return opened;
    }), signal);
    signal?.throwIfAborted();
    // Write through the already-open inode: cancellation can unlink it without
    // a delayed write recreating the temporary pathname.
    await abortable(writeFile(openedFile, JSON.stringify({ ...socket, pid, startTime, bootId: frame.bootId,
      pidNamespace: frame.pidNamespace, ...(frame.machineId !== undefined ? { machineId: frame.machineId } : {}),
      ...(frame.nsNet !== undefined ? { nsNet: frame.nsNet } : {}),
      ...(frame.bootTimeMs !== undefined ? { bootTimeMs: frame.bootTimeMs } : {}) }),
      signal === undefined ? {} : { signal }), signal);
    signal?.throwIfAborted();
    await abortable(rename(temporary, `${socketPath}.owner`), signal);
  } finally {
    // Invalidate the rename source before releasing the publication lock. A
    // delayed rename either already committed (and is rolled back by its
    // publisher) or can no longer install an owner after cancellation.
    try {
      await abortable(unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }), signal);
    } catch (error) {
      if (!signal?.aborted) throw error;
      // No asynchronous rollback can be left targeting a shared pathname.
      // Invalidate the unique source now, before the exclusion lock is closed.
      if (file !== undefined) unlinkOwnedPath(temporary, fstatSync(file.fd));
      else unlinkIfPresent(temporary);
      signal.throwIfAborted();
    } finally {
      // An aborted write may still be unwinding. Its descriptor owns only the
      // unlinked inode and must not hold up listener/lock cleanup.
      void file?.close().catch(() => {});
    }
  }
}

/**
 * ENOENT/ECONNREFUSED are candidates, never proof by themselves. Serialize
 * with publication and re-read both the socket and its durable process
 * identity. A live or unreadable owner keeps the endpoint unknown.
 * Inventories use the read-only default. A launch can explicitly reclaim the
 * proven-dead inode under this same lock, so subsequent starters do not each
 * repeat the one-second stale-inode proof ahead of the new publisher.
 */
export async function proveNativeTerminalEndpointAbsent(
  socketPath: string,
  failure: unknown,
  readFrame: ReadProcessFrame = readProcessFrame,
  ownerProbe: NativeTerminalOwnerHostProbe = defaultOwnerHostProbe,
  reclaimStaleSocket = false,
): Promise<boolean> {
  const code = (failure as NodeJS.ErrnoException | undefined)?.code;
  if (code !== "ENOENT" && code !== "ECONNREFUSED") return false;
  await ensurePrivateSocketDirectory(socketPath);
  return withSocketPublicationLock(socketPath,
    signal => proveEndpointAbsentUnderLock(socketPath, signal, readPublicationFrame(readFrame), ownerProbe, reclaimStaleSocket));
}

function canonicalizePath(targetPath: string): string | undefined {
  const resolved = resolve(targetPath);
  try {
    return realpathSync(resolved);
  } catch {
    const dir = dirname(resolved);
    const base = basename(resolved);
    try {
      const realDir = realpathSync(dir);
      return join(realDir, base);
    } catch {
      return undefined;
    }
  }
}

type ActiveHostScan =
  | { state: "absent" }
  | { state: "live"; pid: number; startTime: number }
  | { state: "unknown"; reason: string };

function findActiveHostServingSocket(
  socketPath: string,
  procRoot = process.env.H2A_TEST_PROC_ROOT ?? "/proc",
  ownerProbe: NativeTerminalOwnerHostProbe = defaultOwnerHostProbe,
): ActiveHostScan {
  if (process.env.H2A_TEST_PROC_UNAVAILABLE) {
    return { state: "unknown", reason: "simulated /proc observation unavailable" };
  }
  if (process.platform !== "linux") {
    return { state: "unknown", reason: "platform does not support /proc host observation" };
  }
  let entries: string[];
  try {
    entries = readdirSync(procRoot);
  } catch (error) {
    return {
      state: "unknown",
      reason: `cannot read ${procRoot}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const targetCanonical = canonicalizePath(socketPath);
  if (!targetCanonical) {
    return {
      state: "unknown",
      reason: `cannot canonicalize target socket path: ${socketPath}`,
    };
  }
  const targetDirectory = statSync(dirname(targetCanonical));
  let targetSocket: NativeTerminalSocketIdentity | undefined;
  try { targetSocket = statSync(targetCanonical); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;

    const pidDir = join(procRoot, entry);
    let procStat;
    try {
      procStat = statSync(pidDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "ESRCH") continue;
      return {
        state: "unknown",
        reason: `cannot stat /proc/${pid}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (process.getuid && procStat.uid !== process.getuid()) {
      continue;
    }

    let cmdline: string;
    try {
      cmdline = readFileSync(join(pidDir, "cmdline"), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "ESRCH") continue;
      return {
        state: "unknown",
        reason: `cannot read /proc/${pid}/cmdline: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const args = cmdline.split("\0");
    const idx = args.indexOf("--socket");
    if (idx === -1 || idx + 1 >= args.length) continue;

    const candidateSocket = args[idx + 1]!;
    const isHost = args.some(arg => arg.includes("process.js") || (arg.includes("native-terminal") && !arg.includes("op.js")));
    if (!isHost) continue;

    const candidateCanonical = canonicalizePath(candidateSocket);
    let sameCandidateSocket = false;
    if (targetSocket) {
      try { sameCandidateSocket = sameNativeTerminalSocket(statSync(candidateSocket), targetSocket); }
      catch { /* An absent published name supplies no direct inode evidence. */ }
    }
    // Staged stems collide between the primary and lf1 endpoints. A native
    // publication keeps its full basename; only direct socket identity can
    // override a different endpoint name or a different resolved path.
    if (!sameCandidateSocket && basename(resolve(candidateSocket)) !== basename(targetCanonical)) continue;
    // An ancestor alias can have been retargeted since bind. Its current
    // resolution alone cannot exclude the old target; pinned bind evidence can.
    const candidateAliased = candidateCanonical !== undefined && candidateCanonical !== resolve(candidateSocket);
    const couldServeTarget = candidateCanonical === undefined
      || candidateCanonical === targetCanonical || sameCandidateSocket || candidateAliased;
    if (!couldServeTarget) continue;

    const candDir = dirname(candidateSocket);
    let isStagingCandidate = false;
    try {
      const dirEntries = readdirSync(candDir);
      isStagingCandidate = dirEntries.some(name => isStagedSocketName(name, candidateSocket, pid));
    } catch {
      // Staging-directory inspection is optional; the descriptor/inode
      // attribution below still decides live, absent, or unknown.
    }
    if (isStagingCandidate) continue;

    const fdDir = join(pidDir, "fd");
    let fds: string[];
    try {
      fds = readdirSync(fdDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "ESRCH") continue;
      return {
        state: "unknown",
        reason: `cannot inspect /proc/${pid}/fd: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    let hasSocketFd = false;
    const descriptorLinks = new Map<string, string>();
    let unreadableDescriptor: string | undefined;
    for (const fd of fds) {
      try { descriptorLinks.set(fd, readlinkSync(join(fdDir, fd))); }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "ESRCH") continue;
        unreadableDescriptor = `cannot readlink /proc/${pid}/fd/${fd}: ${String(err)}`;
      }
    }
    let unixSockets: Map<string, string> | undefined;
    for (const link of descriptorLinks.values()) {
      const inode = /^socket:\[(\d+)\]$/.exec(link)?.[1];
      if (!inode) continue;
      if (!unixSockets) {
        try {
          unixSockets = new Map(readFileSync(join(pidDir, "net", "unix"), "utf8")
            .split("\n").flatMap(line => {
              const row = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(\d+)(?:\s+(.*))?$/.exec(line);
              return row?.[2] ? [[row[1]!, row[2]] as const] : [];
            }));
        } catch (error) {
          return { state: "unknown", reason: `cannot inspect /proc/${pid}/net/unix: ${String(error)}` };
        }
      }
      const boundPath = unixSockets.get(inode);
      // Stdio and journal IPC are Unix socket pairs too. Only the native
      // listener's canonical or PID-attributed staged address proves service,
      // including a listener whose filesystem pathname has been unlinked.
      if (!boundPath || !boundPath.startsWith("/")) continue;
      const canonicalBound = canonicalizePath(boundPath);
      let sameSocket = false;
      if (targetSocket) {
        try { sameSocket = sameNativeTerminalSocket(statSync(boundPath), targetSocket); }
        catch { /* An unlinked staging name has no filesystem inode to compare. */ }
      }
      const stagedForTarget = isStagedSocketName(basename(boundPath), socketPath, pid);
      if (sameSocket) {
        hasSocketFd = true;
        break;
      }
      // Prefer the pinned directory even when its old pathname resolves again:
      // a replacement directory at that name is a different endpoint. The bind
      // directory is canonical, so its FD stays attributable after alias loss.
      // Never compare the sockfs inode with a VFS inode.
      // The Unix-table row above belongs to a socket this PID actually holds.
      const nativeListener = boundPath === candidateSocket
        || isStagedSocketName(basename(boundPath), candidateSocket, pid);
      if (!nativeListener) continue;
      let boundDirectory: NativeTerminalSocketIdentity | undefined;
      for (const [fd, path] of descriptorLinks) {
        if (path !== dirname(boundPath) && path !== `${dirname(boundPath)} (deleted)`) continue;
        try {
          const info = statSync(join(fdDir, fd));
          if (info.isDirectory() && (path === dirname(boundPath) || info.nlink === 0)) {
            boundDirectory = info;
            break;
          }
        } catch { /* Missing directory evidence remains unknown below. */ }
      }
      if (boundDirectory && !sameNativeTerminalSocket(boundDirectory, targetDirectory)) continue;
      if (boundDirectory && (stagedForTarget || basename(boundPath) === basename(targetCanonical))) {
        hasSocketFd = true;
        break;
      }
      // Older hosts have no directory FD. Resolvable bind evidence can still
      // attribute them; only an opaque listener of this same endpoint remains
      // unknown. Distinct endpoint names were excluded before FD inspection.
      if (canonicalBound === targetCanonical || (canonicalBound !== undefined
        && dirname(canonicalBound) === dirname(targetCanonical) && stagedForTarget)) {
        hasSocketFd = true;
        break;
      }
      if (canonicalBound !== undefined && !candidateAliased) continue;
      return { state: "unknown", reason: `cannot attribute bound socket directory for host pid ${pid}` };
    }
    if (!hasSocketFd && unreadableDescriptor) return { state: "unknown", reason: unreadableDescriptor };
    if (!hasSocketFd) continue;

    const startTime = readProcessStartTime(pid);
    if (startTime === undefined) {
      return { state: "unknown", reason: `cannot read start time for host pid ${pid}` };
    }
    const probe = ownerProbe({ pid, startTime });
    if (probe === "alive") {
      return { state: "live", pid, startTime };
    }
    if (probe === "unresolvable") {
      return { state: "unknown", reason: `host pid ${pid} liveness probe is unresolvable` };
    }
  }
  return { state: "absent" };
}

function readPublicationFrame(readFrame: ReadProcessFrame): DurableProcFrame {
  const frame = readFrame();
  if (frame.machineId === undefined || !/^[0-9a-f]{32}$/.test(frame.machineId) || /^0+$/.test(frame.machineId)) {
    throw new NativeTerminalPublicationRefusal("H2A_MACHINE_ID_UNREADABLE");
  }
  if (classifyDurableProcFrame(frame, frame) !== "current") {
    throw new NativeTerminalPublicationRefusal("H2A_PROC_FRAME_UNKNOWN");
  }
  return frame;
}

/** A refused connect says only that nobody accepts now. An existing inode
 * needs all five refusals; a missing pathname needs one under the publication
 * lock (active-host and durable-owner checks still precede it, inode recheck
 * still follows). Every attempt has its own timer and a shared global budget.
 * Abort destroys the socket and cancels the interval before the lock releases. */
async function repeatedlyRefusesConnection(socketPath: string, socketPresent: boolean, signal?: AbortSignal, provenDeadOwner = false): Promise<boolean> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new NativeTerminalPublicationRefusal("H2A_ENDPOINT_PROBE_TIMEOUT")), 2_000);
  const bounded = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  try {
    const attempts = socketPresent && !provenDeadOwner ? 5 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      bounded.throwIfAborted();
      const refusal = await new Promise<boolean>((resolve, reject) => {
        const connection = createConnection(socketPath);
        const finish = (error?: unknown, refused = false) => {
          clearTimeout(unitTimer);
          bounded.removeEventListener("abort", cancel);
          connection.destroy();
          if (error !== undefined) reject(error); else resolve(refused);
        };
        const cancel = () => finish(bounded.reason);
        const unitTimer = setTimeout(() => finish(new NativeTerminalPublicationRefusal("H2A_ENDPOINT_PROBE_TIMEOUT")), 500);
        bounded.addEventListener("abort", cancel, { once: true });
        connection.once("connect", () => finish());
        connection.once("error", error => {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ECONNREFUSED" || (!socketPresent && code === "ENOENT")) finish(undefined, true);
          else finish(error);
        });
      });
      if (!refusal) return false;
      if (attempt < attempts - 1) {
        await new Promise<void>((resolve, reject) => {
          const cancel = () => { clearTimeout(interval); reject(bounded.reason); };
          const interval = setTimeout(() => { bounded.removeEventListener("abort", cancel); resolve(); }, 250);
          bounded.addEventListener("abort", cancel, { once: true });
          if (bounded.aborted) cancel();
        });
      }
    }
    bounded.throwIfAborted();
    return true;
  } finally { clearTimeout(timer); }
}

/** Caller holds withSocketPublicationLock through classification, probes,
 * inode recheck, reclamation, link and owner stamping (R2). */
async function proveEndpointAbsentUnderLock(
  socketPath: string,
  signal: AbortSignal | undefined,
  currentFrame: DurableProcFrame,
  ownerProbe: NativeTerminalOwnerHostProbe = defaultOwnerHostProbe,
  reclaimStaleSocket = false,
): Promise<boolean> {
  signal?.throwIfAborted();
  let socket: NativeTerminalSocketIdentity | undefined;
  try { socket = await abortable(inspectPrivateNativeTerminalSocket(socketPath), signal); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  // Normative order: active scan, all three sources, classification, probes.
  // A live host serving this endpoint — including an OLDER published host
  // during an upgrade (scenario 9) — is the strongest refusal there is: the
  // candidate must never unlink or republish over it.
  // Seam symmetry (F4): the scan liveness probe is the INJECTED ownerProbe so
  // the "zero probes for stale-boot sources" assertions observe this path too.
  const activeScan = findActiveHostServingSocket(socketPath, undefined, ownerProbe);
  if (activeScan.state === "live") throw new NativeTerminalPublicationRefusal("H2A_ENDPOINT_LIVE_OWNER");
  if (activeScan.state === "unknown") {
    // The frozen literal carries the sense (T8); the scan's own reason (e.g.
    // which /proc view was unreadable) rides as `cause` so operators keep the
    // diagnostic the old generic throw used to inline.
    throw Object.assign(new NativeTerminalPublicationRefusal("H2A_ENDPOINT_SCAN_UNKNOWN"), {
      cause: new Error(activeScan.reason),
    });
  }
  let sidecar: EndpointOwner | undefined;
  const ownerPath = `${socketPath}.owner`;
  try {
    const info = await abortable(lstat(ownerPath), signal);
    if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600) {
      throw new NativeTerminalPublicationRefusal("H2A_ENDPOINT_OWNER_MALFORMED");
    }
    try {
      const parsed = JSON.parse(await abortable(readFile(ownerPath, "utf8"), signal)) as unknown;
      // Valid JSON that is not an object (null, a bare string, a number) is
      // the same coded refusal (T4): the shape is validated BEFORE any
      // property access, never an undifferentiated TypeError crash (exit 1).
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new NativeTerminalPublicationRefusal("H2A_ENDPOINT_OWNER_MALFORMED");
      }
      sidecar = parsed as EndpointOwner;
    } catch (error) {
      if (signal?.aborted || error instanceof NativeTerminalPublicationRefusal) throw error;
      // Unparseable sidecar content is a coded refusal (T4), never an
      // undifferentiated crash: the file is local fail-closed evidence.
      throw new NativeTerminalPublicationRefusal("H2A_ENDPOINT_OWNER_MALFORMED");
    }
    if (!Number.isSafeInteger(sidecar.pid) || sidecar.pid <= 0 || !Number.isSafeInteger(sidecar.startTime) ||
      sidecar.startTime < 0 || !Number.isSafeInteger(sidecar.dev) || !Number.isSafeInteger(sidecar.ino) ||
      typeof sidecar.bootId !== "string" || typeof sidecar.pidNamespace !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sidecar.bootId) || !/^\d+$/.test(sidecar.pidNamespace) ||
      (sidecar.machineId !== undefined && typeof sidecar.machineId !== "string")) {
      throw new NativeTerminalPublicationRefusal("H2A_ENDPOINT_OWNER_MALFORMED");
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const snapshot = listNativeTerminalPgidEntries();
  const registry = loadRegistry();
  if (!snapshot.known && snapshot.reason !== "registry is absent") throw new NativeTerminalPublicationRefusal("H2A_ENDPOINT_REGISTRY_UNKNOWN");
  if (registry.state === "unknown" || registry.unreadable.length > 0) throw new NativeTerminalPublicationRefusal("H2A_ENDPOINT_REGISTRY_UNKNOWN");
  const canonicalTarget = canonicalizePath(socketPath);
  if (!canonicalTarget) throw new Error(`cannot canonicalize socket path: ${socketPath}`);
  const matches = (path?: string) => path !== undefined && canonicalizePath(path) === canonicalTarget;
  const attributedRows = registry.entries.filter(row => matches(row.ownerHostSocketPath));
  const attributedPgid = snapshot.known ? snapshot.entries.filter(entry => matches(entry.owner?.socketPath)) : [];
  // Legacy sidecars are local, unattributed evidence (R3); registry and pgid
  // records without a machine anchor remain blocking foreign frames (R1).
  const sidecarVerdict = sidecar?.machineId === undefined ? undefined : classifyDurableProcFrame(sidecar, currentFrame);
  const classifiedPgid = attributedPgid.map(entry => ({ entry, verdict: classifyDurableProcFrame(entry.frame, currentFrame) }));
  const classifiedRows = attributedRows.map(row => ({ row, verdict: classifyDurableProcFrame({
    pidNamespace: row.pgidPidNamespace, bootId: row.pgidBootId, machineId: row.pgidMachineId,
  }, currentFrame) }));
  if ((socket && sidecar && !sameNativeTerminalSocket(socket, sidecar)) || sidecarVerdict === "foreign-frame" ||
    classifiedPgid.some(item => item.verdict === "foreign-frame") || classifiedRows.some(item => item.verdict === "foreign-frame")) return false;
  // Owners are derived only AFTER every source has been classified.
  const currentOwners: Array<{ pid: number; startTime?: number }> = [];
  if (sidecarVerdict === "current" && sidecar) currentOwners.push(sidecar);
  for (const { entry, verdict } of classifiedPgid) if (verdict === "current" && entry.owner) currentOwners.push(entry.owner);
  for (const { row, verdict } of classifiedRows) if (verdict === "current") {
    if (row.ownerHostPid === undefined) return false;
    currentOwners.push({ pid: row.ownerHostPid, ...(row.ownerHostStartTime !== undefined ? { startTime: row.ownerHostStartTime } : {}) });
  }
  const uniqueOwners = [...new Map(currentOwners.map(owner => [`${owner.pid}:${owner.startTime}`, owner])).values()];
  const ownersDead = uniqueOwners.every(owner => owner.startTime !== undefined && ownerProbe(owner) === "dead");
  const sidecarProvesDeath = sidecarVerdict === "stale-boot" || (sidecarVerdict === "current" && ownersDead);
  // Even a run of refusals cannot prove a new, unattributed holder dead.
  // With an inode-matched, current-frame sidecar and every attributed owner
  // positively dead, waiting cannot add identity evidence. Publication is
  // serialized by this same lock and the inode is checked again below. Keep
  // the full observation window for legacy/unattributed sockets; never turn
  // an unknown identity into this fast path. Read-only proofs keep the inode.
  const provenDeadOwner = socket !== undefined && sidecar !== undefined &&
    sidecarVerdict === "current" && ownersDead && sameNativeTerminalSocket(socket, sidecar);
  if (!await repeatedlyRefusesConnection(socketPath, socket !== undefined, signal, provenDeadOwner)) return false;
  let preBootInode = false;
  try {
    const final = await abortable(lstat(socketPath), signal);
    if (!socket || !sameNativeTerminalSocket(socket, final)) return false;
    preBootInode = currentFrame.bootTimeMs !== undefined && Number.isFinite(currentFrame.bootTimeMs) && currentFrame.bootTimeMs > 0 &&
      final.birthtimeMs > 0 && final.birthtimeMs < currentFrame.bootTimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (socket) return false;
  }
  if (!ownersDead) return false;
  const staleProof = classifiedRows.find(item => item.verdict === "stale-boot" && item.row.ownerHostPid !== undefined && item.row.ownerHostStartTime !== undefined)?.row;
  const currentDead = uniqueOwners[0];
  // Stale rows prove the death of their AUTHORS, never the absence of a NEW
  // holder of the pathname (R4-probe): they cannot bypass the age/liveness
  // proof. Without a sidecar death proof or a CURRENT-boot owner positively
  // probed dead, an existing socket yields publication only to the pre-boot
  // inode proof (R3 combo 4): an inode created during this boot may have a
  // live, unattributed holder that refused every connect probe.
  if (socket && !sidecarProvesDeath && currentDead === undefined && !preBootInode) return false;
  if (socket && currentDead !== undefined) {
    await recordEndpointOwner(socketPath, socket, { pid: currentDead.pid, startTime: currentDead.startTime }, signal, currentFrame);
  } else if (socket && !sidecarProvesDeath && staleProof !== undefined) {
    await recordEndpointOwner(socketPath, socket, { pid: staleProof.ownerHostPid!, startTime: staleProof.ownerHostStartTime }, signal, currentFrame,
      { bootId: staleProof.pgidBootId, pidNamespace: staleProof.pgidPidNamespace, machineId: staleProof.pgidMachineId });
  }
  if (socket && reclaimStaleSocket) {
    unlinkOwnedPath(socketPath, socket);
    try { await abortable(lstat(socketPath), signal); return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return true;
}

async function removeStaleSocket(
  socketPath: string,
  signal: AbortSignal | undefined,
  frame: DurableProcFrame,
  ownerProbe: NativeTerminalOwnerHostProbe = defaultOwnerHostProbe,
): Promise<void> {
  for (;;) {
    signal?.throwIfAborted();
    let stale: NativeTerminalSocketIdentity;
    try {
      stale = await abortable(inspectPrivateNativeTerminalSocket(socketPath), signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (!await proveEndpointAbsentUnderLock(socketPath, signal, frame, ownerProbe)) {
      throw new NativeTerminalPublicationRefusal("H2A_STALE_SOCKET_UNPROVEN");
    }
    try {
      const current = await abortable(inspectPrivateNativeTerminalSocket(socketPath), signal);
      if (sameNativeTerminalSocket(stale, current)) {
        // Do not leave an uncancellable deletion queued against a successor.
        unlinkOwnedPath(socketPath, stale);
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

/**
 * Staged-socket naming grammar, shared by the generator (`stagingSocketPath`)
 * and the recognizers in `findActiveHostServingSocket`. The staged name MUST
 * remain recognizable: a live host that lost its published pathname is only
 * attributable through its staged name, and refusing to attribute it would
 * admit a second writer. Never edit the generator without the recognizers.
 *
 * Two grammars, with an explicit compatibility order (R5 v5):
 *
 * 1. LEGACY (≤ 0.98.4): `.<8 stem bytes>.<pid>.<8 hex>.sock` — the ONLY
 *    grammar the PUBLISHED 0.98.4 reader recognizes when it attributes, via
 *    /proc, a live host whose published pathname is gone. Chosen WHENEVER the
 *    kernel sun_path budget allows it, so a mixed 0.98.4/0.98.5 fleet never
 *    loses the anti-second-writer attribution in either direction.
 * 2. SHORT: `.<3 stem bytes>.<pid>.<8 hex>` — the fallback when the legacy
 *    name would overflow the sun_path budget. RESTRICTION (explicit, R5 v5):
 *    in such deep paths a 0.98.4 reader can no longer attribute a
 *    pathname-less 0.98.5 host through /proc — but a 0.98.4 host could not
 *    even bind there (its own staged name would overflow first), so the
 *    exposure is confined to deep development/deployment directories, and
 *    0.98.5 readers still refuse the double publication on both grammars.
 */
const STAGED_SOCKET_UUID_HEX_LENGTH = 8;

function stagedSocketStem(publishedPath: string, stemLength: number): string {
  return basename(publishedPath).slice(0, stemLength).replace(/[^A-Za-z0-9_.-]/g, "_");
}

/**
 * Grammar-exact recognizer: `.<stem>.<pid>.<exactly 8 lowercase hex>` for the
 * short grammar, plus `.sock` for the legacy grammar. A bare `startsWith`
 * would accept forged or truncated names as attribution evidence.
 */
export function isStagedSocketName(name: string, publishedPath: string, pid: number): boolean {
  for (const [stemLength, legacy] of [[8, true], [3, false]] as const) {
    const prefix = `.${stagedSocketStem(publishedPath, stemLength)}.${pid}.`;
    if (!name.startsWith(prefix)) continue;
    const tail = name.slice(prefix.length);
    const expectedTailLength = STAGED_SOCKET_UUID_HEX_LENGTH + (legacy ? ".sock".length : 0);
    if (tail.length !== expectedTailLength) continue;
    if (!/^[0-9a-f]+$/.test(tail.slice(0, STAGED_SOCKET_UUID_HEX_LENGTH))) continue;
    if (legacy && !tail.endsWith(".sock")) continue;
    return true;
  }
  return false;
}

function stagingSocketPath(socketPath: string): string {
  const directory = dirname(socketPath);
  const uuid = randomUUID().slice(0, STAGED_SOCKET_UUID_HEX_LENGTH);
  // Legacy first: it is the grammar the published 0.98.4 reader can still
  // attribute (see the restriction note above). Only a sun_path overflow may
  // demote the staged name to the short grammar.
  const legacy = join(
    directory,
    `.${stagedSocketStem(socketPath, 8)}.${process.pid}.${uuid}.sock`,
  );
  if (Buffer.byteLength(legacy, "utf8") <= NATIVE_TERMINAL_SOCKET_MAX_PATH_BYTES) {
    return legacy;
  }
  const stagedPath = join(
    directory,
    `.${stagedSocketStem(socketPath, 3)}.${process.pid}.${uuid}`,
  );
  // Even the short name must fit: a publishable path can still overflow the
  // kernel sun_path budget at the bind step.
  assertNativeTerminalSocketPathWithinLimit(
    stagedPath,
    "terminal host staging socket path",
  );
  return stagedPath;
}

async function publishSocket(
  stagedPath: string,
  socketPath: string,
  signal: AbortSignal,
  frame: DurableProcFrame,
  ownerProbe: NativeTerminalOwnerHostProbe = defaultOwnerHostProbe,
): Promise<NativeTerminalSocketIdentity> {
  signal.throwIfAborted();
  const staged = await abortable(inspectPrivateNativeTerminalSocket(stagedPath), signal);
  try { await abortable(inspectPrivateNativeTerminalSocket(socketPath), signal); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (!await proveEndpointAbsentUnderLock(socketPath, signal, frame, ownerProbe)) {
      throw new NativeTerminalPublicationRefusal("H2A_ENDPOINT_OWNER_UNPROVEN");
    }
  }
  for (let attempt = 0; attempt < 200; attempt += 1) {
    signal.throwIfAborted();
    try {
      await abortable(link(stagedPath, socketPath), signal);
      const published = await abortable(inspectPrivateNativeTerminalSocket(socketPath), signal);
      if (!sameNativeTerminalSocket(staged, published)) {
        throw new Error(
          "terminal host published socket identity does not match its staged socket",
        );
      }
      await abortable(unlink(stagedPath), signal);
      return published;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await removeStaleSocket(socketPath, signal, frame, ownerProbe);
    }
  }
  throw new Error("terminal host socket publication retry limit exceeded");
}

export type NativeTerminalHostServer = Readonly<{
  socketPath: string;
  /**
   * The listening net.Server, exposed for supervision and fault-injection
   * tests. Callers must not close it directly: use `close()` so publication
   * rollback and socket cleanup run.
   */
  server: Server;
  close(options?: { stopSessions?: boolean; signal?: string }): Promise<void>;
}>;

/**
 * Listener failure classification (R7). A listener error that is neither
 * recoverable nor provably-unusable is UNKNOWN: the host must not pretend to
 * serve on a listener whose failure it cannot name.
 */
export type NativeTerminalListenerFailure = Readonly<{
  kind: "unusable" | "unknown";
  errno: string | undefined;
  error: unknown;
}>;

/**
 * Accept/connection-side transport errors: the listener itself keeps serving.
 */
const RECOVERABLE_LISTENER_ERRNOS: ReadonlySet<string> =
  new Set(["ECONNRESET", "EPIPE", "ECONNABORTED"]);

/** Accept-path fd exhaustion: transient while it clears, unusable when it
 * persists (v5 R7 predicate: >= 3 consecutive accept errors within 60 s). */
const EXHAUSTED_LISTENER_ERRNOS: ReadonlySet<string> = new Set(["EMFILE", "ENFILE"]);
const LISTENER_EXHAUSTION_PERSISTENCE_THRESHOLD = 3;
const LISTENER_EXHAUSTION_WINDOW_MS = 60_000;

/** The listening socket can no longer serve: late EADDRINUSE, an invalid fd,
 * an unusable address. Known-dead — exit cleanly and let the supervisor own
 * the respawn. */
const UNUSABLE_LISTENER_ERRNOS: ReadonlySet<string> =
  new Set(["ERR_SERVER_CLOSED", "EADDRINUSE", "EADDRNOTAVAIL", "EBADF", "EINVAL", "ENOTSOCK", "EACCES"]);

export async function startNativeTerminalHostServer(options: {
  socketPath: string;
  host: NativeTerminalHost;
  signal?: AbortSignal;
  /** Injectable frame reader for the publication proofs (see `ReadProcessFrame`). */
  readFrame?: ReadProcessFrame;
  /** Injectable owner liveness probe for the publication proofs (see
   * `NativeTerminalOwnerHostProbe`): tests record its calls so the absence of
   * a probe is OBSERVED, not inferred from a verdict. */
  ownerProbe?: NativeTerminalOwnerHostProbe;
  /**
   * Invoked when a post-listen net.Server error leaves the listener unable
   * (or unproven) to serve; the server itself has already stopped accepting.
   * The standalone host process wires this to its graceful stop (exit 3 for
   * an unclassifiable failure, a clean exit for a known-unusable listener).
   * Recoverable transport errors never reach this callback.
   */
  onListenerFailure?: (failure: NativeTerminalListenerFailure) => void;
}): Promise<NativeTerminalHostServer> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new NativeTerminalPublicationRefusal("H2A_SOCKET_PUBLICATION_TIMEOUT")),
    SOCKET_PUBLICATION_LOCK_TIMEOUT_MS);
  const signal = options.signal === undefined ? deadline.signal : AbortSignal.any([options.signal, deadline.signal]);
  try {
    return await initializeNativeTerminalHostServer({ ...options, signal });
  } finally { clearTimeout(timer); }
}

async function initializeNativeTerminalHostServer(options: {
  socketPath: string;
  host: NativeTerminalHost;
  signal: AbortSignal;
  readFrame?: ReadProcessFrame;
  ownerProbe?: NativeTerminalOwnerHostProbe;
  onListenerFailure?: (failure: NativeTerminalListenerFailure) => void;
}): Promise<NativeTerminalHostServer> {
  options.signal?.throwIfAborted();
  if (!isAbsolute(options.socketPath)) throw new Error("terminal host socket path must be absolute");
  await abortable(ensurePrivateSocketDirectory(options.socketPath), options.signal);

  const sockets = new Set<Socket>();
  const responseBudget: ResponseQueueBudget = { pendingBytes: 0 };
  let readyForRequests = false;
  let listenerExhaustionEvents: number[] = [];
  const server: Server = createServer((socket) => {
    // A successful accept breaks the consecutive failure series (R7 v5).
    listenerExhaustionEvents = [];
    if (sockets.size >= NATIVE_TERMINAL_MAX_CONNECTIONS) {
      socket.destroy();
      return;
    }
    // A visible socket is not yet a completed publication: its durable owner
    // record and publication lock must finish before health/PTY admission.
    if (!readyForRequests) socket.pause();
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
      // R7.5 named exemption: expected, potentially high-volume transport
      // errors. Count per connection instead of producing a log per event.
      recordHostFault(HOST_FAULT_COUNTERS.hostSocketConnectionErrors);
    });
    socket.on("data", (chunk: string) => {
      try {
        consumeFrames(options.host, context, chunk);
      } catch {
        // R7.5 named exemption: a bad client costs only this connection;
        // count frame destroys instead of logging every malformed stream.
        recordHostFault(HOST_FAULT_COUNTERS.hostClientFrameDestroys);
        socket.destroy();
      }
    });
    socket.on("close", () => {
      releaseAllPendingResponses(context);
      releaseConnectionLeases(options.host, context);
      sockets.delete(socket);
    });
  });
  // bind(2) retains this literal path in /proc/net/unix. Resolve its directory
  // before binding so it agrees with the retained directory FD even if an
  // ancestor symlink is later removed. Keep the published path and grammar.
  const stagedPath = stagingSocketPath(join(realpathSync(dirname(options.socketPath)), basename(options.socketPath)));
  let directoryFd: number | undefined;
  const closeDirectory = () => {
    if (directoryFd !== undefined) { closeSync(directoryFd); directoryFd = undefined; }
  };
  let ownedSocket: NativeTerminalSocketIdentity | undefined;
  // Assigned once the published close is built; the listener-failure handler
  // (installed before that object exists) tears the server down through it.
  let closePublished: ((closeOptions?: { stopSessions?: boolean; signal?: string }) => Promise<void>) | undefined;
  let initializationFailure: NativeTerminalListenerFailure | undefined;
  try {
    // Keep the real directory inode observable through /proc/<pid>/fd even
    // after its pathname is deleted. The bind name and staging grammar stay
    // compatible with older readers; no private-state census is introduced.
    directoryFd = openSync(dirname(stagedPath), constants.O_RDONLY | constants.O_DIRECTORY);
    await abortable(new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(stagedPath, () => {
        server.removeListener("error", reject);
        resolve();
      });
    }), options.signal);
    // The listener that turned listen()-path errors into a rejected startup
    // is gone by design; without a replacement, any error surfacing on the
    // net.Server AFTER listen would be an unhandled `error` event — an
    // uncaughtException that kills the host (the 2026-10-10/11 crash-loop's
    // class of failure). This durable handler CLASSIFIES instead of
    // absorbing everything (R7):
    // - recoverable transport errors (accept/connection side): log + survive;
    // - a known-unusable listener: log + stop serving + clean exit path;
    // - anything unclassifiable: log + stop serving + let the wired owner
    //   exit non-zero (exit 3) — the supervisor's bounded respawn owns it.
    // Per-connection transport errors stay on each socket's own handler.
    server.on("error", (error) => {
      const errno = (error as NodeJS.ErrnoException).code;
      if (errno !== undefined && RECOVERABLE_LISTENER_ERRNOS.has(errno)) {
        listenerExhaustionEvents = [];
        recordHostFault(HOST_FAULT_COUNTERS.serverListenerErrorRecoverable);
        writeHostLogLine(`terminal host listener recovered from a transport error (${errno}, contained): ${String(error)}`);
        return;
      }
      // fd exhaustion on the accept path is survivable while it clears; the
      // v5 R7 persistence predicate promotes it to a known-unusable listener.
      if (errno !== undefined && EXHAUSTED_LISTENER_ERRNOS.has(errno)) {
        const now = Date.now();
        listenerExhaustionEvents.push(now);
        listenerExhaustionEvents = listenerExhaustionEvents.filter(
          (at) => now - at < LISTENER_EXHAUSTION_WINDOW_MS,
        );
        if (listenerExhaustionEvents.length >= LISTENER_EXHAUSTION_PERSISTENCE_THRESHOLD) {
          writeHostLogLine(`terminal host listener accept path is persistently exhausted (${listenerExhaustionEvents.length} ${errno} within ${LISTENER_EXHAUSTION_WINDOW_MS}ms); stopping`);
          listenerExhaustionEvents = [];
          escalateListenerFailure({ kind: "unusable", errno, error });
          return;
        }
        recordHostFault(HOST_FAULT_COUNTERS.serverListenerErrorExhausted);
        writeHostLogLine(`terminal host listener accept path exhausted (${errno}, contained while it clears; ${listenerExhaustionEvents.length}/${LISTENER_EXHAUSTION_PERSISTENCE_THRESHOLD} in the window): ${String(error)}`);
        return;
      }
      const kind: "unusable" | "unknown" =
        errno !== undefined && UNUSABLE_LISTENER_ERRNOS.has(errno) ? "unusable" : "unknown";
      escalateListenerFailure({ kind, errno, error });
    });
    const escalateListenerFailure = (failure: NativeTerminalListenerFailure): void => {
      recordHostFault(failure.kind === "unusable"
        ? HOST_FAULT_COUNTERS.serverListenerErrorUnusable
        : HOST_FAULT_COUNTERS.serverListenerErrorUnknown);
      const label = failure.kind === "unknown" ? "unknown listener error" : "unusable listener error";
      writeHostLogLine(`${label} (${failure.errno ?? "no errno"}): ${String(failure.error)}; stopping`);
      if (options.onListenerFailure !== undefined) {
        options.onListenerFailure(failure);
        return;
      }
      if (closePublished === undefined) {
        initializationFailure = failure;
        return;
      }
      // Library default: no owner owns the process exit — stop serving
      // (sessions, sockets, publication rollback) without crashing the caller.
      closePublished?.({ stopSessions: true }).catch(() => {
        // The failure is already logged and counted; teardown errors must not
        // turn a contained listener failure into an unhandled rejection.
      });
    };
    // Capture the listener's inode before any publication await can suspend.
    ownedSocket = lstatSync(stagedPath);
    if (!sameNativeTerminalSocket(fstatSync(directoryFd), statSync(dirname(stagedPath)))) {
      throw new Error("terminal host socket directory changed during bind");
    }
    await abortable(chmod(stagedPath, 0o600), options.signal);
    await withSocketPublicationLock(
      options.socketPath,
      async (signal) => {
        try {
          signal.throwIfAborted();
          const frame = readPublicationFrame(options.readFrame ?? readProcessFrame);
          const published = await publishSocket(stagedPath, options.socketPath, signal,
            frame, options.ownerProbe ?? defaultOwnerHostProbe);
          await recordEndpointOwner(options.socketPath, published, undefined, signal,
            frame);
          return published;
        } catch (pubError) {
          // A link may have committed without resolving its promise. Invalidate
          // its source first, then remove only this listener's published inode.
          unlinkOwnedPath(stagedPath, ownedSocket!);
          rollbackEndpoint(options.socketPath, ownedSocket!);
          throw pubError;
        }
      },
      options.signal,
    );
    if (initializationFailure !== undefined) {
      throw new Error(initializationFailure.kind === "unknown" ? "unknown listener error" : "unusable listener error");
    }
  } catch (error) {
    try {
      for (const socket of sockets) socket.destroy();
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      if (ownedSocket !== undefined) {
        unlinkOwnedPath(stagedPath, ownedSocket);
        rollbackEndpoint(options.socketPath, ownedSocket);
      }
      await abortable(closed, AbortSignal.timeout(SOCKET_PUBLICATION_CLEANUP_TIMEOUT_MS));
    } finally { closeDirectory(); }
    throw error;
  }
  readyForRequests = true;
  for (const socket of sockets) socket.resume();
  let closing: Promise<void> | undefined;

  const doClose = (closeOptions: { stopSessions?: boolean; signal?: string } = {}): Promise<void> => {
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
      await abortable(new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      }), AbortSignal.timeout(SOCKET_PUBLICATION_CLEANUP_TIMEOUT_MS));
      await withSocketPublicationLock(options.socketPath, async () => {
        try {
          rollbackEndpoint(options.socketPath, ownedSocket!);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      });
      if (stopError !== undefined) throw stopError;
    })().finally(closeDirectory);
    return closing;
  };
  closePublished = doClose;

  return Object.freeze({
    socketPath: options.socketPath,
    server,
    close: doClose,
  });
}
