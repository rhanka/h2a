import type { ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
// @ts-ignore Shared JS qualification helper; tests are outside the production build.
import { setupNativeTestEnvironment, spawnIsolatedNative as spawn } from "../../../h2a/test/helpers/native-isolation.js";

setupNativeTestEnvironment(afterAll);

import { NativeTerminalClient } from "./client.js";
import { NativeTerminalHost } from "./host.js";
import { resolveRegistryPath } from "../registry.js";
import { readProcessFrame } from "../proc-identity.js";
import { proveNativeTerminalEndpointAbsent, startNativeTerminalHostServer } from "./server.js";

// Lot BM RED: darwin product-substrate proofs. Every test executes on both
// platforms with real assertions in each branch (the repo execution-proof
// gate bans empty and skipped suites, so D27 "not run" is honored by
// platform-branched assertions, never by skips). On darwin before the port,
// publication throws the typed Linux-only error and the owner refuses to
// boot, so every test below is red there; on Linux they pin the unchanged
// behaviour the port must preserve.
const OWNER_ENTRY = fileURLToPath(new URL("../../dist/native-terminal/owner-process.js", import.meta.url));
const TEST_TIMEOUT = 90_000;

const children = new Set<ChildProcess>();
const directories = new Set<string>();

function sweepOwnedProcesses(owned: Set<string>): void {
  // Portable (Linux + darwin) leftover sweep: only PIDs whose command line
  // names one of this test's private directories are ever signalled.
  let output = "";
  try {
    output = execFileSync("/bin/ps", ["-axo", "pid,args"], {
      encoding: "utf8",
      timeout: 15_000,
      env: { ...process.env, LC_ALL: "C" },
    });
  } catch {
    return;
  }
  for (const line of output.split("\n").slice(1)) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) continue;
    if ([...owned].some((directory) => directory !== "" && match[2]!.includes(directory))) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
}

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
  sweepOwnedProcesses(directories);
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
  let output = "";
  const deadline = Date.now() + 30_000;
  const chunks: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => {
    chunks.push(chunk.toString("utf8"));
  });
  for (;;) {
    output = chunks.join("");
    if (output.split("\n").some((line) => line.includes("h2a.native-terminal.ready"))) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`owner exited before ready: ${child.exitCode ?? child.signalCode}; output: ${output.slice(-2000)}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`owner did not become ready; output: ${output.slice(-2000)}`);
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
    const server = await startNativeTerminalHostServer({
      socketPath,
      host: servingHost(socketPath),
      readFrame: readProcessFrame,
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
      const lockId = join(dirname(socketPath), ".h2a-native-terminal.lock-id");
      expect(readFileSync(lockId, "utf8").trim().length).toBeGreaterThan(0);
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
  }, TEST_TIMEOUT);

  it("should attribute a pathname-less live host", async () => {
    const { child, socketPath } = await spawnOwner();
    try {
      // The published name is gone but the owner still serves: a second
      // publisher must see the live owner through its argv, not the name.
      rmSync(socketPath, { force: true });
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
});
