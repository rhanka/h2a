import type { ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
// @ts-ignore Shared JS qualification helper; tests are outside the production build.
import { setupNativeTestEnvironment, spawnIsolatedNative as spawn } from "../../../h2a/test/helpers/native-isolation.js";

setupNativeTestEnvironment(afterAll);

import { NativeTerminalClient } from "./client.js";
import { defaultOwnerHostProbe, readProcessStartTime } from "./host.js";

// Lot BM RED: darwin identity + legacy containment proofs. Same platform
// contract as darwin-publication.test.ts: every test executes on both
// platforms with real assertions. Before the port, darwin start-time reads
// are unavailable and the owner refuses to boot, so both tests are red on
// darwin; on Linux they pin the behaviour the port must preserve.
const OWNER_ENTRY = fileURLToPath(new URL("../../dist/native-terminal/owner-process.js", import.meta.url));
const TEST_TIMEOUT = 90_000;

const children = new Set<ChildProcess>();
const directories = new Set<string>();
const sessionGroups = new Set<number>();

function sweepOwnedProcesses(owned: Set<string>): void {
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
  for (const pgid of sessionGroups) {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  sessionGroups.clear();
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    await delay(25);
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

function processGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function groupGone(pgid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      process.kill(-pgid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
    }
    if (Date.now() > deadline) return false;
    await delay(100);
  }
}

describe("darwin process identity substrate", () => {
  it("should distinguish a recycled pid from the same process, or refuse the proof", async () => {
    // The substrate must deliver a start-time discriminant: without it every
    // verdict below degrades and the test fails (pre-port darwin behaviour).
    const ownStart = readProcessStartTime(process.pid);
    expect(ownStart).toBeDefined();
    expect(defaultOwnerHostProbe({ pid: process.pid, startTime: ownStart })).toBe("alive");
    // A different live process under this pid's recorded start-time is exactly
    // what pid recycling looks like to the probe. The 1.1 s guard separates
    // the two starts even at one-second resolution.
    await delay(1100);
    const sleeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
      env: process.env,
      stdio: "ignore",
    });
    children.add(sleeper);
    let otherStart: number | undefined;
    const startDeadline = Date.now() + 10_000;
    while (otherStart === undefined) {
      if (sleeper.exitCode !== null || sleeper.signalCode !== null) {
        throw new Error("sleeper exited before its start time was readable");
      }
      if (Date.now() > startDeadline) throw new Error("sleeper start time stayed unreadable");
      otherStart = readProcessStartTime(sleeper.pid!);
      if (otherStart === undefined) await delay(100);
    }
    try {
      expect(otherStart).not.toBe(ownStart);
      expect(defaultOwnerHostProbe({ pid: sleeper.pid!, startTime: ownStart })).toBe("dead");
      expect(defaultOwnerHostProbe({ pid: sleeper.pid!, startTime: otherStart })).toBe("alive");
    } finally {
      try {
        sleeper.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }
    await once(sleeper, "exit").catch(() => undefined);
    const goneDeadline = Date.now() + 10_000;
    while (!processGone(sleeper.pid!)) {
      if (Date.now() > goneDeadline) throw new Error("sleeper pid never reported gone");
      await delay(50);
    }
    expect(defaultOwnerHostProbe({ pid: sleeper.pid!, startTime: otherStart })).toBe("dead");
  }, TEST_TIMEOUT);

  it("should confine a legacy session group on host death, or refuse to start it", async () => {
    const { child, socketPath, directory } = await spawnOwner();
    let pgid = -1;
    try {
      const client = await NativeTerminalClient.connect(socketPath);
      try {
        const session = await client.create({
          id: "bm-confinement",
          command: "/bin/sh",
          args: ["-c", "sleep 60"],
          cwd: directory,
          env: { ...process.env } as Record<string, string>,
          cols: 80,
          rows: 24,
        });
        // node-pty puts the spawned tree in its own session: pgid === pid.
        pgid = session.pid;
        sessionGroups.add(pgid);
        child.kill("SIGKILL");
        await once(child, "exit");
        expect(await groupGone(pgid, 15_000)).toBe(true);
      } finally {
        await client.close();
      }
    } finally {
      if (pgid > 0) {
        try {
          process.kill(-pgid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, TEST_TIMEOUT);
});
