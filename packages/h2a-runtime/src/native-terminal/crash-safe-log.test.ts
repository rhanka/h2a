import { beforeEach, describe, expect, it, vi } from "vitest";

import { hostLogSinkDiagnostics, resetHostLogSinkForTests, writeHostLogLine } from "./crash-safe-log.js";
import { HOST_FAULT_COUNTERS, hostFaultCounters } from "./fault-counters.js";

// The sink is a module-level singleton; each test resets it to its healthy
// state first so the sync-death and async-death transitions are exercised
// independently (the crash-loop this module prevents was an async stderr EPIPE
// taking the host down — the sink is designed to die ONCE per stream death
// and count that death once). The fault-counter registry is cumulative by
// design; the assertions below check DELTAS.
describe("crash-safe host log sink", () => {
  beforeEach(() => {
    resetHostLogSinkForTests();
  });

  it("should tolerate a synchronous write throw, report undelivered, and stop touching stderr", () => {
    const before = hostFaultCounters()[HOST_FAULT_COUNTERS.hostLogStderrSyncWriteFailed] ?? 0;
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => {
      throw new Error("synchronous EPIPE");
    });
    expect(writeHostLogLine("sync-failure")).toBe(false);
    const after = hostLogSinkDiagnostics();
    expect(after.stderrUsable).toBe(false);
    expect(after.bufferedLines).toEqual(["[h2a-pty-host] sync-failure\n"]);
    expect(hostFaultCounters()[HOST_FAULT_COUNTERS.hostLogStderrSyncWriteFailed]).toBe(before + 1);
    write.mockRestore();
  });

  it("should expose a durable error listener so an async stream error is not an uncaughtException", () => {
    const before = hostFaultCounters()[HOST_FAULT_COUNTERS.hostLogStderrStreamError] ?? 0;
    // The listener is attached at module load: emitting `error` on the stream
    // must be an observation, never a throw.
    expect(() => process.stderr.emit("error", new Error("asynchronous EPIPE"))).not.toThrow();
    expect(hostLogSinkDiagnostics().stderrUsable).toBe(false);
    expect(hostFaultCounters()[HOST_FAULT_COUNTERS.hostLogStderrStreamError]).toBe(before + 1);
    // The transition is counted once; a second error event is not a new death.
    process.stderr.emit("error", new Error("asynchronous EPIPE again"));
    expect(hostFaultCounters()[HOST_FAULT_COUNTERS.hostLogStderrStreamError]).toBe(before + 1);
  });

  it("should never write to the failed stream again, and never re-bump the sync counter", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => {
      throw new Error("synchronous EPIPE");
    });
    writeHostLogLine("first");
    write.mockRestore();
    const afterDeath = hostFaultCounters()[HOST_FAULT_COUNTERS.hostLogStderrSyncWriteFailed] ?? 0;
    const spy = vi.spyOn(process.stderr, "write");
    expect(writeHostLogLine("post-mortem")).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(hostLogSinkDiagnostics().bufferedLines.at(-1)).toBe("[h2a-pty-host] post-mortem\n");
    // A dead stream is observed once, not counted again per buffered line.
    expect(hostFaultCounters()[HOST_FAULT_COUNTERS.hostLogStderrSyncWriteFailed]).toBe(afterDeath);
  });

  it("should bound the post-mortem buffer to the most recent lines", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => {
      throw new Error("synchronous EPIPE");
    });
    writeHostLogLine("kill");
    write.mockRestore();
    for (let index = 0; index < 300; index += 1) expect(writeHostLogLine(`line-${index}`)).toBe(false);
    const buffered = hostLogSinkDiagnostics().bufferedLines;
    expect(buffered.length).toBeLessThanOrEqual(256);
    expect(buffered.length).toBe(256);
    expect(buffered[0]).toBe("[h2a-pty-host] line-44\n");
    expect(buffered.at(-1)).toBe("[h2a-pty-host] line-299\n");
  });
});
