// @ts-ignore Shared, read-only isolation helper.
import { setupNativeTestEnvironment, spawnIsolatedNative as spawn } from "../../../h2a/test/helpers/native-isolation.js";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NativeTerminalClient } from "./client.js";
import { readProcessStartTime } from "./host.js";
import { runAttach } from "./op.js";
setupNativeTestEnvironment(afterAll);

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => T | Promise<T>, accept: (v: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 8000;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() >= deadline) throw new Error(`waiting for ${label}: ${JSON.stringify(value)}`);
    await delay(10);
  }
}
type Cut = "before" | "after" | "timeout" | undefined;

async function fixture(cut?: Cut, budget = 4096, maxSessions = 4) {
  const directory = mkdtempSync(join(process.env.TMPDIR!, "sw-"));
  const socketPath = join(directory, "h"), proxyPath = join(directory, "p");
  const receipts = join(directory, "children");
  const observer = join(directory, "observer.mjs");
  const identityModule = pathToFileURL(fileURLToPath(new URL("../../dist/proc-identity.js", import.meta.url))).href;
  writeFileSync(observer, `import {appendFileSync} from 'node:fs';
import {ChildProcess} from 'node:child_process';
import {readProcessStartTime} from ${JSON.stringify(identityModule)};
const record=pid=>appendFileSync(${JSON.stringify(receipts)},JSON.stringify({pid,birth:readProcessStartTime(pid)})+'\\n');
record(process.pid);const original=ChildProcess.prototype.spawn;
ChildProcess.prototype.spawn=function(options){const result=original.call(this,options);if(this.pid)record(this.pid);return result;};`);
  const owner = spawn(process.execPath, [fileURLToPath(new URL("../../dist/native-terminal/owner-process.js", import.meta.url)),
    "--socket", socketPath, "--generation", "swap", "--registry-path", join(directory, "registry.json"),
    "--replay-bytes", String(budget), "--max-sessions", String(maxSessions)], {
    env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(observer).href}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "", ready = "";
  owner.stdout!.on("data", chunk => { ready += chunk; });
  owner.stderr!.on("data", chunk => { errors += chunk; });
  const clients: NativeTerminalClient[] = [], sockets = new Set<Socket>();
  let proxy: ReturnType<typeof createServer> | undefined;
  cleanups.push(async () => {
    for (const client of clients) client.close();
    for (const socket of sockets) socket.destroy();
    if (proxy?.listening) await new Promise<void>(resolve => proxy!.close(() => resolve()));
    // PID receipts originate at spawn, including grandchildren and journal writers.
    if (existsSync(receipts)) for (const line of readFileSync(receipts, "utf8").trim().split("\n").filter(Boolean)) {
      const {pid, birth} = JSON.parse(line);
      if (pid === process.pid || birth === undefined || readProcessStartTime(pid) !== birth) continue;
      try { process.kill(pid, "SIGKILL"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e; }
    }
    if (owner.exitCode === null && owner.signalCode === null) { const exit = once(owner, "exit"); owner.kill("SIGKILL"); await exit; }
    await delay(100);
    rmSync(directory, { recursive: true, force: true });
  });
  await until(() => ready || errors, () => ready.includes("h2a.native-terminal.ready"), "owner ready");
  async function connect(path = socketPath, requestTimeoutMs = 1000) {
    const client = await NativeTerminalClient.connect(path, { requestTimeoutMs }); clients.push(client); return client;
  }
  const admin = await connect();
  const bytesPath = join(directory, "bytes"), infoPath = join(directory, "info"), sizePath = join(directory, "size");
  writeFileSync(bytesPath, "");
  const program = `const fs=require('node:fs');process.stdin.setRawMode(true);process.stdin.resume();
fs.writeFileSync(${JSON.stringify(infoPath)},JSON.stringify({pid:process.pid}));process.stdout.write('READY\\r\\n');
process.on('SIGWINCH',()=>fs.writeFileSync(${JSON.stringify(sizePath)},JSON.stringify([process.stdout.columns,process.stdout.rows])));
process.stdin.on('data',b=>{fs.appendFileSync(${JSON.stringify(bytesPath)},b);process.stdout.write('ECHO:'+b.toString()+'\\r\\n');if(b.toString().includes('EXIT'))process.exit(23);});`;
  const state = await admin.create({ id: "cli", command: process.execPath, args: ["-e", program], cwd: directory,
    env: { ...process.env } as Record<string,string>, cols: 80, rows: 24 });
  await until(() => existsSync(infoPath), Boolean, "CLI ready");
  const cliPid = JSON.parse(readFileSync(infoPath, "utf8")).pid;
  const cliBirth = readProcessStartTime(cliPid);
  const ownerBirth = readProcessStartTime(owner.pid!);
  expect(cliBirth).toBeDefined(); expect(ownerBirth).toBeDefined();
  let frontendPid = (await admin.ping() as any).frontend.pid as number;
  const killFrontend = () => process.kill(frontendPid, "SIGKILL");
  const bytes = () => readFileSync(bytesPath, "utf8");
  let armed = cut;
  const observedIdentities: unknown[] = [];
  proxy = createServer(down => {
    const up = createConnection(socketPath); sockets.add(down); sockets.add(up);
    down.setEncoding("utf8"); up.setEncoding("utf8");
    let input = "", output = "", droppedId: string | undefined;
    down.on("error", () => {}); up.on("error", () => down.destroy());
    down.on("close", () => { sockets.delete(down); up.destroy(); });
    up.on("close", () => { sockets.delete(up); down.destroy(); });
    down.on("data", chunk => {
      input += chunk;
      for (;;) {
        const end = input.indexOf("\n"); if (end < 0) break;
        const line = input.slice(0, end); input = input.slice(end + 1);
        const request = JSON.parse(line);
        if (request.operation === "write") {
          observedIdentities.push(request.params.writeIdentity);
          const fault = armed; armed = undefined;
          if (fault === "before") { killFrontend(); down.destroy(); up.destroy(); continue; }
          if (fault === "after" || fault === "timeout") {
            droppedId = request.id;
            if (fault === "after") {
              // Observe execution at the CLI before severing the response path.
              void until(bytes, value => value.includes(request.params.data), "executed cut write").then(() => { killFrontend(); down.destroy(); up.destroy(); });
            }
          }
        }
        up.write(line + "\n");
      }
    });
    up.on("data", chunk => {
      output += chunk;
      for (;;) {
        const end = output.indexOf("\n"); if (end < 0) break;
        const line = output.slice(0, end); output = output.slice(end + 1);
        if (JSON.parse(line).id !== droppedId) down.write(line + "\n");
      }
    });
  });
  await new Promise<void>(resolve => proxy!.listen(proxyPath, resolve)); chmodSync(proxyPath, 0o600);
  const input = new PassThrough(), output: string[] = [];
  let connected = 0, resize: (() => void) | undefined;
  const stdout = { columns: 80, rows: 24, write: (s: string) => { output.push(s); return true; } };
  const attach = () => {
    const result = runAttach("cli", {
      connect: async () => { const c = await connect(proxyPath, 150); connected++; return c; },
      stdin: input as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream,
      now: Date.now, delay: ms => delay(Math.min(ms, 20)), onResize: fn => { resize = fn; }, offResize() {},
    });
    // Keep a failed assertion from leaving an attach loop alive.
    cleanups.push(async () => { input.emit("end"); await result.catch(() => {}); });
    return result;
  };
  async function replacement() {
    return until(async () => {
      try { const c = await connect(); return await c.ping() as any; } catch { return undefined; }
    }, p => Boolean(p && p.frontend.pid !== frontendPid), "replacement frontend").then(p => { frontendPid = p.frontend.pid; return p; });
  }
  return { admin, connect, state, bytes, infoPath, sizePath, input, output, stdout, attach, resize: () => resize?.(),
    cliPid, cliBirth, owner, ownerBirth, killFrontend, replacement, observedIdentities, connected: () => connected };
}

describe("frontend replacement through real attach and a real CLI", () => {
  for (const [cut, title] of [
    ["before", "should deliver a write cut before execution exactly once after a frontend swap"],
    ["after", "should not duplicate a write cut after execution but before its response"],
    ["timeout", "should resolve a client timeout without losing or duplicating the timed-out write"],
  ] as const) it(title, async () => {
    const f = await fixture(cut); const attached = f.attach();
    await until(() => f.output.join(""), s => s.includes("READY"), "attach replay");
    f.input.write("numbered:001\n");
    await until(f.bytes, s => s === "numbered:001\n", "exact CLI input after recovery");
    await until(f.connected, n => n >= 2, "attach reconnected");
    f.input.write("numbered:002\n");
    await until(f.bytes, s => s === "numbered:001\nnumbered:002\n", "ordered second write");
    expect(f.observedIdentities[0]).toBeDefined();
    expect(f.observedIdentities[1]).toEqual(f.observedIdentities[0]);
    expect(readProcessStartTime(f.cliPid)).toBe(f.cliBirth);
    expect(readProcessStartTime(f.owner.pid!)).toBe(f.ownerBirth);
    f.input.write("EXIT\n"); expect(await attached).toBe(23);
    expect(f.bytes()).toBe("numbered:001\nnumbered:002\nEXIT\n");
  }, 20000);

  it("should replay identical scrollback before and after a frontend swap", async () => {
    const f = await fixture(); const before = await f.admin.readOutput("cli", 0);
    f.killFrontend(); await f.replacement(); const next = await f.connect();
    expect(await next.readOutput("cli", 0)).toEqual(before);
  }, 15000);

  it("should apply a resize issued after a frontend swap (SIGWINCH and size readback)", async () => {
    const f = await fixture(); const attached = f.attach();
    await until(() => f.output.join(""), s => s.includes("READY"), "initial attach");
    f.killFrontend(); await f.replacement();
    await until(f.connected, n => n >= 2, "attach recovery");
    f.stdout.columns = 109; f.stdout.rows = 37; f.resize();
    await until(() => existsSync(f.sizePath) ? readFileSync(f.sizePath, "utf8") : "", s => s === "[109,37]", "SIGWINCH ioctl size");
    f.input.write("EXIT\n"); expect(await attached).toBe(23);
  }, 15000);

  it("should keep enforcing session and replay quotas across a frontend swap", async () => {
    const f = await fixture(undefined, 128, 1);
    const lease = await f.admin.acquireController("cli", "quota"); await f.admin.write(lease, "x".repeat(300));
    await until(f.bytes, s => s.length === 300, "large fixture output");
    f.killFrontend(); await f.replacement(); const c = await f.connect();
    const replay = await c.readOutput("cli", 0); expect(replay.gap).not.toBeNull();
    expect(Buffer.byteLength(replay.chunks.map(chunk => chunk.data).join(""))).toBeLessThanOrEqual(128);
    await expect(c.create({ id: "extra", command: "fixture", args: [], cwd: process.env.TMPDIR!, env: {}, cols: 80, rows: 24 })).rejects.toThrow(/session.*limit|maximum|capacity|quota/i);
  }, 15000);

  it("should surface the exact exit status of a CLI that exits during a frontend swap", async () => {
    const f = await fixture(); const attached = f.attach();
    await until(() => f.output.join(""), s => s.includes("READY"), "attach");
    f.input.write("EXIT\n"); await until(f.bytes, s => s.includes("EXIT"), "CLI exit input");
    f.killFrontend(); await f.replacement(); expect(await attached).toBe(23);
  }, 15000);
});
