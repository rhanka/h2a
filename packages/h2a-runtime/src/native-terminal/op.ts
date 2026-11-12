#!/usr/bin/env node
/**
 * One-shot synchronous-facing operations against the native terminal host.
 *
 * The h2a session verbs are synchronous (they shell out to the `tmux` binary
 * with spawnSync). The native host speaks an async unix-socket protocol, so
 * this entrypoint plays the role tmux's binary plays: one process invocation =
 * one operation, JSON on stdout, exit 0/1. `native-host.ts` execFileSync's it.
 *
 * Operations (argv[2]):
 *   ensure-host                       -> {hostPid, generation, socketPath}
 *   list                              -> {sessions: [...]}
 *   state   --id X                    -> session state
 *   probe   --id X                    -> {verdict: live|dead|unknown, ...}
 *                                     3-state liveness; classifies IN-BAND
 *                                     (exit 0) so a caller never reads a
 *                                     generic failure as proof of death
 *   create  --id X --cwd D [--cols N --rows N] [--env-file F] -- cmd args...
 *   drive   --target I --b64 TEXT      resolve a native session and submit TEXT
 *   write   --id X --b64 TEXT         raw keystrokes (base64, controller-scoped)
 *   paste   --id X --b64 TEXT         ONE bracketed-paste block (tmux paste -p twin)
 *   enter   --id X                    submit (CR)
 *   capture --id X [--bytes N]        -> {text} ANSI-stripped tail of the stream
 *   pid     --id X                    -> {pid}
 *   kill    --id X [--signal S]       stop the session (escalates to SIGKILL)
 *   kill-if-incarnation --id X --generation G --incarnation I
 *                                     fenced owner stop for explicit restart
 *   attach  --id X [--takeover]       interactive raw bridge on this terminal
 *                                     (detach: Ctrl-\\ ; exits when session exits)
 *   host-stop                         SIGTERM the host process (sessions stop)
 */
import { existsSync, readFileSync, readlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { NativeTerminalClient, NativeTerminalRequestTimeoutError } from "./client.js";
import { loadRegistry, registryEntriesForNativeTarget } from "../registry.js";
import {
  NATIVE_TERMINAL_INTERACTIVE_READ_TIMEOUT_MS,
  NATIVE_TERMINAL_HEALTH_TIMEOUT_MS,
  NATIVE_TERMINAL_PROTOCOL_VERSION,
  NativeTerminalRemoteError,
} from "./protocol.js";
import type {
  NativeTerminalControllerLease,
  NativeTerminalSessionState,
} from "./host.js";
import { NativeTerminalHostSupervisor } from "./supervisor.js";
import { proveNativeTerminalEndpointAbsent, withNativeTerminalStartupLock } from "./server.js";
import { defaultNativeTerminalSocketPath, knownNativeTerminalSocketPaths,
  inspectPrivateNativeTerminalSocket, sameNativeTerminalSocket } from "./socket-path.js";
import { collectNativeInventory, publicationContenderObserved, readNativeTerminalSuccessor, resolveNativeOwner, type NativeInventory } from "./fleet.js";
import { renderTerminalScreen } from "./screen.js";
import { TerminalModeTracker } from "./terminal-modes.js";
import { publishAttachReset } from "./attach-recovery.js";
import { TerminalResetRelay } from "./reset-relay.js";
import { appendCrashLog, crashSignalName, installCrashHandlers, type CrashLogEntry } from "../crash-log.js";
import type {
  NativeStatusBarLinkState,
  NativeStatusBarSnapshot,
  ReadNativeStatusBarOptions,
} from "../status-projection.js";

const DETACH_BYTE = 0x1c; // Ctrl-\

/**
 * Build the crash-log record for an observed session exit. Only observed
 * values are recorded: `exitCode` comes from the session's exit report and
 * `signal` from the stop order (`stopSignal`) or the pty exit signal. Either
 * field is omitted when unknown — never defaulted to 0/1.
 */
export function sessionExitCrashEntry(
  state: Pick<NativeTerminalSessionState, "exit" | "stopSignal">,
  options: { sessionId: string; reason?: string | undefined; detail?: string | undefined },
): CrashLogEntry {
  const exitCode = state.exit?.exitCode;
  const signal = state.stopSignal ?? crashSignalName(state.exit?.signal ?? undefined);
  return {
    event: "sessionExit",
    sessionId: options.sessionId,
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.detail ? { detail: options.detail } : {}),
    ...(typeof exitCode === "number" && Number.isSafeInteger(exitCode) ? { exitCode } : {}),
    ...(signal ? { signal } : {}),
  };
}

type Parsed = {
  op: string;
  flags: Map<string, string>;
  command: string[];
};

function parseArgv(argv: ReadonlyArray<string>): Parsed {
  const op = argv[2];
  if (!op) throw new Error("missing operation");
  const flags = new Map<string, string>();
  const command: string[] = [];
  let index = 3;
  for (; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--") {
      command.push(...argv.slice(index + 1));
      break;
    }
    if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`);
    if (arg === "--takeover") {
      flags.set("takeover", "true");
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${arg} requires a value`);
    flags.set(arg.slice(2), value);
    index += 1;
  }
  return { op, flags, command };
}

function required(parsed: Parsed, name: string): string {
  const value = parsed.flags.get(name);
  if (value === undefined) throw new Error(`--${name} is required`);
  return value;
}

function emitResult(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export function stripAnsi(text: string): string {
  return text
    .replace(/\][^]*(?:|\\)/g, "")
    .replace(/\[\d+G/g, " ")
    .replace(/\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/[78=>]/g, "")
    .replace(/\r/g, "");
}

function socketPathFromEnv(): string {
  const override = process.env["H2A_NATIVE_SOCKET"];
  return override !== undefined && override.length > 0
    ? override
    : defaultNativeTerminalSocketPath();
}

// Every opened client is tracked so the entrypoint can close them on EVERY
// exit path. A client left open after a failed request keeps the event loop
// alive: the op prints its error but never exits, and the synchronous caller
// only learns about it through a 15s ETIMEDOUT.
const openClients = new Set<NativeTerminalClient>();

export function closeAllNativeTerminalOpClients(): void {
  for (const client of openClients) client.close();
  openClients.clear();
}

async function connectExisting(socketPath: string, tracked = true, signal?: AbortSignal): Promise<NativeTerminalClient> {
  signal?.throwIfAborted();
  const identity = await inspectPrivateNativeTerminalSocket(socketPath);
  signal?.throwIfAborted();
  const client = await NativeTerminalClient.connect(socketPath);
  if (tracked) openClients.add(client);
  const abort = () => client.close();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    const ping = await client.ping();
    if (ping.protocolVersion !== NATIVE_TERMINAL_PROTOCOL_VERSION || !ping.generation?.trim() ||
      !Number.isSafeInteger(ping.hostPid) || ping.hostPid <= 0 ||
      !sameNativeTerminalSocket(identity, await inspectPrivateNativeTerminalSocket(socketPath))) {
      throw new Error("native host identity changed or handshake is invalid");
    }
  } catch (error) { client.close(); openClients.delete(client); throw error; }
  finally { signal?.removeEventListener("abort", abort); }
  return client;
}

class NativeOwnerError extends Error {
  constructor(readonly refusal: { code: string; id: string; reason?: string; sockets?: string[] }) {
    super(`native session ${refusal.id}: ${refusal.code}${refusal.reason ? ` (${refusal.reason})` : ""}`);
  }
}

async function inventoryFor(parsed: Parsed): Promise<NativeInventory> {
  const pinned = parsed.flags.get("socket");
  return collectNativeInventory(pinned ? [pinned] : knownNativeTerminalSocketPaths(), connectExisting, proveNativeTerminalEndpointAbsent);
}

/** Same three-state proof for in-process callers and the one-shot probe.
 * Own these connections locally: an async caller must close them even when
 * another endpoint makes the inventory incomplete. */
export async function probeNativeSession(id: string, socketPath?: string, ensureHost = false) {
  // A run may prepare its host before the read-only guards. Otherwise every
  // relauncher first queues multiple absence proofs, delaying the publisher
  // until those same callers' publication/readiness budgets expire.
  if (ensureHost) {
    const client = socketPath ? await launchClient(socketPath) : (await selectLaunchClient(true)).client;
    client.close();
    openClients.delete(client);
  }
  const inventory = await collectNativeInventory(socketPath ? [socketPath] : knownNativeTerminalSocketPaths(),
    path => connectExisting(path, false), proveNativeTerminalEndpointAbsent);
  try {
    const owner = resolveNativeOwner(id, inventory);
    if (owner.state === "found") return { verdict: owner.session.status === "running" ? "live" : "dead",
      state: { ...owner.session, socketPath: owner.socketPath } };
    if (owner.state === "absent") return { verdict: "dead" };
    return { verdict: "unknown", code: owner.state,
      ...(owner.state === "unknown" ? { reason: owner.reason } : { sockets: owner.sockets, reason: "ambiguous-owner" }) };
  } finally {
    for (const host of inventory.hosts) host.client?.close();
  }
}

async function owningClient(parsed: Parsed, id: string): Promise<{ client: NativeTerminalClient; socketPath: string }> {
  const owner = resolveNativeOwner(id, await inventoryFor(parsed));
  if (owner.state !== "found") throw new NativeOwnerError({ code: owner.state, id,
    ...(owner.state === "unknown" ? { reason: owner.reason } : {}),
    ...(owner.state === "ambiguous-owner" ? { sockets: owner.sockets } : {}) });
  return owner;
}

async function selectLaunchClient(fenced: boolean): Promise<{ client: NativeTerminalClient; socketPath: string }> {
  const paths = knownNativeTerminalSocketPaths();
  const imposed = process.env["H2A_NATIVE_SOCKET"];
  if (imposed) {
    const client = await launchClient(imposed);
    // An imposed endpoint can never silently redirect, even when its mate is
    // available. Capability certification is performed by the caller.
    return { client, socketPath: imposed };
  }
  const historical = paths[0]!;
  const client = await launchClient(historical);
  try {
    const ping = await client.ping();
    if (!fenced || paths.length === 1) return { client, socketPath: historical };
    const compatible = paths[1]!;
    // Initialize the second known endpoint so admission obtains a complete
    // inventory even when the historical host already provides the fence.
    const second = await launchClient(compatible);
    const unused = ping.launchFence === true ? second : client;
    unused.close();
    openClients.delete(unused);
    return ping.launchFence === true ? { client, socketPath: historical } : { client: second, socketPath: compatible };
  } catch (error) { client.close(); openClients.delete(client); throw error; }
}

async function launchClient(socketPath: string): Promise<NativeTerminalClient> {
  let failure: unknown;
  try { return await connectExisting(socketPath); }
  catch (error) { failure = error; }
  try {
    return await withNativeTerminalStartupLock(socketPath, () => launchClientUnderLock(socketPath, failure),
      signal => connectExisting(socketPath, true, signal));
  } catch (error) {
    // Election expiry is contention, just like publication-lock expiry. The
    // elected publisher can finish as our acquisition deadline expires. Spend
    // the existing successor-health budget on read-only adoption; never use
    // this failure as an absence proof or permission to spawn another host.
    if ((error as Error)?.name === "TimeoutError" || publicationContenderObserved(error)) {
      const successorSignal = AbortSignal.timeout(NATIVE_TERMINAL_HEALTH_TIMEOUT_MS);
      try { return await readNativeTerminalSuccessor(() => connectExisting(socketPath, true, successorSignal), true); }
      catch { /* Preserve the original fail-closed election diagnostic. */ }
    }
    throw error;
  }
}

async function launchClientUnderLock(socketPath: string, error: unknown): Promise<NativeTerminalClient> {
  let absent = false;
  let publisherObserved = false;
  // Launch-only reclamation: inventories never remove the stale inode.
  try { absent = await proveNativeTerminalEndpointAbsent(socketPath, error, undefined, undefined, true); }
  catch (proofError) {
    publisherObserved = publicationContenderObserved(proofError);
    error = new Error(`${error instanceof Error ? error.message : String(error)}; absence proof failed: ${proofError instanceof Error ? proofError.message : String(proofError)}`);
  }
  if (absent) return ensureClient(socketPath);
  // Publication may have completed while the absence proof held/waited for
  // its lock. A fresh handshake can adopt that winner without any takeover.
  try { return await readNativeTerminalSuccessor(() => connectExisting(socketPath), publisherObserved); }
  catch { /* Still uncertain: retain the original proof failure below. */ }
  throw Object.assign(new Error(`${socketPath}: ${error instanceof Error ? error.message : String(error)}; owner death is unproven. Inspect endpoint permissions and the owning process identity, restore probe access, then retry; do not remove a socket or lock while ownership is unproven.`), { socketPath });
}

async function ensureClient(socketPath: string): Promise<NativeTerminalClient> {
  const supervisor = new NativeTerminalHostSupervisor({
    socketPath,
    replayBytesPerSession: 4 * 1024 * 1024,
  });
  const client = await supervisor.client();
  openClients.add(client);
  return client;
}

async function withController<T>(
  client: NativeTerminalClient,
  id: string,
  action: (lease: NativeTerminalControllerLease) => Promise<T>,
): Promise<T> {
  const lease = await client.acquireController(id, `h2a-op-${process.pid}`);
  try {
    return await action(lease);
  } finally {
    await client.releaseController(lease).catch(() => {});
  }
}

async function readAll(client: NativeTerminalClient, id: string): Promise<string> {
  const replay = await client.readOutput(id, 0);
  return replay.chunks.map((chunk) => chunk.data).join("");
}

const NATIVE_DRIVE_ACTIVITY_WINDOW_MS = 4_000;

function nativeDriveActivityWindowMs(): number {
  const raw = process.env["H2A_WAKE_DEFER_ACTIVITY_MS"];
  if (raw !== undefined) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return NATIVE_DRIVE_ACTIVITY_WINDOW_MS;
}

/**
 * Resolve the perennial instance address first, then its human-facing label,
 * through the runtime registry. The registry owns the native session name;
 * guessing a h2a-<slug> name here could inject into a homonymous session.
 */
type NativeDriveSessionResolution =
  | { readonly state: "found"; readonly id: string }
  | { readonly state: "unresolved" }
  | { readonly state: "unknown" };

function nativeDriveSessionId(target: string): NativeDriveSessionResolution {
  const registry = loadRegistry();
  if (registry.state !== "ok") return { state: "unknown" };
  const labels = [target];
  const hostSeparator = target.indexOf(":");
  if (hostSeparator > 0 && hostSeparator < target.length - 1) {
    labels.push(target.slice(hostSeparator + 1));
  }
  const sessions = new Set<string>();
  let matches = 0;
  let hasUnknownSessionId = false;
  for (const label of labels) {
    for (const entry of registryEntriesForNativeTarget(label, registry.entries)) {
      matches += 1;
      if (entry.tmuxSession === undefined) hasUnknownSessionId = true;
      else sessions.add(entry.tmuxSession);
    }
  }
  if (matches === 0) return { state: "unresolved" };
  if (hasUnknownSessionId || sessions.size !== 1) return { state: "unknown" };
  return { state: "found", id: [...sessions][0]! };
}

function nativeDriveInstruction(text: string): string | undefined {
  // The PTY write appends the one submit CR below. Reject every embedded
  // control/format character (including CR, LF, escape, and Unicode line
  // separators) so an instruction can never add a second line or sequence.
  if (text.length === 0 || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(text)) return undefined;
  return text;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

type NativeTerminalAttachClient = Pick<
  NativeTerminalClient,
  | "readOutput"
  | "state"
  | "acquireController"
  | "releaseController"
  | "write"
  | "resize"
  | "close"
>;

export type NativeTerminalAttachRuntime = {
  connect(): Promise<NativeTerminalAttachClient>;
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  now(): number;
  delay(ms: number): Promise<void>;
  onResize(listener: () => void): void;
  offResize(listener: () => void): void;
  onTerminate?(listener: () => void): void;
  offTerminate?(listener: () => void): void;
  saveTerminalReset?(sequence: string): void;
};

const ATTACH_STATE_POLL_MS = 1_000;
const ATTACH_STATE_POLL_MAX_MS = 16_000;
const ATTACH_ACTIVE_POLL_MS = 100;
const ATTACH_IDLE_POLL_MIN_MS = 100;
const ATTACH_IDLE_POLL_MAX_MS = 500;
const ATTACH_RECONNECT_MIN_MS = 100;
const ATTACH_RECONNECT_MAX_MS = 2_000;
const ATTACH_PENDING_INPUT_MAX_BYTES = 64 * 1024;

function defaultAttachRuntime(socketPath: string): NativeTerminalAttachRuntime {
  const signals = { SIGTERM: 15, SIGHUP: 1, SIGINT: 2, SIGQUIT: 3 } as const;
  const handlers = new Map<NodeJS.Signals, () => void>();
  return {
    // runAttach owns and closes every reconnecting client. Keeping these
    // long-lived clients in the one-shot op registry would retain each closed
    // connection until the user eventually detaches.
    connect: () => connectExisting(socketPath, false),
    stdin: process.stdin,
    stdout: process.stdout,
    now: () => Date.now(),
    delay,
    onResize: (listener) => process.on("SIGWINCH", listener),
    offResize: (listener) => process.removeListener("SIGWINCH", listener),
    saveTerminalReset: publishAttachReset,
    onTerminate: (listener) => {
      for (const [signal, number] of Object.entries(signals)) {
        const handler = () => { listener(); process.exit(128 + number); };
        handlers.set(signal as NodeJS.Signals, handler);
        process.on(signal, handler);
      }
      process.on("exit", listener);
      // Observe the fatal path without suppressing Node's error/exit behavior.
      process.on("uncaughtExceptionMonitor", listener);
    },
    offTerminate: (listener) => {
      for (const [signal, handler] of handlers) process.removeListener(signal, handler);
      handlers.clear();
      process.removeListener("exit", listener);
      process.removeListener("uncaughtExceptionMonitor", listener);
    },
  };
}

function isDefinitiveNativeTerminalAbsence(error: unknown): boolean {
  if (
    error instanceof NativeTerminalRemoteError &&
    error.message.includes("unknown terminal session")
  ) {
    return true;
  }
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ECONNREFUSED";
}

function isStateRequestTimeout(error: unknown): boolean {
  return (
    error instanceof NativeTerminalRequestTimeoutError ||
    (error instanceof Error && error.name === "NativeTerminalRequestTimeoutError")
  );
}

type ActiveAttachConnection = {
  client: NativeTerminalAttachClient;
  lease: NativeTerminalControllerLease;
};

export type NativeAttachStatusBarOptions = Omit<
  ReadNativeStatusBarOptions,
  "sessionName" | "linkState" | "nowMs"
> & {
  readonly enabled?: boolean;
  readonly env?: NodeJS.ProcessEnv;
};

const STATUS_BAR_MIN_ROWS = 10;
const STATUS_BAR_REFRESH_MIN_MS = 1_000;
const MAX_PENDING_SEQ_LEN = 4_096;
// Amber/orange background (#7C2D12) with warm light foreground (#FEF3C7), plus 256-color fallback.
const AMBER_BAR_SGR =
  "\x1b[48;5;166;38;5;231;48;2;124;45;18;38;2;254;243;199m";

interface HeadlessAttrData {
  isAttributeDefault(): boolean;
  isBold(): number | boolean;
  isDim(): number | boolean;
  isItalic(): number | boolean;
  isUnderline(): number | boolean;
  isBlink(): number | boolean;
  isInverse(): number | boolean;
  isInvisible(): number | boolean;
  isStrikethrough(): number | boolean;
  isOverline(): number | boolean;
  isFgRGB(): boolean;
  isFgPalette(): boolean;
  getFgColorMode(): number;
  getFgColor(): number;
  isBgRGB(): boolean;
  isBgPalette(): boolean;
  getBgColorMode(): number;
  getBgColor(): number;
  hasExtendedAttrs(): number | boolean;
  getUnderlineStyle(): number;
  isUnderlineColorDefault(): boolean;
  isUnderlineColorRGB(): boolean;
  isUnderlineColorPalette(): boolean;
  getUnderlineColor(): number;
}

interface HeadlessCellData extends HeadlessAttrData {
  getChars(): string;
  getWidth(): number;
}

interface HeadlessBufferLine {
  getCell(x: number): HeadlessCellData | undefined;
}

interface HeadlessInternalBuffer {
  x: number;
  y: number;
  ybase: number;
  scrollTop: number;
  scrollBottom: number;
}

interface HeadlessTerminal {
  readonly cols: number;
  readonly rows: number;
  readonly buffer: {
    readonly active: {
      readonly type: "normal" | "alternate";
      getLine(y: number): HeadlessBufferLine | undefined;
    };
  };
  readonly _core: {
    readonly _bufferService: {
      readonly buffer: HeadlessInternalBuffer;
      readonly buffers: {
        readonly normal: HeadlessInternalBuffer;
        readonly alt: HeadlessInternalBuffer;
      };
    };
    readonly coreService: {
      readonly modes: { readonly insertMode: boolean };
      readonly decPrivateModes: { readonly origin: boolean };
    };
    readonly _inputHandler: {
      readonly _curAttrData: HeadlessAttrData;
      parse(data: string): void;
    };
  };
  resize(cols: number, rows: number): void;
  reset(): void;
  dispose(): void;
}

type HeadlessTerminalConstructor = new (options: {
  cols: number;
  rows: number;
  scrollback: number;
  allowProposedApi: boolean;
}) => HeadlessTerminal;

function sgrSequenceFromAttr(attr: HeadlessAttrData): string {
  if (attr.isAttributeDefault()) return "";
  const codes: string[] = [];
  if (attr.isBold()) codes.push("1");
  if (attr.isDim()) codes.push("2");
  if (attr.isItalic()) codes.push("3");
  if (attr.isUnderline()) {
    const style = attr.hasExtendedAttrs() ? attr.getUnderlineStyle() : 1;
    codes.push(style > 1 ? `4:${style}` : "4");
  }
  if (attr.isBlink()) codes.push("5");
  if (attr.isInverse()) codes.push("7");
  if (attr.isInvisible()) codes.push("8");
  if (attr.isStrikethrough()) codes.push("9");
  if (attr.isOverline()) codes.push("53");
  if (attr.isFgRGB()) {
    const c = attr.getFgColor();
    codes.push(`38;2;${(c >>> 16) & 0xff};${(c >>> 8) & 0xff};${c & 0xff}`);
  } else if (attr.isFgPalette()) {
    const c = attr.getFgColor();
    if (attr.getFgColorMode() === 0x1000000 && c >= 0 && c < 16) {
      codes.push(String(c < 8 ? 30 + c : 90 + (c - 8)));
    } else {
      codes.push(`38;5;${c}`);
    }
  }
  if (attr.isBgRGB()) {
    const c = attr.getBgColor();
    codes.push(`48;2;${(c >>> 16) & 0xff};${(c >>> 8) & 0xff};${c & 0xff}`);
  } else if (attr.isBgPalette()) {
    const c = attr.getBgColor();
    if (attr.getBgColorMode() === 0x1000000 && c >= 0 && c < 16) {
      codes.push(String(c < 8 ? 40 + c : 100 + (c - 8)));
    } else {
      codes.push(`48;5;${c}`);
    }
  }
  if (attr.hasExtendedAttrs() && !attr.isUnderlineColorDefault()) {
    const c = attr.getUnderlineColor();
    if (attr.isUnderlineColorRGB()) {
      codes.push(`58;2;${(c >>> 16) & 0xff};${(c >>> 8) & 0xff};${c & 0xff}`);
    } else if (attr.isUnderlineColorPalette()) {
      codes.push(`58;5;${c}`);
    }
  }
  return codes.length > 0 ? `\x1b[${codes.join(";")}m` : "";
}

class NativeStatusBarController {
  readonly #id: string;
  readonly #stdout: NodeJS.WriteStream;
  readonly #now: () => number;
  readonly #opts: NativeAttachStatusBarOptions;
  readonly #optionEnabled: boolean;
  readonly #isTty: boolean;
  #featureEnabled = false;
  #initialized = false;
  #probeInFlight: Promise<void> | undefined;
  #readSnapshot:
    | ((opts: ReadNativeStatusBarOptions) => Promise<NativeStatusBarSnapshot>)
    | undefined;
  #renderLine:
    | ((snapshot: NativeStatusBarSnapshot, cols: number) => string)
    | undefined;
  #xtermCtor: HeadlessTerminalConstructor | undefined;
  #headless: HeadlessTerminal | undefined;

  #linkState: NativeStatusBarLinkState = "attached";
  #snapshot: NativeStatusBarSnapshot;
  #lastProbeAt: number | undefined;
  #wasActive = false;
  #activeRows = 0;
  #activeCols = 0;
  #lastRenderedLine = "";
  #needsRepaint = true;
  #pendingRegionReapply = false;
  #restored = false;
  #pendingSeq = "";

  constructor(
    id: string,
    stdout: NodeJS.WriteStream,
    now: () => number,
    option?: boolean | NativeAttachStatusBarOptions,
  ) {
    this.#id = id;
    this.#stdout = stdout;
    this.#now = now;
    this.#opts = typeof option === "object" && option !== null ? option : {};
    this.#optionEnabled = option !== false && this.#opts.enabled !== false;
    this.#isTty = (stdout as { isTTY?: boolean }).isTTY === true;
    this.#snapshot = {
      cli: "unknown",
      sessionName: id,
      linkState: "attached",
      role: "unknown",
      workload: {
        j: { open: 0, attention: 0, degraded: true },
        i: { waiting: 0, degraded: true },
        l: { active: 0, attention: 0, degraded: true },
      },
      delegatedSessions: "unknown",
      gateway: { state: "unknown", clientSessionId: id },
    };
  }

  isActive(): boolean {
    const rows = this.#stdout.rows ?? 0;
    const cols = this.#stdout.columns ?? 0;
    return (
      this.#featureEnabled &&
      this.#isTty &&
      rows >= STATUS_BAR_MIN_ROWS &&
      cols > 0
    );
  }

  childRows(): number | undefined {
    const rows = this.#stdout.rows;
    if (!rows) return undefined;
    return this.isActive() ? rows - 1 : rows;
  }

  #ensureHeadless(cols: number, childRows: number): HeadlessTerminal | undefined {
    if (!this.#xtermCtor) return undefined;
    if (!this.#headless) {
      this.#headless = new this.#xtermCtor({
        cols,
        rows: childRows,
        scrollback: 0,
        allowProposedApi: true,
      });
    } else if (
      this.#headless.cols !== cols ||
      this.#headless.rows !== childRows
    ) {
      this.#headless.resize(cols, childRows);
    }
    return this.#headless;
  }

  async probe(
    force = false,
    linkState?: NativeStatusBarLinkState,
  ): Promise<void> {
    const linkChanged =
      linkState !== undefined && linkState !== this.#linkState;
    if (linkState !== undefined) {
      this.#linkState = linkState;
      this.#snapshot = { ...this.#snapshot, linkState };
    }
    if (!this.#optionEnabled || !this.#isTty) return;
    if (!this.#initialized) {
      this.#initialized = true;
      const [{ isStatusBarEnabled }, statusProjection, xtermMod] =
        await Promise.all([
          import("../config.js"),
          import("../status-projection.js"),
          import("@xterm/headless"),
        ]);
      const xterm = (xtermMod.default ?? xtermMod) as unknown as {
        Terminal: HeadlessTerminalConstructor;
      };
      this.#readSnapshot = statusProjection.readNativeStatusBarSnapshot;
      this.#renderLine = statusProjection.renderNativeStatusBarLine;
      this.#xtermCtor = xterm.Terminal;
      this.#featureEnabled = isStatusBarEnabled(this.#opts.env ?? process.env);
    }
    if (!this.#featureEnabled || !this.#readSnapshot) return;
    if (!this.isActive()) {
      this.paint(linkChanged);
      return;
    }
    const nowMs = this.#now();
    const due =
      force ||
      this.#lastProbeAt === undefined ||
      nowMs - this.#lastProbeAt >= STATUS_BAR_REFRESH_MIN_MS;
    if (due) {
      this.#lastProbeAt = nowMs;
      const runRead = async (): Promise<void> => {
        try {
          this.#snapshot = await this.#readSnapshot!({
            ...this.#opts,
            sessionName: this.#id,
            linkState: this.#linkState,
            nowMs,
          });
        } catch {
          this.#snapshot = { ...this.#snapshot, linkState: this.#linkState };
        }
      };
      if (force) {
        await runRead();
      } else if (!this.#probeInFlight) {
        this.#probeInFlight = runRead().finally(() => {
          this.#probeInFlight = undefined;
          this.paint(false);
        });
        await this.#probeInFlight;
        return;
      }
    }
    if (linkChanged || due) {
      this.paint(linkChanged);
    }
  }

  onResize(): void {
    this.paint(true);
  }

  flushAfterOutputBatch(): void {
    if (this.#needsRepaint && this.#pendingSeq.length === 0) {
      this.paint(false);
    }
  }

  flushPendingSequence(): string {
    if (this.#pendingSeq.length === 0) return "";
    const pending = this.#pendingSeq;
    this.#pendingSeq = "";
    return pending;
  }

  resumeAfterReset(): void {
    this.#restored = false;
    this.#pendingSeq = "";
    this.#lastRenderedLine = "";
    this.#needsRepaint = true;
    this.#pendingRegionReapply = false;
    this.#headless?.reset();
    this.paint(true);
  }

  dispose(): void {
    this.#headless?.dispose();
    this.#headless = undefined;
  }

  peekRestoreSequence(): string {
    if (!this.#wasActive || this.#restored) return "";
    const rows = this.#activeRows || (this.#stdout.rows ?? 24);
    const cols = this.#activeCols || (this.#stdout.columns ?? 80);
    const headless = this.#headless;
    const inAltScreen =
      headless !== undefined && headless.buffer.active.type === "alternate";
    if (inAltScreen && headless) {
      const normalBuf = headless._core._bufferService.buffers.normal;
      const mainRow = Math.min(rows, Math.max(1, normalBuf.y + 1));
      const mainCol = Math.min(cols, Math.max(1, normalBuf.x + 1));
      return `\x1b[?6l\x1b[r\x1b[${rows};1H\x1b[2K\x1b[?1049l\x1b[?1047l\x1b[?47l\x1b[?6l\x1b[r\x1b[${rows};1H\x1b[2K\x1b[${mainRow};${mainCol}H\x1b[0m`;
    }
    const activeBuf = headless?._core._bufferService.buffer;
    const row = Math.min(rows, Math.max(1, (activeBuf?.y ?? 0) + 1));
    const col = Math.min(cols, Math.max(1, (activeBuf?.x ?? 0) + 1));
    return `\x1b[?6l\x1b[r\x1b[${rows};1H\x1b[2K\x1b[${row};${col}H\x1b[0m`;
  }

  restoreSequence(): string {
    const seq = this.peekRestoreSequence();
    if (!seq) return "";
    this.#restored = true;
    this.#pendingRegionReapply = false;
    return seq;
  }

  #restoreStateFromHeadless(cols: number, childRows: number): string {
    const headless = this.#headless;
    if (!headless) return "\x1b[1;1H\x1b[0m";
    const core = headless._core;
    const buf = core._bufferService.buffer;
    const originMode = core.coreService.decPrivateModes.origin === true;
    const insertMode = core.coreService.modes.insertMode === true;
    const activeSgr = sgrSequenceFromAttr(core._inputHandler._curAttrData);
    const top = Math.min(childRows - 1, Math.max(1, buf.scrollTop + 1));
    const row = Math.min(childRows, Math.max(1, buf.y + 1));
    const col = Math.min(cols, Math.max(1, buf.x + 1));
    const targetRow = originMode ? Math.max(1, row - top + 1) : row;
    const originPrefix = originMode ? "\x1b[?6h" : "";

    if (buf.x >= cols && !insertMode) {
      const line = headless.buffer.active.getLine(buf.ybase + buf.y);
      if (line) {
        let startCol = cols;
        let cell = line.getCell(cols - 1);
        if (cell && cell.getWidth() === 0 && cols >= 2) {
          startCol = cols - 1;
          cell = line.getCell(cols - 2);
        }
        if (cell) {
          const chars = cell.getChars();
          const glyph = chars.length > 0 ? chars : " ";
          const cellSgr = sgrSequenceFromAttr(cell);
          return `${originPrefix}\x1b[${targetRow};${startCol}H\x1b[0m${cellSgr}${glyph}\x1b[0m${activeSgr}`;
        }
      }
    }
    return `${originPrefix}\x1b[${targetRow};${col}H\x1b[0m${activeSgr}`;
  }

  #reapplyScrollRegionAndState(cols: number, childRows: number): string {
    const buf = this.#headless?._core._bufferService.buffer;
    const top = Math.min(childRows - 1, Math.max(1, (buf?.scrollTop ?? 0) + 1));
    const bottom = Math.min(
      childRows,
      Math.max(top + 1, (buf?.scrollBottom ?? childRows - 1) + 1),
    );
    return `\x1b[?6l\x1b[${top};${bottom}r${this.#restoreStateFromHeadless(cols, childRows)}`;
  }

  #flushPendingRegionReapply(cols: number, childRows: number): string {
    if (!this.#pendingRegionReapply) return "";
    this.#pendingRegionReapply = false;
    return this.#reapplyScrollRegionAndState(cols, childRows);
  }

  paint(force = false): void {
    if (this.#restored) return;
    if (this.#pendingSeq.length > 0) {
      this.#needsRepaint = true;
      return;
    }
    if (!this.isActive()) {
      this.#pendingRegionReapply = false;
      if (this.#wasActive && this.#activeRows >= STATUS_BAR_MIN_ROWS) {
        const currentRows = this.#stdout.rows ?? 1;
        const currentCols = this.#stdout.columns ?? 1;
        const buf = this.#headless?._core._bufferService.buffer;
        const activeSgr = this.#headless
          ? sgrSequenceFromAttr(this.#headless._core._inputHandler._curAttrData)
          : "";
        const targetRow = Math.min(
          Math.max(1, currentRows),
          Math.max(1, (buf?.y ?? 0) + 1),
        );
        const targetCol = Math.min(
          Math.max(1, currentCols),
          Math.max(1, (buf?.x ?? 0) + 1),
        );
        // Only clear the previous status row if the terminal did not shrink past it;
        // otherwise \x1b[activeRows;1H\x1b[2K clamps to the new bottom row and erases the child's last line.
        const clearOldBar =
          this.#activeRows <= currentRows
            ? `\x1b[${this.#activeRows};1H\x1b[2K`
            : "";
        this.#stdout.write(
          `\x1b[?6l\x1b[r${clearOldBar}\x1b[${targetRow};${targetCol}H\x1b[0m${activeSgr}`,
        );
        this.#wasActive = false;
        this.#lastRenderedLine = "";
        this.#needsRepaint = true;
      }
      return;
    }

    const rows = this.#stdout.rows!;
    const cols = this.#stdout.columns!;
    const childRows = rows - 1;
    const headless = this.#ensureHeadless(cols, childRows);
    const rowsChanged = !this.#wasActive || rows !== this.#activeRows;
    const geometryChanged = rowsChanged || cols !== this.#activeCols;
    let clearPreviousRow = "";
    if (geometryChanged) {
      if (
        this.#wasActive &&
        this.#activeRows !== rows &&
        this.#activeRows > 0 &&
        this.#activeRows < rows
      ) {
        clearPreviousRow = `\x1b[${this.#activeRows};1H\x1b[2K`;
      }
      this.#wasActive = true;
      this.#activeRows = rows;
      this.#activeCols = cols;
      this.#needsRepaint = true;
    }

    if (!this.#renderLine) return;
    const line = this.#renderLine(this.#snapshot, cols);
    if (
      !force &&
      !this.#needsRepaint &&
      !geometryChanged &&
      line === this.#lastRenderedLine
    ) {
      return;
    }

    this.#lastRenderedLine = line;
    this.#needsRepaint = false;
    this.#pendingRegionReapply = false;
    const buf = headless?._core._bufferService.buffer;
    const top = Math.min(childRows - 1, Math.max(1, (buf?.scrollTop ?? 0) + 1));
    const bottom = Math.min(
      childRows,
      Math.max(top + 1, (buf?.scrollBottom ?? childRows - 1) + 1),
    );
    const restoreSeq = this.#restoreStateFromHeadless(cols, childRows);
    this.#stdout.write(
      `${clearPreviousRow}\x1b[?6l\x1b[${top};${bottom}r\x1b[${rows};1H${AMBER_BAR_SGR}${line}\x1b[0m${restoreSeq}`,
    );
  }

  transformChildOutput(data: string): string {
    if (!this.isActive()) {
      if (this.#pendingSeq.length > 0) {
        const flushed = this.#pendingSeq + data;
        this.#pendingSeq = "";
        return flushed;
      }
      return data;
    }
    if (data.length === 0) return data;
    const input = this.#pendingSeq.length > 0 ? this.#pendingSeq + data : data;
    this.#pendingSeq = "";
    const rows = this.#stdout.rows!;
    const cols = this.#stdout.columns!;
    const childRows = rows - 1;
    const headless = this.#ensureHeadless(cols, childRows);
    if (!headless) return input;
    const ih = headless._core._inputHandler;
    let out = "";
    let i = 0;
    while (i < input.length) {
      const ch = input[i]!;
      if (ch === "\x1b") {
        if (i + 1 >= input.length) {
          this.#pendingSeq = input.slice(i);
          break;
        }
        const next = input[i + 1]!;
        if (next === "[") {
          let j = i + 2;
          while (
            j < input.length &&
            input.charCodeAt(j) >= 0x30 &&
            input.charCodeAt(j) <= 0x3f
          ) {
            j += 1;
          }
          const params = input.slice(i + 2, j);
          const intStart = j;
          while (
            j < input.length &&
            input.charCodeAt(j) >= 0x20 &&
            input.charCodeAt(j) <= 0x2f
          ) {
            j += 1;
          }
          const intermediates = input.slice(intStart, j);
          if (j >= input.length) {
            if (input.length - i <= MAX_PENDING_SEQ_LEN) {
              this.#pendingSeq = input.slice(i);
              break;
            }
            ih.parse(input.slice(i));
            out += input.slice(i);
            break;
          }
          if (
            input.charCodeAt(j) >= 0x40 &&
            input.charCodeAt(j) <= 0x7e
          ) {
            const final = input[j]!;
            const rawSeq = input.slice(i, j + 1);
            out += this.#processCsi(
              headless,
              params,
              intermediates,
              final,
              rawSeq,
              childRows,
              cols,
            );
            i = j + 1;
            continue;
          }
          ih.parse("\x1b[");
          out += "\x1b[";
          i += 2;
          continue;
        } else if (
          next === "]" ||
          next === "P" ||
          next === "X" ||
          next === "^" ||
          next === "_"
        ) {
          let j = i + 2;
          let closed = false;
          while (j < input.length) {
            const c = input[j]!;
            if (next === "]" && c === "\x07") {
              j += 1;
              closed = true;
              break;
            }
            if (c === "\x9c") {
              j += 1;
              closed = true;
              break;
            }
            if (c === "\x1b") {
              if (j + 1 >= input.length) {
                break;
              }
              if (input[j + 1] === "\\") {
                j += 2;
                closed = true;
                break;
              }
            }
            j += 1;
          }
          if (!closed && input.length - i <= MAX_PENDING_SEQ_LEN) {
            this.#pendingSeq = input.slice(i);
            break;
          }
          const rawSeq = input.slice(i, j);
          ih.parse(rawSeq);
          out += rawSeq;
          i = j;
          continue;
        } else if (next.charCodeAt(0) >= 0x20 && next.charCodeAt(0) <= 0x2f) {
          let j = i + 2;
          while (
            j < input.length &&
            input.charCodeAt(j) >= 0x20 &&
            input.charCodeAt(j) <= 0x2f
          ) {
            j += 1;
          }
          if (j >= input.length) {
            if (input.length - i <= MAX_PENDING_SEQ_LEN) {
              this.#pendingSeq = input.slice(i);
              break;
            }
            ih.parse(input.slice(i));
            out += input.slice(i);
            break;
          }
          const rawSeq = input.slice(i, j + 1);
          ih.parse(rawSeq);
          out += rawSeq;
          i = j + 1;
          continue;
        } else {
          const rawSeq = input.slice(i, i + 2);
          out += this.#processEsc(headless, next, rawSeq, childRows, cols);
          i += 2;
          continue;
        }
      }

      const codeUnit = input.charCodeAt(i);
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && i + 1 >= input.length) {
        this.#pendingSeq = input.slice(i);
        break;
      }
      const cp = input.codePointAt(i)!;
      const step = cp > 0xffff ? 2 : 1;
      const glyph = input.slice(i, i + step);
      if (cp !== 0x0d) {
        out += this.#flushPendingRegionReapply(cols, childRows);
      }
      const buf = headless._core._bufferService.buffer;
      const prevY = buf.y;
      const prevX = buf.x;
      const prevScrollBottom = buf.scrollBottom;
      ih.parse(glyph);
      if (prevY === childRows - 1 && prevScrollBottom < childRows - 1) {
        if (cp === 0x0a || cp === 0x0b || cp === 0x0c || cp === 0x84) {
          out +=
            prevX >= cols
              ? this.#restoreStateFromHeadless(cols, childRows)
              : "";
          i += step;
          continue;
        }
        if (cp === 0x85) {
          out += "\r";
          i += step;
          continue;
        }
        if (
          cp >= 0x20 &&
          !(cp >= 0x7f && cp <= 0x9f) &&
          prevX >= cols &&
          buf.x <= prevX
        ) {
          out += `\r${glyph}`;
          i += step;
          continue;
        }
      }
      out += glyph;
      i += step;
    }
    return out;
  }

  #processEsc(
    headless: HeadlessTerminal,
    next: string,
    rawSeq: string,
    childRows: number,
    cols: number,
  ): string {
    const prefix = this.#flushPendingRegionReapply(cols, childRows);
    const core = headless._core;
    const buf = core._bufferService.buffer;
    const prevY = buf.y;
    const prevX = buf.x;
    const prevScrollBottom = buf.scrollBottom;
    core._inputHandler.parse(rawSeq);
    if (next === "c") {
      this.#needsRepaint = true;
      this.#pendingRegionReapply = true;
      return `${prefix}${rawSeq}`;
    }
    if (next === "8") {
      return `${prefix}${rawSeq}${this.#restoreStateFromHeadless(cols, childRows)}`;
    }
    if (prevY === childRows - 1 && prevScrollBottom < childRows - 1) {
      if (next === "D") {
        return `${prefix}${
          prevX >= cols
            ? this.#restoreStateFromHeadless(cols, childRows)
            : ""
        }`;
      }
      if (next === "E") {
        return `${prefix}\r`;
      }
    }
    return `${prefix}${rawSeq}`;
  }

  #processCsi(
    headless: HeadlessTerminal,
    params: string,
    intermediates: string,
    final: string,
    rawSeq: string,
    childRows: number,
    cols: number,
  ): string {
    const isPassthroughModeCsi =
      intermediates === "" &&
      ((final === "u" && /^[<>]\d*$/.test(params)) ||
        ((final === "h" || final === "l") &&
          /^\?\d+(;\d+)*$/.test(params) &&
          !params
            .slice(1)
            .split(";")
            .some((m) => Number(m) === 6 || Number(m) === 1048)));
    const prefix = isPassthroughModeCsi
      ? ""
      : this.#flushPendingRegionReapply(cols, childRows);

    const core = headless._core;
    const prevBuf = core._bufferService.buffer;
    const prevY = prevBuf.y;
    const prevScrollBottom = prevBuf.scrollBottom;
    const prevOrigin = core.coreService.decPrivateModes.origin === true;

    core._inputHandler.parse(rawSeq);
    const buf = core._bufferService.buffer;

    if (intermediates === "!" && final === "p" && params === "") {
      this.#needsRepaint = true;
      this.#pendingRegionReapply = true;
      return `${prefix}${rawSeq}`;
    }
    if (intermediates !== "") return `${prefix}${rawSeq}`;

    const isStandardParams = !/^[<=>?]/.test(params);
    if (final === "r" && isStandardParams) {
      const parts = params.length === 0 ? [] : params.split(";");
      const rawTop = parts[0] ? Number.parseInt(parts[0], 10) : 1;
      const rawBottom =
        parts.length < 2 || !parts[1]
          ? childRows
          : Number.parseInt(parts[1], 10);
      const top = rawTop || 1;
      const bottom =
        !rawBottom || rawBottom > childRows ? childRows : rawBottom;
      if (bottom <= top) {
        return prefix;
      }
      this.#needsRepaint = true;
      this.#pendingRegionReapply = false;
      return `${prefix}\x1b[${buf.scrollTop + 1};${buf.scrollBottom + 1}r`;
    }

    if ((final === "H" || final === "f") && isStandardParams) {
      if (!prevOrigin) {
        const rawRow = Number.parseInt(params.split(";")[0] || "1", 10) || 1;
        if (rawRow > childRows) {
          return `${prefix}\x1b[${buf.y + 1};${buf.x + 1}${final}`;
        }
      }
      return `${prefix}${rawSeq}`;
    }

    if (final === "d" && isStandardParams) {
      if (!prevOrigin) {
        const rawRow = Number.parseInt(params || "1", 10) || 1;
        if (rawRow > childRows) {
          return `${prefix}\x1b[${buf.y + 1}d`;
        }
      }
      return `${prefix}${rawSeq}`;
    }

    if (
      (final === "B" || final === "e" || final === "E") &&
      isStandardParams
    ) {
      const n = Math.max(1, Number.parseInt(params || "1", 10) || 1);
      if ((prevY > prevScrollBottom || final === "e") && prevY + n >= childRows) {
        const maxDown = Math.max(0, buf.y - prevY);
        if (final === "E") {
          return `${prefix}${maxDown > 0 ? `\x1b[${maxDown}E` : "\r"}`;
        }
        return `${prefix}${maxDown > 0 ? `\x1b[${maxDown}${final}` : ""}`;
      }
      return `${prefix}${rawSeq}`;
    }

    if (final === "u" && params === "") {
      return `${prefix}${rawSeq}${this.#restoreStateFromHeadless(cols, childRows)}`;
    }

    if (final === "J" && (params === "" || /^\??\d+$/.test(params))) {
      const mode = Number.parseInt(params.replace(/^\?/, "") || "0", 10);
      if (mode === 0 || mode === 2 || mode === 3) {
        this.#needsRepaint = true;
        this.#pendingRegionReapply = true;
        return `${prefix}${rawSeq}`;
      }
      return `${prefix}${rawSeq}`;
    }

    if (
      (final === "h" || final === "l") &&
      /^\?\d+(;\d+)*$/.test(params)
    ) {
      const modes = params.slice(1).split(";").map(Number);
      if (modes.some((m) => m === 47 || m === 1047 || m === 1049)) {
        this.#needsRepaint = true;
        this.#pendingRegionReapply = true;
        return `${prefix}${rawSeq}`;
      }
      if (final === "l" && modes.includes(1048)) {
        return `${prefix}${rawSeq}${this.#restoreStateFromHeadless(cols, childRows)}`;
      }
      return `${prefix}${rawSeq}`;
    }

    return `${prefix}${rawSeq}`;
  }
}

/**
 * Follow one native PTY without owning its lifetime. A transport failure closes
 * only this observer/controller connection; the host-owned PTY is never stopped
 * or recreated. Reconnection resumes from the last rendered sequence number.
 */
export async function runAttach(
  id: string,
  runtime: NativeTerminalAttachRuntime = defaultAttachRuntime(socketPathFromEnv()),
  options: {
    takeover?: boolean;
    statusBar?: boolean | NativeAttachStatusBarOptions;
  } = {},
): Promise<number> {
  const stdin = runtime.stdin;
  const stdout = runtime.stdout;
  const statusBar = new NativeStatusBarController(
    id,
    stdout,
    () => runtime.now(),
    options.statusBar,
  );
  let modes = new TerminalModeTracker();
  let modesSuspended = false;
  let savedReset = "";
  const saveReset = (): void => {
    const reset = modesSuspended
      ? ""
      : `${statusBar.peekRestoreSequence()}${modes.resetSequence()}`;
    if (reset === savedReset) return;
    runtime.saveTerminalReset?.(reset);
    savedReset = reset;
  };
  const restoreBarForNotice = (): void => {
    const pending = statusBar.flushPendingSequence();
    const barRestore = statusBar.restoreSequence();
    const seq = `${pending}${barRestore}`;
    if (seq) stdout.write(seq);
  };
  const relayOutput = (data: string): void => {
    modes.feed(data);
    stdout.write(statusBar.transformChildOutput(data));
    saveReset();
  };
  // Older protocol-v1 hosts relay the wrapper marker verbatim. New hosts
  // consume it themselves so detached sessions also return to a clean shell.
  let resetRelay = new TerminalResetRelay(relayOutput, () => modes.resetSequence());
  const resetModes = (): void => {
    if (modesSuspended) return;
    modesSuspended = true;
    const pending = statusBar.flushPendingSequence();
    const barRestore = statusBar.restoreSequence();
    const reset = modes.resetSequence();
    const sequence = `${pending}${barRestore}${reset}`;
    if (!sequence) { saveReset(); return; }
    // Signals and fatal exits cannot wait for an asynchronous pipe flush.
    const fd = (stdout as NodeJS.WriteStream & { fd?: number }).fd;
    if (typeof fd === "number") writeSync(fd, sequence);
    else stdout.write(sequence);
    saveReset();
  };
  const isRawCapable = stdin.isTTY === true;
  const wasRaw = stdin.isRaw === true;
  let detached = false;
  let terminalEnded = false;
  let exitCode = 0;
  let active: ActiveAttachConnection | undefined;
  let transportFailure: unknown;
  let interruptedAt: number | undefined;
  let pendingInputBytes = 0;
  const pendingInput: Buffer[] = [];
  let inputPump: Promise<void> | undefined;
  let takeoverPending = options.takeover === true;
  let tty = "not-a-tty";
  try { tty = readlinkSync("/proc/self/fd/0"); } catch { /* Non-Linux terminal. */ }

  const controllerChanged = (state: NativeTerminalSessionState, lease: NativeTerminalControllerLease): boolean => {
    if (state.status === "exited" && !state.stopSignal) return false;
    if (state.generation === lease.generation && state.incarnation === lease.incarnation &&
        (state.controllerEpoch === undefined || state.controllerEpoch === lease.epoch)) return false;
    const reason = state.stopSignal ? `session stopped (${state.stopSignal})`
      : state.status === "exited" ? "session exited"
      : state.controller ? `controller taken over by pid=${state.controller.pid ?? "unknown"} tty=${state.controller.tty} since=${state.controller.since}`
      : "controller released or session replaced";
    restoreBarForNotice();
    stdout.write(`\r\n[h2a] ${reason}; attach detached\r\n`);
    exitCode = state.status === "exited" && !state.stopSignal ? state.exit?.exitCode ?? 0 : 0;
    if (state.status === "exited") appendCrashLog("attach", sessionExitCrashEntry(state, { sessionId: id, detail: reason }));
    else appendCrashLog("attach", { event: "refusal", sessionId: id, reason: "controller-changed", detail: reason });
    terminalEnded = true;
    return true;
  };

  const closeActive = (): void => {
    const current = active;
    active = undefined;
    current?.client.close();
  };
  const terminate = (): void => {
    detached = true;
    try { resetRelay.flush(); resetModes(); } finally {
      if (isRawCapable) stdin.setRawMode(wasRaw);
      stdin.pause();
      closeActive();
    }
  };
  runtime.onTerminate?.(terminate);

  const markTransportFailure = (
    connection: ActiveAttachConnection,
    error: unknown,
    inputDeliveryUncertain = false,
  ): void => {
    if (inputDeliveryUncertain && !detached) {
      appendCrashLog("attach", {
        event: "refusal",
        sessionId: id,
        reason: "input-delivery-uncertain",
        detail:
          "terminal input delivery became uncertain during reconnect; " +
          "the in-flight chunk was not replayed to avoid duplicate input",
      });
    }
    // A request from the previous socket may settle after recovery. Fence that
    // stale failure so it can never tear down the newly-acquired controller.
    if (active !== connection) return;
    if (error instanceof NativeTerminalRemoteError && error.message === "stale terminal controller lease") {
      restoreBarForNotice();
      stdout.write("\r\n[h2a] controller revoked by takeover or stop; attach detached\r\n");
      appendCrashLog("attach", { event: "refusal", sessionId: id, reason: "stale-controller-lease" });
      terminalEnded = true;
      closeActive();
      return;
    }
    if (transportFailure === undefined) {
      transportFailure = error;
      interruptedAt = runtime.now();
    }
    closeActive();
  };

  const pumpInput = (): void => {
    if (inputPump !== undefined || detached || active === undefined) return;
    inputPump = (async () => {
      while (!detached && pendingInput.length > 0) {
        const current = active;
        if (current === undefined) return;
        const chunk = pendingInput[0]!;
        try {
          await current.client.write(current.lease, chunk.toString("utf8"));
          pendingInput.shift();
          pendingInputBytes -= chunk.length;
        } catch (error) {
          // The host may have accepted the write before the response path
          // broke. Drop this ONE uncertain chunk with an explicit warning;
          // replaying it could duplicate a command. Later queued input stays
          // ordered and is delivered only after a fresh exclusive lease.
          pendingInput.shift();
          pendingInputBytes -= chunk.length;
          markTransportFailure(current, error, true);
          return;
        }
      }
    })().finally(() => {
      inputPump = undefined;
      if (!detached && active !== undefined && pendingInput.length > 0) {
        pumpInput();
      }
    });
  };

  const onInput = (value: Buffer | string): void => {
    const chunk = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value);
    if (chunk.includes(DETACH_BYTE)) {
      detached = true;
      closeActive();
      return;
    }
    if (pendingInputBytes + chunk.length > ATTACH_PENDING_INPUT_MAX_BYTES) {
      restoreBarForNotice();
      stdout.write(
        "\r\n[h2a] native attach input buffer full during reconnect; detaching " +
          "without stopping the session\r\n",
      );
      appendCrashLog("attach", { event: "refusal", sessionId: id, reason: "input-buffer-full" });
      detached = true;
      closeActive();
      return;
    }
    pendingInput.push(chunk);
    pendingInputBytes += chunk.length;
    pumpInput();
  };
  stdin.on("data", onInput);
  const onEnd = (): void => { detached = true; closeActive(); };
  stdin.on("end", onEnd);
  const sendChildResize = (): void => {
    const current = active;
    const rows = statusBar.childRows();
    if (current && stdout.columns && rows) {
      void current.client
        .resize(current.lease, stdout.columns, rows)
        .catch((error) => markTransportFailure(current, error));
    }
  };
  const resize = (): void => {
    sendChildResize();
    statusBar.onResize();
    saveReset();
  };
  runtime.onResize(resize);

  const connectAndAcquire = async (): Promise<NativeTerminalSessionState> => {
    const client = await runtime.connect();
    try {
      const state = await client.state(id);
      if (state.status === "exited") {
        client.close();
        return state;
      }
      const lease = await client.acquireController(
        id,
        `h2a-attach-${process.pid}`,
        "human",
        { takeover: takeoverPending, pid: process.pid, tty },
      );
      // A reconnect must never take the terminal back from a newer attach.
      takeoverPending = false;
      active = { client, lease };
      transportFailure = undefined;
      await statusBar.probe(true, "attached");
      sendChildResize();
      saveReset();
      pumpInput();
      return state;
    } catch (error) {
      client.close();
      throw error;
    }
  };

  // Paint the existing scrollback once, then follow the stream.
  let seq = 0;
  try {
    if (isRawCapable) stdin.setRawMode(true);
    stdin.resume();
    let initial: NativeTerminalSessionState;
    try {
      initial = await connectAndAcquire();
    } catch (error) {
      // Attaching to a provably absent session is an observed session end,
      // not a crash without a record. Anything else still throws.
      if (!isDefinitiveNativeTerminalAbsence(error)) throw error;
      appendCrashLog("attach", sessionExitCrashEntry(
        { exit: null, stopSignal: null },
        { sessionId: id, reason: "definitive-absence", detail: "session absent at attach; exit code unknown" },
      ));
      return 1;
    }
    if (initial.status === "exited") {
      appendCrashLog("attach", sessionExitCrashEntry(initial, { sessionId: id, detail: "session already exited at attach" }));
      return initial.exit?.exitCode ?? 0;
    }
    let idlePollMs = ATTACH_IDLE_POLL_MIN_MS;
    let statePollMs = ATTACH_STATE_POLL_MS;
    let nextStatePollAt = runtime.now() + statePollMs;

    for (;;) {
      if (detached || terminalEnded) break;

      if (active === undefined || transportFailure !== undefined) {
        const disconnectStartedAt = interruptedAt ?? runtime.now();
        const failureCause =
          transportFailure instanceof Error
            ? transportFailure.message
            : transportFailure !== undefined
              ? String(transportFailure)
              : "connection interrupted";
        const failureReason =
          transportFailure instanceof NativeTerminalRequestTimeoutError
            ? `timeout:${transportFailure.operation}`
            : "transport-interrupted";
        closeActive();
        await statusBar.probe(false, "reconnecting");
        let reconnectDelayMs = ATTACH_RECONNECT_MIN_MS;
        for (;;) {
          if (detached) break;
          try {
            const state = await connectAndAcquire();
            const durationMs = Math.max(0, runtime.now() - disconnectStartedAt);
            interruptedAt = undefined;
            if (state.status === "exited") {
              exitCode = state.exit?.exitCode ?? 0;
              appendCrashLog("attach", {
                ...sessionExitCrashEntry(state, {
                  sessionId: id,
                  detail: `session exited during reconnect after ${durationMs}ms (${failureCause})`,
                }),
                durationMs,
              });
              terminalEnded = true;
              break;
            }
            appendCrashLog("attach", {
              event: "reconnect",
              sessionId: id,
              instanceId: state.generation,
              reason: failureReason,
              durationMs,
              detail: `reconnected after ${durationMs}ms (${failureCause})`,
            });
            idlePollMs = ATTACH_IDLE_POLL_MIN_MS;
            statePollMs = ATTACH_STATE_POLL_MS;
            nextStatePollAt = runtime.now() + statePollMs;
            break;
          } catch (error) {
            const durationMs = Math.max(0, runtime.now() - disconnectStartedAt);
            if (error instanceof NativeTerminalRemoteError && error.message.includes("already has a controller")) {
              restoreBarForNotice();
              stdout.write(`\r\n[h2a] ${error.message}; attach detached\r\n`);
              appendCrashLog("attach", {
                event: "refusal",
                sessionId: id,
                reason: "already-has-controller",
                durationMs,
                detail: error.message,
              });
              terminalEnded = true;
              break;
            }
            if (isDefinitiveNativeTerminalAbsence(error)) {
              appendCrashLog("attach", {
                ...sessionExitCrashEntry(
                  { exit: null, stopSignal: null },
                  {
                    sessionId: id,
                    reason: "definitive-absence",
                    detail: `session proven absent during reconnect after ${durationMs}ms (${failureCause}); exit code unknown`,
                  },
                ),
                durationMs,
              });
              exitCode = 1;
              terminalEnded = true;
              break;
            }
            await runtime.delay(reconnectDelayMs);
            reconnectDelayMs = Math.min(
              ATTACH_RECONNECT_MAX_MS,
              reconnectDelayMs * 2,
            );
          }
        }
        if (terminalEnded) break;
        continue;
      }

      const current = active;
      try {
        const replay = await current.client.readOutput(
          id,
          seq,
          NATIVE_TERMINAL_INTERACTIVE_READ_TIMEOUT_MS,
        );
        if (detached) break;
        if (replay.gap) {
          resetModes();
          modes = new TerminalModeTracker();
          resetRelay = new TerminalResetRelay(relayOutput, () => modes.resetSequence());
          modesSuspended = false;
          statusBar.resumeAfterReset();
          if (replay.terminalModePrefix) {
            resetRelay.feed(replay.terminalModePrefix);
          }
        }
        for (const chunk of replay.chunks) {
          resetRelay.feed(chunk.data);
          seq = chunk.seq;
        }
        statusBar.flushAfterOutputBatch();
        await statusBar.probe(false);
        seq = replay.latestSeq;
        if (replay.chunks.length === 0) {
          await runtime.delay(idlePollMs);
          idlePollMs = Math.min(ATTACH_IDLE_POLL_MAX_MS, idlePollMs * 2);
        } else {
          idlePollMs = ATTACH_IDLE_POLL_MIN_MS;
          // A continuously busy PTY must still yield between snapshots. Without
          // this bound, a non-empty replay would turn the follow loop into a
          // tight local RPC spin under sustained model output.
          await runtime.delay(ATTACH_ACTIVE_POLL_MS);
        }
        if (replay.state !== undefined) {
          statePollMs = ATTACH_STATE_POLL_MS;
          nextStatePollAt = runtime.now() + statePollMs;
          if (controllerChanged(replay.state, current.lease)) break;
          if (replay.state.status === "exited") {
            exitCode = replay.state.exit?.exitCode ?? 0;
            appendCrashLog("attach", sessionExitCrashEntry(replay.state, { sessionId: id, detail: "session exited during attach" }));
            break;
          }
        } else if (runtime.now() >= nextStatePollAt) {
          let state: NativeTerminalSessionState | undefined;
          try {
            state = await current.client.state(id);
            statePollMs = ATTACH_STATE_POLL_MS;
            nextStatePollAt = runtime.now() + statePollMs;
          } catch (stateError) {
            // A slow state probe must not kill a live attachment while readOutput
            // is healthy; tolerate state timeouts with bounded backoff.
            if (!isStateRequestTimeout(stateError)) throw stateError;
            statePollMs = Math.min(ATTACH_STATE_POLL_MAX_MS, statePollMs * 2);
            nextStatePollAt = runtime.now() + statePollMs;
          }
          if (state !== undefined) {
            if (controllerChanged(state, current.lease)) break;
            if (state.status === "exited") {
              exitCode = state.exit?.exitCode ?? 0;
              appendCrashLog("attach", sessionExitCrashEntry(state, { sessionId: id, detail: "session exited during attach" }));
              break;
            }
          }
        }
      } catch (error) {
        if (detached) break;
        if (isDefinitiveNativeTerminalAbsence(error)) {
          appendCrashLog("attach", sessionExitCrashEntry(
            { exit: null, stopSignal: null },
            { sessionId: id, reason: "definitive-absence", detail: "session proven absent during attach; exit code unknown" },
          ));
          exitCode = 1;
          break;
        }
        markTransportFailure(current, error);
      }
    }
  } finally {
    try {
      resetRelay.flush();
      if (detached) {
        restoreBarForNotice();
        stdout.write("\r\n[h2a] detached from native session (session keeps running)\r\n");
      }
      resetModes();
    } finally {
      runtime.offTerminate?.(terminate);
      runtime.offResize(resize);
      stdin.removeListener("data", onInput);
      stdin.removeListener("end", onEnd);
      if (isRawCapable) stdin.setRawMode(wasRaw);
      stdin.pause();
      if (inputPump !== undefined) await inputPump.catch(() => {});
      const current = active;
      active = undefined;
      if (current !== undefined) {
        await current.client.releaseController(current.lease).catch(() => {});
        current.client.close();
      }
      statusBar.dispose();
    }
  }
  return exitCode;
}

export async function runNativeTerminalOp(
  argv: ReadonlyArray<string>,
  emit: (payload: unknown) => void = emitResult,
  signal?: AbortSignal,
  deadline = Infinity,
): Promise<number> {
  const checkDeadline = () => {
    signal?.throwIfAborted();
    if (Date.now() >= deadline) throw new Error("native host operation deadline exceeded");
  };
  checkDeadline();
  const parsed = parseArgv(argv);
  const socketPath = parsed.flags.get("socket") ?? socketPathFromEnv();

  switch (parsed.op) {
    case "ensure-host": {
      let selected: { client: NativeTerminalClient; socketPath: string };
      try {
        selected = parsed.flags.has("socket") ? { client: await connectExisting(socketPath), socketPath }
          : await selectLaunchClient(parsed.flags.get("fenced") === "true");
      } catch (error) {
        emit({ code: "native-inventory-unknown", hosts: [{ socketPath: (error as { socketPath?: string })?.socketPath ?? socketPath,
          reason: error instanceof Error ? error.message : String(error) }] });
        return 1;
      }
      const { client } = selected;
      const ping = await client.ping();
      client.close();
      emit({ hostPid: ping.hostPid, generation: ping.generation, socketPath: selected.socketPath, launchFence: ping.launchFence === true });
      return 0;
    }
    case "list": {
      const inventory = await inventoryFor(parsed);
      emit({ sessions: inventory.sessions, complete: inventory.complete,
        hosts: inventory.hosts.map(({ socketPath, reason, absent }) => ({ socketPath, reachable: !absent && reason === undefined, ...(absent ? { absent } : {}), ...(reason ? { reason } : {}) })) });
      return 0;
    }
    case "state": {
      const owner = await owningClient(parsed, required(parsed, "id"));
      const { client } = owner;
      const state = await client.state(required(parsed, "id"));
      client.close();
      emit({ ...state, socketPath: owner.socketPath });
      return 0;
    }
    case "probe": {
      // 3-state liveness probe (F2). Emits a VERDICT on exit 0 instead of a
      // generic nonzero exit, so the synchronous caller never has to guess
      // whether a failure meant "no session" or "the op broke":
      //  - live:    a reachable host answered and the session is running
      //  - dead:    every known reachable endpoint proves absence, or the
      //             owning endpoint reports an exited session
      //  - unknown: an incomplete inventory without a found owner; even
      //             transport errors without an independent owner-death proof.
      const id = required(parsed, "id");
      emit(await probeNativeSession(id, parsed.flags.get("socket")));
      return 0;
    }
    case "admit": {
      const inventory = await inventoryFor({ ...parsed, flags: new Map() });
      const ids = [required(parsed, "id"), parsed.flags.get("sidecar")].filter((id): id is string => !!id);
      const collision = inventory.sessions.find(session => ids.includes(session.id) &&
        (session.status !== "exited" || session.socketPath !== parsed.flags.get("launch-socket")));
      emit(collision ? { code: "native-name-collision", id: collision.id, socketPath: collision.socketPath }
        : !inventory.complete ? { code: "native-inventory-unknown", hosts: inventory.hosts.map(({ socketPath, reason }) => ({ socketPath, reason })) }
        : { admitted: true });
      return 0;
    }
    case "create": {
      const client = parsed.flags.has("socket") ? await connectExisting(socketPath) : await ensureClient(socketPath);
      const id = required(parsed, "id");
      if (parsed.flags.has("incarnation") || socketPath.endsWith("/native-terminal.lf1.sock")) {
        if (parsed.flags.has("incarnation") && (await client.ping()).launchFence !== true) throw new Error("selected native host does not provide launchFence");
        const inventory = await inventoryFor({ ...parsed, flags: new Map() });
        const ids = [id, ...(parsed.flags.has("sidecar") ? [required(parsed, "sidecar")]
          : !id.endsWith(".h2a") ? [`${id}.h2a`] : [])];
        if (!inventory.complete || inventory.sessions.some(session => ids.includes(session.id) &&
          (session.status !== "exited" || session.socketPath !== socketPath))) {
          throw new Error("native creation admission changed; refusing possible name collision");
        }
      }
      const cwd = required(parsed, "cwd");
      const cols = Number(parsed.flags.get("cols") ?? 160);
      const rows = Number(parsed.flags.get("rows") ?? 48);
      const envFile = parsed.flags.get("env-file");
      const env = envFile !== undefined
        ? (JSON.parse(readFileSync(envFile, "utf8")) as Record<string, string>)
        : Object.fromEntries(
            Object.entries(process.env).filter(
              (entry): entry is [string, string] => entry[1] !== undefined,
            ),
          );
      if (parsed.command.length === 0) throw new Error("create requires -- command");
      const state = await client.create({
        ...(parsed.flags.has("incarnation") ? { launchFence: {
          generation: required(parsed, "generation"), incarnation: required(parsed, "incarnation"),
        } } : {}),
        id,
        command: parsed.command[0]!,
        args: parsed.command.slice(1),
        cwd,
        env,
        cols,
        rows,
      });
      client.close();
      emit(state);
      return 0;
    }
    case "launch": {
      // R3 P1 single-fork fast path: ensure-host + admit + probe + create
      // share ONE client and ONE inventory in ONE Node process. Admission
      // and identity proofs stay under the host lock: an incomplete
      // inventory still refuses, and a fenced create re-checks admission
      // atomically like "create" does. Emits the host identity together
      // with the session state so callers skip their pid re-probes.
      const fenced = parsed.flags.has("incarnation") || parsed.flags.has("fenced");
      const selected = parsed.flags.has("socket")
        ? { client: await connectExisting(socketPath), socketPath }
        : await selectLaunchClient(fenced);
      const client = selected.client;
      const launchSocket = selected.socketPath;
      try {
        checkDeadline();
        const ping = await client.ping();
        if (fenced && ping.launchFence !== true) {
          emit({ code: "native-host-capability-mismatch", socketPath: launchSocket,
            hostPid: ping.hostPid, generation: ping.generation, launchFence: false });
          return 0;
        }
        const inventory = await inventoryFor({ ...parsed, flags: new Map() });
        const id = required(parsed, "id");
        const ids = [id, ...(parsed.flags.has("sidecar") ? [required(parsed, "sidecar")]
          : !id.endsWith(".h2a") ? [`${id}.h2a`] : [])];
        const collision = inventory.sessions.find(session => ids.includes(session.id) &&
          (session.status !== "exited" || session.socketPath !== launchSocket));
        if (collision) {
          emit({ code: "native-name-collision", id: collision.id, socketPath: collision.socketPath,
            hostPid: ping.hostPid, generation: ping.generation, launchFence: ping.launchFence === true });
          return 0;
        }
        if (!inventory.complete) {
          emit({ code: "native-inventory-unknown",
            hosts: inventory.hosts.map(({ socketPath: p, reason }) => ({ socketPath: p, reason })),
            hostPid: ping.hostPid, generation: ping.generation, launchFence: ping.launchFence === true });
          return 0;
        }
        const existing = inventory.sessions.find(session => session.id === id && session.status !== "exited" &&
          session.socketPath === launchSocket);
        if (existing && parsed.flags.get("refuse-existing") !== "true") {
          const { socketPath: _droppedSocket, ...existingRest } = existing;
          emit({ ...existingRest, hostPid: ping.hostPid, socketPath: launchSocket, generation: ping.generation,
            launchFence: ping.launchFence === true, adopted: true });
          return 0;
        }
        if (existing && parsed.flags.get("refuse-existing") === "true") {
          emit({ code: "native-name-collision", id: existing.id, socketPath: launchSocket,
            hostPid: ping.hostPid, generation: ping.generation, launchFence: ping.launchFence === true });
          return 0;
        }
        const cwd = required(parsed, "cwd");
        const cols = Number(parsed.flags.get("cols") ?? 160);
        const rows = Number(parsed.flags.get("rows") ?? 48);
        const envFile = parsed.flags.get("env-file");
        const env = envFile !== undefined
          ? (JSON.parse(readFileSync(envFile, "utf8")) as Record<string, string>)
          : Object.fromEntries(
              Object.entries(process.env).filter(
                (entry): entry is [string, string] => entry[1] !== undefined,
              ),
            );
        if (parsed.command.length === 0) throw new Error("launch requires -- command");
        checkDeadline();
        const state = await client.create({
          ...(parsed.flags.has("incarnation") ? { launchFence: {
            generation: required(parsed, "generation"), incarnation: required(parsed, "incarnation"),
          } } : {}),
          id,
          command: parsed.command[0]!,
          args: parsed.command.slice(1),
          cwd,
          env,
          cols,
          rows,
        });
        const { socketPath: _droppedStateSocket, generation: _droppedStateGeneration, ...stateRest } = state as Record<string, unknown>;
        emit({ ...stateRest, hostPid: ping.hostPid, socketPath: launchSocket, generation: ping.generation,
          launchFence: ping.launchFence === true });
        return 0;
      } finally {
        client.close();
      }
    }
    case "drive": {
      const target: NativeDriveSessionResolution = parsed.flags.has("id")
        ? { state: "found", id: required(parsed, "id") } : nativeDriveSessionId(required(parsed, "target"));
      if (target.state === "unresolved") {
        emit({ outcome: "unresolved" });
        return 0;
      }
      if (target.state === "unknown") {
        emit({ outcome: "deferred" });
        return 0;
      }
      const text = nativeDriveInstruction(
        Buffer.from(required(parsed, "b64"), "base64").toString("utf8"),
      );
      if (text === undefined) {
        emit({
          outcome: "failed",
          reason: "native drive instruction must be exactly one text line with no control characters",
        });
        return 0;
      }
      const { client } = await owningClient(parsed, target.id);
      try {
        let lease: NativeTerminalControllerLease;
        try {
          // This is one host-side operation. An older host that does not
          // support it rejects the request, which is deliberately deferred.
          lease = await client.acquireAutomationControllerIfNoRecentHuman(
            target.id,
            `h2a-drive-${process.pid}`,
            nativeDriveActivityWindowMs(),
          );
        } catch {
          emit({ outcome: "deferred" });
          return 0;
        }
        try {
          // One validated text line plus one submit CR: no bracketed-paste or
          // embedded controls can turn this into multiple terminal actions.
          await client.write(lease, `${text}\r`);
        } finally {
          await client.releaseController(lease).catch(() => {});
        }
      } finally {
        client.close();
      }
      emit({ outcome: "driven" });
      return 0;
    }
    case "write":
    case "paste": {
      const id = required(parsed, "id");
      const { client } = await owningClient(parsed, id);
      const text = Buffer.from(required(parsed, "b64"), "base64").toString("utf8");
      await withController(client, id, async (lease) => {
        if (parsed.op === "paste") {
          // Bracketed paste: the TUI receives ONE block (tmux paste-buffer -p twin).
          await client.write(lease, `[200~${text}[201~`);
        } else {
          await client.write(lease, text);
        }
      });
      client.close();
      emit({ ok: true });
      return 0;
    }
    case "enter": {
      const { client } = await owningClient(parsed, required(parsed, "id"));
      await withController(client, required(parsed, "id"), (lease) =>
        client.write(lease, "\r"),
      );
      client.close();
      emit({ ok: true });
      return 0;
    }
    case "capture": {
      const { client } = await owningClient(parsed, required(parsed, "id"));
      const raw = await readAll(client, required(parsed, "id"));
      client.close();
      const budget = Number(parsed.flags.get("bytes") ?? 16384);
      // Cutting/stripping the stream first loses cursor positioning, joins
      // words and retains erased startup/modal text. Inspect the drawn screen.
      emit({ text: (await renderTerminalScreen(raw)).slice(-budget) });
      return 0;
    }
    case "pid": {
      const { client } = await owningClient(parsed, required(parsed, "id"));
      const state = await client.state(required(parsed, "id"));
      client.close();
      emit({ pid: state.pid, status: state.status });
      return 0;
    }
    case "resize": {
      const id = required(parsed, "id");
      const { client } = await owningClient(parsed, id);
      await withController(client, id, lease => client.resize(lease, Number(required(parsed, "cols")), Number(required(parsed, "rows"))));
      emit({ ok: true });
      return 0;
    }
    case "stop":
    case "kill":
    case "stop-if-incarnation":
    case "kill-if-incarnation": {
      const id = required(parsed, "id");
      const { client } = await owningClient(parsed, id);
      const signal = parsed.flags.get("signal") ?? "SIGTERM";
      if (signal !== "SIGTERM" && signal !== "SIGKILL" && signal !== "SIGINT" && signal !== "SIGHUP") {
        throw new Error(`unsupported signal: ${signal}`);
      }
      const before = await client.state(id);
      const fenced = parsed.op.endsWith("-if-incarnation");
      const generation = fenced ? required(parsed, "generation") : before.generation;
      const incarnation = fenced ? required(parsed, "incarnation") : before.incarnation;
      if (before.generation !== generation) {
        appendCrashLog("cli", { event: "refusal", sessionId: id, instanceId: generation, reason: "stale-terminal-host-generation" });
        throw new Error("stale terminal host generation");
      }
      if (before.incarnation !== incarnation) {
        appendCrashLog("cli", { event: "refusal", sessionId: id, instanceId: generation, reason: "stale-terminal-session-incarnation" });
        throw new Error("stale terminal session incarnation");
      }
      if (before.status !== "exited") {
        await client.stopIfIncarnation(
          id,
          generation,
          incarnation,
          signal,
        );
        const deadline = Date.now() + 4_000;
        for (;;) {
          const state = await client.state(id);
          if (state.status === "exited") break;
          if (Date.now() >= deadline) {
            // Escalation stays fenced to the SAME preflight incarnation. If a
            // same-name replacement appeared, the host refuses instead of
            // killing it.
            await client.stopIfIncarnation(
              id,
              generation,
              incarnation,
              "SIGKILL",
            );
            await delay(300);
            break;
          }
          await delay(100);
        }
      }
      const after = await client.state(id);
      client.close();
      if (after.generation !== generation || after.incarnation !== incarnation) {
        appendCrashLog("cli", { event: "refusal", sessionId: id, instanceId: generation, reason: "incarnation-changed-while-stopping" });
        throw new Error("native session changed incarnation while stopping; replacement was not stopped");
      }
      if (after.status !== "exited") {
        appendCrashLog("cli", { event: "exit", sessionId: id, instanceId: generation, reason: "kill-escalation-failed", detail: `status=${after.status}` });
        throw new Error(`native session ${id} pid=${after.pid} did not exit after ${signal} and SIGKILL (status=${after.status})`);
      }
      appendCrashLog("cli", { event: "sessionExit", sessionId: id, instanceId: generation, reason: `killed-${signal}`, signal });
      emit(after);
      return 0;
    }
    case "attach": {
      const id = required(parsed, "id");
      let owner: Awaited<ReturnType<typeof owningClient>>;
      try {
        owner = await owningClient(parsed, id);
      } catch (error) {
        const refusal = error instanceof NativeOwnerError ? error.refusal : undefined;
        appendCrashLog("attach", { event: "refusal", sessionId: id, reason: refusal?.code ?? "owner-unproven", detail: refusal?.reason });
        throw error;
      }
      owner.client.close();
      // Reconnects retain this owner for the entire interactive operation.
      return runAttach(id, defaultAttachRuntime(owner.socketPath), { takeover: parsed.flags.get("takeover") === "true" });
    }
    case "host-stop": {
      let client: NativeTerminalClient;
      try {
        client = await connectExisting(socketPath);
      } catch {
        emit({ ok: true, note: "host was not running" });
        return 0;
      }
      const ping = await client.ping();
      client.close();
      process.kill(ping.hostPid, "SIGTERM");
      emit({ ok: true, hostPid: ping.hostPid });
      return 0;
    }
    default:
      throw new Error(`unknown native terminal operation: ${parsed.op}`);
  }
}

function isEntryPoint(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  try {
    return dirname(fileURLToPath(import.meta.url)) === dirname(argv1)
      ? import.meta.url === new URL(`file://${argv1}`).href
      : false;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  installCrashHandlers("cli");
  runNativeTerminalOp(process.argv)
    .then(
      (code) => {
        process.exitCode = code;
      },
      (error: unknown) => {
        if (error instanceof NativeOwnerError) emitResult(error.refusal);
        process.stderr.write(
          `[h2a-native-op] ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      },
    )
    .finally(() => {
      closeAllNativeTerminalOpClients();
    });
}
