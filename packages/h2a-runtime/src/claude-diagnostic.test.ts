import { it, expect } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, existsSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

for (const created of [false, true]) it(`should ${created ? "preserve" : "terminate"} an unassigned collector after proven launcher death with creation ${created}`, async () => {
  const root = mkdtempSync(join(tmpdir(), "diag-precreate-")), fifo = join(root, "input.pipe"), file = join(root, "debug.log"), receipt = join(root, "launch.json");
  execFileSync("mkfifo", ["-m", "600", fifo]); writeFileSync(file, "");
  const launcher = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  const stat = readFileSync(`/proc/${launcher.pid}/stat`, "utf8"), birth = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]!;
  writeFileSync(receipt, JSON.stringify({ token: "precreate", creationAttempted: created }));
  const worker = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./claude-diagnostic.ts", import.meta.url)), fifo, file,
    receipt, String(launcher.pid), birth, "precreate"], { stdio: ["pipe", "pipe", "pipe"] });
  let ready = ""; worker.stdout.on("data", data => { ready += data; });
  try {
    for (let i = 0; i < 100 && !ready.includes("ready\n"); i++) await new Promise(r => setTimeout(r, 20));
    expect(ready).toContain("ready\n");
    const exited = once(launcher, "exit"); launcher.kill("SIGKILL"); await exited;
    for (let i = 0; i < 100 && worker.exitCode === null; i++) await new Promise(r => setTimeout(r, 20));
    expect(worker.exitCode).toBe(created ? null : 0); expect(existsSync(fifo)).toBe(created);
  } finally {
    for (const child of [launcher, worker]) if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }
    rmSync(root, { recursive: true, force: true });
  }
}, 10000);

it("should cap retained diagnostic storage while draining the live provider FIFO", async () => {
  const root = mkdtempSync(join(tmpdir(), "diag-")), fifo = join(root, "input.pipe"), file = join(root, "debug.log");
  execFileSync("mkfifo", ["-m", "600", fifo]); writeFileSync(file, "", { mode: 0o600 });
  const worker = spawn(process.execPath, ["--import", "tsx", process.env.QUAL_DIAGNOSTIC_MODULE ?? fileURLToPath(new URL("./claude-diagnostic.ts", import.meta.url)), fifo, file], { stdio: ["pipe", "pipe", "pipe"] });
  let health = ""; worker.stdout.on("data", data => { health += data; });
  let writer: ReturnType<typeof spawn> | undefined;
  try {
    writer = spawn(process.execPath, ["-e", 'const fs=require("node:fs");const fd=fs.openSync(process.argv[1],"w");for(let i=0;i<18;i++)fs.writeSync(fd,Buffer.alloc(1024*1024,120));fs.closeSync(fd);', fifo], { stdio: "ignore" });
    expect((await once(writer, "exit"))[0]).toBe(0);
    for (let i = 0; i < 100 && statSync(file).size < 16 * 1024 * 1024; i++) await new Promise(r => setTimeout(r, 10));
    expect(statSync(file).size).toBe(16 * 1024 * 1024);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    for (let i = 0; i < 100 && !health.includes("invalid\n"); i++) await new Promise(r => setTimeout(r, 10));
    expect(health).toContain("ready\n"); expect(health).toContain("invalid\n");
  } finally {
    if (writer && writer.exitCode === null) writer.kill("SIGKILL");
    if (worker.exitCode === null) { const exited = once(worker, "exit"); worker.kill("SIGTERM"); await exited; }
    rmSync(root, { recursive: true, force: true });
  }
});

it("should expire retained logs after the provider exits without deleting a replaced file", async () => {
  const root = mkdtempSync(join(tmpdir(), "expire-")), file = join(root, "debug.log"), state = join(root, "retained.json");
  writeFileSync(file, "expired diagnostic", { mode: 0o600 });
  const stat = statSync(file);
  const renamed = join(root, "renamed.log"); renameSync(file, renamed);
  const worker = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./claude-diagnostic.ts", import.meta.url)), "--retention", state], { stdio: ["ignore", "ignore", "pipe"] });
  const replacement = join(root, "replacement.log"); writeFileSync(replacement, "replacement must survive");
  const other = statSync(replacement);
  writeFileSync(state, JSON.stringify({ pid: worker.pid, files: [
    { file, expires: Date.now() - 1, dev: stat.dev, ino: stat.ino },
    { file: replacement, expires: Date.now() - 1, dev: other.dev, ino: other.ino + 1 },
  ] }));
  try {
    expect((await once(worker, "exit"))[0]).toBe(0); expect(existsSync(file)).toBe(false); expect(existsSync(renamed)).toBe(false);
    expect(JSON.parse(readFileSync(state, "utf8")).files).toEqual([]);
    expect(readFileSync(replacement, "utf8")).toBe("replacement must survive");
  } finally { if (worker.exitCode === null) worker.kill("SIGKILL"); rmSync(root, { recursive: true, force: true }); }
});
