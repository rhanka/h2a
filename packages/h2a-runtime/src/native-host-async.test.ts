import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ operation: vi.fn(), close: vi.fn(), probe: vi.fn() }));
vi.mock("./native-terminal/op.js", () => ({
  runNativeTerminalOp: native.operation, closeAllNativeTerminalOpClients: native.close, probeNativeSession: native.probe,
}));
vi.mock("./proc-cpu.js", async original => ({ ...await original<object>(), readWorkerPid: () => undefined }));
vi.mock("./tmux.js", async original => {
  const actual = await original<typeof import("./tmux.js")>();
  return { ...actual, procReaderDeps: vi.fn(actual.procReaderDeps) };
});
const { procReaderDeps } = await import("./tmux.js");
const { startNativeSessionSingleShot, nativeSessionStateAsync } = await import("./native-host.js");
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "async-native-"));
  for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "REMOTE_CLI_CONFIG_HOME"]) vi.stubEnv(key, root);
  vi.clearAllMocks();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
const launch = (onCreateAttempt = vi.fn()) => startNativeSessionSingleShot("codex", "codex", root, [], "async-target",
  { terminateOnAgentExit: true, onCreateAttempt });

it("should return the direct operation's session identity without a launch helper", async () => {
  native.operation.mockImplementation(async (_argv, emit) => { emit({ pid: 123, generation: "g", socketPath: join(root, "h") }); return 0; });
  const onCreateAttempt = vi.fn();
  expect(await launch(onCreateAttempt)).toMatchObject({ name: "h2a-async-target", pid: 123, generation: "g" });
  expect(onCreateAttempt).toHaveBeenCalledOnce();
  expect(procReaderDeps).toHaveBeenCalledExactlyOnceWith(123);
  expect(native.close).toHaveBeenCalled();
});

it("should abort pending RPCs at the unchanged 15 second operation deadline", async () => {
  vi.useFakeTimers();
  let observed: AbortSignal;
  native.operation.mockImplementation((_argv, _emit, signal: AbortSignal) => {
    observed = signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  const result = expect(launch()).rejects.toThrow("timed out after 15000ms");
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(14999);
  expect(observed!.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await result;
  expect(observed!.aborted).toBe(true);
  expect(native.close).toHaveBeenCalled();
});

it("should preserve unknown identity and transport failure in the in-process name probe", async () => {
  native.probe.mockResolvedValue({ verdict: "unknown", code: "ambiguous-owner", sockets: ["a", "b"], reason: "ambiguous-owner" });
  expect(await nativeSessionStateAsync("target")).toMatchObject({ state: "unknown", code: "ambiguous-owner", sockets: ["a", "b"] });
  native.probe.mockRejectedValue(new Error("permission refused"));
  expect(await nativeSessionStateAsync("target")).toEqual({ state: "unknown", reason: "permission refused" });
});
