import { describe, expect, it } from "vitest";

import { TerminalReplayBuffer } from "./replay-buffer.js";

describe("TerminalReplayBuffer", () => {
  it("should assign monotonic sequences and replay chunks after a cursor", () => {
    const replay = new TerminalReplayBuffer(32);

    expect(replay.append("one").seq).toBe(1);
    expect(replay.append("two").seq).toBe(2);

    expect(replay.readAfter(1)).toEqual({
      chunks: [{ seq: 2, data: "two" }],
      gap: null,
      latestSeq: 2,
    });
  });

  it("should report an explicit gap when the byte budget evicts output", () => {
    const replay = new TerminalReplayBuffer(5);

    replay.append("abc");
    replay.append("def");

    expect(replay.readAfter(0)).toEqual({
      chunks: [{ seq: 2, data: "def" }],
      gap: { fromSeq: 1, toSeq: 1 },
      latestSeq: 2,
    });
  });

  it("should keep memory bounded when one chunk exceeds the budget", () => {
    const replay = new TerminalReplayBuffer(2);

    replay.append("three bytes");

    expect(replay.readAfter(0)).toEqual({
      chunks: [],
      gap: { fromSeq: 1, toSeq: 1 },
      latestSeq: 1,
    });
  });

  it("should reject invalid budgets and cursors", () => {
    expect(() => new TerminalReplayBuffer(0)).toThrow(RangeError);
    const replay = new TerminalReplayBuffer(8);
    expect(() => replay.append("")).toThrow(RangeError);
    expect(() => replay.readAfter(-1)).toThrow(RangeError);
    expect(() => replay.readAfter(1)).toThrow(RangeError);
  });
});
