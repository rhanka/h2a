import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
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
const { ensureH2aBinOnPath, resolveRunningH2aBinDir, startNativeSessionSingleShot, nativeSessionStateAsync } = await import("./native-host.js");
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "async-native-"));
  for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "REMOTE_CLI_CONFIG_HOME"]) vi.stubEnv(key, root);
  vi.clearAllMocks();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
const launch = (onCreateAttempt = vi.fn()) => {
  const sessionRuntimeDir = join(root, "rt");
  mkdirSync(sessionRuntimeDir, { recursive: true, mode: 0o700 });
  return startNativeSessionSingleShot("codex", "codex", root, [], "async-target", {
    identity: {
      kind: "reuse",
      host: "codex",
      actorId: "codex:async-target:000000000001",
      agentUuid: "11111111-1111-4111-8111-111111111111",
      sessionClass: "human",
      invocationMode: "interactive",
    },
    sessionRuntimeDir,
    terminateOnAgentExit: true,
    onCreateAttempt,
  });
};

it("should return the direct operation's session identity without a launch helper", async () => {
  let capturedEnv: Record<string, string> = {};
  native.operation.mockImplementation(async (argv: string[], emit) => {
    const envIdx = argv.indexOf("--env-file");
    if (envIdx >= 0 && argv[envIdx + 1]) {
      capturedEnv = JSON.parse(readFileSync(argv[envIdx + 1]!, "utf8")) as Record<string, string>;
    }
    emit({ pid: 123, generation: "g", socketPath: join(root, "h") });
    return 0;
  });
  const onCreateAttempt = vi.fn();
  expect(await launch(onCreateAttempt)).toMatchObject({ name: "h2a-async-target", pid: 123, generation: "g" });
  expect(capturedEnv["H2A_NATIVE_TERMINAL"]).toBe("1");
  expect(capturedEnv["H2A_NATIVE_PTY_SESSION"]).toBe("h2a-async-target");
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

it("should append the running h2a bin dir to child PATH so SessionEnd hooks resolve h2a under narrowed PATH", async () => {
  const prefix = join(root, ".npm-global");
  const binDir = join(prefix, "bin");
  const distDir = join(prefix, "lib", "node_modules", "@sentropic", "h2a", "dist");
  mkdirSync(binDir, { recursive: true, mode: 0o755 });
  mkdirSync(distDir, { recursive: true, mode: 0o755 });
  const binJs = join(distDir, "bin.js");
  writeFileSync(binJs, `#!/usr/bin/env node\nprocess.stdout.write("hook-ok:" + process.argv.slice(2).join(" ") + "\\n");\n`, { mode: 0o755 });
  chmodSync(binJs, 0o755);
  const h2aCmd = join(binDir, "h2a");
  symlinkSync(binJs, h2aCmd);

  // 1. Derives <prefix>/bin directly from argv1 pointing to dist/bin.js (the h2a_run spawn shape).
  const derived = resolveRunningH2aBinDir({ argv1: binJs, env: { HOME: join(root, "empty-home") } });
  expect(derived).toBe(binDir);

  // 2. Appends <prefix>/bin when PATH omits it (plus node's dir if node is outside /usr/bin:/bin),
  //    and preserves an existing h2a on PATH without shadowing.
  const narrowed: Record<string, string> = { HOME: join(root, "empty-home"), PATH: "/usr/bin:/bin" };
  ensureH2aBinOnPath(narrowed, { argv1: binJs });
  const narrowedParts = narrowed["PATH"]!.split(delimiter);
  expect(narrowedParts.slice(0, 3)).toEqual(["/usr/bin", "/bin", binDir]);
  expect(
    narrowedParts.length === 3 ||
      (narrowedParts.length === 4 && narrowedParts[3] === dirname(process.execPath)),
  ).toBe(true);

  // Even when the active node runtime lives in a 0o777 toolcache directory (e.g.
  // pre-cached GitHub Actions hostedtoolcache) and PATH has no `node`,
  // ensureH2aBinOnPath still appends dirname(execPath) so `#!/usr/bin/env node` resolves.
  const toolcacheBin = join(root, "toolcache", "bin");
  mkdirSync(toolcacheBin, { recursive: true });
  chmodSync(toolcacheBin, 0o777);
  const toolcacheNode = join(toolcacheBin, "node");
  symlinkSync(process.execPath, toolcacheNode);
  const noNodeBin = join(root, "no-node-bin");
  mkdirSync(noNodeBin, { recursive: true, mode: 0o755 });
  const toolcacheEnv: Record<string, string> = { HOME: join(root, "empty-home"), PATH: noNodeBin };
  ensureH2aBinOnPath(toolcacheEnv, { argv1: binJs, execPath: toolcacheNode });
  expect(toolcacheEnv["PATH"]!.split(delimiter)).toEqual([noNodeBin, binDir, toolcacheBin]);

  const overrideBin = join(root, "override-bin");
  mkdirSync(overrideBin, { recursive: true, mode: 0o755 });
  writeFileSync(join(overrideBin, "h2a"), "#!/bin/sh\necho override\n", { mode: 0o755 });
  const alreadyOnPath: Record<string, string> = { HOME: root, PATH: `${overrideBin}:/usr/bin:/bin` };
  ensureH2aBinOnPath(alreadyOnPath, { argv1: binJs });
  expect(alreadyOnPath["PATH"]).toBe(`${overrideBin}:/usr/bin:/bin`);

  // 3. startNativeSessionSingleShot propagates ~/.npm-global/bin into env.json under narrowed PATH,
  //    so a Claude SessionEnd hook (`h2a enroll --hook claude-end`) run by `/bin/sh` resolves `h2a`.
  vi.stubEnv("PATH", "/usr/bin:/bin");
  let capturedEnv: Record<string, string> = {};
  native.operation.mockImplementation(async (argv: string[], emit) => {
    const envIdx = argv.indexOf("--env-file");
    if (envIdx >= 0 && argv[envIdx + 1]) {
      capturedEnv = JSON.parse(readFileSync(argv[envIdx + 1]!, "utf8")) as Record<string, string>;
    }
    emit({ pid: 456, generation: "g", socketPath: join(root, "h") });
    return 0;
  });
  await launch();
  expect(capturedEnv["PATH"]!.split(delimiter)).toContain(binDir);

  const hookRun = spawnSync("/bin/sh", ["-c", "h2a enroll --hook claude-end"], {
    env: capturedEnv,
    encoding: "utf8",
    timeout: 10_000,
  });
  expect(hookRun.status, `stderr=${hookRun.stderr} PATH=${capturedEnv["PATH"]}`).toBe(0);
  expect(hookRun.stdout.trim()).toBe("hook-ok:enroll --hook claude-end");
});
