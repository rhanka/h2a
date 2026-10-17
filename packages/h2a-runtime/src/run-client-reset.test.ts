import { createServer } from "node:net";
import { describe, expect, it } from "vitest";

import type { PtyHandle, PtySpawner } from "./pty.js";
import { run } from "./run.js";

const E = "\x1b";

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

  it("should reset, restore raw and exit 143 on SIGTERM (rev351r2-2)", async () => {
    const { spawner, pty } = stubSpawner();
    let killed = false;
    (pty as unknown as { kill(): void }).kill = () => {
      killed = true;
    };
    const stdin = ttyStdin();
    const stdout = ttyStdout();
    const before = baselineListeners();
    const result = await run({
      profile: "shell",
      port: 0,
      spawner,
      stdin,
      stdout,
      initialSize: { cols: 80, rows: 24 },
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
    expect(killed).toBe(true);
    expect(exitCodes).toEqual([143]);
    const out = stdout.written.join("");
    expect(out).toContain(`${E}[?1004l`);
    expect(stdin.rawCalls).toContain(false);
    pty.emitExit(0);
    await result.exit;
    expectNoListenerLeak(before);
  });

  it("should restore the terminal when the control-plane listen fails (rev351r2-5)", async () => {
    const holder = createServer();
    await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
    const addr = holder.address();
    if (!addr || typeof addr !== "object") throw new Error("probe has no port");
    try {
      const { spawner, pty } = stubSpawner();
      let killed = false;
      (pty as unknown as { kill(): void }).kill = () => {
        killed = true;
      };
      const stdin = ttyStdin();
      const stdout = ttyStdout();
      const before = baselineListeners();
      await expect(
        run({ profile: "shell", port: addr.port, spawner, stdin, stdout }),
      ).rejects.toThrow(/EADDRINUSE/);
      const out = stdout.written.join("");
      expect(out).toContain(`${E}[?1004l`);
      expect(stdin.rawCalls).toContain(false);
      expect(killed).toBe(true);
      expectNoListenerLeak(before);
    } finally {
      holder.close();
    }
  });
});
