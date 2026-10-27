// @ts-ignore Tests do not ship in the runtime.
import { createPrivateTestDirectory, setupNativeTestEnvironment } from "../../h2a/test/helpers/native-isolation.js";
import { afterAll, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { acquireFileLock, releaseFileLock } from "./file-lock.js";

setupNativeTestEnvironment(afterAll);

it("should yield CPU to the lock holder while waiting for a contended registry lock", async () => {
  const root = createPrivateTestDirectory("lock");
  const path = join(root, "registry.json");
  const holder = spawn(process.execPath, ["--input-type=module", "-e", `
    import { openSync, closeSync, unlinkSync } from 'node:fs';
    const path = process.argv[1] + '.lock';
    const fd = openSync(path, 'wx');
    process.stdin.once('data', () => setTimeout(() => {
      closeSync(fd); unlinkSync(path); process.stdin.destroy();
    }, 600));
    console.log('locked');
  `, path], { env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  const closed = once(holder, "close");
  let fd: number | undefined;
  try {
    await Promise.race([once(holder.stdout!, "data"), closed.then(() => { throw new Error("lock holder exited before readiness"); })]);
    expect(existsSync(`${path}.lock`)).toBe(true);
    const cpu = process.cpuUsage();
    const begun = performance.now();
    holder.stdin!.write("release after 600 ms\n");
    fd = acquireFileLock(path);
    const elapsedMs = performance.now() - begun;
    const used = process.cpuUsage(cpu);
    const cpuMs = (used.user + used.system) / 1000;
    expect(fd).toBeDefined();
    expect(elapsedMs).toBeGreaterThanOrEqual(550);
    expect(cpuMs, `lock wait consumed ${cpuMs.toFixed(1)} ms CPU in ${elapsedMs.toFixed(1)} ms`).toBeLessThan(elapsedMs / 2);
    expect(existsSync(`${path}.lock`)).toBe(true);
  } finally {
    if (fd !== undefined) releaseFileLock(fd, path);
    if (holder.exitCode === null && holder.signalCode === null) holder.kill("SIGKILL");
    await closed;
    rmSync(root, { recursive: true, force: true });
  }
});
