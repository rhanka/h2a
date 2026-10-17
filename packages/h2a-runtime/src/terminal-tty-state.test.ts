import { describe, expect, it } from "vitest";

import { restoreTtyState, saveTtyState } from "./terminal-reset.js";

type StubStdin = NodeJS.ReadStream & { rawCalls: boolean[] };

function stubStdin(
  fd: number | undefined,
  isRaw = false,
  isTTY = true,
): StubStdin {
  const rawCalls: boolean[] = [];
  const stdin = {
    isTTY,
    isRaw,
    fd,
    setRawMode(raw: boolean) {
      rawCalls.push(raw);
      (stdin as { isRaw: boolean }).isRaw = raw;
      return stdin;
    },
    rawCalls,
  } as unknown as StubStdin;
  return stdin;
}

describe("tty save/restore (rev351r2-2, shared stty helper)", () => {
  it("should not touch stty when stdin is not a TTY", () => {
    let calls = 0;
    const stdin = stubStdin(undefined, false, false);
    const state = saveTtyState(stdin, () => {
      calls += 1;
      return { status: 0, stdout: "g0a31" };
    });
    expect(state.saved).toBeUndefined();
    expect(calls).toBe(0);
    let resets = 0;
    restoreTtyState(
      state,
      stdin,
      () => {
        resets += 1;
      },
      () => {
        calls += 1;
        return {};
      },
    );
    expect(resets).toBe(1);
    expect(calls).toBe(0);
    expect(stdin.rawCalls).toEqual([]);
  });

  it("should save via stty -g and restore raw mode plus the saved state", () => {
    const seen: string[][] = [];
    const stdin = stubStdin(99);
    const state = saveTtyState(stdin, (args) => {
      seen.push([...args]);
      return { status: 0, stdout: "g0a31" };
    });
    expect(seen).toEqual([["-g"]]);
    expect(state.stdinFd).toBe(99);
    expect(state.wasRaw).toBe(false);
    // The child leaves raw on; restore must switch it back off.
    (stdin as unknown as { isRaw: boolean }).isRaw = true;
    const restored: string[][] = [];
    let resets = 0;
    restoreTtyState(
      state,
      stdin,
      () => {
        resets += 1;
      },
      (args) => {
        restored.push([...args]);
        return { status: 0 };
      },
    );
    expect(resets).toBe(1);
    expect(stdin.rawCalls).toEqual([false]);
    expect(restored).toEqual([["g0a31"]]);
  });

  it("should skip the stty restore when the save failed, but still restore raw", () => {
    const stdin = stubStdin(99);
    const state = saveTtyState(stdin, () => {
      throw new Error("no tty");
    });
    expect(state.saved).toBeUndefined();
    let spawns = 0;
    restoreTtyState(
      state,
      stdin,
      () => {},
      () => {
        spawns += 1;
        return {};
      },
    );
    expect(spawns).toBe(0);
    expect(stdin.rawCalls).toEqual([false]);
  });

  it("should restore a raw stdin back to raw", () => {
    const stdin = stubStdin(99, true);
    const state = saveTtyState(stdin, () => ({ status: 0, stdout: "abc" }));
    restoreTtyState(state, stdin, () => {}, () => ({ status: 0 }));
    expect(stdin.rawCalls).toEqual([true]);
  });
});
