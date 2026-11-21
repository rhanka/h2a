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
import { existsSync, readFileSync, readlinkSync } from "node:fs";
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
import {
  RightPanelController,
  buildRightPanelSnapshot,
  resolveRightPanelEnabled,
  resolveRightPanelWidth,
  type RightPanelSnapshot,
} from "./right-panel.js";
import {
  RightPanelSnapshotRefresher,
  TrackJournalCache,
  buildLiveRightPanelSnapshot,
  type BuildLiveRightPanelSnapshotOptions,
} from "./right-panel-snapshot.js";
import { readRemoteConfig } from "../config.js";
import { publishAttachReset } from "./attach-recovery.js";
import {
  ATTACH_PENDING_INPUT_MAX_BYTES,
  createSessionView,
  sessionExitCrashEntry,
  type NativeTerminalAttachClient,
} from "./session-view.js";
import { appendCrashLog, installCrashHandlers } from "../crash-log.js";
import type {
  NativeStatusBarLinkState,
  NativeStatusBarRightPanelMarker,
  NativeStatusBarSnapshot,
  ReadNativeStatusBarOptions,
} from "../status-projection.js";

export { sessionExitCrashEntry };

const DETACH_BYTE = 0x1c; // Ctrl-\

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

export type NativeAttachStatusBarOptions = Omit<
  ReadNativeStatusBarOptions,
  "sessionName" | "linkState" | "nowMs"
> & {
  readonly enabled?: boolean;
  readonly env?: NodeJS.ProcessEnv;
};

export type NativeAttachRightPanelOptions = {
  readonly enabled?: boolean;
  readonly width?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly snapshot?: RightPanelSnapshot;
  readonly loadSnapshot?: () => RightPanelSnapshot | Promise<RightPanelSnapshot>;
  readonly snapshotOptions?: Omit<
    BuildLiveRightPanelSnapshotOptions,
    "currentSessionId" | "seenDecisionKeys" | "nowMs"
  >;
  readonly refreshIntervalMs?: number;
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
      readonly decPrivateModes: {
        readonly origin: boolean;
        readonly wraparound?: boolean;
      };
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

type StatusBarRightPanelHost = {
  childCols(totalCols: number): number;
  isPaintActive(): boolean;
  isOpen(): boolean;
  paint(): void;
};

class NativeStatusBarController {
  readonly #id: string;
  readonly #stdout: NodeJS.WriteStream;
  readonly #now: () => number;
  readonly #opts: NativeAttachStatusBarOptions;
  readonly #optionEnabled: boolean;
  readonly #isTty: boolean;
  #rightPanel: StatusBarRightPanelHost | undefined;
  #onBeforeActivate: (() => void) | undefined;
  #featureEnabled = false;
  #initialized = false;
  #headlessInitialized = false;
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
  #panelDirty = false;
  #pendingRegionReapply = false;
  #restored = false;
  #pendingSeq = "";
  #lastGraphicChar = "";
  #rightPanelMarkerProvider:
    | (() => NativeStatusBarRightPanelMarker | undefined)
    | undefined;

  setRightPanelMarkerProvider(
    provider: (() => NativeStatusBarRightPanelMarker | undefined) | undefined,
  ): void {
    this.#rightPanelMarkerProvider = provider;
  }

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

  setRightPanel(panel: StatusBarRightPanelHost | undefined): void {
    this.#rightPanel = panel;
  }

  setOnBeforeActivate(cb: (() => void) | undefined): void {
    this.#onBeforeActivate = cb;
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

  #panelActive(): boolean {
    if (!this.#rightPanel || !this.#rightPanel.isPaintActive()) return false;
    const cols = this.#stdout.columns ?? 0;
    if (cols <= 0) return false;
    return this.#rightPanel.childCols(cols) < cols;
  }

  #containmentActive(): boolean {
    return this.isActive() || this.#panelActive();
  }

  #childCols(totalCols: number): number {
    if (!this.#panelActive()) return totalCols;
    return Math.max(1, this.#rightPanel!.childCols(totalCols));
  }

  childRows(): number | undefined {
    const rows = this.#stdout.rows;
    if (!rows) return undefined;
    return this.isActive() ? rows - 1 : rows;
  }

  onRightPanelGeometryChange(): void {
    const totalCols = this.#stdout.columns ?? 0;
    const totalRows = this.#stdout.rows ?? 0;
    if (totalCols > 0 && totalRows > 0 && this.#containmentActive()) {
      const childCols = this.#childCols(totalCols);
      const childRows = this.isActive() ? totalRows - 1 : totalRows;
      this.#ensureHeadless(childCols, childRows);
    }
    if (this.isActive()) {
      this.paint(true);
    }
  }

  restoreChildStateSequence(): string {
    const totalCols = this.#stdout.columns ?? 0;
    const totalRows = this.#stdout.rows ?? 0;
    if (totalCols <= 0 || totalRows <= 0) return "";
    const childCols = this.#childCols(totalCols);
    const childRows = this.isActive() ? totalRows - 1 : totalRows;
    return this.#restoreStateFromHeadless(childCols, childRows);
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

  async #ensureHeadlessCtor(): Promise<void> {
    if (this.#headlessInitialized) return;
    this.#headlessInitialized = true;
    const xtermMod = await import("@xterm/headless");
    const xterm = (xtermMod.default ?? xtermMod) as unknown as {
      Terminal: HeadlessTerminalConstructor;
    };
    this.#xtermCtor = xterm.Terminal;
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
    if (!this.#optionEnabled || !this.#isTty) {
      if (this.#rightPanel !== undefined) {
        await this.#ensureHeadlessCtor();
        const totalCols = this.#stdout.columns ?? 0;
        const totalRows = this.#stdout.rows ?? 0;
        if (totalCols > 0 && totalRows > 0 && this.#panelActive()) {
          this.#ensureHeadless(this.#childCols(totalCols), totalRows);
        }
      }
      return;
    }
    if (!this.#initialized) {
      this.#initialized = true;
      const [{ isStatusBarEnabled }, statusProjection] = await Promise.all([
        import("../config.js"),
        import("../status-projection.js"),
        this.#ensureHeadlessCtor(),
      ]);
      this.#readSnapshot = statusProjection.readNativeStatusBarSnapshot;
      this.#renderLine = statusProjection.renderNativeStatusBarLine;
      this.#featureEnabled = isStatusBarEnabled(this.#opts.env ?? process.env);
    }
    if (!this.#featureEnabled || !this.#readSnapshot) {
      if (this.#rightPanel !== undefined) {
        const totalCols = this.#stdout.columns ?? 0;
        const totalRows = this.#stdout.rows ?? 0;
        if (totalCols > 0 && totalRows > 0 && this.#panelActive()) {
          this.#ensureHeadless(this.#childCols(totalCols), totalRows);
        }
      }
      return;
    }
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
    const totalCols = this.#stdout.columns ?? 0;
    const totalRows = this.#stdout.rows ?? 0;
    if (totalCols > 0 && totalRows > 0 && this.#containmentActive()) {
      this.#ensureHeadless(
        this.#childCols(totalCols),
        this.isActive() ? totalRows - 1 : totalRows,
      );
    }
    this.paint(true);
  }

  flushAfterOutputBatch(): void {
    if (this.#pendingSeq.length > 0) return;
    if (this.#needsRepaint && this.isActive()) {
      this.paint(false);
    }
    if (this.#panelDirty && this.#panelActive()) {
      this.#panelDirty = false;
      this.#rightPanel!.paint();
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
    this.#panelDirty = this.#panelActive();
    this.#pendingRegionReapply = false;
    this.#lastGraphicChar = "";
    this.#headless?.reset();
    this.paint(true);
    if (this.#panelActive()) {
      this.#panelDirty = false;
      this.#rightPanel!.paint();
    }
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
    const totalCols = this.#stdout.columns ?? cols;
    const hasRightMargin = cols < totalCols;
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
    const insertSuffix = insertMode ? "\x1b[4h" : "";

    if (!hasRightMargin && buf.x >= cols && !insertMode) {
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
          return `${originPrefix}\x1b[${targetRow};${startCol}H\x1b[0m${cellSgr}${glyph}\x1b[0m${activeSgr}${insertSuffix}`;
        }
      }
    }
    return `${originPrefix}\x1b[${targetRow};${col}H\x1b[0m${activeSgr}${insertSuffix}`;
  }

  #reapplyScrollRegionAndState(cols: number, childRows: number): string {
    if (!this.isActive()) return "";
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
    const childCols = this.#childCols(cols);
    const childRows = rows - 1;
    const headless = this.#ensureHeadless(childCols, childRows);
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
    const panelMarker = this.#rightPanelMarkerProvider?.();
    const renderSnapshot = panelMarker
      ? { ...this.#snapshot, rightPanelMarker: panelMarker }
      : this.#snapshot;
    const line = this.#renderLine(renderSnapshot, cols);
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
    const restoreSeq = this.#restoreStateFromHeadless(childCols, childRows);
    const insertOff = this.#panelActive() ? "\x1b[4l" : "";
    // Publish the status-bar restore receipt BEFORE activating DECSTBM on stdout.
    this.#onBeforeActivate?.();
    this.#stdout.write(
      `${clearPreviousRow}\x1b[?6l${insertOff}\x1b[${top};${bottom}r\x1b[${rows};1H${AMBER_BAR_SGR}${line}\x1b[0m${restoreSeq}`,
    );
  }

  transformChildOutput(data: string): string {
    if (!this.#containmentActive()) {
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
    const totalCols = this.#stdout.columns!;
    const childCols = this.#childCols(totalCols);
    const childRows = this.isActive() ? rows - 1 : rows;
    const hasRightMargin = childCols < totalCols;
    const headless = this.#ensureHeadless(childCols, childRows);
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
              childCols,
              hasRightMargin,
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
          if (hasRightMargin && rawSeq === "\x1b#8") {
            this.#panelDirty = true;
          }
          out += rawSeq;
          i = j + 1;
          continue;
        } else {
          const rawSeq = input.slice(i, i + 2);
          out += this.#processEsc(
            headless,
            next,
            rawSeq,
            childRows,
            childCols,
            hasRightMargin,
          );
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
        out += this.#flushPendingRegionReapply(childCols, childRows);
      }
      const buf = headless._core._bufferService.buffer;
      const prevY = buf.y;
      const prevX = buf.x;
      const prevScrollTop = buf.scrollTop;
      const prevScrollBottom = buf.scrollBottom;
      const prevInsert = headless._core.coreService.modes.insertMode === true;
      ih.parse(glyph);

      if (this.isActive() && prevY === childRows - 1 && prevScrollBottom < childRows - 1) {
        if (cp === 0x0a || cp === 0x0b || cp === 0x0c || cp === 0x84) {
          out +=
            prevX >= childCols
              ? this.#restoreStateFromHeadless(childCols, childRows)
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
          prevX >= childCols &&
          buf.x <= prevX
        ) {
          this.#lastGraphicChar = glyph;
          out += `\r${glyph}`;
          if (hasRightMargin && buf.x >= childCols) {
            out += `\x1b[${childCols}G`;
          }
          i += step;
          continue;
        }
      }

      if (!hasRightMargin) {
        out += glyph;
        i += step;
        continue;
      }

      // Column-containment path (PANEL:182; outer terminal ignores ?69/DECSLRM).
      if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) {
        if (cp === 0x09) {
          out += `\x1b[${Math.min(childCols, buf.x + 1)}G`;
        } else if (cp === 0x08 && prevX >= childCols) {
          out += `\x1b[${Math.min(childCols, buf.x + 1)}G`;
        } else if (cp === 0x0a || cp === 0x0b || cp === 0x0c || cp === 0x84) {
          if (prevY === prevScrollBottom) this.#panelDirty = true;
          out += glyph;
          if (prevX >= childCols) {
            out += `\x1b[${Math.min(childCols, buf.x + 1)}G`;
          }
        } else if (cp === 0x85) {
          if (prevY === prevScrollBottom) this.#panelDirty = true;
          out += glyph;
        } else if (cp === 0x8d) {
          if (prevY === prevScrollTop) this.#panelDirty = true;
          out += glyph;
          if (prevX >= childCols) {
            out += `\x1b[${Math.min(childCols, buf.x + 1)}G`;
          }
        } else {
          out += glyph;
        }
        i += step;
        continue;
      }

      this.#lastGraphicChar = glyph;
      if (prevInsert) this.#panelDirty = true;

      if (prevX === childCols - 1 && buf.y === prevY && buf.x === prevX) {
        // Wide glyph at right boundary with autowrap disabled: clear boundary cell without writing glyph.
        out += `\x1b[${childCols}G\x1b[1X`;
      } else if (prevX >= childCols - 1 && (buf.y !== prevY || buf.x < prevX)) {
        // Autowrap occurred at childCols (either pending-wrap or wide glyph straddling boundary).
        if (prevX === childCols - 1) {
          out += `\x1b[${childCols}G\x1b[1X`;
        }
        if (prevY === prevScrollBottom) {
          this.#panelDirty = true;
          out += `\r\n${glyph}`;
        } else if (prevY === childRows - 1 && prevScrollBottom < childRows - 1) {
          out += `\r${glyph}`;
        } else {
          out += `\r\n${glyph}`;
        }
        if (buf.x >= childCols) {
          out += `\x1b[${childCols}G`;
        }
      } else if (prevX >= childCols && buf.y === prevY && buf.x >= childCols) {
        // Autowrap disabled at right boundary: overwrite last child cell and clamp cursor inside child area.
        out += `\x1b[${childCols}G${glyph}\x1b[${childCols}G`;
      } else {
        out += glyph;
        if (buf.x >= childCols) {
          out += `\x1b[${childCols}G`;
        }
      }
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
    hasRightMargin: boolean,
  ): string {
    const prefix = this.#flushPendingRegionReapply(cols, childRows);
    const core = headless._core;
    const buf = core._bufferService.buffer;
    const prevY = buf.y;
    const prevX = buf.x;
    const prevScrollTop = buf.scrollTop;
    const prevScrollBottom = buf.scrollBottom;
    core._inputHandler.parse(rawSeq);
    if (next === "c") {
      this.#needsRepaint = true;
      if (hasRightMargin) this.#panelDirty = true;
      this.#pendingRegionReapply = this.isActive();
      return `${prefix}${rawSeq}`;
    }
    if (next === "8") {
      return `${prefix}${rawSeq}${this.#restoreStateFromHeadless(cols, childRows)}`;
    }
    if (this.isActive() && prevY === childRows - 1 && prevScrollBottom < childRows - 1) {
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
    if (hasRightMargin) {
      if (next === "D") {
        if (prevY === prevScrollBottom) this.#panelDirty = true;
        return `${prefix}${rawSeq}${prevX >= cols ? `\x1b[${Math.min(cols, buf.x + 1)}G` : ""}`;
      }
      if (next === "E") {
        if (prevY === prevScrollBottom) this.#panelDirty = true;
        return `${prefix}${rawSeq}`;
      }
      if (next === "M") {
        if (prevY === prevScrollTop) this.#panelDirty = true;
        return `${prefix}${rawSeq}${prevX >= cols ? `\x1b[${Math.min(cols, buf.x + 1)}G` : ""}`;
      }
    }
    return `${prefix}${rawSeq}`;
  }

  #emitContainedRep(
    glyph: string,
    count: number,
    prevX: number,
    prevY: number,
    prevScrollBottom: number,
    childCols: number,
    childRows: number,
    wraparound: boolean,
  ): string {
    let out = "";
    let curX = prevX;
    let curY = prevY;
    let remaining = Math.min(count, 65535);
    while (remaining > 0) {
      if (curX >= childCols) {
        if (!wraparound) {
          out += `\x1b[${childCols}G${glyph}\x1b[${childCols}G`;
          return out;
        }
        if (curY === prevScrollBottom) {
          this.#panelDirty = true;
          out += "\r\n";
        } else if (curY === childRows - 1 && prevScrollBottom < childRows - 1) {
          out += "\r";
        } else {
          out += "\r\n";
          curY = Math.min(childRows - 1, curY + 1);
        }
        curX = 0;
      }
      const take = Math.min(remaining, childCols - curX);
      out += glyph.repeat(take);
      curX += take;
      remaining -= take;
    }
    if (curX >= childCols) {
      out += `\x1b[${childCols}G`;
    }
    return out;
  }

  #processCsi(
    headless: HeadlessTerminal,
    params: string,
    intermediates: string,
    final: string,
    rawSeq: string,
    childRows: number,
    cols: number,
    hasRightMargin: boolean,
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
    const prevX = prevBuf.x;
    const prevY = prevBuf.y;
    const prevScrollBottom = prevBuf.scrollBottom;
    const prevOrigin = core.coreService.decPrivateModes.origin === true;
    const prevInsert = core.coreService.modes.insertMode === true;
    const prevWraparound = core.coreService.decPrivateModes.wraparound !== false;

    core._inputHandler.parse(rawSeq);
    const buf = core._bufferService.buffer;

    if (intermediates === "!" && final === "p" && params === "") {
      this.#needsRepaint = true;
      if (hasRightMargin) this.#panelDirty = true;
      this.#pendingRegionReapply = this.isActive();
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
      if (this.isActive()) {
        this.#needsRepaint = true;
        this.#pendingRegionReapply = false;
        return `${prefix}\x1b[${buf.scrollTop + 1};${buf.scrollBottom + 1}r`;
      }
      return `${prefix}${rawSeq}`;
    }

    if ((final === "H" || final === "f") && isStandardParams) {
      const parts = params.split(";");
      const rawRow = Number.parseInt(parts[0] || "1", 10) || 1;
      const rawCol = Number.parseInt(parts[1] || "1", 10) || 1;
      const rowClamped = !prevOrigin && rawRow > childRows;
      const colClamped = hasRightMargin && rawCol > cols;
      if (rowClamped || colClamped) {
        const targetRow = prevOrigin
          ? Math.max(1, buf.y - buf.scrollTop + 1)
          : buf.y + 1;
        return `${prefix}\x1b[${targetRow};${Math.min(cols, buf.x + 1)}${final}`;
      }
      return `${prefix}${rawSeq}`;
    }

    if ((final === "G" || final === "`") && isStandardParams) {
      if (hasRightMargin) {
        const rawCol = Number.parseInt(params || "1", 10) || 1;
        if (rawCol > cols || prevX >= cols) {
          return `${prefix}\x1b[${Math.min(cols, buf.x + 1)}G`;
        }
      }
      return `${prefix}${rawSeq}`;
    }

    if ((final === "C" || final === "a") && isStandardParams) {
      if (hasRightMargin) {
        const n = Math.max(1, Number.parseInt(params || "1", 10) || 1);
        if (prevX + n >= cols || prevX >= cols) {
          return `${prefix}\x1b[${Math.min(cols, buf.x + 1)}G`;
        }
      }
      return `${prefix}${rawSeq}`;
    }

    if (final === "D" && isStandardParams) {
      if (hasRightMargin && prevX >= cols) {
        return `${prefix}\x1b[${Math.min(cols, buf.x + 1)}G`;
      }
      return `${prefix}${rawSeq}`;
    }

    if ((final === "I" || final === "Z") && isStandardParams) {
      if (hasRightMargin) {
        return `${prefix}\x1b[${Math.min(cols, buf.x + 1)}G`;
      }
      return `${prefix}${rawSeq}`;
    }

    if (final === "d" && isStandardParams) {
      let out = rawSeq;
      if (!prevOrigin) {
        const rawRow = Number.parseInt(params || "1", 10) || 1;
        if (rawRow > childRows) {
          out = `\x1b[${buf.y + 1}d`;
        }
      }
      if (hasRightMargin && prevX >= cols) {
        out += `\x1b[${Math.min(cols, buf.x + 1)}G`;
      }
      return `${prefix}${out}`;
    }

    if (final === "A" && isStandardParams) {
      if (hasRightMargin && prevX >= cols) {
        return `${prefix}${rawSeq}\x1b[${Math.min(cols, buf.x + 1)}G`;
      }
      return `${prefix}${rawSeq}`;
    }

    if (
      (final === "B" || final === "e" || final === "E") &&
      isStandardParams
    ) {
      const n = Math.max(1, Number.parseInt(params || "1", 10) || 1);
      let out = rawSeq;
      if ((prevY > prevScrollBottom || final === "e") && prevY + n >= childRows) {
        const maxDown = Math.max(0, buf.y - prevY);
        if (final === "E") {
          out = maxDown > 0 ? `\x1b[${maxDown}E` : "\r";
        } else {
          out = maxDown > 0 ? `\x1b[${maxDown}${final}` : "";
        }
      }
      if (hasRightMargin && final !== "E" && prevX >= cols) {
        out += `\x1b[${Math.min(cols, buf.x + 1)}G`;
      }
      return `${prefix}${out}`;
    }

    if (final === "K" && (params === "" || /^\??\d+$/.test(params))) {
      if (hasRightMargin) {
        const mode = Number.parseInt(params.replace(/^\?/, "") || "0", 10);
        if (mode === 0) {
          if (prevX >= cols) return prefix;
          const count = cols - prevX;
          return `${prefix}\x1b[${count}X`;
        }
        if (mode === 1) {
          return `${prefix}${prevX >= cols ? `\x1b[${cols}G` : ""}\x1b[1K`;
        }
        if (mode === 2) {
          return `${prefix}\x1b[1G\x1b[${cols}X\x1b[${Math.min(cols, buf.x + 1)}G`;
        }
      }
      return `${prefix}${rawSeq}`;
    }

    if (final === "X" && isStandardParams) {
      if (hasRightMargin) {
        const n = Math.max(1, Number.parseInt(params || "1", 10) || 1);
        const x = Math.min(prevX, cols - 1);
        const clamped = Math.min(n, Math.max(0, cols - x));
        return `${prefix}${clamped > 0 ? `\x1b[${clamped}X` : ""}`;
      }
      return `${prefix}${rawSeq}`;
    }

    if (final === "@" && isStandardParams) {
      if (hasRightMargin) {
        this.#panelDirty = true;
        const n = Math.max(1, Number.parseInt(params || "1", 10) || 1);
        const x = Math.min(prevX, cols - 1);
        const clamped = Math.min(n, Math.max(1, cols - x));
        return `${prefix}\x1b[${x + 1}G\x1b[${clamped}@\x1b[${Math.min(cols, buf.x + 1)}G`;
      }
      return `${prefix}${rawSeq}`;
    }

    if (final === "P" && isStandardParams) {
      if (hasRightMargin) {
        this.#panelDirty = true;
        const n = Math.max(1, Number.parseInt(params || "1", 10) || 1);
        const x = Math.min(prevX, cols - 1);
        const k = Math.min(n, Math.max(0, cols - x));
        if (k <= 0) return prefix;
        // DCH on outer terminal pulls cells from [cols .. totalCols-1] into [cols-k .. cols-1].
        // Immediately erase those rightmost k child cells so panel/overflow cells never enter the child area.
        return `${prefix}\x1b[${x + 1}G\x1b[${k}P\x1b[${cols - k + 1}G\x1b[${k}X\x1b[${Math.min(cols, buf.x + 1)}G`;
      }
      return `${prefix}${rawSeq}`;
    }

    if (final === "b" && isStandardParams) {
      if (hasRightMargin) {
        const n = Math.max(1, Number.parseInt(params || "1", 10) || 1);
        if (buf.x === prevX && buf.y === prevY && !prevInsert) {
          return prefix;
        }
        if (prevInsert) this.#panelDirty = true;
        if ((prevX + n >= cols || prevInsert) && this.#lastGraphicChar.length > 0) {
          return `${prefix}${this.#emitContainedRep(
            this.#lastGraphicChar,
            n,
            prevX,
            prevY,
            prevScrollBottom,
            cols,
            childRows,
            prevWraparound,
          )}`;
        }
      }
      return `${prefix}${rawSeq}`;
    }

    if ((final === "L" || final === "M" || final === "S" || final === "T") && isStandardParams) {
      if (hasRightMargin) {
        this.#panelDirty = true;
        if ((final === "S" || final === "T") && prevX >= cols) {
          return `${prefix}${rawSeq}\x1b[${Math.min(cols, buf.x + 1)}G`;
        }
      }
      return `${prefix}${rawSeq}`;
    }

    if (final === "u" && params === "") {
      return `${prefix}${rawSeq}${this.#restoreStateFromHeadless(cols, childRows)}`;
    }

    if (final === "J" && (params === "" || /^\??\d+$/.test(params))) {
      const mode = Number.parseInt(params.replace(/^\?/, "") || "0", 10);
      if (hasRightMargin) {
        this.#panelDirty = true;
      }
      if (mode === 0 || mode === 2 || mode === 3) {
        this.#needsRepaint = true;
        this.#pendingRegionReapply = this.isActive();
      }
      if (hasRightMargin && mode === 0 && prevX >= cols) {
        // Under pendingWrap, ED 0 preserves cell cols-1 on prevY and only erases rows below.
        const targetRow = prevOrigin
          ? Math.max(1, prevY - buf.scrollTop + 1)
          : prevY + 1;
        return `${prefix}\x1b[${targetRow};${cols + 1}H\x1b[J\x1b[${targetRow};${cols}H`;
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
        if (hasRightMargin) this.#panelDirty = true;
        this.#pendingRegionReapply = this.isActive();
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
    rightPanel?: boolean | NativeAttachRightPanelOptions;
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
  let rightPanelRefresher: RightPanelSnapshotRefresher | undefined;
  const rightPanel = ((): RightPanelController | undefined => {
    const opt =
      typeof options.rightPanel === "object" && options.rightPanel !== null
        ? options.rightPanel
        : undefined;
    if (options.rightPanel === false || opt?.enabled === false) return undefined;
    let config: ReturnType<typeof readRemoteConfig> | undefined;
    try {
      config = readRemoteConfig();
    } catch {
      config = undefined;
    }
    const enabled =
      opt?.enabled ??
      (options.rightPanel === true
        ? true
        : resolveRightPanelEnabled(opt?.env ?? process.env, config));
    if (!enabled) return undefined;
    const initialSnapshot =
      opt?.snapshot ??
      buildRightPanelSnapshot({
        currentSessionId: id,
        groups: [],
        decisions: [],
        degraded: true,
      });
    const controller = new RightPanelController({
      stdout: stdout as unknown as {
        columns?: number;
        rows?: number;
        write(chunk: string): boolean;
      },
      snapshot: initialSnapshot,
      width:
        opt?.width ??
        resolveRightPanelWidth(opt?.env ?? process.env, config),
      onOpen: () => {
        const updated = rightPanelRefresher?.markCurrentDecisionsSeen();
        if (updated) {
          controller.setSnapshot(updated);
          statusBar.paint(false);
        }
      },
      restoreChildState: () => statusBar.restoreChildStateSequence(),
      isStatusBarActive: () => statusBar.isActive(),
    });
    if (!opt?.snapshot) {
      const panelEnv = opt?.env ?? process.env;
      const trackCache =
        opt?.snapshotOptions?.trackCache ??
        new TrackJournalCache({ env: panelEnv });
      rightPanelRefresher = new RightPanelSnapshotRefresher({
        currentSessionId: id,
        initialSnapshot,
        now: () => runtime.now(),
        minIntervalMs: opt?.refreshIntervalMs ?? 1_000,
        load: async (seenDecisionKeys) => {
          if (opt?.loadSnapshot) {
            return await opt.loadSnapshot();
          }
          return buildLiveRightPanelSnapshot({
            ...opt?.snapshotOptions,
            currentSessionId: id,
            env: opt?.snapshotOptions?.env ?? panelEnv,
            ...(opt?.snapshotOptions?.config !== undefined
              ? { config: opt.snapshotOptions.config }
              : config !== undefined
                ? { config }
                : {}),
            nowMs: runtime.now(),
            seenDecisionKeys,
            trackCache,
          });
        },
        onUpdate: (next) => {
          controller.setSnapshot(next);
          statusBar.paint(false);
        },
      });
    }
    return controller;
  })();
  if (rightPanel) {
    statusBar.setRightPanelMarkerProvider(() => rightPanel.statusBarMarker());
  }
  statusBar.setRightPanel(rightPanel);
  const isRawCapable = stdin.isTTY === true;
  const wasRaw = stdin.isRaw === true;
  let tty = "not-a-tty";
  try { tty = readlinkSync("/proc/self/fd/0"); } catch { /* Non-Linux terminal. */ }

  const view = createSessionView({
    sessionId: id,
    stdout,
    now: () => runtime.now(),
    tty,
    statusBar,
    takeover: options.takeover,
    ownOuterMouse: rightPanel !== undefined,
    saveTerminalReset: runtime.saveTerminalReset,
    getChildCols: () =>
      rightPanel ? rightPanel.childCols(stdout.columns ?? 0) : stdout.columns,
  });
  statusBar.setOnBeforeActivate(() => view.saveReset());

  const terminate = (): void => {
    view.detached = true;
    try { view.flushRelay(); view.resetModes(); } finally {
      if (isRawCapable) stdin.setRawMode(wasRaw);
      stdin.pause();
      view.closeActive();
    }
  };
  runtime.onTerminate?.(terminate);

  let pendingEscapeAt: number | undefined;
  const enqueueChildBytes = (bytes: Buffer): void => {
    if (bytes.length === 0) return;
    if (!view.enqueueInput(bytes, ATTACH_PENDING_INPUT_MAX_BYTES)) {
      view.restoreBarForNotice();
      stdout.write(
        "\r\n[h2a] native attach input buffer full during reconnect; detaching " +
          "without stopping the session\r\n",
      );
      appendCrashLog("attach", { event: "refusal", sessionId: view.sessionId, reason: "input-buffer-full" });
      view.detached = true;
      view.closeActive();
      return;
    }
  };

  const applyPanelResult = (handled: ReturnType<RightPanelController["handleInputBytes"]>): void => {
    if (handled.actions.some((a) => a.type === "detach")) {
      view.detached = true;
      view.closeActive();
      return;
    }
    if (handled.actions.some((a) => a.type === "toggle")) {
      statusBar.onRightPanelGeometryChange();
      view.sendChildResize();
    }
    if (handled.forwardBytes && handled.forwardBytes.length > 0) {
      enqueueChildBytes(handled.forwardBytes);
    }
  };

  const onInput = (value: Buffer | string): void => {
    const chunk = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value);
    if (chunk.includes(DETACH_BYTE)) {
      view.detached = true;
      view.closeActive();
      return;
    }
    if (rightPanel) {
      const handled = rightPanel.handleInputBytes(chunk, {
        cliMouseEnabled: view.modes.isMouseTrackingEnabled(),
        cliMouseMode: view.modes.mouseTrackingMode(),
        cliMouseEncoding: view.modes.mouseEncoding(),
        bracketedPasteEnabled: view.modes.isBracketedPasteEnabled(),
        kittyKeyboardEnabled: view.modes.isKittyKeyboardEnabled(),
        statusBarActive: statusBar.isActive(),
      });
      pendingEscapeAt = rightPanel.hasPendingEscape() ? runtime.now() : undefined;
      applyPanelResult(handled);
      return;
    }
    enqueueChildBytes(chunk);
  };
  stdin.on("data", onInput);
  const onEnd = (): void => { view.detached = true; view.closeActive(); };
  stdin.on("end", onEnd);
  const resize = (): void => {
    view.sendChildResize();
    view.statusBar.onResize();
    rightPanel?.onResize();
    view.saveReset();
  };
  runtime.onResize(resize);

  const connectAndAcquire = (): Promise<NativeTerminalSessionState> =>
    view.connectAndAcquire(
      () => runtime.connect(),
      () => {
        if (rightPanel) {
          view.enableOuterMouse();
          rightPanel.paint();
          void rightPanelRefresher?.maybeRefresh(true);
        }
      },
    );

  // Paint the existing scrollback once, then follow the stream.
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
        { sessionId: view.sessionId, reason: "definitive-absence", detail: "session absent at attach; exit code unknown" },
      ));
      return 1;
    }
    if (initial.status === "exited") {
      appendCrashLog("attach", sessionExitCrashEntry(initial, { sessionId: view.sessionId, detail: "session already exited at attach" }));
      return initial.exit?.exitCode ?? 0;
    }
    let idlePollMs = ATTACH_IDLE_POLL_MIN_MS;
    let statePollMs = ATTACH_STATE_POLL_MS;
    let nextStatePollAt = runtime.now() + statePollMs;

    for (;;) {
      if (view.detached || view.terminalEnded) break;

      if (view.active === undefined || view.transportFailure !== undefined) {
        const disconnectStartedAt = view.interruptedAt ?? runtime.now();
        const failureCause =
          view.transportFailure instanceof Error
            ? view.transportFailure.message
            : view.transportFailure !== undefined
              ? String(view.transportFailure)
              : "connection interrupted";
        const failureReason =
          view.transportFailure instanceof NativeTerminalRequestTimeoutError
            ? `timeout:${view.transportFailure.operation}`
            : "transport-interrupted";
        view.closeActive();
        await view.statusBar.probe(false, "reconnecting");
        let reconnectDelayMs = ATTACH_RECONNECT_MIN_MS;
        for (;;) {
          if (view.detached) break;
          try {
            const state = await connectAndAcquire();
            const durationMs = Math.max(0, runtime.now() - disconnectStartedAt);
            view.interruptedAt = undefined;
            if (state.status === "exited") {
              view.exitCode = state.exit?.exitCode ?? 0;
              appendCrashLog("attach", {
                ...sessionExitCrashEntry(state, {
                  sessionId: view.sessionId,
                  detail: `session exited during reconnect after ${durationMs}ms (${failureCause})`,
                }),
                durationMs,
              });
              view.terminalEnded = true;
              break;
            }
            appendCrashLog("attach", {
              event: "reconnect",
              sessionId: view.sessionId,
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
              view.restoreBarForNotice();
              stdout.write(`\r\n[h2a] ${error.message}; attach detached\r\n`);
              appendCrashLog("attach", {
                event: "refusal",
                sessionId: view.sessionId,
                reason: "already-has-controller",
                durationMs,
                detail: error.message,
              });
              view.terminalEnded = true;
              break;
            }
            if (isDefinitiveNativeTerminalAbsence(error)) {
              appendCrashLog("attach", {
                ...sessionExitCrashEntry(
                  { exit: null, stopSignal: null },
                  {
                    sessionId: view.sessionId,
                    reason: "definitive-absence",
                    detail: `session proven absent during reconnect after ${durationMs}ms (${failureCause}); exit code unknown`,
                  },
                ),
                durationMs,
              });
              view.exitCode = 1;
              view.terminalEnded = true;
              break;
            }
            await runtime.delay(reconnectDelayMs);
            reconnectDelayMs = Math.min(
              ATTACH_RECONNECT_MAX_MS,
              reconnectDelayMs * 2,
            );
          }
        }
        if (view.terminalEnded) break;
        continue;
      }

      const current = view.active;
      try {
        const replay = await current.client.readOutput(
          view.sessionId,
          view.seq,
          NATIVE_TERMINAL_INTERACTIVE_READ_TIMEOUT_MS,
        );
        if (view.detached) break;
        view.feedReplay(replay);
        if (
          rightPanel &&
          pendingEscapeAt !== undefined &&
          runtime.now() - pendingEscapeAt >= 25
        ) {
          pendingEscapeAt = undefined;
          applyPanelResult(
            rightPanel.flushPending({
              cliMouseEnabled: view.modes.isMouseTrackingEnabled(),
              cliMouseMode: view.modes.mouseTrackingMode(),
              cliMouseEncoding: view.modes.mouseEncoding(),
              bracketedPasteEnabled: view.modes.isBracketedPasteEnabled(),
              kittyKeyboardEnabled: view.modes.isKittyKeyboardEnabled(),
              statusBarActive: statusBar.isActive(),
            }),
          );
        }
        void rightPanelRefresher?.maybeRefresh();
        await view.statusBar.probe(false);
        view.seq = replay.latestSeq;
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
          if (view.controllerChanged(replay.state, current.lease)) break;
          if (replay.state.status === "exited") {
            view.exitCode = replay.state.exit?.exitCode ?? 0;
            appendCrashLog("attach", sessionExitCrashEntry(replay.state, { sessionId: view.sessionId, detail: "session exited during attach" }));
            break;
          }
        } else if (runtime.now() >= nextStatePollAt) {
          let state: NativeTerminalSessionState | undefined;
          try {
            state = await current.client.state(view.sessionId);
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
            if (view.controllerChanged(state, current.lease)) break;
            if (state.status === "exited") {
              view.exitCode = state.exit?.exitCode ?? 0;
              appendCrashLog("attach", sessionExitCrashEntry(state, { sessionId: view.sessionId, detail: "session exited during attach" }));
              break;
            }
          }
        }
      } catch (error) {
        if (view.detached) break;
        if (isDefinitiveNativeTerminalAbsence(error)) {
          appendCrashLog("attach", sessionExitCrashEntry(
            { exit: null, stopSignal: null },
            { sessionId: view.sessionId, reason: "definitive-absence", detail: "session proven absent during attach; exit code unknown" },
          ));
          view.exitCode = 1;
          break;
        }
        view.markTransportFailure(current, error);
      }
    }
  } finally {
    try {
      view.flushRelay();
      if (view.detached) {
        view.restoreBarForNotice();
        stdout.write("\r\n[h2a] detached from native session (session keeps running)\r\n");
      }
      view.resetModes();
    } finally {
      runtime.offTerminate?.(terminate);
      runtime.offResize(resize);
      stdin.removeListener("data", onInput);
      stdin.removeListener("end", onEnd);
      if (isRawCapable) stdin.setRawMode(wasRaw);
      stdin.pause();
      await view.drainInputPump();
      rightPanelRefresher?.dispose();
      rightPanel?.dispose();
      await view.releaseActive();
      view.dispose();
    }
  }
  return view.exitCode;
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
      emit({
        hostPid: ping.hostPid,
        generation: ping.generation,
        socketPath: selected.socketPath,
        launchFence: ping.launchFence === true,
        softRespawn: ping.softRespawn === true,
      });
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
    case "capture-since": {
      const id = required(parsed, "id");
      const afterSeq = Number(parsed.flags.get("after-seq") ?? 0);
      if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
        throw new Error(`invalid after-seq: ${parsed.flags.get("after-seq")}`);
      }
      const { client } = await owningClient(parsed, id);
      const replay = await client.readOutput(id, afterSeq);
      const state = replay.state ?? (await client.state(id));
      client.close();
      const raw = replay.chunks.map((chunk) => chunk.data).join("");
      const budget = Number(parsed.flags.get("bytes") ?? 16384);
      const text = raw.length > 0 ? (await renderTerminalScreen(raw)).slice(-budget) : "";
      emit({
        text,
        latestSeq: replay.latestSeq,
        status: state.status,
        pid: state.pid,
        generation: state.generation,
        incarnation: state.incarnation,
      });
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
    case "respawn-if-incarnation": {
      const id = required(parsed, "id");
      const generation = required(parsed, "generation");
      const incarnation = required(parsed, "incarnation");
      const cwd = required(parsed, "cwd");
      const signal = parsed.flags.get("signal") ?? "SIGTERM";
      if (signal !== "SIGTERM" && signal !== "SIGKILL" && signal !== "SIGINT" && signal !== "SIGHUP") {
        throw new Error(`unsupported signal: ${signal}`);
      }
      const rawTimeout = parsed.flags.get("timeout-ms");
      const timeoutMs = rawTimeout === undefined ? undefined : Number(rawTimeout);
      if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)) {
        throw new Error(`invalid timeout-ms: ${rawTimeout}`);
      }
      const envFile = parsed.flags.get("env-file");
      const env = envFile !== undefined
        ? (JSON.parse(readFileSync(envFile, "utf8")) as Record<string, string>)
        : Object.fromEntries(
            Object.entries(process.env).filter(
              (entry): entry is [string, string] => entry[1] !== undefined,
            ),
          );
      if (parsed.command.length === 0) throw new Error("respawn-if-incarnation requires -- command");
      const owner = await owningClient(parsed, id);
      const { client } = owner;
      try {
        const ping = await client.ping();
        if (ping.softRespawn !== true) {
          appendCrashLog("cli", {
            event: "refusal",
            sessionId: id,
            instanceId: ping.generation,
            reason: "host-soft-restart-unsupported",
            detail: owner.socketPath,
          });
          emit({
            code: "host-soft-restart-unsupported",
            id,
            generation: ping.generation,
            socketPath: owner.socketPath,
          });
          return 1;
        }
        const before = await client.state(id);
        if (before.generation !== generation) {
          appendCrashLog("cli", { event: "refusal", sessionId: id, instanceId: generation, reason: "stale-terminal-host-generation" });
          throw new Error("stale terminal host generation");
        }
        if (before.incarnation !== incarnation) {
          appendCrashLog("cli", { event: "refusal", sessionId: id, instanceId: generation, reason: "stale-terminal-session-incarnation" });
          throw new Error("stale terminal session incarnation");
        }
        const after = await client.respawnIfIncarnation({
          id,
          generation,
          incarnation,
          command: parsed.command[0]!,
          args: parsed.command.slice(1),
          cwd,
          env,
          signal,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        });
        emit({ ...after, socketPath: owner.socketPath });
        return 0;
      } catch (error) {
        if (
          error instanceof NativeTerminalRemoteError &&
          error.code === "invalid-request" &&
          /unknown terminal operation/i.test(error.message)
        ) {
          appendCrashLog("cli", {
            event: "refusal",
            sessionId: id,
            instanceId: generation,
            reason: "host-soft-restart-unsupported",
            detail: owner.socketPath,
          });
          emit({
            code: "host-soft-restart-unsupported",
            id,
            generation,
            socketPath: owner.socketPath,
          });
          return 1;
        }
        throw error;
      } finally {
        client.close();
      }
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
