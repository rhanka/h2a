import { expect, it } from "vitest";
import { NATIVE_TERMINAL_RESET_MARKER, TerminalResetRelay } from "./reset-relay.js";
import { TerminalReplayBuffer } from "./replay-buffer.js";

it("should replace split wrapper requests with exactly the resets before the next prompt", () => {
  const input = `\x1b[?1004h${NATIVE_TERMINAL_RESET_MARKER}prompt`;
  for (let split = 0; split <= input.length; split++) {
    const replay = new TerminalReplayBuffer(1024);
    const relay = new TerminalResetRelay((data) => { replay.append(data); }, () => replay.resetSequence());
    relay.feed(input.slice(0, split));
    relay.feed(input.slice(split));
    relay.flush();
    expect(replay.readAfter(0).chunks.map((chunk) => chunk.data).join(""))
      .toBe("\x1b[?1004h\x1b[?1004lprompt");
    expect(replay.resetSequence()).toBe("");
  }
});

it("should preserve an incomplete non-request escape at process exit", () => {
  const output: string[] = [];
  const relay = new TerminalResetRelay((data) => { output.push(data); }, () => "");
  relay.feed("text\x1b]777;");
  relay.flush();
  expect(output.join("")).toBe("text\x1b]777;");
});
