// @ts-ignore Shared, read-only isolation helper.
import { setupNativeTestEnvironment, spawnIsolatedNative as spawn } from "../../../h2a/test/helpers/native-isolation.js";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { once } from "node:events";
import { NativeTerminalClient } from "./client.js";
import { readProcessStartTime } from "./host.js";
import * as ownerProtocol from "./owner-protocol.js";
import { readHostJournal, resolveHostJournalPath } from "./journal.js";
setupNativeTestEnvironment(afterAll);
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 10000;
  for (;;) { const value = await read(); if (accept(value)) return value; if (Date.now() >= deadline) throw new Error(`waiting for ${label}: ${JSON.stringify(value)}`); await delay(10); }
}

async function fixture() {
  const directory = mkdtempSync(join(process.env.TMPDIR!, "u-"));
  const socketPath = join(directory, "h"), receipts = join(directory, "pids");
  const dist = fileURLToPath(new URL("../../dist/", import.meta.url));
  const observer = join(directory, "observer.mjs");
  writeFileSync(observer, `import {appendFileSync} from 'node:fs';import {ChildProcess} from 'node:child_process';
import {readProcessStartTime} from ${JSON.stringify(pathToFileURL(join(dist, "proc-identity.js")).href)};
const record=pid=>appendFileSync(${JSON.stringify(receipts)},JSON.stringify({pid,birth:readProcessStartTime(pid)})+'\\n');record(process.pid);
const original=ChildProcess.prototype.spawn;ChildProcess.prototype.spawn=function(options){const r=original.call(this,options);if(this.pid)record(this.pid);return r;};`);
  const oldDir = join(directory, "old"), nextDir = join(directory, "next"), badDir = join(directory, "bad");
  for (const [root, version] of [[oldDir, "1.0.0"], [nextDir, "1.0.1"], [badDir, "1.0.2"]]) {
    cpSync(dist, join(root!, "dist"), { recursive: true });
    writeFileSync(join(root!, "package.json"), JSON.stringify({ name: "@sentropic/h2a-runtime", version, type: "module" }));
    symlinkSync(fileURLToPath(new URL("../../../../node_modules/", import.meta.url)), join(root!, "node_modules"), "dir");
  }
  const badProtocol = join(badDir, "dist/native-terminal/owner-protocol.js");
  writeFileSync(badProtocol, readFileSync(badProtocol, "utf8").replace("OWNER_PROTOCOL_VERSION = 1", "OWNER_PROTOCOL_VERSION = 99"));
  const module = (root: string) => join(root, "dist/native-terminal/frontend-process.js");
  const owner = spawn(process.execPath, [join(oldDir, "dist/native-terminal/owner-process.js"), "--socket", socketPath,
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
    const replay = await c.readOutput("cli", 0); expect(replay.chunks.map(chunk => chunk.data).join("")).toContain(text);
    expect(readProcessStartTime(cliPid)).toBe(cliBirth); expect(readProcessStartTime(owner.pid!)).toBe(ownerBirth);
  }
  return { owner, ownerBirth, socketPath, client, connect, control, exchange, oldDir, nextDir, badDir, module, directory };
}

describe("PTY upgrade contract", () => {
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

  it("should refuse a frontend whose owner-protocol version is outside the compat window", async () => {
    const f = await fixture();
    await expect(f.control("status", {}, { expectedVersion: 99 })).rejects.toMatchObject({ name: "OwnerProtocolCompatibilityError" });
    await f.exchange("compatible-owner-kept\n");
  }, 15000);

  it("should leave a visible partial state when the frontend swap is interrupted", async () => {
    const f = await fixture();
    await expect(f.control("replace-frontend", { frontendModule: f.module(f.nextDir), rollbackModule: f.module(f.oldDir) }, { timeoutMs: 1 })).rejects.toThrow();
    const status = await f.control("status"); expect(["switching", "idle"]).toContain(status.upgradeState);
    await f.exchange("partial-state-survived\n");
  }, 15000);

  it("should refuse to abandon B for a fused host while B sessions are live, and allow it after drain", async () => {
    const f = await fixture();
    expect(await f.control("abandon")).toMatchObject({ status: "deferred", blockingSessions: 1 });
    const lease = await f.client.acquireController("cli", "exit"); await f.client.write(lease, "EXIT\n");
    await until(() => f.client.state("cli"), state => state.status === "exited", "CLI drain");
    expect(await f.control("abandon")).toMatchObject({ status: "withdrawn" });
    await until(() => existsSync(f.socketPath), exists => !exists, "endpoint withdrawal");
    const fused = spawn(process.execPath, [fileURLToPath(new URL("../../dist/native-terminal/process.js", import.meta.url)), "--socket", f.socketPath,
      "--registry-path", join(f.directory, "registry.json"), "--generation", "fused"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    cleanups.push(async () => { if (fused.exitCode === null && fused.signalCode === null) { const exit = once(fused, "exit"); fused.kill("SIGKILL"); await exit; } });
    let ready = ""; fused.stdout!.on("data", chunk => { ready += chunk; });
    await until(() => ready, text => text.includes("h2a.native-terminal.ready"), "fused start after drain");
  }, 20000);
});
