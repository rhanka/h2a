import { request as RAW_HTTP } from "node:http";

import { describe, expect, it } from "vitest";

import type { PtyHandle, PtySpawner } from "./pty.js";
import { run } from "./run.js";

/**
 * GHSA-jpvv-r467-5p4w — the `run()` session host opens an in-process
 * control-plane on @hono/node-server (bind 127.0.0.1). Before 2.1.6 the
 * adapter ran any request-target that failed its strict validation through
 * the WHATWG URL parser, which maps "\" to "/" and collapses ".." segments:
 * `GET /healthz\..\sessions\<id>` reached the app as `/sessions/<id>` — the
 * per-session descriptor route answered from behind the public /healthz
 * prefix. The patched adapter refuses raw-backslash targets with 400 before
 * routing; the encoded corpus (%5C, %5c, ..%5C, %255C) stays un-routed
 * percent-encoded and must never resolve into a session route.
 */

const RAW_BACKSLASH_TARGETS = (sessionId: string): string[] => [
  `/healthz\\..\\sessions\\${sessionId}`,
  `/healthz\\..\\..\\sessions\\${sessionId}`,
  `/sessions\\${sessionId}\\events`,
];

const ENCODED_BACKSLASH_TARGETS = (sessionId: string): string[] => [
  `/healthz/..%5Csessions/${sessionId}`,
  `/healthz/..%5csessions/${sessionId}`,
  `/healthz/..%5C..%5Csessions/${sessionId}`,
  `/healthz/%2e%2e%5Csessions/${sessionId}`,
  `/healthz/..%255Csessions/${sessionId}`,
];

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
    pid: 61002,
    pgid: 61002,
    cols: 80,
    rows: 24,
    write(data) {
      writes.push(data);
    },
    resize() {},
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
  return { spawner: () => pty, pty };
}

function stubStdin(): NodeJS.ReadStream {
  const listeners: Array<(data: Buffer) => void> = [];
  return {
    isTTY: false,
    resume() {},
    pause() {},
    on(event: string, listener: (data: Buffer) => void) {
      if (event === "data") listeners.push(listener);
      return this as unknown as NodeJS.ReadStream;
    },
    emit(event: string, ...args: unknown[]) {
      if (event === "data") for (const listener of listeners) listener(args[0] as Buffer);
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

function rawGet(port: number, target: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = RAW_HTTP({ host: "127.0.0.1", port, path: target, method: "GET" }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.once("error", (error) => reject(new Error(`raw GET ${JSON.stringify(target)} failed: ${error.message}`)));
    req.end();
  });
}

describe("run server — backslash request targets (GHSA-jpvv-r467-5p4w)", () => {
  it("refuses raw-backslash request targets at the adapter boundary (400), before any routing", async () => {
    const result = await startRun();
    try {
      for (const target of RAW_BACKSLASH_TARGETS(result.sessionId)) {
        const response = await rawGet(result.port, target);
        // On the vulnerable adapter (2.1.5) the WHATWG rewrite routes
        // /healthz\..\sessions\<id> straight into GET /sessions/<id>, which
        // answers 200 with the session descriptor JSON from behind the
        // public /healthz prefix. This expectation was RED there.
        expect(response.status, `target ${JSON.stringify(target)} must be refused by the server`).toBe(400);
        expect(response.body).not.toContain(result.sessionId);
      }
    } finally {
      await result.stop();
    }
  });

  it("never resolves an encoded-backslash traversal into a session route", async () => {
    const result = await startRun();
    try {
      for (const target of ENCODED_BACKSLASH_TARGETS(result.sessionId)) {
        const response = await rawGet(result.port, target);
        expect(response.status, `target ${JSON.stringify(target)} must not be resolved into a session route`).toBe(404);
        expect(response.body).not.toContain(result.sessionId);
      }
    } finally {
      await result.stop();
    }
  });
});
