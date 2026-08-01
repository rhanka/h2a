import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import type { PtyHandle, PtySpawner } from "./pty.js";
import { run } from "./run.js";

/**
 * What the run server's HTTP surface is, and what it is NOT.
 *
 * `run()` instantiated a `@hono/node-ws` adapter and injected its upgrade
 * listener, but no route ever called `upgradeWebSocket` — the routes are plain
 * HTTP and one SSE stream. The route inventory from `run.ts` is:
 * - `GET /healthz`
 * - `GET /sessions/${sessionId}`
 * - `GET /sessions/${sessionId}/events` (SSE)
 * - `POST /sessions/${sessionId}/terminal/input`
 * Adding a route to `run.ts` means adding it here, so this guard's proof stays
 * equal to the surface it guards. The adapter served nothing, while being the
 * sole remaining lockfile path on two accepted-vulnerability rows.
 *
 * These assertions hold BEFORE and AFTER that dead wiring is removed, which is
 * the point: they characterise the surface rather than guard a migration. The
 * second is the durable one — if a WebSocket route is ever added here it fails,
 * and whoever adds it has to decide deliberately what serves the upgrade.
 */

type StubPty = PtyHandle & {
  readonly writes: string[];
  emitData(chunk: string): void;
  emitExit(exitCode: number, signal?: number): void;
};

function stubSpawner(): { spawner: PtySpawner; pty: StubPty } {
  let dataHandler: (chunk: string) => void = () => {};
  let exitHandler: (event: {
    exitCode: number;
    signal?: number;
  }) => void = () => {};
  const writes: string[] = [];
  const pty: StubPty = {
    cols: 80,
    rows: 24,
    write(data) {
      writes.push(data);
    },
    resize() {},
    // A real PTY reports its exit when killed; `stop()` awaits that, so a
    // no-op kill leaves the process hanging forever.
    kill() {
      exitHandler({ exitCode: 0 });
    },
    onData(handler) {
      dataHandler = handler;
      return { dispose() {} };
    },
    onExit(handler) {
      exitHandler = handler;
      return { dispose() {} };
    },
    writes,
    emitData(chunk) {
      dataHandler(chunk);
    },
    emitExit(exitCode, signal) {
      const event: { exitCode: number; signal?: number } = { exitCode };
      if (signal !== undefined) event.signal = signal;
      exitHandler(event);
    },
  };
  return {
    pty,
    spawner: () => pty,
  };
}

function stubStdin(): NodeJS.ReadStream {
  const listeners: Array<(data: Buffer) => void> = [];
  return {
    isTTY: false,
    setRawMode() {
      return this as unknown as NodeJS.ReadStream;
    },
    resume() {},
    pause() {},
    on(event: string, listener: (data: Buffer) => void) {
      if (event === "data") listeners.push(listener);
      return this as unknown as NodeJS.ReadStream;
    },
    emit(event: string, ...args: unknown[]) {
      if (event === "data") for (const l of listeners) l(args[0] as Buffer);
      return true;
    },
  } as unknown as NodeJS.ReadStream;
}

function stubStdout(): NodeJS.WriteStream & { written: string[] } {
  const written: string[] = [];
  return {
    columns: 100,
    rows: 30,
    write(chunk: string | Buffer) {
      written.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      return true;
    },
    on() {
      return this as unknown as NodeJS.WriteStream;
    },
    written,
  } as unknown as NodeJS.WriteStream & { written: string[] };
}

async function startRun() {
  const { spawner } = stubSpawner();
  return run({
    profile: "shell",
    port: 0,
    spawner,
    stdin: stubStdin(),
    stdout: stubStdout(),
    initialSize: { cols: 80, rows: 24 },
  });
}

describe("run server — HTTP surface, and the absence of a websocket one", () => {
  it("serves its HTTP routes on an ephemeral port", async () => {
    const result = await startRun();
    try {
      expect(result.port).toBeGreaterThan(0);
      const response = await fetch(`http://127.0.0.1:${result.port}/healthz`);
      expect(response.status).toBe(200);
    } finally {
      await result.stop();
    }
  });

  it("does NOT serve a WebSocket upgrade on any of its routes", async () => {
    // The adapter was wired in and injected; nothing ever upgraded. Removing it
    // must therefore change nothing observable here — and if a real WebSocket
    // route is added later, this assertion is what makes that a decision.
    const result = await startRun();
    try {
      for (const path of [
        "/healthz",
        `/sessions/${result.sessionId}`,
        `/sessions/${result.sessionId}/events`,
        `/sessions/${result.sessionId}/terminal/input`,
      ]) {
        const socket = new WebSocket(`ws://127.0.0.1:${result.port}${path}`);
        const opened = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), 3_000);
          socket.once("open", () => {
            clearTimeout(timer);
            resolve(true);
          });
          socket.once("error", () => {
            clearTimeout(timer);
            resolve(false);
          });
        });
        socket.close();
        expect(opened, `${path} must not complete a WebSocket handshake`).toBe(
          false,
        );
      }
    } finally {
      await result.stop();
    }
  });
});
