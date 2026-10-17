import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same injectability boundary as attach-reconnect-livelock.test.ts: the
// reconnect path heals the tunnel before reopening the stream.
vi.mock("./tunnel.js", () => ({
  ensureConnected: async () => {},
  stopTunnel: async () => {},
}));

import { attach } from "./attach.js";
import { readCrashLog, resolveCrashLogPath } from "./crash-log.js";

function ssePayload(envelopes: Array<Record<string, unknown>>): string {
  return (
    envelopes
      .map(
        (envelope) =>
          `event: ${String(envelope.type)}\ndata: ${JSON.stringify(envelope)}`,
      )
      .join("\n\n") + "\n\n"
  );
}

function streamFromString(payload: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

function stubStdin(): NodeJS.ReadStream {
  return {
    isTTY: false,
    setRawMode() { return this; },
    resume() {},
    pause() {},
    on() { return this; },
    off() { return this; },
  } as unknown as NodeJS.ReadStream;
}

function stubStdout(): NodeJS.WriteStream {
  return {
    columns: 100,
    rows: 30,
    write() { return true; },
    on() { return this; },
    off() { return this; },
  } as unknown as NodeJS.WriteStream;
}

describe("attach crash records (revcrashlog constat 2)", () => {
  let root = "";
  let previousStateHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "h2a-attachcrash-"));
    previousStateHome = process.env["XDG_STATE_HOME"];
    process.env["XDG_STATE_HOME"] = join(root, "state");
  });

  afterEach(() => {
    if (previousStateHome === undefined) delete process.env["XDG_STATE_HOME"];
    else process.env["XDG_STATE_HOME"] = previousStateHome;
    rmSync(root, { recursive: true, force: true });
  });

  function attachRows() {
    return readCrashLog("attach", resolveCrashLogPath("attach", { XDG_STATE_HOME: join(root, "state") }));
  }

  it("records the envelope exit code and signal on terminal.exited", async () => {
    const fetchImpl = (async () =>
      new Response(
        streamFromString(
          ssePayload([{ type: "terminal.exited", payload: { exitCode: 3, signal: "9" } }]),
        ),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      )) as typeof fetch;
    const session = await attach({
      baseUrl: "http://127.0.0.1:1",
      sessionId: "sess-exit-code",
      stdin: stubStdin(),
      stdout: stubStdout(),
      fetchImpl,
    });
    await session.finished;
    const rows = attachRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event: "sessionExit",
      sessionId: "sess-exit-code",
      exitCode: 3,
      signal: "SIGKILL",
    });
  });

  it("records a failed reopen as exit, not as a child exit", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        // First open succeeds with an instantly-closing stream (no progress).
        return new Response(
          new ReadableStream<Uint8Array>({ start(c) { c.close(); } }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      return new Response("down", { status: 500 });
    }) as unknown as typeof fetch;
    const session = await attach({
      baseUrl: "http://127.0.0.1:1",
      sessionId: "sess-no-reopen",
      stdin: stubStdin(),
      stdout: stubStdout(),
      fetchImpl,
      reconnect: { minStreamMs: 1000, baseDelayMs: 1, maxDelayMs: 2, maxShortCycles: 10, maxAttempts: 2 },
    });
    await session.finished;
    const rows = attachRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event: "exit", sessionId: "sess-no-reopen", reason: "reconnect-failed" });
  });
});
