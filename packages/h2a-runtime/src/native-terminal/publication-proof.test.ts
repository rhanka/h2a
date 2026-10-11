// @ts-ignore Tests do not ship in the runtime.
import { createPrivateTestDirectory, setupNativeTestEnvironment, spawnIsolatedNative as spawn, spawnSyncIsolatedNative as spawnSync } from "../../../h2a/test/helpers/native-isolation.js";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { createConnection, Socket } from "node:net";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import * as registry from "../registry.js";
import { readProcessFrame } from "../proc-identity.js";
import { NativeTerminalHost, defaultOwnerHostProbe, readProcessStartTime, posixProcessGroupReaper } from "./host.js";
import { NativeTerminalClient } from "./client.js";
import { proveNativeTerminalEndpointAbsent, startNativeTerminalHostServer } from "./server.js";

vi.mock("node:net", async original => {
  const net = await original<typeof import("node:net")>();
  return { ...net, createConnection: vi.fn(net.createConnection) };
});
vi.mock("../registry.js", async original => {
  const r = await original<typeof import("../registry.js")>();
  return { ...r, loadRegistry: vi.fn(r.loadRegistry), listNativeTerminalPgidEntries: vi.fn(r.listNativeTerminalPgidEntries) };
});
vi.mock("./host.js", async original => {
  const host = await original<typeof import("./host.js")>();
  return { ...host, defaultOwnerHostProbe: vi.fn(host.defaultOwnerHostProbe), readProcessStartTime: vi.fn(host.readProcessStartTime) };
});
setupNativeTestEnvironment(afterAll);
const current = { machineId: "a".repeat(32), bootId: "11111111-1111-4111-8111-111111111111", pidNamespace: "4026531836" };
const stale = { ...current, bootId: "00000000-0000-4000-8000-000000000000" };
const cleanup: Array<() => Promise<unknown>> = [];
beforeEach(async () => {
  vi.mocked(createConnection).mockReset().mockImplementation((await vi.importActual<typeof import("node:net")>("node:net")).createConnection);
  vi.mocked(registry.loadRegistry).mockReturnValue({ state: "ok", entries: [], unreadable: [] });
  vi.mocked(registry.listNativeTerminalPgidEntries).mockReturnValue({ known: true, entries: [] });
});
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); vi.restoreAllMocks(); vi.clearAllMocks(); });
async function endpoint() {
  const dir = createPrivateTestDirectory("b");
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "h");
}
function rows(path: string, frame = stale) {
  vi.mocked(registry.loadRegistry).mockReturnValue({ state: "ok", unreadable: [], entries: [{
    id: "native-terminal-pty:proof", kind: "local", tool: "codex", cwd: "", source: "scan",
    enrolledAt: "2026-01-01T00:00:00Z", lastSeenAt: "2026-01-01T00:00:00Z", pgid: 424242,
    ownerHostPid: 424242, ownerHostStartTime: 1, ownerHostSocketPath: path,
    pgidBootId: frame.bootId, pgidMachineId: frame.machineId, pgidPidNamespace: frame.pidNamespace,
  }] });
}
async function boundSocket(path: string, abandon = false) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    const { Pipe, constants } = process.binding('pipe_wrap');
    const handle = new Pipe(constants.SERVER);
    const result = handle.bind(${JSON.stringify(path)});
    if (result !== 0) throw new Error('bind=' + result);
    console.log('bound'); process.stdin.resume();
  `], { stdio: ["pipe", "pipe", "pipe"] });
  const exited = once(child, "exit");
  cleanup.push(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; } });
  await Promise.race([once(child.stdout!, "data"), exited.then(() => { throw new Error("bound fixture exited"); })]);
  await chmod(path, 0o600);
  if (abandon) { child.kill("SIGKILL"); await exited; }
  return child;
}
function sidecar(path: string, frame = current, machine = true) {
  const info = statSync(path);
  writeFileSync(`${path}.owner`, JSON.stringify({ dev: info.dev, ino: info.ino, pid: 424242, startTime: 1,
    bootId: frame.bootId, pidNamespace: frame.pidNamespace, ...(machine ? { machineId: frame.machineId } : {}) }), { mode: 0o600 });
}
function host(path: string) {
  return new NativeTerminalHost({ generation: "proof", replayBytesPerSession: 1024, registryPath: join(dirname(path), "registry.json"), spawner: () => { throw Error("unexpected spawn"); } });
}
async function start(path: string, frame: any, ownerProbe = vi.fn(() => "dead" as const)) {
  const server = await startNativeTerminalHostServer({ socketPath: path, host: host(path), readFrame: frame, ownerProbe });
  cleanup.push(() => server.close());
  return server;
}
function absent(path: string, frame: any = () => current, probe = vi.fn(() => "dead" as const)) {
  return proveNativeTerminalEndpointAbsent(path, { code: "ECONNREFUSED" }, frame, probe);
}
function lockAddress(path: string) {
  const secret = readFileSync(join(dirname(path), ".h2a-native-terminal.lock-id"), "utf8").trim();
  return "\0h2a-terminal-lock-" + createHash("sha256").update(`${process.getuid!()}:${path}:${secret}`).digest("hex");
}
function assertLocked(path: string) {
  const probe = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import {createServer} from 'node:net'; const s=createServer();
    s.once('error', e=>{process.exitCode=e.code==='EADDRINUSE'?0:2;});
    s.listen(${JSON.stringify(lockAddress(path))}, ()=>{s.close();process.exitCode=1;});
  `], { encoding: "utf8", timeout: 1_000 });
  expect(probe.status, probe.stderr).toBe(0);
}

describe("publication proof v5", () => {
  it("should refuse coded when machine-id is unreadable", async () => {
    const path = await endpoint(); const probe = vi.fn(() => "dead" as const);
    const read = vi.fn(() => ({ ...current, machineId: undefined }));
    await expect(start(path, read, probe)).rejects.toMatchObject({ code: "H2A_MACHINE_ID_UNREADABLE", exitCode: 3,
      message: "native host machine-id is unreadable or invalid; recovery remains blocked until a valid machine identity is restored; see docs/runbooks/2026-10-11-recuperation-parc-0.98.2-0.98.4.md#machine-id" });
    await expect(start(path, read, probe)).rejects.toMatchObject({ code: "H2A_MACHINE_ID_UNREADABLE", exitCode: 3 });
    expect(probe).not.toHaveBeenCalled();
    read.mockReturnValue(current);
    await start(path, read, probe);
    expect(read).toHaveBeenCalledTimes(3);
  });
  it("should read the current frame once under the lock through sidecar publication", async () => {
    const path = await endpoint();
    const read = vi.fn(() => { assertLocked(path); return current; });
    await start(path, read);
    expect(read).toHaveBeenCalledTimes(1);
    const owner = JSON.parse(readFileSync(`${path}.owner`, "utf8"));
    expect(owner.machineId).toBe(current.machineId);
    expect(statSync(`${path}.owner`).uid).toBe(process.getuid!());
    expect(statSync(`${path}.owner`).mode & 0o777).toBe(0o600);
  });
  it("should read all three sources after locking and before probing a current sidecar", async () => {
    const path = await endpoint(); await boundSocket(path); sidecar(path); rows(path);
    const seen: string[] = [];
    vi.mocked(registry.listNativeTerminalPgidEntries).mockImplementation(() => { assertLocked(path); seen.push("pgid"); return { known: true, entries: [] }; });
    vi.mocked(registry.loadRegistry).mockImplementation(() => { assertLocked(path); seen.push("registry"); return { state: "ok", entries: [], unreadable: [] }; });
    const ownerProbe = vi.fn(() => { assertLocked(path); expect(seen).toEqual(["pgid", "registry"]); return "alive" as const; });
    expect(await absent(path, () => current, ownerProbe)).toBe(false);
    expect(ownerProbe).toHaveBeenCalledTimes(1);
  });
  it.each(["current", "foreign", "stale"])("should classify a %s snapshot entry independently of registry rows", async kind => {
    const path = await endpoint(); rows(path);
    const frame = kind === "current" ? current : kind === "foreign" ? { ...current, pidNamespace: "999" } : stale;
    vi.mocked(registry.listNativeTerminalPgidEntries).mockReturnValue({ known: true, entries: [{ sessionId: "snapshot", pgid: 424242,
      frame, owner: { pid: 424242, startTime: 1, socketPath: path } }] } as any);
    const probe = vi.fn(() => "unresolvable" as const);
    expect(await absent(path, () => current, probe)).toBe(kind === "stale");
    expect(probe).toHaveBeenCalledTimes(kind === "current" ? 1 : 0);
  });
  it("should refuse publication when a live current-boot sidecar coexists with stale-boot rows", async () => {
    const path = await endpoint(); await boundSocket(path); sidecar(path); rows(path);
    const probe = vi.fn(() => "alive" as const);
    expect(await absent(path, () => current, probe)).toBe(false);
    expect(probe).toHaveBeenCalledTimes(1);
  });
  it.each(["alive", "unresolvable"])("should never unlink a bound-but-not-listening socket attributed to a current-boot owner: %s", async verdict => {
    const path = await endpoint(); const child = await boundSocket(path); sidecar(path); rows(path);
    const original = statSync(path); const probe = vi.fn(() => verdict as any);
    await expect(start(path, () => ({ ...current, bootTimeMs: Date.now() - 60_000 }), probe)).rejects.toThrow();
    expect(statSync(path).ino).toBe(original.ino);
    expect(child.exitCode).toBeNull();
    expect(vi.mocked(createConnection)).toHaveBeenCalledTimes(5);
  });
  it("should never unlink an unattributed bound socket created during the current boot", async () => {
    const path = await endpoint(); const child = await boundSocket(path);
    const original = statSync(path);
    await expect(start(path, () => ({ ...current, bootTimeMs: Date.now() - 60_000 }))).rejects.toThrow();
    expect(statSync(path).ino).toBe(original.ino); expect(child.exitCode).toBeNull();
    expect(vi.mocked(createConnection)).toHaveBeenCalledTimes(5);
  });
  it("should unlink a pre-boot stale socket after repeated probes and dev/ino recheck", async () => {
    const path = await endpoint(); await boundSocket(path, true); rows(path); sidecar(path, stale, false);
    const original = statSync(path);
    await start(path, () => ({ ...current, bootTimeMs: Date.now() + 60_000 }));
    expect(vi.mocked(createConnection)).toHaveBeenCalledTimes(5);
    expect(statSync(path).ino).not.toBe(original.ino);
    const client = await NativeTerminalClient.connect(path); cleanup.push(async () => client.close());
    expect((await client.ping()).generation).toBe("proof");
  });
  it("should refuse a listener appearing during the probe window", async () => {
    const path = await endpoint(); await boundSocket(path, true); rows(path);
    vi.mocked(createConnection).mockImplementationOnce(() => { const socket = new Socket(); queueMicrotask(() => socket.emit("error", Object.assign(new Error("refused"), { code: "ECONNREFUSED" }))); return socket; });
    vi.mocked(createConnection).mockImplementationOnce(() => { const socket = new Socket(); queueMicrotask(() => socket.emit("connect")); return socket; });
    expect(await absent(path, () => ({ ...current, bootTimeMs: Date.now() + 60_000 }))).toBe(false);
    expect(vi.mocked(createConnection)).toHaveBeenCalledTimes(2);
  });
  it("should recheck dev/ino after the last probe before unlink", async () => {
    const path = await endpoint(); const replacement = join(dirname(path), "other.sock");
    await boundSocket(path, true); await boundSocket(replacement, true); rows(path);
    const saved = statSync(replacement);
    for (let i = 0; i < 5; i++) vi.mocked(createConnection).mockImplementationOnce(() => {
      const socket = new Socket(); queueMicrotask(() => { if (i === 4) renameSync(replacement, path); socket.emit("error", Object.assign(new Error("refused"), { code: "ECONNREFUSED" })); }); return socket;
    });
    expect(await absent(path, () => ({ ...current, bootTimeMs: Date.now() + 60_000 }))).toBe(false);
    expect(statSync(path).ino).toBe(saved.ino);
  });
  it("should time out each connect attempt at 500 ms", async () => {
    const path = await endpoint(); await boundSocket(path, true); rows(path);
    vi.mocked(createConnection).mockImplementation(() => new Socket());
    const begun = Date.now();
    await expect(absent(path, () => ({ ...current, bootTimeMs: Date.now() + 60_000 }))).rejects.toMatchObject({ code: "H2A_ENDPOINT_PROBE_TIMEOUT", exitCode: 3 });
    expect(Date.now() - begun).toBeGreaterThanOrEqual(490);
    expect(Date.now() - begun).toBeLessThan(850);
  });
  it("should abort the complete probe window at 2 seconds even with unfinished attempts", async () => {
    const path = await endpoint(); await boundSocket(path, true); rows(path);
    const pending: NodeJS.Timeout[] = [];
    vi.mocked(createConnection).mockImplementation(() => { const socket = new Socket(); const timer = setTimeout(() => socket.emit("error", Object.assign(new Error("refused"), { code: "ECONNREFUSED" })), 400); pending.push(timer); socket.once("close", () => clearTimeout(timer)); return socket; });
    const begun = Date.now();
    await expect(absent(path, () => ({ ...current, bootTimeMs: Date.now() + 60_000 }))).rejects.toMatchObject({ code: "H2A_ENDPOINT_PROBE_TIMEOUT", exitCode: 3 });
    expect(Date.now() - begun).toBeGreaterThanOrEqual(1_990);
    expect(Date.now() - begun).toBeLessThan(2_350);
    expect(vi.mocked(createConnection).mock.calls.length).toBeLessThan(5);
    pending.forEach(clearTimeout);
  });
  it("should observe zero PID, group and signal probes for stale-boot sources", async () => {
    const path = await endpoint(); rows(path);
    vi.mocked(registry.listNativeTerminalPgidEntries).mockReturnValue({ known: true, entries: [{ sessionId: "snapshot", pgid: process.pid,
      frame: stale, owner: { pid: process.pid, startTime: 1, socketPath: path } }] });
    const group = vi.spyOn(posixProcessGroupReaper, "isGroupAlive");
    const kill = vi.spyOn(process, "kill");
    expect(await proveNativeTerminalEndpointAbsent(path, { code: "ENOENT" }, () => current)).toBe(true);
    expect(defaultOwnerHostProbe).not.toHaveBeenCalled();
    expect(readProcessStartTime).not.toHaveBeenCalled();
    expect(group).not.toHaveBeenCalled(); expect(kill).not.toHaveBeenCalled();
  });
  it("should keep an unattributed current-boot socket unknown when uptime is unavailable", async () => {
    const path = await endpoint(); await boundSocket(path);
    expect(await absent(path, () => current)).toBe(false);
  });
  it("should recover a pre-boot unattributed socket with no registry attribution", async () => {
    const path = await endpoint(); await boundSocket(path, true); sidecar(path, stale, false);
    await start(path, () => ({ ...current, bootTimeMs: Date.now() + 60_000 }));
    expect(vi.mocked(createConnection)).toHaveBeenCalledTimes(5);
  });
  it("should preserve the frame anchors in the real pgid snapshot decoder", async () => {
    const path = await endpoint(); rows(path);
    const file = join(dirname(path), "registry.json");
    writeFileSync(file, JSON.stringify({ version: 1, entries: registry.loadRegistry().entries }));
    const actual = await vi.importActual<typeof import("../registry.js")>("../registry.js");
    expect(actual.listNativeTerminalPgidEntries(file)).toMatchObject({ known: true, entries: [{ frame: stale }] });
  });

});

