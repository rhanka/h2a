// @ts-ignore The qualification boundary never ships in the runtime.
import { createPrivateTestDirectory, nativeTestEnvironment, setupNativeTestEnvironment, spawnIsolatedNative as spawn } from "../../h2a/test/helpers/native-isolation.js";
import { afterAll, expect, it, vi } from "vitest";
import { once } from "node:events";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readProcessFrame } from "../src/proc-identity.js";
import { resolveRegistryPath } from "../src/registry.js";
import { NativeTerminalHost } from "../src/native-terminal/host.js";
import { NativeTerminalClient } from "../src/native-terminal/client.js";
import { startNativeTerminalHostServer } from "../src/native-terminal/server.js";

setupNativeTestEnvironment(afterAll);
// Deliberately no skip: missing namespace privileges are a failed qualification.
it("should forbid kill(-pgid) and unlink across real PID and network namespaces", async () => {
  const root = createPrivateTestDirectory("ns");
  const socketPath = join(root, "h");
  const registryPath = resolveRegistryPath();
  mkdirSync(dirname(registryPath), { recursive: true, mode: 0o700 });
  const runtime = fileURLToPath(new URL("../dist/", import.meta.url));
  const script = join(root, "namespace-owner.mjs");
  writeFileSync(script, `
    import {NativeTerminalHost} from ${JSON.stringify(join(runtime, "native-terminal/host.js"))};
    import {startNativeTerminalHostServer} from ${JSON.stringify(join(runtime, "native-terminal/server.js"))};
    import {readProcessFrame} from ${JSON.stringify(join(runtime, "proc-identity.js"))};
    const {spawn}=await import("node:child_process");
    const group=spawn("/bin/sleep",["1000"],{detached:true,stdio:"ignore"});
    const host=new NativeTerminalHost({generation:'namespace-owner',replayBytesPerSession:1024,
      registryPath:${JSON.stringify(join(root, "empty-registry.json"))},spawner:()=>{throw Error('unexpected pty');}});
    const server=await startNativeTerminalHostServer({socketPath:${JSON.stringify(socketPath)},host});
    console.log(JSON.stringify({frame:readProcessFrame(),pid:process.pid,pgid:group.pid}));
    process.stdin.resume(); process.once('SIGTERM',async()=>{group.kill("SIGKILL");await server.close();process.exitCode=0;process.stdin.destroy();});
  `);
  const env = nativeTestEnvironment(root);
  const child = spawn("/usr/bin/unshare", ["--pid", "--fork", "--kill-child", "--mount-proc", "--net", process.execPath, script], { env, stdio: ["pipe", "pipe", "pipe"] });
  const exited = once(child, "exit"), closed = once(child, "close");
  let stdout = "", stderr = "";
  child.stdout!.on("data", data => { stdout += data; });
  child.stderr!.on("data", data => { stderr += data; });
  let client: NativeTerminalClient | undefined;
  const kill = vi.spyOn(process, "kill").mockImplementation(() => { throw Error("unexpected parent signal"); });
  try {
    await Promise.race([once(child.stdout!, "data"), exited.then(() => { throw Error(`namespace fixture failed: ${stderr}`); })]);
    const owner = JSON.parse(stdout.trim());
    const current = readProcessFrame();
    expect(owner.frame.pidNamespace).not.toBe(current.pidNamespace);
    expect(owner.frame.nsNet).not.toBe(current.nsNet);
    expect(owner.frame.machineId).toBe(current.machineId);
    const inode = statSync(socketPath);
    const sidecar = readFileSync(`${socketPath}.owner`, "utf8");
    writeFileSync(registryPath, JSON.stringify({ version: 1, entries: [{
      id: "native-terminal-pty:foreign-namespace", tool: "codex", kind: "local", cwd: "", source: "scan",
      enrolledAt: "2026-01-01T00:00:00Z", lastSeenAt: "2026-01-01T00:00:00Z",
      pgid: owner.pgid, ownerHostPid: owner.pid, ownerHostStartTime: owner.frame.startTime, ownerHostSocketPath: socketPath,
      pgidPidNamespace: owner.frame.pidNamespace, pgidBootId: owner.frame.bootId, pgidMachineId: owner.frame.machineId,
    }] }));
    const reaper = { isGroupAlive: vi.fn(() => true), killGroup: vi.fn(), describeGroup: vi.fn(() => "") };
    const host = new NativeTerminalHost({ generation: "parent", replayBytesPerSession: 1024, registryPath, reaper,
      spawner: () => { throw Error("unexpected pty"); }, log: () => {} });
    expect(await host.reapOrphan("foreign-namespace", "SIGKILL", owner.pgid)).toMatchObject({ cause: "foreign-frame" });
    await expect(startNativeTerminalHostServer({ socketPath, host })).rejects.toThrow();
    expect(reaper.isGroupAlive).not.toHaveBeenCalled(); expect(reaper.killGroup).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
    expect(statSync(socketPath).ino).toBe(inode.ino);
    expect(readFileSync(`${socketPath}.owner`, "utf8")).toBe(sidecar);
    client = await NativeTerminalClient.connect(socketPath);
    expect((await client.ping()).generation).toBe("namespace-owner");
  } finally {
    client?.close(); kill.mockRestore();
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    await closed;
    rmSync(root, { recursive: true, force: true });
  }
}, 8_000);
