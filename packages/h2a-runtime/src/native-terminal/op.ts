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
 *   attach  --id X                    interactive raw bridge on this terminal
 *                                     (detach: Ctrl-\\ ; exits when session exits)
 *   host-stop                         SIGTERM the host process (sessions stop)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { NativeTerminalClient } from "./client.js";
import { loadRegistry, registryEntriesForNativeTarget } from "../registry.js";
import {
  NATIVE_TERMINAL_INTERACTIVE_READ_TIMEOUT_MS,
  NATIVE_TERMINAL_PROTOCOL_VERSION,
  NativeTerminalRemoteError,
} from "./protocol.js";
import type {
  NativeTerminalControllerLease,
  NativeTerminalSessionState,
} from "./host.js";
import { NativeTerminalHostSupervisor } from "./supervisor.js";
import { defaultNativeTerminalSocketPath, knownNativeTerminalSocketPaths,
  inspectPrivateNativeTerminalSocket, sameNativeTerminalSocket } from "./socket-path.js";
import { collectNativeInventory, resolveNativeOwner, type NativeInventory } from "./fleet.js";
import { renderTerminalScreen } from "./screen.js";

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
  return collectNativeInventory(pinned ? [pinned] : knownNativeTerminalSocketPaths(), connectExisting);
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
    const client = existsSync(imposed) ? await connectExisting(imposed) : await ensureClient(imposed);
    // An imposed endpoint can never silently redirect, even when its mate is
    // available. Capability certification is performed by the caller.
    return { client, socketPath: imposed };
  }
  const historical = paths[0]!;
  // A cold fleet can be initialized. Once either endpoint exists, failure to
  // observe the historical host is unknown, never permission to replace it.
  const cold = !existsSync(dirname(historical));
  const client = cold ? await ensureClient(historical) : await connectExisting(historical);
  const ping = await client.ping();
  if (!fenced || paths.length === 1) return { client, socketPath: historical };
  const compatible = paths[1]!;
  // Initialize the second known endpoint so admission obtains a complete
  // inventory even when the historical host already provides the fence.
  if (existsSync(compatible)) await connectExisting(compatible); // Never reclaim an unreachable known endpoint.
  const second = await ensureClient(compatible);
  return ping.launchFence === true ? { client, socketPath: historical } : { client: second, socketPath: compatible };
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
};

const ATTACH_STATE_POLL_MS = 1_000;
const ATTACH_ACTIVE_POLL_MS = 100;
const ATTACH_IDLE_POLL_MIN_MS = 100;
const ATTACH_IDLE_POLL_MAX_MS = 500;
const ATTACH_RECONNECT_MIN_MS = 100;
const ATTACH_RECONNECT_MAX_MS = 2_000;
const ATTACH_PENDING_INPUT_MAX_BYTES = 64 * 1024;

function defaultAttachRuntime(socketPath: string): NativeTerminalAttachRuntime {
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
export async function runAttach(
  id: string,
  runtime: NativeTerminalAttachRuntime = defaultAttachRuntime(socketPathFromEnv()),
): Promise<number> {
  const stdin = runtime.stdin;
  const stdout = runtime.stdout;
  const isRawCapable = stdin.isTTY === true;
  if (isRawCapable) stdin.setRawMode(true);
  stdin.resume();
  let detached = false;
  let terminalEnded = false;
  let exitCode = 0;
  let active: ActiveAttachConnection | undefined;
  let transportFailure: unknown;
  let recoveryAnnounced = false;
  let pendingInputBytes = 0;
  const pendingInput: Buffer[] = [];
  let inputPump: Promise<void> | undefined;

  const closeActive = (): void => {
    const current = active;
    active = undefined;
    current?.client.close();
  };

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
    if (transportFailure === undefined) transportFailure = error;
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
      stdout.write(
        "\r\n[h2a] native attach input buffer full during reconnect; detaching " +
          "without stopping the session\r\n",
      );
      detached = true;
      closeActive();
      return;
    }
    pendingInput.push(chunk);
    pendingInputBytes += chunk.length;
    pumpInput();
  };
  stdin.on("data", onInput);
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
      );
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
    const initial = await connectAndAcquire();
    if (initial.status === "exited") return initial.exit?.exitCode ?? 0;
    let idlePollMs = ATTACH_IDLE_POLL_MIN_MS;
    let nextStatePollAt = runtime.now() + ATTACH_STATE_POLL_MS;

    for (;;) {
      if (detached) break;

      if (active === undefined || transportFailure !== undefined) {
        closeActive();
        if (!recoveryAnnounced) {
          stdout.write(
            "\r\n[h2a] native terminal connection interrupted; reconnecting " +
              "without restarting the session\r\n",
          );
          recoveryAnnounced = true;
        }
        let reconnectDelayMs = ATTACH_RECONNECT_MIN_MS;
        for (;;) {
          if (detached) break;
          try {
            const state = await connectAndAcquire();
            if (state.status === "exited") {
              exitCode = state.exit?.exitCode ?? 0;
              terminalEnded = true;
              break;
            }
            stdout.write("\r\n[h2a] native terminal reconnected\r\n");
            recoveryAnnounced = false;
            idlePollMs = ATTACH_IDLE_POLL_MIN_MS;
            nextStatePollAt = runtime.now() + ATTACH_STATE_POLL_MS;
            break;
          } catch (error) {
            if (isDefinitiveNativeTerminalAbsence(error)) {
              stdout.write(
                "\r\n[h2a] native session is no longer available; attach stopped\r\n",
              );
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
        for (const chunk of replay.chunks) {
          stdout.write(chunk.data);
          seq = chunk.seq;
        }
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
          if (state.status === "exited") {
            exitCode = state.exit?.exitCode ?? 0;
            break;
          }
        }
      } catch (error) {
        if (detached) break;
        if (isDefinitiveNativeTerminalAbsence(error)) {
          stdout.write(
            "\r\n[h2a] native session is no longer available; attach stopped\r\n",
          );
          exitCode = 1;
          break;
        }
        markTransportFailure(current, error);
      }
    }
  } finally {
    runtime.offResize(resize);
    stdin.removeListener("data", onInput);
    if (isRawCapable) stdin.setRawMode(false);
    stdin.pause();
    if (inputPump !== undefined) await inputPump.catch(() => {});
    const current = active;
    active = undefined;
    if (current !== undefined) {
      await current.client.releaseController(current.lease).catch(() => {});
      current.client.close();
    }
  }
  if (detached) {
    stdout.write("\r\n[h2a] detached from native session (session keeps running)\r\n");
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
        emit({ code: "native-inventory-unknown", hosts: [{ socketPath,
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
        hosts: inventory.hosts.map(({ socketPath, reason }) => ({ socketPath, reachable: reason === undefined, ...(reason ? { reason } : {}) })) });
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
      //             ENOENT/ECONNREFUSED never certify absence across hosts.
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
    case "kill": {
      const id = required(parsed, "id");
      const { client } = await owningClient(parsed, id);
      const signal = parsed.flags.get("signal") ?? "SIGTERM";
      if (signal !== "SIGTERM" && signal !== "SIGKILL" && signal !== "SIGINT" && signal !== "SIGHUP") {
        throw new Error(`unsupported signal: ${signal}`);
      }
      const before = await client.state(id);
      if (before.status !== "exited") {
        await withController(client, id, async (lease) => {
          await client.stop(lease, signal);
        });
        const deadline = Date.now() + 4_000;
        for (;;) {
          const state = await client.state(id);
          if (state.status === "exited") break;
          if (Date.now() >= deadline) {
            await withController(client, id, async (lease) => {
              await client.stop(lease, "SIGKILL");
            }).catch(() => {});
            await delay(300);
            break;
          }
          await delay(100);
        }
      }
      const after = await client.state(id);
      client.close();
      emit(after);
      return after.status === "exited" ? 0 : 1;
    }
    case "stop-if-incarnation":
    case "kill-if-incarnation": {
      const id = required(parsed, "id");
      const { client } = await owningClient(parsed, id);
      const generation = required(parsed, "generation");
      const incarnation = required(parsed, "incarnation");
      const signal = parsed.flags.get("signal") ?? "SIGTERM";
      if (signal !== "SIGTERM" && signal !== "SIGKILL" && signal !== "SIGINT" && signal !== "SIGHUP") {
        throw new Error(`unsupported signal: ${signal}`);
      }
      const before = await client.state(id);
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
            ).catch(() => {});
            await delay(300);
            break;
          }
          await delay(100);
        }
      }
      const after = await client.state(id);
      client.close();
      emit(after);
      return after.status === "exited" ? 0 : 1;
    }
    case "attach": {
      const id = required(parsed, "id");
      const owner = await owningClient(parsed, id);
      owner.client.close();
      // Reconnects retain this owner for the entire interactive operation.
      return runAttach(id, defaultAttachRuntime(owner.socketPath));
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
