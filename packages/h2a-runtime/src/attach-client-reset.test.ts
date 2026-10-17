import { describe, expect, it } from "vitest";

import { attach } from "./attach.js";

const E = "\x1b";

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

function ttyStdin() {
  const listeners: Array<(data: Buffer) => void> = [];
  const rawCalls: boolean[] = [];
  const stdin = {
    isTTY: true,
    isRaw: false,
    fd: undefined as unknown as number | undefined,
    setRawMode(raw: boolean) {
      rawCalls.push(raw);
      (stdin as { isRaw: boolean }).isRaw = raw;
      return stdin;
    },
    resume() {},
    pause() {},
    on(event: string, listener: (data: Buffer) => void) {
      if (event === "data") listeners.push(listener);
      return stdin;
    },
    off(event: string, listener: (data: Buffer) => void) {
      if (event === "data") {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      }
      return stdin;
    },
    emit(event: string, ...args: unknown[]) {
      if (event === "data")
        for (const listener of [...listeners])
          listener(args[0] as Buffer);
      return true;
    },
    rawCalls,
  } as unknown as NodeJS.ReadStream & {
    rawCalls: boolean[];
    emit(event: string, data: Buffer): boolean;
  };
  return stdin;
}

function ttyStdout() {
  const written: string[] = [];
  const stdout = {
    isTTY: true,
    fd: undefined as unknown as number | undefined,
    columns: 100,
    rows: 30,
    write(chunk: string | Buffer) {
      written.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      return true;
    },
    on() {
      return stdout;
    },
    off() {
      return stdout;
    },
    written,
  } as unknown as NodeJS.WriteStream & { written: string[] };
  return stdout;
}

const CLIENT_SIGNALS = ["SIGHUP", "SIGINT", "SIGQUIT", "SIGTERM"] as const;

function baselineListeners(): number[] {
  return CLIENT_SIGNALS.map((s) => process.listenerCount(s));
}

function expectNoListenerLeak(before: number[]): void {
  CLIENT_SIGNALS.forEach((s, i) => {
    expect(process.listenerCount(s)).toBe(before[i]);
  });
}

function removeExtraListeners(before: number[]): void {
  CLIENT_SIGNALS.forEach((s, i) => {
    const extra = process.listenerCount(s) - (before[i] ?? 0);
    if (extra <= 0) return;
    for (const listener of process.listeners(s).slice(-extra)) {
      process.removeListener(s, listener);
    }
  });
}

function nullStderr() {
  const written: string[] = [];
  return {
    written,
    stderr: {
      write: (chunk: string) => {
        written.push(String(chunk));
        return true;
      },
    } as unknown as NodeJS.WriteStream,
  };
}

/** An SSE stream that stays open forever (until aborted). */
function hangingStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start() {} });
}

function sseResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("attach client terminal reset (rev351-2)", () => {
  it("should emit the VT reset when the remote session exits", async () => {
    const stdout = ttyStdout();
    const stdin = ttyStdin();
    const fetchImpl = (async () => {
      const body = ssePayload([
        {
          type: "terminal.output",
          payload: { data: `${E}[?1004h${E}[?2004hlive\n` },
        },
        { type: "terminal.exited", payload: { exitCode: 0 } },
      ]);
      return new Response(streamFromString(body), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;
    const session = await attach({
      baseUrl: "http://localhost:8080",
      sessionId: "sess-reset-exit",
      stdin,
      stdout,
      fetchImpl,
    });
    await session.finished;
    const out = stdout.written.join("");
    for (const chunk of [`${E}[?1004l`, `${E}[?2004l`]) {
      expect(out, `missing reset ${JSON.stringify(chunk)}`).toContain(chunk);
    }
  });

  it("should emit the VT reset on Ctrl+P Ctrl+Q detach of a live session", async () => {
    const stdout = ttyStdout();
    const stdin = ttyStdin();
    const fetchImpl = (async (url: string | URL) => {
      if (url.toString().endsWith("/events")) {
        return new Response(streamFromString(""), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response('{"accepted":true}', { status: 202 });
    }) as typeof fetch;
    const session = await attach({
      baseUrl: "http://localhost:8080",
      sessionId: "sess-reset-detach",
      stdin,
      stdout,
      fetchImpl,
    });
    stdin.emit("data", Buffer.from([0x10, 0x11]));
    await session.finished;
    const out = stdout.written.join("");
    for (const chunk of [`${E}[?1004l`, `${E}[?2004l`, `${E}[?1049l`]) {
      expect(out, `missing reset ${JSON.stringify(chunk)}`).toContain(chunk);
    }
  });

  it("should reset, restore raw and exit 143 on SIGTERM (rev351r2-2)", async () => {
    const stdout = ttyStdout();
    const stdin = ttyStdin();
    const { stderr } = nullStderr();
    const fetchImpl = (async () =>
      sseResponse(hangingStream())) as typeof fetch;
    const before = baselineListeners();
    const session = await attach({
      baseUrl: "http://localhost:8080",
      sessionId: "sess-reset-signal",
      stdin,
      stdout,
      stderr,
      fetchImpl,
    });
    const exitCodes: Array<number | undefined> = [];
    const realExit = process.exit;
    process.exit = ((code?: number) => {
      exitCodes.push(code);
      return undefined as never;
    }) as typeof process.exit;
    try {
      process.emit("SIGTERM");
    } finally {
      process.exit = realExit;
      removeExtraListeners(before);
    }
    expect(exitCodes).toEqual([143]);
    const out = stdout.written.join("");
    expect(out).toContain(`${E}[?1004l`);
    expect(stdin.rawCalls).toContain(false);
    await session.close();
    await session.finished;
    expectNoListenerLeak(before);
  });

  it("should restore the terminal before queued inputs finish draining (rev351r2-5)", async () => {
    const inner = ttyStdout();
    let resetAt = 0;
    const stdout = {
      ...inner,
      write(chunk: string | Buffer) {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (text.includes("?1049l") && resetAt === 0) resetAt = Date.now();
        return (inner as unknown as { write(c: string | Buffer): boolean }).write(
          chunk,
        );
      },
    } as unknown as NodeJS.WriteStream & { written: string[] };
    (stdout as unknown as { written: string[] }).written = inner.written;
    const stdin = ttyStdin();
    const { stderr } = nullStderr();
    let inputDoneAt = 0;
    const fetchImpl = (async (url: string | URL) => {
      if (url.toString().endsWith("/events")) {
        return sseResponse(hangingStream());
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      inputDoneAt = Date.now();
      return new Response('{"accepted":true}', { status: 202 });
    }) as typeof fetch;
    const session = await attach({
      baseUrl: "http://localhost:8080",
      sessionId: "sess-reset-order",
      stdin,
      stdout,
      stderr,
      fetchImpl,
    });
    stdin.emit("data", Buffer.from("hello"));
    await session.close();
    await session.finished;
    expect(inputDoneAt).toBeGreaterThan(0);
    expect(resetAt).toBeGreaterThan(0);
    expect(resetAt).toBeLessThan(inputDoneAt);
  });
});
