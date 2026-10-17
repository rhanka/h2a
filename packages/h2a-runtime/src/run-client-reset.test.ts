import { describe, expect, it } from "vitest";

import type { PtyHandle, PtySpawner } from "./pty.js";
import { run } from "./run.js";

const E = "\x1b";

type StubPty = PtyHandle & {
  emitData(chunk: string): void;
  emitExit(exitCode: number, signal?: number): void;
};

function stubSpawner(): { spawner: PtySpawner; pty: StubPty } {
  let dataHandler: (chunk: string) => void = () => {};
  let exitHandler: (event: { exitCode: number; signal?: number }) => void =
    () => {};
  const pty = {
    pid: 62001,
    pgid: 62001,
    cols: 80,
    rows: 24,
    write() {},
    resize() {},
    kill() {},
    onData(handler: (chunk: string) => void) {
      dataHandler = handler;
      return { dispose() {} };
    },
    onExit(handler: (event: { exitCode: number; signal?: number }) => void) {
      exitHandler = handler;
      return { dispose() {} };
    },
    emitData(chunk: string) {
      dataHandler(chunk);
    },
    emitExit(exitCode: number, signal?: number) {
      const event: { exitCode: number; signal?: number } = { exitCode };
      if (signal !== undefined) event.signal = signal;
      exitHandler(event);
    },
  } as unknown as StubPty;
  return { pty, spawner: () => pty };
}

function ttyStdin() {
  const listeners = new Map<string, Array<(...args: never[]) => void>>();
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
    on(event: string, listener: (...args: never[]) => void) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return stdin;
    },
    off() {
      return stdin;
    },
    rawCalls,
  } as unknown as NodeJS.ReadStream & { rawCalls: boolean[] };
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

describe("run client terminal reset (rev351-2)", () => {
  it("should emit the VT reset after the local CLI exits", async () => {
    const { spawner, pty } = stubSpawner();
    const stdin = ttyStdin();
    const stdout = ttyStdout();
    const result = await run({
      profile: "shell",
      port: 0,
      spawner,
      stdin,
      stdout,
      initialSize: { cols: 100, rows: 30 },
    });
    pty.emitData(`${E}[?1004h${E}[?2004h${E}[?1000h${E}[?1049h${E}[?25l`);
    pty.emitExit(0);
    await result.exit;
    const out = (stdout as unknown as { written: string[] }).written.join("");
    for (const chunk of [
      `${E}[?1004l`,
      `${E}[?2004l`,
      `${E}[?1000l`,
      `${E}[?1049l`,
      `${E}[?25h`,
    ]) {
      expect(out, `missing reset ${JSON.stringify(chunk)}`).toContain(chunk);
    }
  });

  it("should restore stdin raw mode on PTY exit", async () => {
    const { spawner, pty } = stubSpawner();
    const stdin = ttyStdin();
    const stdout = ttyStdout();
    const result = await run({
      profile: "shell",
      port: 0,
      spawner,
      stdin,
      stdout,
      initialSize: { cols: 80, rows: 24 },
    });
    expect((stdin as unknown as { isRaw: boolean }).isRaw).toBe(true);
    pty.emitExit(0);
    await result.exit;
    expect(
      (stdin as unknown as { rawCalls: boolean[] }).rawCalls,
    ).toContain(false);
  });
});
