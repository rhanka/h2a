import {
  REMOTE_PROTOCOL_VERSION,
  REMOTE_SCHEMA_VERSION,
  type RemoteEventEnvelope,
} from "./protocol-local.js";

import { resolveProfile, withResume, type ProfileConfig } from "./profiles.js";
import { nodePtySpawner, type PtyHandle, type PtySpawner } from "./pty.js";
import {
  resetClientTerminal,
  restoreTtyState,
  saveTtyState,
  SIGNAL_NUMBERS,
} from "./terminal-reset.js";

export type RunOptions = {
  readonly profile: string;
  readonly resume?: string | true | undefined;
  readonly port?: number;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Only an explicit gateway choice may preserve routing at the PTY boundary. */
  readonly gatewayMode?: "gateway" | "direct";
  readonly startupArgs?: ReadonlyArray<string>;
  readonly stdin?: NodeJS.ReadStream;
  readonly stdout?: NodeJS.WriteStream;
  readonly spawner?: PtySpawner;
  readonly randomId?: (prefix: string) => string;
  readonly clock?: () => Date;
  readonly initialSize?: { cols: number; rows: number };
};

function defaultRandomId(prefix: string): string {
  const random = Math.floor(Math.random() * 1e12)
    .toString(36)
    .padStart(8, "0");
  return `${prefix}-${random}`;
}

const CONTROL_PLANE_ACTOR = {
  id: "remote-cli",
  kind: "control-plane" as const,
  displayName: "Remote CLI",
};

const AGENT_ACTOR = {
  id: "remote-cli-agent",
  kind: "session-agent" as const,
  displayName: "Remote CLI Agent",
};

type SessionRuntime = {
  readonly sessionId: string;
  readonly profile: ProfileConfig;
  readonly handle: PtyHandle;
  sequence: number;
  exited: boolean;
};

function buildEnvelope(
  runtime: SessionRuntime,
  type: RemoteEventEnvelope["type"],
  payload: Record<string, unknown>,
  randomId: (prefix: string) => string,
  clock: () => Date,
  actor = AGENT_ACTOR,
): RemoteEventEnvelope {
  return {
    protocolVersion: REMOTE_PROTOCOL_VERSION,
    schemaVersion: REMOTE_SCHEMA_VERSION,
    eventId: randomId("evt"),
    sessionId: runtime.sessionId,
    sequence: runtime.sequence++,
    type,
    occurredAt: clock().toISOString(),
    correlationId: `cli-${runtime.sessionId}`,
    actor,
    payload,
  };
}

export type RunResult = {
  readonly sessionId: string;
  readonly port: number;
  readonly exit: Promise<{ exitCode: number; signal?: number }>;
  readonly stop: () => Promise<void>;
};

export async function run(options: RunOptions): Promise<RunResult> {
  const [{ serve }, { Hono }, { streamSSE }] = await Promise.all([
    import("@hono/node-server"), import("hono"), import("hono/streaming"),
  ]);
  const profile = withResume(resolveProfile(options.profile), options.resume);
  const randomId = options.randomId ?? defaultRandomId;
  const clock = options.clock ?? (() => new Date());
  const spawner = options.spawner ?? nodePtySpawner;
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const cwd = options.cwd ?? process.cwd();
  const initialCols = options.initialSize?.cols ?? stdout.columns ?? 80;
  const initialRows = options.initialSize?.rows ?? stdout.rows ?? 24;
  const startupArgs = options.startupArgs ?? [];
  const childEnv = { ...(options.env ?? (process.env as Record<string, string>)) };
  if (options.gatewayMode !== "gateway") {
    delete childEnv.ANTHROPIC_BASE_URL;
    delete childEnv.ANTHROPIC_AUTH_TOKEN;
  }

  const handle = spawner({
    command: profile.command,
    args: [...profile.args, ...startupArgs],
    cwd,
    env: childEnv,
    cols: initialCols,
    rows: initialRows,
  });

  const sessionId = randomId("sess");
  const terminalId = randomId("term");
  const subscribers = new Set<(envelope: RemoteEventEnvelope) => void>();
  const runtime: SessionRuntime = {
    sessionId,
    profile,
    handle,
    sequence: 0,
    exited: false,
  };

  const broadcast = (envelope: RemoteEventEnvelope) => {
    for (const subscriber of subscribers) subscriber(envelope);
  };

  // Forward PTY output to host stdout AND broadcast as terminal.output.
  handle.onData((chunk) => {
    stdout.write(chunk);
    broadcast(
      buildEnvelope(
        runtime,
        "terminal.output",
        {
          terminalId,
          stream: "stdout",
          data: chunk,
          encoding: "utf8",
        },
        randomId,
        clock,
      ),
    );
  });

  // rev351-2/3.2: the PTY child drives the REAL client terminal (raw stdin
  // + direct VT bytes). Save termios + raw mode so every exit path restores
  // both the VT modes and the kernel TTY state, even when the CLI dies by
  // signal after enabling focus/mouse/alternate-screen/Kitty modes.
  // rev351r2-2: shared save/restore home (terminal-reset.ts), no local copy.
  const ttyState = saveTtyState(stdin);
  const restoreClientTerminal = (): void => {
    restoreTtyState(ttyState, stdin, () => resetClientTerminal(stdout));
  };
  // Async bridge: the event loop runs, so signal handlers CAN execute here
  // (unlike the blocking spawnSync wrappers). Reset + restore, then preserve
  // signal-death semantics via 128+n like the native attach path.
  // rev351r2-5: installed BEFORE stdin goes raw and BEFORE the control-plane
  // listen, so a signal during the startup window (or a listen failure below)
  // still restores instead of leaving the terminal raw.
  const signalHandlers = new Map<string, () => void>();
  const uninstallSignals = (): void => {
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
    signalHandlers.clear();
  };
  for (const signal of ["SIGHUP", "SIGINT", "SIGQUIT", "SIGTERM"] as const) {
    const number = SIGNAL_NUMBERS[signal] ?? 0;
    const handler = (): void => {
      try {
        restoreClientTerminal();
      } finally {
        try {
          handle.kill();
        } catch {
          // Best effort before exiting.
        }
        uninstallSignals();
        process.exit(128 + (number as number));
      }
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }
  // Forward host stdin to the PTY.
  if (stdin.isTTY) {
    stdin.setRawMode?.(true);
  }
  stdin.resume();
  stdin.on("data", (data: Buffer | string) => {
    const text = typeof data === "string" ? data : data.toString("utf8");
    handle.write(text);
  });

  // Resize PTY when the host terminal resizes.
  const onResize = () => {
    handle.resize(stdout.columns ?? initialCols, stdout.rows ?? initialRows);
  };
  stdout.on?.("resize", onResize);

  // Open control-plane in-process for remote attach.
  const app = new Hono();

  app.get("/healthz", (c) =>
    c.json({ ok: true, sessionId, profile: profile.profile }),
  );

  app.get(`/sessions/${sessionId}`, (c) =>
    c.json({
      session: {
        id: sessionId,
        profile: profile.profile,
        target: "k3s",
        workspacePath: cwd,
        createdAt: clock().toISOString(),
        createdBy: CONTROL_PLANE_ACTOR,
      },
    }),
  );

  app.get(`/sessions/${sessionId}/events`, (c) => {
    return streamSSE(c, async (stream) => {
      const queue: RemoteEventEnvelope[] = [];
      let notify: (() => void) | null = null;
      const subscriber = (envelope: RemoteEventEnvelope) => {
        queue.push(envelope);
        const wake = notify;
        notify = null;
        wake?.();
      };
      subscribers.add(subscriber);
      stream.onAbort(() => {
        subscribers.delete(subscriber);
      });
      try {
        while (!stream.aborted) {
          while (queue.length > 0 && !stream.aborted) {
            const envelope = queue.shift();
            if (!envelope) break;
            await stream.writeSSE({
              event: envelope.type,
              data: JSON.stringify(envelope),
              id: envelope.eventId,
            });
          }
          if (stream.aborted) break;
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
        }
      } finally {
        subscribers.delete(subscriber);
      }
    });
  });

  app.post(`/sessions/${sessionId}/terminal/input`, async (c) => {
    const body = (await c.req.json()) as { data?: string };
    if (typeof body.data === "string") handle.write(body.data);
    return c.json({ accepted: true }, 202);
  });

  const port = options.port ?? 0;
  const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });

  // rev351r2-5: a listen failure (explicit port already bound) used to reject
  // with stdin already raw and no reset. Restore like every other exit path.
  let actualPort = port;
  try {
    const address = server.address();
    if (address && typeof address === "object") {
      actualPort = address.port;
    } else {
      await new Promise<void>((resolve, reject) => {
        server.once("listening", () => {
          const addr = server.address();
          if (addr && typeof addr === "object") actualPort = addr.port;
          resolve();
        });
        server.once("error", reject);
      });
    }
  } catch (error) {
    uninstallSignals();
    restoreClientTerminal();
    try {
      handle.kill();
    } catch {
      // Best effort; the session never started.
    }
    try {
      server.close();
    } catch {
      // Best effort; a failed listen holds nothing.
    }
    throw error;
  }

  // Emit terminal.opened announcement.
  broadcast(
    buildEnvelope(
      runtime,
      "terminal.opened",
      { terminalId, shell: profile.command },
      randomId,
      clock,
    ),
  );

  // Wire exit.
  let resolveExit!: (result: { exitCode: number; signal?: number }) => void;
  const exit = new Promise<{ exitCode: number; signal?: number }>((resolve) => {
    resolveExit = resolve;
  });
  handle.onExit((event) => {
    if (runtime.exited) return;
    runtime.exited = true;
    broadcast(
      buildEnvelope(
        runtime,
        "terminal.exited",
        {
          terminalId,
          exitCode: event.exitCode,
          ...(event.signal !== undefined
            ? { signal: String(event.signal) }
            : {}),
        },
        randomId,
        clock,
      ),
    );
    uninstallSignals();
    restoreClientTerminal();
    server.close();
    resolveExit(event);
  });

  return {
    sessionId,
    port: actualPort,
    exit,
    async stop() {
      handle.kill();
      await exit;
    },
  };
}
