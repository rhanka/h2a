// @ts-ignore Shared, read-only isolation helper.
import { setupNativeTestEnvironment, spawnIsolatedNative as spawn } from "../../../h2a/test/helpers/native-isolation.js";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { once } from "node:events";
import { NativeTerminalClient } from "./client.js";
import { readProcessStartTime } from "./host.js";
import * as ownerProtocol from "./owner-protocol.js";
import { readHostJournal, resolveHostJournalPath } from "./journal.js";
import { defaultUpgradeRuntime, performAutoUpgrade, pinPtyRollbackFrontend, readPtyRollbackFrontend, recordPtyInstallReferences, sweepPtyRetainedInstalls } from "../../../h2a/src/runtime/upgrade/index.js";
setupNativeTestEnvironment(afterAll);
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 10000;
  for (;;) { const value = await read(); if (accept(value)) return value; if (Date.now() >= deadline) throw new Error(`waiting for ${label}: ${JSON.stringify(value)}`); await delay(10); }
}

async function fixture(prefixLayout = false, legacy = false, listenerFault = false) {
  const directory = mkdtempSync(join(process.env.TMPDIR!, "u-"));
  const socketPath = join(directory, "h"), receipts = join(directory, "pids");
  const faultTrigger = join(directory, "listener-fault");
  const dist = fileURLToPath(new URL("../../dist/", import.meta.url));
  const observer = join(directory, "observer.mjs");
  writeFileSync(observer, `import {appendFileSync} from 'node:fs';import {ChildProcess} from 'node:child_process';
import {readProcessStartTime} from ${JSON.stringify(pathToFileURL(join(dist, "proc-identity.js")).href)};
const record=pid=>appendFileSync(${JSON.stringify(receipts)},JSON.stringify({pid,birth:readProcessStartTime(pid)})+'\\n');record(process.pid);
const original=ChildProcess.prototype.spawn;ChildProcess.prototype.spawn=function(options){const r=original.call(this,options);if(this.pid)record(this.pid);return r;};`);
  if (listenerFault) writeFileSync(observer, readFileSync(observer, "utf8") + `
import {Server} from 'node:net';import {existsSync,unlinkSync} from 'node:fs';
const listen=Server.prototype.listen;Server.prototype.listen=function(...args){
  if(typeof args[0]==='string' && args[0].startsWith(${JSON.stringify(join(dirname(socketPath), ".h."))})) {
    this.once('listening',()=>{const poll=setInterval(()=>{
      if(!existsSync(${JSON.stringify(faultTrigger)}))return;
      unlinkSync(${JSON.stringify(faultTrigger)});clearInterval(poll);
      this.emit('error',Object.assign(new Error('injected frontend listener failure'),{code:'EBADF'}));
    },10);poll.unref();});
  }return listen.apply(this,args);
};`);
  const prefix = join(directory, "prefix"), packageDir = join(prefix, "lib/node_modules/@sentropic/h2a");
  const oldDir = prefixLayout ? join(packageDir, "node_modules/@sentropic/h2a-runtime") : join(directory, "old");
  const nextDir = join(directory, "h2a.h2a-prev-1.0.1-2147483646-pinned"), badDir = join(directory, "bad");
  for (const [root, version] of [[oldDir, "1.0.0"], [nextDir, "1.0.1"], [badDir, "1.0.2"]]) {
    cpSync(dist, join(root!, "dist"), { recursive: true });
    writeFileSync(join(root!, "package.json"), JSON.stringify({ name: "@sentropic/h2a-runtime", version, type: "module" }));
    symlinkSync(fileURLToPath(new URL("../../../../node_modules/", import.meta.url)), join(root!, "node_modules"), "dir");
  }
  const seedCli = (destination: string, version: string, runtime?: string) => {
    const pkg = join(destination, "lib/node_modules/@sentropic/h2a");
    mkdirSync(join(pkg, "dist"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@sentropic/h2a", version, type: "module" }));
    writeFileSync(join(pkg, "dist/bin.js"), `console.log(${JSON.stringify(version)});`);
    mkdirSync(join(pkg, "node_modules"), { recursive: true });
    symlinkSync(fileURLToPath(new URL("../../../../node_modules/node-pty", import.meta.url)), join(pkg, "node_modules/node-pty"), "dir");
    if (runtime) cpSync(runtime, join(pkg, "node_modules/@sentropic/h2a-runtime"), { recursive: true });
  };
  if (prefixLayout) seedCli(prefix, "1.0.0");
  const badProtocol = join(badDir, "dist/native-terminal/owner-protocol.js");
  writeFileSync(badProtocol, readFileSync(badProtocol, "utf8").replace("OWNER_PROTOCOL_VERSION = 1", "OWNER_PROTOCOL_VERSION = 99"));
  const module = (root: string) => join(root, "dist/native-terminal/frontend-process.js");
  const owner = spawn(process.execPath, [join(oldDir, `dist/native-terminal/${legacy ? "process" : "owner-process"}.js`), "--socket", socketPath,
    "--generation", "upgrade-contract", "--registry-path", join(directory, "registry.json")], {
    env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(observer).href}` }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "", errors = "";
  owner.stdout!.on("data", chunk => { output += chunk; }); owner.stderr!.on("data", chunk => { errors += chunk; });
  const clients: NativeTerminalClient[] = [];
  cleanups.push(async () => {
    for (const c of clients) c.close();
    if (existsSync(receipts)) for (const line of readFileSync(receipts, "utf8").trim().split("\n").filter(Boolean)) {
      const {pid, birth} = JSON.parse(line);
      if (pid === process.pid || birth === undefined || readProcessStartTime(pid) !== birth) continue;
      try { process.kill(pid, "SIGKILL"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    }
    if (owner.exitCode === null && owner.signalCode === null) { const exit = once(owner, "exit"); owner.kill("SIGKILL"); await exit; }
    await delay(100); rmSync(directory, { recursive: true, force: true });
  });
  await until(() => output || errors, () => output.includes("h2a.native-terminal.ready"), "owner ready");
  const connect = async () => { const c = await NativeTerminalClient.connect(socketPath); clients.push(c); return c; };
  const client = await connect();
  const got = join(directory, "got"), cliInfo = join(directory, "cli"); writeFileSync(got, "");
  await client.create({ id: "cli", command: process.execPath, args: ["-e", `const fs=require('node:fs');process.stdin.setRawMode(true);process.stdin.resume();fs.writeFileSync(${JSON.stringify(cliInfo)},String(process.pid));process.stdin.on('data',b=>{fs.appendFileSync(${JSON.stringify(got)},b);process.stdout.write(b);if(b.toString().includes('EXIT'))process.exit(19);});`],
    cwd: directory, env: { ...process.env } as Record<string,string>, cols: 80, rows: 24 });
  await until(() => existsSync(cliInfo), Boolean, "CLI ready");
  const cliPid = Number(readFileSync(cliInfo, "utf8")), cliBirth = readProcessStartTime(cliPid), ownerBirth = readProcessStartTime(owner.pid!);
  expect(cliBirth).toBeDefined(); expect(ownerBirth).toBeDefined();
  const control = (command: string, params: Record<string, unknown> = {}, options = {}) =>
    (ownerProtocol as any).requestNativeTerminalOwnerControl(socketPath, owner.pid!, command, params, options);
  async function exchange(text: string) {
    const c = await connect(), lease = await c.acquireController("cli", "exchange");
    await c.write(lease, text); await c.releaseController(lease);
    await until(() => readFileSync(got, "utf8"), s => s.includes(text), "CLI input");
    await until(() => c.readOutput("cli", 0), replay => replay.chunks.map(chunk => chunk.data).join("").replace(/\r\n/g, "\n").includes(text), "CLI output replay");
    expect(readProcessStartTime(cliPid)).toBe(cliBirth); expect(readProcessStartTime(owner.pid!)).toBe(ownerBirth);
  }
  return { owner, ownerBirth, socketPath, client, connect, control, exchange, oldDir, nextDir, badDir, module, directory, prefix, packageDir, seedCli, faultTrigger };
}

describe("PTY upgrade contract", () => {
  it("should preserve the published inode and CLI when a frontend listener fails", async () => {
    const f = await fixture(false, false, true); await f.exchange("listener-before\n");
    const before = await f.control("status"), inode = statSync(f.socketPath);
    writeFileSync(f.faultTrigger, "fail");
    await until(() => f.control("status"), status => status.frontend && status.frontend.pid !== before.frontend.pid, "listener replacement");
    expect(existsSync(f.faultTrigger)).toBe(false);
    expect(statSync(f.socketPath).ino).toBe(inode.ino);
    await f.exchange("listener-after\n");
  }, 20000);

  it("should install an upgrade while preserving a live fused host and retaining its unknown code references", async () => {
    const f = await fixture(true, true); await f.exchange("legacy-before\n");
    const previousSocket = process.env.H2A_NATIVE_SOCKET;
    try {
      process.env.H2A_NATIVE_SOCKET = f.socketPath;
      const result = performAutoUpgrade("1.0.0", { prefix: f.prefix, runtime: {
        ...defaultUpgradeRuntime, fetchLatest: () => "1.0.1", fetchTarball: () => ({ ok: true, file: join(f.directory, "fixture.tgz") }),
        stageInstall: (_tarball, stage) => { f.seedCli(stage, "1.0.1", f.nextDir); return { ok: true }; },
      } });
      expect(result.outcome).toBe("pty-deferred"); expect(result.verifiedVersion, result.message).toBe("1.0.1");
      expect(result.pty?.owners[0].owner.pid).toBe(f.owner.pid);
      const backups = readdirSync(dirname(f.packageDir)).filter(name => name.startsWith("h2a.h2a-prev-"));
      expect(backups).toHaveLength(1); expect(existsSync(join(dirname(f.packageDir), backups[0]!))).toBe(true);
    } finally { if (previousSocket === undefined) delete process.env.H2A_NATIVE_SOCKET; else process.env.H2A_NATIVE_SOCKET = previousSocket; }
    await f.exchange("legacy-after\n");
  }, 20000);

  it("should run the real staged upgrade and keep the same CLI while switching the frontend", async () => {
    const f = await fixture(true); await f.exchange("real-upgrade-before\n");
    const previousSocket = process.env.H2A_NATIVE_SOCKET;
    try {
      process.env.H2A_NATIVE_SOCKET = f.socketPath;
      const result = performAutoUpgrade("1.0.0", { prefix: f.prefix, runtime: {
        ...defaultUpgradeRuntime, fetchLatest: () => "1.0.1", fetchTarball: () => ({ ok: true, file: join(f.directory, "fixture.tgz") }),
        stageInstall: (_tarball, stage) => { f.seedCli(stage, "1.0.1", f.nextDir); return { ok: true }; },
      } });
      expect(result.outcome, result.message).toBe("upgraded"); expect(result.pty?.status).toBe("switched");
      expect(result.pty?.owners[0].owner.pid).toBe(f.owner.pid);
      expect(result.pty?.owners[0].owner.version).toBe("1.0.0");
      expect(result.pty?.owners[0].frontend.version).toBe("1.0.1");
      expect((result.pty as any).versions).toEqual(expect.arrayContaining([
        expect.objectContaining({ component: "owner", installedVersion: "1.0.1", loadedVersion: "1.0.0", deferredVersion: "1.0.1" }),
        expect.objectContaining({ component: "frontend", installedVersion: "1.0.1", loadedVersion: "1.0.1", switchedVersion: "1.0.1" }),
      ]));
      const pin = readPtyRollbackFrontend(f.prefix, 1)!; expect(existsSync(pin.frontendModule)).toBe(true);
      expect(pin.installDir).toContain("h2a.h2a-prev-");
    } finally { if (previousSocket === undefined) delete process.env.H2A_NATIVE_SOCKET; else process.env.H2A_NATIVE_SOCKET = previousSocket; }
    await f.exchange("real-upgrade-after\n");
  }, 20000);
  it("should never signal the PTY owner during a frontend upgrade", async () => {
    const f = await fixture(); await f.exchange("before\n");
    const result = await f.control("replace-frontend", { frontendModule: f.module(f.nextDir), rollbackModule: f.module(f.oldDir) });
    expect(result.status).toBe("switched"); await f.exchange("after\n");
    expect(readHostJournal(resolveHostJournalPath()).filter(entry => entry.pid === f.owner.pid && ["signal", "stop"].includes(entry.event))).toEqual([]);
  }, 20000);

  it("should roll back to the retained previous B frontend when the new frontend fails its handshake", async () => {
    const f = await fixture(); const before = await f.control("status");
    const result = await f.control("replace-frontend", { frontendModule: f.module(f.badDir), rollbackModule: f.module(f.oldDir) });
    expect(result.status).toBe("rolled-back"); expect(result.frontend.pid).not.toBe(before.frontend.pid);
    expect(result.frontend.codePath).toBe(f.module(f.oldDir)); await f.exchange("rollback\n");
  }, 20000);

  it("should report installed, loaded, switched and deferred versions per component", async () => {
    const f = await fixture(); const before = await f.control("status");
    expect(before.owner.version).toBe("1.0.0"); expect(before.frontend.version).toBe("1.0.0");
    expect(before.owner.codeIdentity.ino).toBeGreaterThan(0);
    const result = await f.control("replace-frontend", { frontendModule: f.module(f.nextDir), rollbackModule: f.module(f.oldDir) });
    expect(result.frontend.version).toBe("1.0.1"); expect(result.owner.version).toBe("1.0.0");
    expect(result.owner.pid).toBe(f.owner.pid); expect(result.frontend.codeIdentity.ino).not.toBe(before.frontend.codeIdentity.ino);
  }, 20000);

  it("should start the pinned previous frontend after all old component references disappear and a sweep runs", async () => {
    const f = await fixture();
    const qualified = await f.control("replace-frontend", { frontendModule: f.module(f.nextDir), rollbackModule: f.module(f.oldDir) });
    expect(qualified.status).toBe("switched");
    const lock = defaultUpgradeRuntime.acquirePrefixLock!(f.directory);
    expect(lock.acquired).toBe(true);
    try {
      const target = { installDir: f.nextDir, frontendModule: f.module(f.nextDir), codeIdentity: qualified.frontend.codeIdentity, ownerProtocolVersion: 1 };
      pinPtyRollbackFrontend(f.directory, lock, target, { ...qualified.frontend, ownerProtocolVersion: 1 });
      expect((await f.control("replace-frontend", { frontendModule: f.module(f.oldDir), rollbackModule: f.module(f.nextDir) })).status).toBe("switched");
      await until(() => f.control("status"), status => status.components.every((c: any) => !c.codePath.startsWith(f.nextDir)), "all old component references gone");
      await until(() => { try { process.kill(qualified.frontend.pid, 0); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; } }, Boolean, "old frontend reaped");
      recordPtyInstallReferences(f.directory, lock, f.nextDir, []);
      sweepPtyRetainedInstalls(f.directory, lock);
      expect(existsSync(f.module(f.nextDir))).toBe(true);
      const pin = readPtyRollbackFrontend(f.directory, 1)!;
      expect((await f.control("replace-frontend", { frontendModule: pin.frontendModule, rollbackModule: f.module(f.oldDir) })).status).toBe("switched");
      await f.exchange("pinned-after-sweep\n");
    } finally { lock.release(); }
  }, 20000);

  it("should refuse a frontend whose owner-protocol version is outside the compat window", async () => {
    const f = await fixture();
    await expect(f.control("status", {}, { expectedVersion: 99 })).rejects.toMatchObject({ name: "OwnerProtocolCompatibilityError" });
    await f.exchange("compatible-owner-kept\n");
  }, 15000);

  it("should leave a visible partial state when the frontend swap is interrupted", async () => {
    const f = await fixture();
    await expect(f.control("replace-frontend", { frontendModule: f.module(f.nextDir), rollbackModule: f.module(f.oldDir) }, { timeoutMs: 1 })).rejects.toThrow();
    const status = await f.control("status"); expect(["switching", "idle"]).toContain(status.upgradeState);
    await until(() => f.control("status"), value => value.upgradeState === "idle", "interrupted switch settled");
    await f.exchange("partial-state-survived\n");
  }, 15000);

  it("should refuse to abandon B for a fused host while B sessions are live, and allow it after drain", async () => {
    const f = await fixture();
    expect((await f.control("replace-frontend", { frontendModule: f.module(f.nextDir), rollbackModule: f.module(f.oldDir) })).status).toBe("switched");
    const currentClient = await f.connect();
    expect(await f.control("abandon")).toMatchObject({ status: "deferred", blockingSessions: 1 });
    const lease = await currentClient.acquireController("cli", "exit"); await currentClient.write(lease, "EXIT\n");
    await until(() => currentClient.state("cli"), state => state.status === "exited", "CLI drain");
    expect(await f.control("abandon")).toMatchObject({ status: "withdrawing" });
    await until(() => existsSync(f.socketPath), exists => !exists, "endpoint withdrawal");
    const fused = spawn(process.execPath, [fileURLToPath(new URL("../../dist/native-terminal/process.js", import.meta.url)), "--socket", f.socketPath,
      "--registry-path", join(f.directory, "registry.json"), "--generation", "fused"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    cleanups.push(async () => { if (fused.exitCode === null && fused.signalCode === null) { const exit = once(fused, "exit"); fused.kill("SIGKILL"); await exit; } });
    let ready = ""; fused.stdout!.on("data", chunk => { ready += chunk; });
    await until(() => ready, text => text.includes("h2a.native-terminal.ready"), "fused start after drain");
  }, 20000);
});
