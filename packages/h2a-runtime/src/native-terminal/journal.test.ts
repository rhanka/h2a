import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// @ts-ignore Shared JS qualification helper; tests are outside the production build.
import { assertIsolatedEnvironment } from "../../../h2a/test/helpers/native-isolation.js";
import { NativeTerminalClient } from "./client.js";
import { readProcessStartTime } from "./host.js";
import { appendHostJournal, getDroppedJournalEntriesCount, getRuntimeVersion, MAX_HOST_JOURNAL_BYTES, readHostJournal, resolveHostJournalPath } from "./journal.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const qualRoot = join(repo, ".qual-tmp");
const entry = join(repo, "packages/h2a-runtime/dist/native-terminal/process.js");
const journalModule = pathToFileURL(join(repo, "packages/h2a-runtime/dist/native-terminal/journal.js")).href;
const processModule = pathToFileURL(entry).href;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

function fixture() {
  mkdirSync(qualRoot, { recursive: true, mode: 0o700 });
  const root = mkdtempSync(join(qualRoot, "j"));
  const env: Record<string, string> = { PATH: "/usr/bin:/bin", HOME: join(root, "h"),
    XDG_RUNTIME_DIR: root, XDG_STATE_HOME: join(root, "s"), XDG_CONFIG_HOME: join(root, "c"),
    TMPDIR: join(root, "t"), REMOTE_CLI_CONFIG_HOME: join(root, "c"), TERM: "xterm-256color" };
  for (const path of Object.values(env).filter(path => path.startsWith(root))) mkdirSync(path, { recursive: true, mode: 0o700 });
  assertIsolatedEnvironment(env, qualRoot);
  const log = resolveHostJournalPath(env), socket = join(root, "nt.sock");
  mkdirSync(dirname(log), { recursive: true, mode: 0o700 });
  cleanups.push(async () => { rmSync(root, { recursive: true, force: true }); });
  return { root, env, log, socket };
}
async function eventually(predicate: () => boolean) {
  const end = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= end) throw new Error("expected journal/host observation did not arrive");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function child(args: string[], env: Record<string, string>) {
  assertIsolatedEnvironment(env, qualRoot);
  const handle = spawn(process.execPath, args, { env, cwd: env.HOME, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  handle.stdout.on("data", data => { stdout += data; }); handle.stderr.on("data", data => { stderr += data; });
  const closed = once(handle, "close");
  cleanups.push(async () => {
    if (handle.exitCode === null && handle.signalCode === null) handle.kill("SIGTERM");
    await closed;
  });
  return { process: handle, closed, output: () => ({ stdout, stderr }) };
}
function startEntry() {
  return { event: "start" as const, pid: process.pid, startTime: readProcessStartTime(process.pid)!,
    version: getRuntimeVersion(), codePath: entry, socket: "nt.sock", generation: "journal-test" };
}

describe("native host life journal", () => {
  it("should reject all unsafe isolation variables including symlinks", () => {
    const f = fixture();
    for (const key of ["HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME"]) {
      for (const path of ["/home/antoinefa", "/home/antoinefa/.local/state", "/home/antoinefa/.config",
        "/home/antoinefa/.cache-tmp/h2a-test", "/run/user/1000/h2a-nt"]) {
        expect(() => assertIsolatedEnvironment({ ...f.env, [key]: path }, qualRoot)).toThrow(/REFUSING/);
      }
      const link = join(f.root, key); symlinkSync("/home/antoinefa/.local/state", link);
      expect(() => assertIsolatedEnvironment({ ...f.env, [key]: join(link, "h2a") }, qualRoot)).toThrow(/REFUSING/);
    }
  });
  it("should use XDG state or HOME fallback and report the real package version", () => {
    expect(resolveHostJournalPath({ HOME: "/lab/home", XDG_STATE_HOME: "/lab/state" })).toBe("/lab/state/h2a/native-host.log");
    expect(resolveHostJournalPath({ HOME: "/lab/home" })).toBe("/lab/home/.local/state/h2a/native-host.log");
    expect(getRuntimeVersion()).toBe(JSON.parse(readFileSync(join(repo, "packages/h2a-runtime/package.json"), "utf8")).version);
  });
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) it(`should record real start, ${signal}, clean stop and exit`, async () => {
    const f = fixture(), host = child([entry, "--socket", f.socket, "--generation", "life-test"], f.env);
    await eventually(() => host.output().stdout.includes("h2a.native-terminal.ready"));
    const client = await NativeTerminalClient.connect(f.socket);
    try { expect((await client.ping()).hostPid).toBe(host.process.pid); } finally { client.close(); }
    await eventually(() => readHostJournal(f.log).some(e => e.event === "start"));
    const start = readHostJournal(f.log)[0]!;
    expect(start).toMatchObject({ event: "start", pid: host.process.pid, startTime: readProcessStartTime(host.process.pid!),
      version: getRuntimeVersion(), codePath: entry, socket: f.socket, generation: "life-test" });
    host.process.kill(signal); expect((await host.closed)[0]).toBe(0);
    const entries = readHostJournal(f.log);
    expect(entries.map(e => e.event)).toEqual(["start", "signal", "stop", "exit"]);
    expect(entries[1]).toMatchObject({ signal }); expect(entries[2]).toMatchObject({ clean: true });
    expect(entries[3]).toMatchObject({ exitCode: 0, cause: "clean-stop" });
    for (const e of entries) expect(e).toMatchObject({ pid: host.process.pid, startTime: (start as any).startTime });
    expect(statSync(f.log).mode & 0o777).toBe(0o600);
  });
  for (const failure of ["exception", "rejection", "abort"] as const) it(`should record only observed facts for a real host ${failure}`, async () => {
    const f = fixture(), script = join(f.root, "crash.mjs"), secret = "vR9z7Q2p4L6w8N3x";
    const action = failure === "abort" ? "process.abort()" : failure === "rejection"
      ? `Promise.reject(new Error(${JSON.stringify(secret)}))` : `(() => { throw new Error(${JSON.stringify(secret)}); })()`;
    writeFileSync(script, `import {runNativeTerminalHostProcess} from ${JSON.stringify(processModule)};
      await runNativeTerminalHostProcess([process.execPath, ${JSON.stringify(entry)}, '--socket', ${JSON.stringify(f.socket)}]);
      process.on('SIGUSR1', () => { ${action}; });`);
    const host = child([script], { ...f.env, PRIVATE_VALUE: secret });
    await eventually(() => host.output().stdout.includes("h2a.native-terminal.ready"));
    await eventually(() => readHostJournal(f.log).some(e => e.event === "start"));
    host.process.kill("SIGUSR1");
    const [code, signal] = await host.closed, events = readHostJournal(f.log);
    expect(readFileSync(f.log, "utf8")).not.toContain(secret);
    if (failure === "abort") {
      expect(signal).toBe("SIGABRT"); expect(events.map(e => e.event)).toEqual(["start"]);
      expect(events).not.toContainEqual(expect.objectContaining({ signal: "SIGKILL" }));
    } else {
      expect(code).toBe(1);
      const kind = failure === "exception" ? "uncaughtException" : "unhandledRejection";
      expect(events.map(e => e.event)).toEqual(["start", kind, "exit"]);
      expect(events[1]).toMatchObject({ error: "[REDACTED]" }); expect((events[1] as any).stack).toContain(":");
      expect(events[2]).toMatchObject({ exitCode: 1, cause: kind });
    }
  });
  it("should label an unobserved exit cause unknown without inventing a signal", async () => {
    const f = fixture(), script = join(f.root, "exit.mjs");
    writeFileSync(script, `import {runNativeTerminalHostProcess} from ${JSON.stringify(processModule)};
      await runNativeTerminalHostProcess([process.execPath, ${JSON.stringify(entry)}, '--socket', ${JSON.stringify(f.socket)}]);
      process.on('SIGUSR1', () => process.exit(7));`);
    const host = child([script], f.env);
    await eventually(() => readHostJournal(f.log).some(e => e.event === "start")); host.process.kill("SIGUSR1");
    expect((await host.closed)[0]).toBe(7);
    expect(readHostJournal(f.log).at(-1)).toMatchObject({ event: "exit", exitCode: 7, cause: "unknown" });
    expect(readFileSync(f.log, "utf8")).not.toContain("SIGKILL");
  });
  it("should keep a real host usable when journal storage is unavailable", async () => {
    const f = fixture(), blocked = join(f.root, "blocked"); writeFileSync(blocked, "not a directory");
    const host = child([entry, "--socket", f.socket], { ...f.env, XDG_STATE_HOME: blocked });
    await eventually(() => host.output().stdout.includes("h2a.native-terminal.ready"));
    const client = await NativeTerminalClient.connect(f.socket);
    try { expect((await client.ping()).hostPid).toBe(host.process.pid); } finally { client.close(); }
    host.process.kill("SIGTERM"); expect((await host.closed)[0]).toBe(0);
  });
  it("should preserve a live writer lock while a real host serves and stops", async () => {
    const f = fixture(), lock = `${f.log}.lock`, token = `${process.pid}:holder`;
    writeFileSync(lock, token); utimesSync(lock, new Date(0), new Date(0));
    const host = child([entry, "--socket", f.socket], f.env);
    await eventually(() => host.output().stdout.includes("h2a.native-terminal.ready"));
    const client = await NativeTerminalClient.connect(f.socket);
    try { for (let i = 0; i < 3; i++) expect((await client.ping()).hostPid).toBe(host.process.pid); }
    finally { client.close(); }
    host.process.kill("SIGTERM"); expect((await host.closed)[0]).toBe(0);
    expect(readFileSync(lock, "utf8")).toBe(token); expect(existsSync(f.log)).toBe(false);
  });
  it("should record a real startup failure without calling it an uncaught exception", async () => {
    const f = fixture(), host = child([entry, "--unknown-option"], f.env);
    expect((await host.closed)[0]).toBe(1);
    const events = readHostJournal(f.log);
    expect(events.map(row => row.event)).toEqual(["startupError", "exit"]);
    expect(events[0]).toMatchObject({ error: "[REDACTED]" });
    expect(events[1]).toMatchObject({ exitCode: 1, cause: "startupError" });
  });
  it("should redact arbitrary diagnostics, Basic/Bearer, cookies, tokens, keys and env through an allowlist", () => {
    const f = fixture(), secret = "qZ8r2V7w4M1n9L6x", basic = Buffer.from(`user:${secret}`).toString("base64");
    for (const error of [secret, `Authorization: Basic ${basic}`, `Authorization: Bearer ${secret}`,
      `Cookie: session=${secret}`, `Set-Cookie: session=${secret}`, `api_key=${secret}`, `token=${secret}`, `PRIVATE_VALUE=${secret}`]) {
      appendHostJournal({ event: "uncaughtException", pid: process.pid, generation: "test", error,
        stack: `${error}\n    at ${secret} (file:///private/${secret}.js:4:2)`, env: { PRIVATE_VALUE: secret },
        headers: { Authorization: error }, token: secret } as any, f.log);
    }
    const raw = readFileSync(f.log, "utf8");
    expect(raw).not.toContain(secret); expect(raw).not.toContain(basic); expect(raw).not.toContain("PRIVATE_VALUE");
    expect(readHostJournal(f.log)).toHaveLength(8);
    for (const row of readHostJournal(f.log)) {
      expect(row).toMatchObject({ error: "[REDACTED]", stack: "[REDACTED]" });
      expect(row).not.toHaveProperty("env"); expect(row).not.toHaveProperty("headers"); expect(row).not.toHaveProperty("token");
    }
  });
  it("should never wait for or reclaim a live writer lock including an old lock", () => {
    const f = fixture(), lock = `${f.log}.lock`, token = `${process.pid}:live`;
    writeFileSync(lock, token); utimesSync(lock, new Date(0), new Date(0));
    const before = getDroppedJournalEntriesCount(), started = performance.now();
    for (let i = 0; i < 5; i++) appendHostJournal(startEntry(), f.log);
    expect(performance.now() - started).toBeLessThan(100);
    expect(readFileSync(lock, "utf8")).toBe(token); expect(existsSync(f.log)).toBe(false);
    expect(getDroppedJournalEntriesCount() - before).toBe(5);
    rmSync(lock); appendHostJournal(startEntry(), f.log);
    expect(readHostJournal(f.log)).toContainEqual(expect.objectContaining({ event: "dropped", count: expect.any(Number) }));
    expect(getDroppedJournalEntriesCount()).toBe(before + 5);
  });
  it("should drop on ambiguous orphan locks without a racy unlink", () => {
    const f = fixture(), lock = `${f.log}.lock`; writeFileSync(lock, "99999999:old");
    const before = getDroppedJournalEntriesCount(); appendHostJournal(startEntry(), f.log);
    expect(existsSync(f.log)).toBe(false); expect(readFileSync(lock, "utf8")).toBe("99999999:old");
    expect(getDroppedJournalEntriesCount()).toBe(before + 1);
  });
  it("should count storage failures and refuse symlink journals", () => {
    const f = fixture(), target = join(f.root, "target"); writeFileSync(target, "untouched"); symlinkSync(target, f.log);
    const before = getDroppedJournalEntriesCount(); expect(() => appendHostJournal(startEntry(), f.log)).not.toThrow();
    expect(readFileSync(target, "utf8")).toBe("untouched"); expect(getDroppedJournalEntriesCount()).toBe(before + 1);
  });
  it("should rotate at one MB under lock with private modes", () => {
    const f = fixture(); writeFileSync(f.log, "x".repeat(MAX_HOST_JOURNAL_BYTES), { mode: 0o600 }); appendHostJournal(startEntry(), f.log);
    expect(statSync(`${f.log}.1`).size).toBe(MAX_HOST_JOURNAL_BYTES);
    expect(statSync(`${f.log}.1`).mode & 0o777).toBe(0o600); expect(statSync(f.log).mode & 0o777).toBe(0o600);
    expect(readHostJournal(f.log).at(-1)).toMatchObject({ event: "start" });
  });
  it("should account for every concurrent attempt and keep rotation JSON intact", async () => {
    const f = fixture(), seed = JSON.stringify({ event: "dropped", count: 0 }) + "\n";
    writeFileSync(f.log, seed.repeat(Math.ceil(MAX_HOST_JOURNAL_BYTES / seed.length)), { mode: 0o600 });
    const workers: ReturnType<typeof child>[] = [];
    for (let worker = 0; worker < 4; worker++) {
      const script = `import {appendHostJournal,getDroppedJournalEntriesCount} from ${JSON.stringify(journalModule)};
        for(let i=0;i<20;i++)appendHostJournal({event:'start',pid:process.pid,startTime:1,version:'test',codePath:'worker',socket:'test',generation:${JSON.stringify(`w${worker}-`)}+i},${JSON.stringify(f.log)});
        console.log(JSON.stringify({dropped:getDroppedJournalEntriesCount()}));`;
      workers.push(child(["--input-type=module", "-e", script], f.env));
    }
    for (const worker of workers) expect((await worker.closed)[0]).toBe(0);
    const raw = [f.log, `${f.log}.1`].map(path => readFileSync(path, "utf8")).join("");
    const rows = raw.trim().split("\n").map(line => JSON.parse(line)), starts = rows.filter(row => row.event === "start");
    const dropped = workers.reduce((sum, worker) => sum + JSON.parse(worker.output().stdout).dropped, 0);
    expect(starts.length + dropped).toBe(80); expect(new Set(starts.map(row => row.generation)).size).toBe(starts.length);
    expect(starts.length).toBeGreaterThan(0); expect(existsSync(`${f.log}.lock`)).toBe(false);
    expect(statSync(f.log).mode & 0o777).toBe(0o600);
  });
});
