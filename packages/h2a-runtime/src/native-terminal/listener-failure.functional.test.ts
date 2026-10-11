import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
// @ts-ignore Shared JS qualification helper; tests are outside the production build.
import { spawnIsolatedNative as spawn, setupNativeTestEnvironment } from "../../../h2a/test/helpers/native-isolation.js";

setupNativeTestEnvironment(afterAll);

const children = new Set<ChildProcess>();
const directories = new Set<string>();

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (child.exitCode === null && child.signalCode === null) await once(child, "exit");
  }
  children.clear();
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

/**
 * Wait for a host child to exit, with an explicit deadline.
 */
async function exitWithin(
  child: ChildProcess,
  timeoutMs: number,
): Promise<[number | null, NodeJS.Signals | null]> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  try {
    return await Promise.race([
      once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>,
      new Promise<never>((_, reject) => deadline.signal.addEventListener("abort", () => {
        reject(new Error(`host did not exit within ${timeoutMs}ms; exitCode=${child.exitCode}`));
      })),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * R7, process level: the host process must EXIT when a post-listen listener
 * error cannot be served through — exit 3 for an unclassifiable error, a
 * clean exit for a known-unusable listener — never keep running on a dead
 * listener and never crash. The failure is injected inside the child through
 * a wrapper that patches `node:net`'s createServer (the same
 * syncBuiltinESMExports technique the publication tests use) and emits the
 * classified error on the real net.Server AFTER the host published readiness.
 */
async function spawnHostWithInjectedListenerFailure(options: {
  socketPath: string;
  registryPath: string;
  generation: string;
  wrapperPath: string;
  failure: { message: string; code?: string };
}): Promise<{ child: ChildProcess; readStderr: () => string }> {
  const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
  const wrapper = `
    import net from "node:net";
    import { syncBuiltinESMExports } from "node:module";
    const realCreateServer = net.createServer;
    let listener;
    net.createServer = function (handler, ...rest) {
      const created = realCreateServer.call(net, handler, ...rest);
      if (listener === undefined) listener = created;
      return created;
    };
    syncBuiltinESMExports();
    const failureMessage = ${JSON.stringify(options.failure.message)};
    const failureCode = ${JSON.stringify(options.failure.code ?? null)};
    const originalWrite = process.stdout.write.bind(process.stdout);
    let injected = false;
    process.stdout.write = (chunk, ...rest) => {
      const written = originalWrite(chunk, ...rest);
      if (!injected && String(chunk).includes("h2a.native-terminal.ready")) {
        injected = true;
        const error = new Error(failureMessage);
        if (failureCode !== null) error.code = failureCode;
        setTimeout(() => listener.emit("error", error), 50);
      }
      return written;
    };
    const entry = ${JSON.stringify(entry)};
    const { runNativeTerminalHostProcess } = await import(entry);
    await runNativeTerminalHostProcess([process.execPath, entry,
      "--socket", ${JSON.stringify(options.socketPath)},
      "--generation", ${JSON.stringify(options.generation)},
      "--registry-path", ${JSON.stringify(options.registryPath)}]);
  `;
  await writeFile(options.wrapperPath, wrapper, "utf8");
  const child = spawn(process.execPath, [
    "--import",
    "tsx",
    options.wrapperPath,
  ], {
    cwd: dirname(entry),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  let stderr = "";
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => { stderr += chunk; });
  return { child, readStderr: () => stderr };
}

describe.skipIf(process.platform !== "linux")("native terminal listener failure classification (R7)", () => {
  it("exits 3 after an unclassifiable post-listen listener error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "n-"));
    directories.add(directory);
    const { child, readStderr } = await spawnHostWithInjectedListenerFailure({
      socketPath: join(directory, "host.sock"),
      registryPath: join(directory, "registry.json"),
      generation: "listener-unknown-generation",
      wrapperPath: join(directory, "wrapper.mjs"),
      failure: { message: "late mystery listener failure" },
    });

    const [exitCode, signal] = await exitWithin(child, 10_000);
    // UNKNOWN listener error: non-zero (exit 3), no signal, no crash — the
    // supervisor's bounded respawn owns what comes next.
    expect([exitCode, signal]).toEqual([3, null]);
    expect(readStderr()).toContain("terminal host listener is unknown");
    // The exit was graceful: the published socket and its owner record were
    // rolled back, not left behind by a crash.
    await expect(stat(join(directory, "host.sock"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(directory, "host.sock.owner"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("exits cleanly when the listener becomes unusable (late EADDRINUSE)", async () => {
    const directory = await mkdtemp(join(tmpdir(), "n-"));
    directories.add(directory);
    const { child, readStderr } = await spawnHostWithInjectedListenerFailure({
      socketPath: join(directory, "host.sock"),
      registryPath: join(directory, "registry.json"),
      generation: "listener-unusable-generation",
      wrapperPath: join(directory, "wrapper.mjs"),
      failure: { message: "late EADDRINUSE on the listener", code: "EADDRINUSE" },
    });

    const [exitCode, signal] = await exitWithin(child, 10_000);
    // KNOWN-unusable listener: a clean exit (exit 0) through the graceful stop
    // path — sessions drained, publication rolled back — never a crash.
    expect([exitCode, signal]).toEqual([0, null]);
    expect(readStderr()).toContain("terminal host listener is unusable");
    await expect(stat(join(directory, "host.sock"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(directory, "host.sock.owner"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
