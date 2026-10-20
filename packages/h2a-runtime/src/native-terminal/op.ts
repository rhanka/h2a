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
 *                                     [--request-id R for idempotent retry]
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
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { NativeTerminalClient } from "./client.js";
import { loadRegistry, registryEntriesForNativeTarget } from "../registry.js";
import {
  NATIVE_TERMINAL_INTERACTIVE_READ_TIMEOUT_MS,
  NATIVE_TERMINAL_PROTOCOL_VERSION,
  NativeTerminalRemoteError,
  type NativeTerminalReplyUnit,
} from "./protocol.js";
import type {
  NativeTerminalControllerLease,
  NativeTerminalInjectOutcome,
  NativeTerminalReplyOutcome,
  NativeTerminalSessionState,
} from "./host.js";
import {
  TERMINAL_REPLY_BRIDGE_FLUSH_DELAY_MS,
  TerminalReplyClassifier,
  stripTerminalQueries,
  type ClassifiedPart,
} from "./terminal-replies.js";
import { NativeTerminalHostSupervisor } from "./supervisor.js";
import { proveNativeTerminalEndpointAbsent } from "./server.js";
import { defaultNativeTerminalSocketPath, knownNativeTerminalSocketPaths,
  inspectPrivateNativeTerminalSocket, sameNativeTerminalSocket } from "./socket-path.js";
import { collectNativeInventory, resolveNativeOwner, type NativeInventory } from "./fleet.js";
import { renderTerminalScreen } from "./screen.js";
import { TerminalModeTracker } from "./terminal-modes.js";
import { publishAttachReset } from "./attach-recovery.js";
import { TerminalResetRelay } from "./reset-relay.js";
import { appendCrashLog, crashSignalName, installCrashHandlers, type CrashLogEntry } from "../crash-log.js";
import { humanOutputText } from "../human-output.js";

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

function emit(payload: unknown): void {
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

async function connectExisting(socketPath: string, tracked = true): Promise<NativeTerminalClient> {
  const identity = await inspectPrivateNativeTerminalSocket(socketPath);
  const client = await NativeTerminalClient.connect(socketPath);
  if (tracked) openClients.add(client);
  try {
    const ping = await client.ping();
    if (ping.protocolVersion !== NATIVE_TERMINAL_PROTOCOL_VERSION || !ping.generation?.trim() ||
      !Number.isSafeInteger(ping.hostPid) || ping.hostPid <= 0 ||
      !sameNativeTerminalSocket(identity, await inspectPrivateNativeTerminalSocket(socketPath))) {
      throw new Error("native host identity changed or handshake is invalid");
    }
  } catch (error) { client.close(); throw error; }
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
  const ping = await client.ping();
  if (!fenced || paths.length === 1) return { client, socketPath: historical };
  const compatible = paths[1]!;
  // Initialize the second known endpoint so admission obtains a complete
  // inventory even when the historical host already provides the fence.
  const second = await launchClient(compatible);
  return ping.launchFence === true ? { client, socketPath: historical } : { client: second, socketPath: compatible };
}

async function launchClient(socketPath: string): Promise<NativeTerminalClient> {
  try { return await connectExisting(socketPath); }
  catch (error) {
    let absent = false;
    try { absent = await proveNativeTerminalEndpointAbsent(socketPath, error); }
    catch (proofError) {
      error = new Error(`${error instanceof Error ? error.message : String(error)}; absence proof failed: ${proofError instanceof Error ? proofError.message : String(proofError)}`);
    }
    if (absent) return ensureClient(socketPath);
    throw Object.assign(new Error(`${socketPath}: ${error instanceof Error ? error.message : String(error)}; owner death is unproven. Inspect endpoint permissions and the owning process identity, restore probe access, then retry; do not remove a socket or lock while ownership is unproven.`), { socketPath });
  }
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
  // Round-1 (D6): machine acts through the automation activity — never the
  // human one. A machine paste/resize/enter via a human-stamped lease would
  // forge human activity AND advance the host's human-input epoch, poisoning
  // the inject composition gate (and the anti-overwrite window) with bytes
  // no human composed. Only the attach bridge acquires "human".
  const lease = await client.acquireController(id, `h2a-op-${process.pid}`, "automation");
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
  | "writeReply"
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

type ActiveAttachConnection = {
  client: NativeTerminalAttachClient;
  lease: NativeTerminalControllerLease;
};

/**
 * Follow one native PTY without owning its lifetime. A transport failure closes
 * only this observer/controller connection; the host-owned PTY is never stopped
 * or recreated. Reconnection resumes from the last rendered sequence number.
 */
/**
 * Lot L4-hint (D11b/c) — survivor hints for the OUTER terminal, printed
 * after raw modes are restored. `recreation` (the `h2a run …` line) prints
 * only when the session end was OBSERVED — never on detach, takeover, or
 * unproven transport loss. `attach` (the `h2a attach …` line) prints on a
 * user detach (Ctrl-\ / stdin end).
 */
export type SessionEndHint = {
  recreation?: string;
  attach?: string;
};

export async function runAttach(
  id: string,
  runtime: NativeTerminalAttachRuntime = defaultAttachRuntime(socketPathFromEnv()),
  options: { takeover?: boolean; sessionEndHint?: SessionEndHint } = {},
): Promise<number> {
  const stdin = runtime.stdin;
  const stdout = runtime.stdout;
  let modes = new TerminalModeTracker();
  let modesSuspended = false;
  let savedReset = "";
  const saveReset = (): void => {
    const reset = modesSuspended ? "" : modes.resetSequence();
    if (reset === savedReset) return;
    runtime.saveTerminalReset?.(reset);
    savedReset = reset;
  };
  const relayOutput = (data: string): void => {
    modes.feed(data);
    saveReset();
    stdout.write(data);
  };
  // Older protocol-v1 hosts relay the wrapper marker verbatim. New hosts
  // consume it themselves so detached sessions also return to a clean shell.
  // Lot L4-replies (D10): every consumed marker also opens a new application
  // incarnation for the typed-reply correlation (suppressed while feeding a
  // gap repaint: repainted markers are history the host already counted).
  const countMarker = (): void => {
    if (!suppressMarkerCount) appEpoch += 1;
  };
  let resetRelay = new TerminalResetRelay(relayOutput, () => modes.resetSequence(), countMarker);
  const resetModes = (): void => {
    if (modesSuspended) return;
    modesSuspended = true;
    const reset = modes.resetSequence();
    if (!reset) { saveReset(); return; }
    // Signals and fatal exits cannot wait for an asynchronous pipe flush.
    const fd = (stdout as NodeJS.WriteStream & { fd?: number }).fd;
    if (typeof fd === "number") writeSync(fd, reset);
    else stdout.write(reset);
    saveReset();
  };
  const resumeModes = (): void => {
    if (!modesSuspended) return;
    modesSuspended = false;
    saveReset();
    stdout.write(modes.restoreSequence() + modes.replayPrefix());
  };
  const isRawCapable = stdin.isTTY === true;
  const wasRaw = stdin.isRaw === true;
  let detached = false;
  let terminalEnded = false;
  // Lot L4-hint (D11b/c) — the survivor prints by OBSERVED reason only:
  // a user detach (Ctrl-\ / stdin end / buffer-full) gets the attach line,
  // a PROVEN session exit gets the recreation line. Takeover, refusal and
  // unproven transport loss set neither and print neither hint.
  let userDetached = false;
  let sessionExited = false;
  let exitCode = 0;
  let active: ActiveAttachConnection | undefined;
  let transportFailure: unknown;
  let recoveryAnnounced = false;
  let pendingInputBytes = 0;
  type PendingAttachAction =
    | { kind: "bytes"; buf: Buffer }
    | {
      kind: "reply";
      family: NativeTerminalReplyUnit["family"];
      key: string;
      bytes: string;
      acceptedAt: number;
    };
  const pendingInput: PendingAttachAction[] = [];
  let inputPump: Promise<void> | undefined;
  // Lot L4-replies (D10): the bridge's own application-incarnation counter,
  // advanced by every wrapper reset marker the relayed output carries and
  // healed from the host's authoritative state (evicted markers never reach
  // the bridge). Typed units carry it; the host revalidates it at apply.
  let appEpoch = 0;
  // An old host without the `write-reply` operation cannot gate typed units:
  // replies are then swallowed locally (fail closed, never plain-written)
  // instead of round-tripping a guaranteed rejection.
  let hostNoReplySupport = false;
  let suppressMarkerCount = false;
  const replyClassifier = new TerminalReplyClassifier();
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
    if (replyFlushTimer !== undefined) {
      clearTimeout(replyFlushTimer);
      replyFlushTimer = undefined;
    }
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
      stdout.write(
        "\r\n[h2a] terminal input delivery became uncertain during reconnect; " +
          "the in-flight chunk was not replayed to avoid duplicate input\r\n",
      );
    }
    // A request from the previous socket may settle after recovery. Fence that
    // stale failure so it can never tear down the newly-acquired controller.
    if (active !== connection) return;
    if (error instanceof NativeTerminalRemoteError && error.message === "stale terminal controller lease") {
      stdout.write("\r\n[h2a] controller revoked by takeover or stop; attach detached\r\n");
      appendCrashLog("attach", { event: "refusal", sessionId: id, reason: "stale-controller-lease" });
      terminalEnded = true;
      closeActive();
      return;
    }
    if (transportFailure === undefined) transportFailure = error;
    closeActive();
  };

  const pumpInput = (): void => {
    if (inputPump !== undefined || detached || active === undefined) return;
    inputPump = (async () => {
      while (!detached && pendingInput.length > 0) {
        const current = active;
        if (current === undefined) return;
        const action = pendingInput[0]!;
        const actionBytes = action.kind === "bytes"
          ? action.buf.length
          : Buffer.byteLength(action.bytes, "utf8");
        try {
          if (action.kind === "bytes") {
            await current.client.write(current.lease, action.buf.toString("utf8"));
          } else {
            // The typed unit is assembled at SEND time from the current
            // lease and application incarnation: classification only decided
            // the bytes are a machine reply. The host is the final gate.
            const unit: NativeTerminalReplyUnit = {
              family: action.family,
              key: action.key,
              epoch: current.lease.epoch,
              incarnation: current.lease.incarnation,
              appEpoch,
              bytes: action.bytes,
              acceptedAt: action.acceptedAt,
            };
            const outcome: NativeTerminalReplyOutcome = await current.client.writeReply(
              current.lease,
              unit,
            );
            if (outcome.outcome === "swallowed") {
              appendCrashLog("attach", {
                event: "reply-swallowed",
                sessionId: id,
                reason: outcome.reason,
              });
            }
          }
          pendingInput.shift();
          pendingInputBytes -= actionBytes;
        } catch (error) {
          if (action.kind === "reply" && error instanceof NativeTerminalRemoteError) {
            // A typed-unit REJECTION (stale lease, or an old host without
            // `write-reply`) swallows the reply with zero bytes and lets the
            // human queue keep flowing in order — never a plain write.
            pendingInput.shift();
            pendingInputBytes -= actionBytes;
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("unknown terminal operation") && !hostNoReplySupport) {
              hostNoReplySupport = true;
              stdout.write(
                "\r\n[h2a] terminal host predates typed replies; machine replies " +
                  "are swallowed, never typed\r\n",
              );
            }
            appendCrashLog("attach", {
              event: "reply-swallowed",
              sessionId: id,
              reason: "rejected",
              detail: message.slice(0, 160),
            });
            continue;
          }
          // The host may have accepted the write before the response path
          // broke. Drop this ONE uncertain chunk with an explicit warning;
          // replaying it could duplicate a command. Later queued input stays
          // ordered and is delivered only after a fresh exclusive lease.
          pendingInput.shift();
          pendingInputBytes -= actionBytes;
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

  const enqueueInputBytes = (buf: Buffer): boolean => {
    if (pendingInputBytes + buf.length > ATTACH_PENDING_INPUT_MAX_BYTES) {
      stdout.write(
        "\r\n[h2a] native attach input buffer full during reconnect; detaching " +
          "without stopping the session\r\n",
      );
      appendCrashLog("attach", { event: "refusal", sessionId: id, reason: "input-buffer-full" });
      detached = true;
      userDetached = true;
      closeActive();
      return false;
    }
    pendingInput.push({ kind: "bytes", buf });
    pendingInputBytes += buf.length;
    return true;
  };
  // Round-1 (D10/sol-6): the classifier holds an ambiguous trailing bare
  // ESC for the next chunk. When no chunk follows — a genuine lone Escape
  // key — flush it as input after a short bound so the keypress is delayed,
  // never lost, while split replies arriving in the same burst resolve
  // first. Partial introducers and paste carries are NEVER flushed here
  // (their continuation may legitimately arrive later — see the split-reply
  // functional tests). The timer is cleared on detach/terminate; held bytes
  // are then dropped with the queue.
  let replyFlushTimer: NodeJS.Timeout | undefined;
  const scheduleReplyFlush = (): void => {
    if (!replyClassifier.hasHeldBareEscape || replyFlushTimer !== undefined || detached) return;
    replyFlushTimer = setTimeout(() => {
      replyFlushTimer = undefined;
      if (detached) return;
      for (const part of replyClassifier.flush()) {
        if (part.kind !== "input") continue;
        if (!enqueueInputBytes(Buffer.from(part.text, "utf8"))) return;
      }
      pumpInput();
    }, TERMINAL_REPLY_BRIDGE_FLUSH_DELAY_MS);
  };
  const onInput = (value: Buffer | string): void => {
    const chunk = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value);
    if (chunk.includes(DETACH_BYTE)) {
      detached = true;
      userDetached = true;
      closeActive();
      return;
    }
    // Lot L4-replies (D10): split outer-terminal bytes into human input
    // (existing `write` path, verbatim, ordered) and machine replies (typed
    // units the host revalidates before writing). On ambiguity the bytes stay
    // human — the classifier only routes positively-identified replies.
    for (const part of replyClassifier.feed(chunk.toString("utf8"))) {
      if (part.kind === "input") {
        const buf = Buffer.from(part.text, "utf8");
        if (!enqueueInputBytes(buf)) return;
        continue;
      }
      // A machine reply: never plain-written, even to an old host.
      if (hostNoReplySupport || active === undefined) {
        appendCrashLog("attach", {
          event: "reply-swallowed",
          sessionId: id,
          reason: hostNoReplySupport ? "old-host" : "no-controller",
        });
        continue;
      }
      const replyBytes = Buffer.byteLength(part.text, "utf8");
      if (pendingInputBytes + replyBytes > ATTACH_PENDING_INPUT_MAX_BYTES) {
        stdout.write(
          "\r\n[h2a] native attach input buffer full during reconnect; detaching " +
            "without stopping the session\r\n",
        );
        appendCrashLog("attach", { event: "refusal", sessionId: id, reason: "input-buffer-full" });
        detached = true;
        userDetached = true;
        closeActive();
        return;
      }
      pendingInput.push({
        kind: "reply",
        family: part.family,
        key: part.key,
        bytes: part.text,
        acceptedAt: runtime.now(),
      });
      pendingInputBytes += replyBytes;
    }
    scheduleReplyFlush();
    pumpInput();
  };
  stdin.on("data", onInput);
  const onEnd = (): void => { detached = true; userDetached = true; closeActive(); };
  stdin.on("end", onEnd);
  const resize = (): void => {
    const current = active;
    if (current && stdout.columns && stdout.rows) {
      void current.client
        .resize(current.lease, stdout.columns, stdout.rows)
        .catch((error) => markTransportFailure(current, error));
    }
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
      // Lot L4-replies (D10): every (re)connect heals the bridge's
      // application incarnation from the host's authoritative counter, so a
      // marker evicted before this attach cannot strand typed units stale.
      if (typeof state.applicationEpoch === "number") {
        appEpoch = Math.max(appEpoch, state.applicationEpoch);
      }
      // A reconnect must never take the terminal back from a newer attach.
      takeoverPending = false;
      active = { client, lease };
      transportFailure = undefined;
      resize();
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
      sessionExited = true;
      return 1;
    }
    if (initial.status === "exited") {
      appendCrashLog("attach", sessionExitCrashEntry(initial, { sessionId: id, detail: "session already exited at attach" }));
      sessionExited = true;
      return initial.exit?.exitCode ?? 0;
    }
    let idlePollMs = ATTACH_IDLE_POLL_MIN_MS;
    let nextStatePollAt = runtime.now() + ATTACH_STATE_POLL_MS;

    for (;;) {
      if (detached || terminalEnded) break;

      if (active === undefined || transportFailure !== undefined) {
        closeActive();
        if (!recoveryAnnounced) {
          stdout.write(
            "\r\n[h2a] native terminal connection interrupted; reconnecting " +
              "without restarting the session\r\n",
          );
          recoveryAnnounced = true;
        }
        resetModes();
        let reconnectDelayMs = ATTACH_RECONNECT_MIN_MS;
        for (;;) {
          if (detached) break;
          try {
            const state = await connectAndAcquire();
            if (state.status === "exited") {
              exitCode = state.exit?.exitCode ?? 0;
              appendCrashLog("attach", sessionExitCrashEntry(state, { sessionId: id, detail: "session exited during reconnect" }));
              sessionExited = true;
              terminalEnded = true;
              break;
            }
            stdout.write("\r\n[h2a] native terminal reconnected\r\n");
            resumeModes();
            recoveryAnnounced = false;
            idlePollMs = ATTACH_IDLE_POLL_MIN_MS;
            nextStatePollAt = runtime.now() + ATTACH_STATE_POLL_MS;
            break;
          } catch (error) {
            if (error instanceof NativeTerminalRemoteError && error.message.includes("already has a controller")) {
              stdout.write(`\r\n[h2a] ${error.message}; attach detached\r\n`);
              appendCrashLog("attach", { event: "refusal", sessionId: id, reason: "already-has-controller", detail: error.message });
              terminalEnded = true;
              break;
            }
            if (isDefinitiveNativeTerminalAbsence(error)) {
              appendCrashLog("attach", sessionExitCrashEntry(
                { exit: null, stopSignal: null },
                { sessionId: id, reason: "definitive-absence", detail: "session proven absent during reconnect; exit code unknown" },
              ));
              exitCode = 1;
              sessionExited = true;
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
          resetRelay = new TerminalResetRelay(relayOutput, () => modes.resetSequence(), countMarker);
          modesSuspended = false;
          if (replay.terminalModePrefix) {
            resetRelay.feed(replay.terminalModePrefix);
          }
          // Lot L4-replies (D10(b)): the gap repaint carries queries the new
          // reader never asked — the outer would answer stale queries
          // straight into its input line. Strip them from the RELAYED paint
          // only: modes/saveReset still see the original bytes, and seq still
          // jumps to the latest retained chunk. Marker counting is suppressed
          // for this feed: repainted markers are history the host already
          // counted, and the state poll below heals any evicted ones.
          let paint = "";
          for (const chunk of replay.chunks) {
            paint += chunk.data;
            if (!modesSuspended) modes.feed(chunk.data);
            saveReset();
          }
          suppressMarkerCount = true;
          try {
            resetRelay.feed(stripTerminalQueries(paint));
          } finally {
            suppressMarkerCount = false;
          }
          if (replay.chunks.length > 0) {
            seq = replay.chunks[replay.chunks.length - 1]!.seq;
          }
        } else {
          for (const chunk of replay.chunks) {
            resetRelay.feed(chunk.data);
            seq = chunk.seq;
          }
        }
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
        if (runtime.now() >= nextStatePollAt) {
          const state = await current.client.state(id);
          nextStatePollAt = runtime.now() + ATTACH_STATE_POLL_MS;
          // Lot L4-replies (D10): heal the bridge's application incarnation
          // from the host's authoritative counter (evicted markers never
          // reach the relay). Never moves backwards: the local count is exact
          // for everything the bridge actually relayed.
          if (typeof state.applicationEpoch === "number") {
            appEpoch = Math.max(appEpoch, state.applicationEpoch);
          }
          if (controllerChanged(state, current.lease)) break;
          if (state.status === "exited") {
            exitCode = state.exit?.exitCode ?? 0;
            appendCrashLog("attach", sessionExitCrashEntry(state, { sessionId: id, detail: "session exited during attach" }));
            sessionExited = true;
            break;
          }
        }
      } catch (error) {
        if (detached) break;
        if (isDefinitiveNativeTerminalAbsence(error)) {
          stdout.write(
            "\r\n[h2a] native session is no longer available; attach stopped\r\n",
          );
          appendCrashLog("attach", sessionExitCrashEntry(
            { exit: null, stopSignal: null },
            { sessionId: id, reason: "definitive-absence", detail: "session proven absent during attach; exit code unknown" },
          ));
          exitCode = 1;
          sessionExited = true;
          break;
        }
        markTransportFailure(current, error);
      }
    }
  } finally {
    try {
      resetRelay.flush();
      // Lot L4-hint (D11b/c) — the survivor speaks only AFTER the modes are
      // restored (D11b). A user detach gets the attach command (D11c — the
      // attach carries the session, so the id always yields a command); an
      // OBSERVED session exit gets the recreation line when the caller
      // supplied one. Takeover, refusal and unproven transport loss print
      // neither: the session lives on (or its end is unproven).
      if (userDetached) {
        const attachCmd = options.sessionEndHint?.attach ?? `h2a attach ${id}`;
        stdout.write(
          `\r\n[h2a] ${humanOutputText("hint.detachedReattach")} ${attachCmd}\r\n`,
        );
      } else if (sessionExited && options.sessionEndHint?.recreation !== undefined) {
        stdout.write(
          `\r\n[h2a] ${humanOutputText("hint.sessionEndedRecreate")}\n  ${options.sessionEndHint.recreation}\n`,
        );
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
    }
  }
  return exitCode;
}

export async function runNativeTerminalOp(argv: ReadonlyArray<string>): Promise<number> {
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
      const owner = resolveNativeOwner(id, await inventoryFor(parsed));
      if (owner.state === "found") emit({ verdict: owner.session.status === "running" ? "live" : "dead",
        state: { ...owner.session, socketPath: owner.socketPath } });
      else if (owner.state === "absent") emit({ verdict: "dead" });
      else emit({ verdict: "unknown", code: owner.state,
        ...(owner.state === "unknown" ? { reason: owner.reason } : { sockets: owner.sockets, reason: "ambiguous-owner" }) });
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
      // Round-1 (D5–D7): reimplemented on the lease-free host inject path.
      // Injection works with a human window attached. The request binds the
      // session incarnation observed immediately before the commit (a stale
      // target refuses with zero bytes instead of typing into a recycled
      // session). Outcomes are never flattened: `driven` carries the
      // automation seq; every host refusal/deferral stays typed as
      // `deferred` with its reason so the wake chain STOPS instead of
      // falling through to tmux/headless (D9); only transport failures
      // (unknown session, old host without the operation) read `failed`.
      const requestId = parsed.flags.get("request-id") ?? randomUUID();
      const { client } = await owningClient(parsed, target.id);
      try {
        let incarnation: string | undefined;
        try {
          incarnation = (await client.state(target.id)).incarnation;
        } catch {
          incarnation = undefined;
        }
        let outcome: NativeTerminalInjectOutcome;
        try {
          outcome = await client.inject(target.id, {
            text,
            requestId,
            ...(incarnation !== undefined ? { incarnation } : {}),
            activityWindowMs: nativeDriveActivityWindowMs(),
            actor: `owner-channel/op.js pid=${process.pid}`,
          });
        } catch (error) {
          // Unknown session (or an old host without the operation): the
          // target cannot take bytes. A stale registry row resolves to a
          // dead session; the wake layer re-resolves and retries.
          emit({ outcome: "failed", reason: `inject failed: ${(error as Error).message}` });
          return 0;
        }
        if (outcome.outcome === "injected") {
          emit({ outcome: "driven", automationSeq: outcome.automationSeq });
          return 0;
        }
        if (outcome.outcome === "deferred-recent-human") {
          emit({ outcome: "deferred", reason: "deferred-recent-human", retryAfterMs: outcome.retryAfterMs });
          return 0;
        }
        // Every host refusal (stale incarnation, unproven composition,
        // shell facet, unavailable audit, evicted request) stops the chain
        // with its typed reason: the native transport owns this target, so
        // falling through to another terminal or a headless spawn would
        // type the line where it was never admitted (D9).
        emit({ outcome: "deferred", reason: outcome.outcome });
        return 0;
      } finally {
        client.close();
      }
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
      // Lot L4-hint (D11b/c) — survivor hints ride along as flags (the attach
      // child owns the outer terminal while attached).
      const recreationHint = parsed.flags.get("recreation-hint");
      const attachHint = parsed.flags.get("attach-hint");
      return runAttach(id, defaultAttachRuntime(owner.socketPath), {
        takeover: parsed.flags.get("takeover") === "true",
        ...((recreationHint !== undefined || attachHint !== undefined)
          ? {
              sessionEndHint: {
                ...(recreationHint !== undefined ? { recreation: recreationHint } : {}),
                ...(attachHint !== undefined ? { attach: attachHint } : {}),
              },
            }
          : {}),
      });
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
        if (error instanceof NativeOwnerError) emit(error.refusal);
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
