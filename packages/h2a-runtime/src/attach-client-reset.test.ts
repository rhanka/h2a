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
});
