import { it, expect, vi } from "vitest";
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("node:child_process", async original => ({
  ...await original<typeof import("node:child_process")>(), execFile: execute,
}));
import { nativeClaudeDeliveryDeps } from "./native-host.js";

it("should carry the initial PID probe into the shared native observation schedule", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  execute.mockImplementation((_command, _args, _options, callback) => callback(null, '{"text":"composer"}', ""));
  try {
    const factory = nativeClaudeDeliveryDeps as unknown as (
      owned: Parameters<typeof nativeClaudeDeliveryDeps>[0], deadline: number,
      onEpoch: undefined, previousPollCompletedAt: number,
    ) => ReturnType<typeof nativeClaudeDeliveryDeps>;
    const deps = factory({ name: "w", socketPath: "/private/fixture.sock", generation: "g", incarnation: "i" }, 15000, undefined, Date.now());
    const first = deps.capturePane("w");
    await vi.advanceTimersByTimeAsync(274);
    expect(execute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await first).toBe("composer");
    expect(execute).toHaveBeenCalledTimes(1);
    const final = deps.capturePane("w");
    await vi.advanceTimersByTimeAsync(274);
    expect(execute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await final).toBe("composer");
    expect(execute).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); execute.mockReset(); }
});
