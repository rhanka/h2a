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

  it("should evict fragmented output by chunk count with an explicit gap", () => {
    const replay = new TerminalReplayBuffer(32, {
      maxChunks: 2,
      maxWireBytes: 1_024,
    });

    replay.append("a");
    replay.append("b");
    replay.append("c");

    expect(replay.latestSeq).toBe(3);
    expect(replay.readAfter(0)).toEqual({
      chunks: [
        { seq: 2, data: "b" },
        { seq: 3, data: "c" },
      ],
      gap: { fromSeq: 1, toSeq: 1 },
      latestSeq: 3,
    });
  });

  it("should evict JSON-heavy output by serialized wire bytes", () => {
    const oneChunkWireBytes =
      Buffer.byteLength(JSON.stringify({ seq: 1, data: "\0" }), "utf8") + 1;
    const replay = new TerminalReplayBuffer(32, {
      maxChunks: 32,
      maxWireBytes: oneChunkWireBytes,
    });

    replay.append("\0");
    replay.append("\0");

    expect(replay.readAfter(0)).toEqual({
      chunks: [{ seq: 2, data: "\0" }],
      gap: { fromSeq: 1, toSeq: 1 },
      latestSeq: 2,
    });
  });

  it("should reject invalid budgets and cursors", () => {
    expect(() => new TerminalReplayBuffer(0)).toThrow(RangeError);
    expect(() => new TerminalReplayBuffer(8, { maxChunks: 0 })).toThrow(
      RangeError,
    );
    expect(() => new TerminalReplayBuffer(8, { maxWireBytes: 0 })).toThrow(
      RangeError,
    );
    const replay = new TerminalReplayBuffer(8);
    expect(() => replay.append("")).toThrow(RangeError);
    expect(() => replay.readAfter(-1)).toThrow(RangeError);
    expect(() => replay.readAfter(1)).toThrow(RangeError);
  });
});
