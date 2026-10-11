import { describe, expect, it, vi } from "vitest";

import { hostLogSinkDiagnostics, writeHostLogLine } from "./crash-safe-log.js";

// The sink is a module-level singleton shared by this whole file: the tests
// below run in order and each documents the state it starts from (the
// crash-loop this module prevents was an async stderr EPIPE taking the host
// down, so the sink is designed to flip to "unusable" ONCE and stay there).
describe("crash-safe host log sink", () => {
  it("should tolerate a synchronous write throw and stop touching stderr", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => {
      throw new Error("synchronous EPIPE");
    });
    expect(() => writeHostLogLine("sync-failure")).not.toThrow();
    const after = hostLogSinkDiagnostics();
    expect(after.stderrUsable).toBe(false);
    expect(after.bufferedLines).toEqual(["[h2a-pty-host] sync-failure\n"]);
    write.mockRestore();
  });

  it("should expose a durable error listener so an async stream error is not an uncaughtException", () => {
    expect(() => process.stderr.emit("error", new Error("asynchronous EPIPE"))).not.toThrow();
    expect(hostLogSinkDiagnostics().stderrUsable).toBe(false);
  });

  it("should never write to the failed stream again", () => {
    const write = vi.spyOn(process.stderr, "write");
    writeHostLogLine("post-mortem");
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
    expect(hostLogSinkDiagnostics().bufferedLines.at(-1)).toBe("[h2a-pty-host] post-mortem\n");
  });

  it("should bound the post-mortem buffer to the most recent lines", () => {
    for (let index = 0; index < 300; index += 1) writeHostLogLine(`line-${index}`);
    const buffered = hostLogSinkDiagnostics().bufferedLines;
    expect(buffered.length).toBe(256);
    expect(buffered[0]).toBe("[h2a-pty-host] line-44\n");
    expect(buffered.at(-1)).toBe("[h2a-pty-host] line-299\n");
  });
});
