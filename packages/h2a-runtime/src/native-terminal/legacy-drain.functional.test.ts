// @ts-ignore Shared, read-only isolation helper.
import { setupNativeTestEnvironment, spawnIsolatedNative as spawn } from "../../../h2a/test/helpers/native-isolation.js";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ChildProcess } from "node:child_process";
import { NativeTerminalClient } from "./client.js";
import { readProcessStartTime } from "./host.js";
import { knownNativeTerminalSocketPaths } from "./socket-path.js";
import { collectNativeInventory } from "./fleet.js";
import { getRuntimeVersion } from "./journal.js";
import { requestNativeTerminalOwnerControl } from "./owner-protocol.js";
import { inspectNativeTerminalFrontendUpgrade, switchNativeTerminalUpgradeFrontends } from "./supervisor.js";

setupNativeTestEnvironment(afterAll);
const children: ChildProcess[] = [], clients: NativeTerminalClient[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  // These endpoints and every listed session belong to this test's fixture.
  for (const client of clients.splice(0)) {
    try {
      for (const session of await client.list()) if (session.status !== "exited") {
        await client.stopIfIncarnation(session.id, session.generation, session.incarnation, "SIGKILL");
      }
    } catch { /* A drained endpoint may already have closed. */ }
    client.close();
  }
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = once(child, "exit"); child.kill("SIGTERM"); await exited;
  }
});
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 8000;
  for (;;) {
    const value = await read(); if (accept(value)) return value;
    if (Date.now() >= deadline) throw new Error(`${label}: ${JSON.stringify(value)}`);
    await delay(10);
  }
}
const entry = (name: string) => fileURLToPath(new URL(`../../dist/native-terminal/${name}.js`, import.meta.url));
async function fixture(holdRetirement = false) {
  const directory = mkdtempSync(join(process.env.TMPDIR!, "ld-"));
  const paths = knownNativeTerminalSocketPaths({ XDG_RUNTIME_DIR: directory });
  const held = join(directory, "hold-retirement"), hook = join(directory, "retirement-hook.mjs");
  if (holdRetirement) writeFileSync(hook, `
import { existsSync } from 'node:fs';
const immediate = globalThis.setImmediate;
globalThis.setImmediate = (callback, ...args) => {
  if (!existsSync(${JSON.stringify(held)})) return immediate(callback, ...args);
  const resume = () => existsSync(${JSON.stringify(held)}) ? setTimeout(resume, 5) : immediate(callback, ...args);
  return setTimeout(resume, 5);
};`);
  async function connect(index: number) {
    const client = await NativeTerminalClient.connect(paths[index]!); clients.push(client); return client;
  }
  async function start(index: number, kind: string) {
    const child = spawn(process.execPath, [entry(kind), "--socket", paths[index]!, "--generation", `drain-${index}`,
      "--registry-path", join(directory, `registry-${index}.json`)], {
        env: holdRetirement && kind === "owner-process"
          ? { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(hook).href}` } : process.env,
        stdio: ["ignore", "pipe", "pipe"] });
    children.push(child); let out = "", err = "";
    child.stdout!.on("data", b => { out += b; }); child.stderr!.on("data", b => { err += b; });
    await until(() => ({ out, err, code: child.exitCode }), value => value.out.includes("h2a.native-terminal.ready"), "host ready");
    const birth = readProcessStartTime(child.pid!); expect(birth).toBeDefined();
    return { child, client: await connect(index), birth };
  }
  // process.js intentionally keeps the unfenced fused-host v1 dispatch. It
  // must never be retroactively treated as a cooperative B owner.
  const legacy = await start(1, "process"), current = await start(0, "owner-process");
  const create = (client: NativeTerminalClient, id: string) => client.create({ id, command: "/bin/bash",
    args: ["--noprofile", "--norc", "-c", "printf 'READY\\n'; while IFS= read -r line; do [ \"$line\" = finish ] && exit 19; printf 'legacy:%s\\n' \"$line\"; done"],
    cwd: directory, env: { ...process.env } as Record<string, string>, cols: 80, rows: 24 });
  async function inspect() {
    const previous = process.env.H2A_NATIVE_SOCKET;
    process.env.H2A_NATIVE_SOCKET = paths[1]!;
    try { return await inspectNativeTerminalFrontendUpgrade(); }
    finally { if (previous === undefined) delete process.env.H2A_NATIVE_SOCKET; else process.env.H2A_NATIVE_SOCKET = previous; }
  }
  async function defer(plan?: Awaited<ReturnType<typeof inspect>>) {
    return switchNativeTerminalUpgradeFrontends(plan ?? await inspect(), entry("frontend-process"), entry("frontend-process"));
  }
  async function exchange(client: NativeTerminalClient, id: string, text: string) {
    const lease = await client.acquireController(id, "legacy-driver");
    try { await client.write(lease, `${text}\n`); }
    finally { await client.releaseController(lease); }
    await until(() => client.readOutput(id, 0), r => r.chunks.some(c => c.data.includes(`legacy:${text}`)), "legacy response");
  }
  const deferred = (result: Awaited<ReturnType<typeof defer>>) => {
    expect(result.status).toBe("deferred");
    expect(result.owners).toContainEqual(expect.objectContaining({ socketPath: paths[1], status: "deferred",
      admission: "unfenced", retirement: "deferred" }));
  };
  return { directory, paths, legacy, current, connect, create, inspect, defer, exchange, deferred, held };
}

/** An existing frontend that ignores the drain broadcast. Only the owner can
 * make admission authoritative across every loaded v1 frontend/connection. */
async function oldFrontend(f: Awaited<ReturnType<typeof fixture>>) {
  const socket = createConnection(join(f.directory, "h2a-nt", `.fwd-${f.current.child.pid}.sock`));
  const frames: Record<string, unknown>[] = []; let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", chunk => {
    buffer += chunk;
    for (;;) {
      const end = buffer.indexOf("\n"); if (end < 0) break;
      frames.push(JSON.parse(buffer.slice(0, end))); buffer = buffer.slice(end + 1);
    }
  });
  try { await until(() => frames, values => values.some(frame => frame.kind === "hello"), "forward hello"); }
  catch (error) { socket.destroy(); throw error; }
  socket.write(JSON.stringify({ kind: "hello", role: "frontend", ownerProtocolVersion: 1 }) + "\n");
  return { socket, create: async (id: string) => {
    const params = { id, command: "/bin/bash", args: ["--noprofile", "--norc", "-c", "read -r line"],
      cwd: f.directory, env: { ...process.env }, cols: 80, rows: 24 };
    socket.write(JSON.stringify({ kind: "request", connId: "existing-v1", reqId: id,
      frame: JSON.stringify({ version: 1, id, operation: "create", params }) + "\n" }) + "\n");
    const responses = await until(() => frames, values => values.some(frame => frame.kind === "response" && frame.reqId === id), "forward create");
    return responses.find(frame => frame.kind === "response" && frame.reqId === id)!;
  } };
}

it("should preserve a live pre-B session and explicitly defer unfenced retirement", async () => {
  const f = await fixture(), state = await f.create(f.legacy.client, "legacy");
  const birth = readProcessStartTime(state.pid); expect(birth).toBeDefined();
  f.deferred(await f.defer()); await f.exchange(f.legacy.client, "legacy", "still-here");
  expect(readProcessStartTime(state.pid)).toBe(birth);
  expect(readProcessStartTime(f.legacy.child.pid!)).toBe(f.legacy.birth);
  const lease = await f.legacy.client.acquireController("legacy", "natural-exit");
  await f.legacy.client.write(lease, "finish\n");
  const ended = await until(() => f.legacy.client.state("legacy"), s => s.status === "exited", "natural legacy exit");
  expect(ended.exit).toMatchObject({ exitCode: 19 });
  // The last exit is still no authority to signal an unfenced pre-B owner.
  f.deferred(await f.defer()); expect(existsSync(f.paths[1]!)).toBe(true);
  expect((await f.legacy.client.ping()).hostPid).toBe(f.legacy.child.pid);
}, 20000);

it("should keep an empty pre-B endpoint reachable instead of authorizing withdrawal", async () => {
  const f = await fixture(), before = statSync(f.paths[1]!);
  expect(await f.legacy.client.list()).toEqual([]); f.deferred(await f.defer());
  expect(statSync(f.paths[1]!).ino).toBe(before.ino);
  expect((await f.legacy.client.ping()).hostPid).toBe(f.legacy.child.pid);
  expect(existsSync(f.paths[1] + ".owner")).toBe(true);
  expect(existsSync(f.paths[1] + ".draining")).toBe(false);
}, 20000);

it("should defer retirement when a v1 creation races an empty pre-B inventory", async () => {
  const f = await fixture(), plan = await f.inspect();
  expect(await f.legacy.client.list()).toEqual([]);
  const [result, state] = await Promise.all([f.defer(plan), f.create(f.legacy.client, "concurrent")]);
  f.deferred(result); await f.exchange(f.legacy.client, "concurrent", "survived-race");
  expect((await f.legacy.client.state(state.id)).pid).toBe(state.pid);
  expect(readProcessStartTime(f.legacy.child.pid!)).toBe(f.legacy.birth);
}, 20000);

it("should never treat a client marker as an admission fence on established or fresh v1 connections", async () => {
  const f = await fixture();
  const { dev, ino } = statSync(f.paths[1]!);
  writeFileSync(f.paths[1] + ".draining", JSON.stringify({ hostPid: f.legacy.child.pid,
    startTime: f.legacy.birth, generation: "drain-1", dev, ino }), { mode: 0o600 });
  f.deferred(await f.defer());
  // Preserve the inherited adversarial counterexample: both creations still
  // succeed. This proves why pre-B admission/B5 remain OPEN, not qualified.
  await f.create(f.legacy.client, "established-v1");
  const fresh = await f.connect(1); await f.create(fresh, "fresh-v1");
  await f.exchange(f.legacy.client, "established-v1", "old-connection");
  await f.exchange(fresh, "fresh-v1", "new-connection");
}, 20000);

it("should inventory both generations with loaded versions and explicit unfenced retirement", async () => {
  const f = await fixture();
  expect((await f.inspect()).legacyHosts).toContainEqual({ socketPath: f.paths[1], hostPid: f.legacy.child.pid,
    admission: "unfenced", retirement: "deferred" });
  const inventory = await collectNativeInventory(f.paths, path => f.connect(f.paths.indexOf(path)));
  expect(inventory.complete).toBe(true); expect(inventory.hosts.map(h => h.socketPath)).toEqual(f.paths);
  expect(inventory.hosts[0]).toMatchObject({ generation: "drain-0", loadedVersion: getRuntimeVersion() });
  expect(inventory.hosts[1]).toMatchObject({ generation: "drain-1", loadedVersion: "unknown", admission: "unfenced", retirement: "deferred" });
  const op = spawn(process.execPath, [entry("op"), "list"], {
    env: { ...process.env, XDG_RUNTIME_DIR: f.directory, H2A_NATIVE_SOCKET: "" }, stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(op); let output = "", errors = "";
  op.stdout!.on("data", chunk => { output += chunk; }); op.stderr!.on("data", chunk => { errors += chunk; });
  const [code] = await once(op, "close"); expect(code, errors).toBe(0);
  expect(JSON.parse(output).hosts[1]).toMatchObject({ socketPath: f.paths[1], reachable: true,
    generation: "drain-1", loadedVersion: "unknown", admission: "unfenced", retirement: "deferred" });
}, 20000);

it("should preserve known pre-B metadata when another endpoint makes the upgrade inventory undecidable", async () => {
  const f = await fixture(), plan = await f.inspect();
  const state = await f.create(f.legacy.client, "deferred-inventory"), birth = readProcessStartTime(state.pid);
  expect(birth).toBeDefined();
  f.deferred(await f.defer({ ...plan, state: "deferred", reason: "another endpoint is undecidable" }));
  await f.exchange(f.legacy.client, state.id, "still-accessible");
  expect(readProcessStartTime(state.pid)).toBe(birth);
  expect(readProcessStartTime(f.legacy.child.pid!)).toBe(f.legacy.birth);
}, 20000);

it("should refuse an unknown protocol before classifying or retiring a pre-B host", async () => {
  const f = await fixture(), original = NativeTerminalClient.prototype.ping;
  vi.spyOn(NativeTerminalClient.prototype, "ping").mockImplementation(async function (this: NativeTerminalClient) {
    return { ...await original.call(this), protocolVersion: 99 } as any;
  });
  const plan = await f.inspect();
  expect(plan.state).toBe("deferred"); expect(plan.reason).toMatch(/unsupported.*protocol/);
  expect(plan.legacyHosts).toEqual([]); expect(plan.owners).toEqual([]);
  expect(existsSync(f.paths[1] + ".draining")).toBe(false);
}, 20000);

it("should refuse v1 creates at the draining B owner even through an older frontend", async () => {
  const f = await fixture(), peer = await oldFrontend(f);
  try {
    const state = await f.create(f.current.client, "survivor"), birth = readProcessStartTime(state.pid);
    f.current.child.kill("SIGTERM");
    await until(() => requestNativeTerminalOwnerControl(f.paths[0]!, f.current.child.pid!, "status"), s => s.draining === true, "owner draining");
    expect(await peer.create("late-forwarded")).toMatchObject({ ok: false, message: expect.stringMatching(/draining/) });
    const fresh = await f.connect(0);
    await expect(f.create(fresh, "late-direct")).rejects.toThrow(/draining/);
    await f.exchange(f.current.client, "survivor", "still-running");
    expect(readProcessStartTime(state.pid)).toBe(birth);
    expect((await f.current.client.list()).map(session => session.id)).toEqual(["survivor"]);
  } finally { peer.socket.destroy(); }
}, 20000);

it("should seal B admission before acknowledging empty withdrawal and before asynchronous close", async () => {
  const f = await fixture(true), peer = await oldFrontend(f);
  try {
    writeFileSync(f.held, "hold");
    expect(await requestNativeTerminalOwnerControl(f.paths[0]!, f.current.child.pid!, "abandon")).toMatchObject({ status: "withdrawing" });
    expect(await peer.create("raced-withdrawal")).toMatchObject({ ok: false, message: expect.stringMatching(/draining/) });
    expect((await f.current.client.list()).filter(session => session.status !== "exited")).toEqual([]);
  } finally { rmSync(f.held, { force: true }); peer.socket.destroy(); }
  const [code] = await once(f.current.child, "exit"); expect(code).toBe(0);
  expect(existsSync(f.paths[0]!)).toBe(false); expect(existsSync(f.paths[0] + ".owner")).toBe(false);
  expect((await f.legacy.client.ping()).hostPid).toBe(f.legacy.child.pid);
}, 20000);
