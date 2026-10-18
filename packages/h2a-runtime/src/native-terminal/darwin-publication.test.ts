import type { ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
// @ts-ignore Shared JS qualification helper; tests are outside the production build.
import { setupNativeTestEnvironment, spawnIsolatedNative as spawn } from "../../../h2a/test/helpers/native-isolation.js";

setupNativeTestEnvironment(afterAll);

import { NativeTerminalClient } from "./client.js";
import { NativeTerminalHost } from "./host.js";
import { resolveRegistryPath } from "../registry.js";
import { readProcessFrame, readProcessStartTime } from "../proc-identity.js";
import {
  darwinSocketPublicationLockPath,
  findDarwinActiveHostServingSocket,
  proveNativeTerminalEndpointAbsent,
  startNativeTerminalHostServer,
} from "./server.js";

// Lot BM RED: darwin product-substrate proofs. Every test executes on both
// platforms with real assertions in each branch (the repo execution-proof
// gate bans empty and skipped suites, so D27 "not run" is honored by
// platform-branched assertions, never by skips). On darwin before the port,
// publication throws the typed Linux-only error and the owner refuses to
// boot, so every test below is red there; on Linux they pin the unchanged
// behaviour the port must preserve.
const OWNER_ENTRY = fileURLToPath(new URL("../../dist/native-terminal/owner-process.js", import.meta.url));
const TEST_TIMEOUT = 90_000;

// Each Node child records its own PID and birth in this private fixture.
// Cleanup uses these launch receipts, never a process census or name matching.
const receiptPath = join(process.env.TMPDIR!, "darwin-publication-children.jsonl");
const observerPath = receiptPath + ".mjs";
const identityModule = pathToFileURL(fileURLToPath(new URL("../../dist/proc-identity.js", import.meta.url))).href;
writeFileSync(observerPath, `import { appendFileSync } from "node:fs";
import { readProcessStartTime } from ${JSON.stringify(identityModule)};
import { ChildProcess } from "node:child_process";
const record = pid => appendFileSync(${JSON.stringify(receiptPath)}, JSON.stringify({pid,birth:readProcessStartTime(pid)})+"\\n");
record(process.pid);
const original = ChildProcess.prototype.spawn;
ChildProcess.prototype.spawn = function(options) {
  const result = original.call(this, options);
  if (this.pid) record(this.pid);
  return result;
};`);
const previousNodeOptions = process.env.NODE_OPTIONS;
process.env.NODE_OPTIONS = `${previousNodeOptions ?? ""} --import=${pathToFileURL(observerPath).href}`;
afterAll(() => {
  if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
  else process.env.NODE_OPTIONS = previousNodeOptions;
});

function stopRecordedChildren(): void {
  let rows: string;
  try { rows = readFileSync(receiptPath, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  for (const line of rows.trim().split("\n").filter(Boolean)) {
    const {pid, birth} = JSON.parse(line);
    if (pid === process.pid || birth === undefined || readProcessStartTime(pid) !== birth) continue;
    try { process.kill(pid, "SIGKILL"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  }
}

const children = new Set<ChildProcess>();
const directories = new Set<string>();


afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      await once(child, "exit").catch(() => undefined);
    }
  }
  children.clear();
  stopRecordedChildren();
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true });
  }
  directories.clear();
});

async function endpoint(): Promise<{ directory: string; socketPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), "dpub-"));
  directories.add(directory);
  return { directory, socketPath: join(directory, "h") };
}

function writeEmptyRegistry(): void {
  const registryPath = resolveRegistryPath();
  mkdirSync(dirname(registryPath), { recursive: true, mode: 0o700 });
  writeFileSync(registryPath, JSON.stringify({ version: 1, entries: [] }));
}

function servingHost(socketPath: string): NativeTerminalHost {
  return new NativeTerminalHost({
    generation: "darwin-pub",
    replayBytesPerSession: 1024,
    registryPath: join(dirname(socketPath), "registry.json"),
    spawner: () => {
      throw new Error("unexpected spawn");
    },
  });
}

async function waitForOwnerReady(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => {
    outChunks.push(chunk.toString("utf8"));
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    errChunks.push(chunk.toString("utf8"));
  });
  for (;;) {
    const output = outChunks.join("");
    if (output.split("\n").some((line) => line.includes("h2a.native-terminal.ready"))) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`owner exited before ready: ${child.exitCode ?? child.signalCode}; stdout: ${output.slice(-2000)}; stderr: ${errChunks.join("").slice(-2000)}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`owner did not become ready; stdout: ${output.slice(-2000)}; stderr: ${errChunks.join("").slice(-2000)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function spawnOwner(): Promise<{ child: ChildProcess; socketPath: string; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "downer-"));
  directories.add(directory);
  const socketPath = join(directory, "owner.sock");
  const child = spawn(process.execPath, [
    OWNER_ENTRY,
    "--socket",
    socketPath,
    "--generation",
    "bm-darwin",
    "--replay-bytes",
    String(1024 * 1024),
    "--max-sessions",
    "16",
    "--registry-path",
    join(directory, "registry.json"),
  ], {
    cwd: dirname(OWNER_ENTRY),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  await waitForOwnerReady(child);
  return { child, socketPath, directory };
}

describe("darwin publication substrate", () => {
  it("should publish, lock and attribute a socket", async () => {
    const { socketPath } = await endpoint();
    writeEmptyRegistry();
    // The lock assertion runs UNDER the publication lock (readFrame is read
    // there): after publication the lock is released and its filesystem
    // pathname unlinked, like the Linux abstract lock vanishing on close.
    const readUnderLock = () => {
      const lockId = join(dirname(socketPath), ".h2a-native-terminal.lock-id");
      const secret = readFileSync(lockId, "utf8").trim();
      expect(secret.length).toBeGreaterThan(0);
      const lockPath = darwinSocketPublicationLockPath(socketPath, secret);
      if (process.platform === "darwin") {
        expect(lstatSync(lockPath).isSocket()).toBe(true);
      } else {
        expect(() => lstatSync(lockPath)).toThrowError(expect.objectContaining({ code: "ENOENT" }));
      }
      return readProcessFrame();
    };
    const server = await startNativeTerminalHostServer({
      socketPath,
      host: servingHost(socketPath),
      readFrame: readUnderLock,
    });
    try {
      const client = await NativeTerminalClient.connect(socketPath);
      try {
        expect((await client.ping()).generation).toBe("darwin-pub");
      } finally {
        await client.close();
      }
      const owner = JSON.parse(readFileSync(`${socketPath}.owner`, "utf8")) as Record<string, unknown>;
      expect(owner.pid).toBe(process.pid);
      expect(typeof owner.bootId).toBe("string");
      expect(typeof owner.pidNamespace).toBe("string");
      expect(typeof owner.startTime).toBe("number");
    } finally {
      await server.close();
    }
  }, TEST_TIMEOUT);

  it("should refuse a second publisher for the same socket", async () => {
    const { child, socketPath } = await spawnOwner();
    try {
      writeEmptyRegistry();
      await expect(startNativeTerminalHostServer({
        socketPath,
        host: servingHost(socketPath),
        readFrame: readProcessFrame,
      })).rejects.toMatchObject({ code: "H2A_ENDPOINT_LIVE_OWNER" });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, TEST_TIMEOUT);

  it("should prove endpoint absence only from positive evidence", async () => {
    const { socketPath } = await endpoint();
    writeEmptyRegistry();
    const server = await startNativeTerminalHostServer({
      socketPath,
      host: servingHost(socketPath),
      readFrame: readProcessFrame,
    });
    try {
      // A live publisher answering connects is not absent.
      await expect(proveNativeTerminalEndpointAbsent(
        socketPath,
        { code: "ECONNREFUSED" },
        readProcessFrame,
      )).resolves.toBe(false);
    } finally {
      await server.close();
    }
    // Nothing published, no sidecar, no rows, nobody answering: absent.
    const fresh = await endpoint();
    writeEmptyRegistry();
    await expect(proveNativeTerminalEndpointAbsent(
      fresh.socketPath,
      { code: "ENOENT" },
      readProcessFrame,
    )).resolves.toBe(true);
    // Unreadable observation is unknown (refuse), never absent — even with a
    // live publisher that the scan can no longer see.
    const held = await endpoint();
    writeEmptyRegistry();
    const heldServer = await startNativeTerminalHostServer({
      socketPath: held.socketPath,
      host: servingHost(held.socketPath),
      readFrame: readProcessFrame,
    });
    try {
      process.env.H2A_TEST_PROC_UNAVAILABLE = "1";
      try {
        await expect(proveNativeTerminalEndpointAbsent(
          held.socketPath,
          { code: "ECONNREFUSED" },
          readProcessFrame,
        )).rejects.toMatchObject({ code: "H2A_ENDPOINT_SCAN_UNKNOWN" });
      } finally {
        delete process.env.H2A_TEST_PROC_UNAVAILABLE;
      }
    } finally {
      await heldServer.close();
    }
  }, TEST_TIMEOUT);

  it("should attribute a ps-visible live host and refuse without observations", async () => {
    const { directory, socketPath } = await endpoint();
    // A real live process whose fabricated argv carries this endpoint: the
    // scan must correlate it and defer to the injected probe. kill(0) and
    // the start-time read below are real; only the argv row is fabricated.
    // A second real socket decides serving: bound (accepting) versus absent.
    const sleeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
      env: process.env,
      stdio: "ignore",
    });
    children.add(sleeper);
    try {
      const row = {
        pid: sleeper.pid!,
        pgid: sleeper.pid!,
        stat: "S",
        args: `${process.execPath} /opt/h2a/dist/native-terminal/owner-process.js --socket ${socketPath} --generation g`,
      };
      const expectedStart = readProcessStartTime(sleeper.pid!);
      expect(expectedStart).toBeDefined();
      const { createServer } = await import("node:net");
      const acceptor = createServer((socket) => socket.destroy());
      await new Promise<void>((resolve, reject) => {
        acceptor.once("error", reject);
        acceptor.listen(socketPath, () => {
          acceptor.removeListener("error", reject);
          resolve();
        });
      });
      try {
        // Named, alive, and serving: live.
        expect(await findDarwinActiveHostServingSocket(socketPath, [row], () => "alive")).toEqual({
          state: "live",
          pid: sleeper.pid!,
          startTime: expectedStart,
        });
        // The same candidate probed dead is not a host: absent.
        expect(await findDarwinActiveHostServingSocket(socketPath, [row], () => "dead")).toEqual({
          state: "absent",
        });
      } finally {
        await new Promise<void>((resolve) => acceptor.close(() => resolve()));
      }
      // Named and alive but serving nothing: not live (this is the
      // reclaiming tree itself, which must publish, never refuse itself).
      expect(await findDarwinActiveHostServingSocket(socketPath, [row], () => "alive")).toEqual({
        state: "absent",
      });
    } finally {
      try {
        sleeper.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }
    // No observations, no proof: unknown, never absent.
    expect(await findDarwinActiveHostServingSocket(socketPath, undefined, () => "dead")).toEqual({
      state: "unknown",
      reason: "darwin process table is unreadable",
    });
    // Whitespace targets cannot be attributed exactly: unknown, never absent.
    const spaced = join(directory, "with space.sock");
    expect(await findDarwinActiveHostServingSocket(spaced, [], () => "dead")).toEqual({
      state: "unknown",
      reason: "darwin argv scan cannot attribute socket paths containing whitespace",
    });
  });

  it("should attribute a pathname-less live host", async () => {
    const { child, socketPath } = await spawnOwner();
    try {
      // The published name is gone but the owner still serves with a live
      // owner record. On Linux the fd attribution names the holder
      // (H2A_ENDPOINT_LIVE_OWNER); on darwin the scan sees argv without
      // serving and the refusal comes downstream as unproven owner death —
      // still a coded refusal, never a second publication (the spec's
      // "or refuse" clause).
      rmSync(socketPath, { force: true });
      writeEmptyRegistry();
      await expect(startNativeTerminalHostServer({
        socketPath,
        host: servingHost(socketPath),
        readFrame: readProcessFrame,
      })).rejects.toMatchObject(process.platform === "darwin"
        ? { code: "H2A_ENDPOINT_OWNER_UNPROVEN", exitCode: 3 }
        : { code: "H2A_ENDPOINT_LIVE_OWNER", exitCode: 3 });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, TEST_TIMEOUT);
});
