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
 *   write   --id X --b64 TEXT         raw keystrokes (base64, controller-scoped)
 *   paste   --id X --b64 TEXT         ONE bracketed-paste block (tmux paste -p twin)
 *   enter   --id X                    submit (CR)
 *   capture --id X [--bytes N]        -> {text} ANSI-stripped tail of the stream
 *   pid     --id X                    -> {pid}
 *   kill    --id X [--signal S]       stop the session (escalates to SIGKILL)
 *   attach  --id X                    interactive raw bridge on this terminal
 *                                     (detach: Ctrl-\\ ; exits when session exits)
 *   host-stop                         SIGTERM the host process (sessions stop)
 */
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { NativeTerminalClient } from "./client.js";
import { NativeTerminalRemoteError } from "./protocol.js";
import {
  NativeTerminalHost,
  type NativeTerminalControllerLease,
  type NativeTerminalReapOutcome,
} from "./host.js";
import { NativeTerminalHostSupervisor } from "./supervisor.js";
import { defaultNativeTerminalSocketPath } from "./socket-path.js";

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

async function connectExisting(socketPath: string): Promise<NativeTerminalClient> {
  const client = await NativeTerminalClient.connect(socketPath);
  openClients.add(client);
  return client;
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

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function killPersistedSessionGroup(
  id: string,
  signal: "SIGHUP" | "SIGINT" | "SIGTERM" | "SIGKILL",
  registryPath?: string,
): Promise<NativeTerminalReapOutcome> {
  // `h2a stop` is an administrative lifecycle act, not terminal input. The
  // interactive `stop` protocol requires the caller to own the exclusive
  // controller lease, so it necessarily fails while an attach client owns
  // that lease. Reuse the already-hardened persisted-PGID reaper instead: it
  // re-resolves and re-proves the exact process-group identity at act time,
  // signals only that group, and waits for confirmed death. This path uses no
  // new host protocol operation, so a host kept alive across a CLI upgrade is
  // compatible.
  const reaper = new NativeTerminalHost({
    generation: `h2a-op-reaper-${process.pid}`,
    replayBytesPerSession: 1,
    spawner: () => {
      throw new Error("the one-shot session reaper must never spawn a PTY");
    },
    ...(registryPath !== undefined ? { registryPath } : {}),
    forceKillTimeoutMs: 4_000,
  });
  return reaper.reapOrphan(id, signal);
}

export function nativeSessionKillStrategy(
  platform: NodeJS.Platform = process.platform,
): "persisted-pgid" | "controller" {
  // Persisted process-group identity is re-provable through /proc on Linux.
  // Preserve the protocol-v1 controller path elsewhere: the POSIX reaper
  // cannot establish the same identity proof there and must not guess.
  return platform === "linux" ? "persisted-pgid" : "controller";
}

export function nativeSessionDeathConfirmed(
  beforeIncarnation: string,
  reaperOutcome: NativeTerminalReapOutcome | undefined,
  projected: Readonly<{
    incarnation: string;
    status: "running" | "stopping" | "exited";
  }>,
): boolean {
  // The host's onExit projection is asynchronous and has no timing SLA. Once
  // the persisted-PGID reaper has confirmed the OS group empty, a lagging host
  // snapshot of the SAME incarnation must never turn that positive death
  // proof back into a failure. A newly-created incarnation with the same id is
  // different live work and must never inherit the old process group's proof.
  return (
    projected.status === "exited" ||
    (reaperOutcome?.status === "reaped" &&
      projected.incarnation === beforeIncarnation)
  );
}

async function runAttach(client: NativeTerminalClient, id: string): Promise<number> {
  const lease = await client.acquireController(id, `h2a-attach-${process.pid}`);
  const stdin = process.stdin;
  const stdout = process.stdout;
  const isRawCapable = stdin.isTTY === true;
  if (isRawCapable) stdin.setRawMode(true);
  stdin.resume();
  let detached = false;
  let exitCode = 0;
  const onInput = (chunk: Buffer): void => {
    if (chunk.includes(DETACH_BYTE)) {
      detached = true;
      return;
    }
    void client.write(lease, chunk.toString("utf8")).catch(() => {
      detached = true;
    });
  };
  stdin.on("data", onInput);
  const resize = (): void => {
    if (stdout.columns && stdout.rows) {
      void client.resize(lease, stdout.columns, stdout.rows).catch(() => {});
    }
  };
  process.on("SIGWINCH", resize);
  resize();
  // Paint the existing scrollback once, then follow the stream.
  let seq = 0;
  try {
    for (;;) {
      if (detached) break;
      const replay = await client.readOutput(id, seq);
      for (const chunk of replay.chunks) {
        stdout.write(chunk.data);
        seq = chunk.seq;
      }
      const state = await client.state(id);
      if (state.status === "exited") {
        exitCode = state.exit?.exitCode ?? 0;
        break;
      }
      await delay(40);
    }
  } finally {
    process.removeListener("SIGWINCH", resize);
    stdin.removeListener("data", onInput);
    if (isRawCapable) stdin.setRawMode(false);
    stdin.pause();
    await client.releaseController(lease).catch(() => {});
  }
  if (detached) {
    stdout.write("\r\n[h2a] detached from native session (session keeps running)\r\n");
  }
  return exitCode;
}

export async function runNativeTerminalOp(argv: ReadonlyArray<string>): Promise<number> {
  const parsed = parseArgv(argv);
  const socketPath = socketPathFromEnv();

  switch (parsed.op) {
    case "ensure-host": {
      const client = await ensureClient(socketPath);
      const ping = await client.ping();
      client.close();
      emit({ hostPid: ping.hostPid, generation: ping.generation, socketPath });
      return 0;
    }
    case "list": {
      let client: NativeTerminalClient;
      try {
        client = await connectExisting(socketPath);
      } catch {
        emit({ sessions: [] });
        return 0;
      }
      const sessions = await client.list();
      client.close();
      emit({ sessions });
      return 0;
    }
    case "state": {
      const client = await connectExisting(socketPath);
      const state = await client.state(required(parsed, "id"));
      client.close();
      emit(state);
      return 0;
    }
    case "probe": {
      // 3-state liveness probe (F2). Emits a VERDICT on exit 0 instead of a
      // generic nonzero exit, so the synchronous caller never has to guess
      // whether a failure meant "no session" or "the op broke":
      //  - live:    a reachable host answered and the session is running
      //  - dead:    POSITIVE proof — a reachable host does not know the
      //             session, or no host is listening at all (a PTY cannot
      //             outlive its host process — the tmux-server death rule)
      //  - unknown: anything else; never proof of death.
      const id = required(parsed, "id");
      let client: NativeTerminalClient;
      try {
        client = await connectExisting(socketPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ECONNREFUSED" || code === "ENOENT") {
          emit({ verdict: "dead", reason: `native host is not running (${code})` });
        } else {
          emit({
            verdict: "unknown",
            reason: error instanceof Error ? error.message : String(error),
          });
        }
        return 0;
      }
      try {
        const state = await client.state(id);
        emit({
          verdict: state.status === "running" ? "live" : "dead",
          state,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // The host's own "unknown terminal session" refusal is a POSITIVE
        // absence verdict from a reachable host; any other remote/protocol
        // error proves nothing (fail closed on the caller side).
        emit(
          error instanceof NativeTerminalRemoteError &&
            message.includes("unknown terminal session")
            ? { verdict: "dead", reason: message }
            : { verdict: "unknown", reason: message },
        );
      } finally {
        client.close();
      }
      return 0;
    }
    case "create": {
      const client = await ensureClient(socketPath);
      const id = required(parsed, "id");
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
    case "write":
    case "paste": {
      const client = await connectExisting(socketPath);
      const id = required(parsed, "id");
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
      const client = await connectExisting(socketPath);
      await withController(client, required(parsed, "id"), (lease) =>
        client.write(lease, "\r"),
      );
      client.close();
      emit({ ok: true });
      return 0;
    }
    case "capture": {
      const client = await connectExisting(socketPath);
      const raw = await readAll(client, required(parsed, "id"));
      client.close();
      const budget = Number(parsed.flags.get("bytes") ?? 16384);
      emit({ text: stripAnsi(raw.slice(-budget)) });
      return 0;
    }
    case "pid": {
      const client = await connectExisting(socketPath);
      const state = await client.state(required(parsed, "id"));
      client.close();
      emit({ pid: state.pid, status: state.status });
      return 0;
    }
    case "kill": {
      const client = await connectExisting(socketPath);
      const id = required(parsed, "id");
      const signal = parsed.flags.get("signal") ?? "SIGTERM";
      if (signal !== "SIGTERM" && signal !== "SIGKILL" && signal !== "SIGINT" && signal !== "SIGHUP") {
        throw new Error(`unsupported signal: ${signal}`);
      }
      const before = await client.state(id);
      let reaperOutcome: NativeTerminalReapOutcome | undefined;
      if (before.status !== "exited") {
        if (nativeSessionKillStrategy() === "persisted-pgid") {
          const registryPath = parsed.flags.get("registry-path");
          reaperOutcome = await killPersistedSessionGroup(
            id,
            signal,
            registryPath,
          );
          if (
            reaperOutcome.status === "reap-timed-out" &&
            signal !== "SIGKILL"
          ) {
            reaperOutcome = await killPersistedSessionGroup(
              id,
              "SIGKILL",
              registryPath,
            );
          }
          if (reaperOutcome.status !== "reaped") {
            const detail =
              reaperOutcome.status === "refused"
                ? reaperOutcome.reason
                : `process group did not confirm dead within ${reaperOutcome.elapsedMs}ms`;
            throw new Error(
              `native session ${id} could not be killed: ${detail}`,
            );
          }
        } else {
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
      }
      const after = await client.state(id);
      client.close();
      const confirmed = nativeSessionDeathConfirmed(
        before.incarnation,
        reaperOutcome,
        after,
      );
      emit(
        reaperOutcome?.status === "reaped" &&
          after.status !== "exited" &&
          after.incarnation === before.incarnation
          ? {
              ...after,
              status: "exited",
              deathConfirmed: "persisted-pgid",
            }
          : after,
      );
      return confirmed ? 0 : 1;
    }
    case "attach": {
      const client = await connectExisting(socketPath);
      const code = await runAttach(client, required(parsed, "id"));
      client.close();
      return code;
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
