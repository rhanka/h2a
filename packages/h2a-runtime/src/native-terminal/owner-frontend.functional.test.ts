import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
// @ts-ignore Shared JS qualification helper; tests are outside the production build.
import { setupNativeTestEnvironment, spawnIsolatedNative as spawn } from "../../../h2a/test/helpers/native-isolation.js";

setupNativeTestEnvironment(afterAll);

import { NativeTerminalClient } from "./client.js";
import { readProcessStartTime } from "./host.js";

const OWNER_ENTRY = fileURLToPath(new URL("../../dist/native-terminal/owner-process.js", import.meta.url));
const TEST_TIMEOUT = 90_000;

// Each Node child records its own PID and birth in this private fixture.
// Cleanup uses these launch receipts, never a process census or name matching.
const receiptPath = join(process.env.TMPDIR!, "owner-frontend-children.jsonl");
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

/** Test-owned PIDs: the owner spawns frontends and keepers, which must
 * not outlive the test even when their self-exit lags. */
function descendantPids(pid: number, seen = new Set<number>()): number[] {
  if (seen.has(pid)) return [];
  seen.add(pid);
  let kids: string[] = [];
  try {
    kids = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8")
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
  const out = [...kids.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0)];
  for (const kid of out) out.push(...descendantPids(kid, seen));
  return out;
}


afterEach(async () => {
  for (const child of children) {
    if (child.pid === undefined) continue;
    // Descendants first (frontends, keepers): they self-exit on owner
    // death, but reaping here keeps teardown deterministic.
    for (const pid of descendantPids(child.pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
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

type OwnerSpawn = {
  child: ChildProcess;
  pid: number;
  socketPath: string;
  directory: string;
};

async function waitForReady(child: ChildProcess): Promise<{ pid: number; generation: string }> {
  let output = "";
  const deadline = Date.now() + 30_000;
  const chunks: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => {
    chunks.push(chunk.toString("utf8"));
  });
  for (;;) {
    output = chunks.join("");
    const line = output.split("\n").find((candidate) => candidate.includes("h2a.native-terminal.ready"));
    if (line !== undefined) {
      const parsed = JSON.parse(line) as { pid: number; generation: string };
      return parsed;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`owner exited before ready: ${child.exitCode ?? child.signalCode}; output: ${output.slice(-2000)}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`owner did not become ready; output: ${output.slice(-2000)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function spawnOwner(): Promise<OwnerSpawn> {
  const directory = await mkdtemp(join(tmpdir(), "b2-"));
  directories.add(directory);
  const socketPath = join(directory, "owner.sock");
  const child = spawn(process.execPath, [
    OWNER_ENTRY,
    "--socket",
    socketPath,
    "--generation",
    "b2-generation",
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
  const ready = await waitForReady(child);
  if (ready.pid === undefined) throw new Error("owner ready line carried no pid");
  return { child, pid: ready.pid, socketPath, directory };
}

function shellFixture(id: string, directory: string): {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
} {
  return {
    id,
    command: "/bin/sh",
    args: ["-c", `printf '${id}-up\\n'; while IFS= read -r line; do printf '${id}:%s\\n' "$line"; done`],
    cwd: directory,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm-256color" },
    cols: 80,
    rows: 24,
  };
}

async function readUntil(client: NativeTerminalClient, id: string, marker: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let afterSeq = 0;
  for (;;) {
    const replay = await client.readOutput(id, afterSeq);
    afterSeq = replay.latestSeq;
    const text = replay.chunks.map((chunk) => chunk.data).join("");
    if (text.includes(marker)) return;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${JSON.stringify(marker)}; saw: ${JSON.stringify(text.slice(-500))}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function waitForFrontendPid(socketPath: string, differentFrom?: number): Promise<number> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    // A fresh client per attempt: the previous connection dies with its
    // frontend, and a replaced frontend only serves new connections.
    const probe = await NativeTerminalClient.connect(socketPath).catch(() => undefined);
    if (probe !== undefined) {
      try {
        const ping = (await probe.ping()) as unknown as {
          frontend?: { pid: number };
        };
        const pid = ping.frontend?.pid;
        if (pid !== undefined && pid !== differentFrom) return pid;
      } catch {
        // No frontend serving yet.
      } finally {
        probe.close();
      }
    }
    if (Date.now() > deadline) throw new Error("no frontend answered with an identity");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function waitForDeath(pid: number, label: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!alive(pid)) return;
    if (Date.now() > deadline) throw new Error(`${label} pid=${pid} still alive`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function readPgid(pid: number): number {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const afterComm = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const pgrp = Number(afterComm[2]);
  if (!Number.isSafeInteger(pgrp) || pgrp <= 0) throw new Error(`cannot parse pgid for pid=${pid}`);
  return pgrp;
}

async function writeAndExpectEcho(
  client: NativeTerminalClient,
  lease: { id: string } & Record<string, unknown>,
  id: string,
  word: string,
): Promise<void> {
  await (client as unknown as { write(l: unknown, d: string): Promise<void> }).write(lease, `${word}\n`);
  await readUntil(client, id, `${id}:${word}`);
}

describe.skipIf(process.platform !== "linux")("owner/frontend split", () => {
  it(
    "should keep every CLI alive across a frontend SIGKILL and replacement",
    { timeout: TEST_TIMEOUT },
    async () => {
      const owner = await spawnOwner();
      const client = await NativeTerminalClient.connect(owner.socketPath);
      try {
        await client.create(shellFixture("tty1", owner.directory));
        const lease = await client.acquireController("tty1", "ctrl-1");
        await writeAndExpectEcho(client, lease, "tty1", "before");
        const before = await client.state("tty1");
        const birthBefore = readProcessStartTime(before.pid);
        expect(birthBefore).toBeDefined();
        const frontendPid = await waitForFrontendPid(owner.socketPath);

        process.kill(frontendPid, "SIGKILL");

        const replacementPid = await waitForFrontendPid(owner.socketPath, frontendPid);
        expect(replacementPid).not.toBe(frontendPid);

        // The old client connection died with the frontend; a fresh client
        // proves positive liveness: new input answered by the SAME CLI.
        const afterKill = await NativeTerminalClient.connect(owner.socketPath);
        try {
          const after = await afterKill.state("tty1");
          expect(after.pid).toBe(before.pid);
          expect(readProcessStartTime(after.pid)).toBe(birthBefore);
          const lease2 = await afterKill.acquireController("tty1", "ctrl-2");
          await writeAndExpectEcho(afterKill, lease2, "tty1", "after");
          const ping = (await afterKill.ping()) as unknown as { hostPid: number };
          expect(ping.hostPid).toBe(owner.pid);
        } finally {
          afterKill.close();
        }
      } finally {
        client.close();
      }
    },
  );

  it(
    "should accept a client connection queued during frontend replacement",
    { timeout: TEST_TIMEOUT },
    async () => {
      const owner = await spawnOwner();
      const inoBefore = statSync(owner.socketPath).ino;
      const probe = await NativeTerminalClient.connect(owner.socketPath);
      const frontendPid = await waitForFrontendPid(owner.socketPath);
      probe.close();

      process.kill(frontendPid, "SIGKILL");

      // Connect while no frontend serves: the keeper-held listener must hold
      // this connection in its backlog instead of refusing it. A
      // fresh-listener-per-frontend design fails here (ECONNREFUSED) and gets
      // a new inode below.
      const queued = createConnection(owner.socketPath);
      await once(queued, "connect");
      let queuedResponse = "";
      const queuedDone = new Promise<void>((resolve, reject) => {
        let buffer = "";
        queued.setEncoding("utf8");
        queued.on("data", (chunk: string) => {
          buffer += chunk;
          const newline = buffer.indexOf("\n");
          if (newline >= 0) {
            queuedResponse = buffer.slice(0, newline);
            resolve();
          }
        });
        queued.on("error", reject);
        setTimeout(() => reject(new Error("queued connection was never served")), 30_000).unref();
      });
      queued.write(`${JSON.stringify({ version: 1, id: "queued-1", operation: "ping" })}\n`);
      await queuedDone;
      queued.destroy();
      const parsed = JSON.parse(queuedResponse) as { ok: boolean };
      expect(parsed.ok).toBe(true);

      // Same listening inode after replacement: the listener was preserved,
      // not rebound.
      const check = await NativeTerminalClient.connect(owner.socketPath);
      try {
        await waitForFrontendPid(owner.socketPath, frontendPid);
      } finally {
        check.close();
      }
      expect(statSync(owner.socketPath).ino).toBe(inoBefore);
    },
  );

  it(
    "should refuse to start a second owner for the same socket",
    { timeout: TEST_TIMEOUT },
    async () => {
      const owner = await spawnOwner();
      const directory = await mkdtemp(join(tmpdir(), "b2-2-"));
      directories.add(directory);
      const second = spawn(process.execPath, [
        OWNER_ENTRY,
        "--socket",
        owner.socketPath,
        "--generation",
        "b2-generation-second",
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
      children.add(second);
      let stderr = "";
      second.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      const [code] = (await once(second, "exit")) as [number | null];
      expect(code).toBe(3);
      expect(stderr).toContain("H2A_ENDPOINT_LIVE_OWNER");
    },
  );

  it(
    "should exit the owner only when empty and explicitly stopped",
    { timeout: TEST_TIMEOUT },
    async () => {
      // Phase A: an empty owner stops promptly on SIGTERM.
      const empty = await spawnOwner();
      empty.child.kill("SIGTERM");
      const [emptyCode] = (await once(empty.child, "exit")) as [number | null];
      expect(emptyCode).toBe(0);

      // Phase B: an owner with a live session survives SIGTERM, then exits
      // by itself once the session ends.
      const owner = await spawnOwner();
      const client = await NativeTerminalClient.connect(owner.socketPath);
      try {
        await client.create(shellFixture("drain1", owner.directory));
        const lease = await client.acquireController("drain1", "ctrl-1");
        await writeAndExpectEcho(client, lease, "drain1", "alive");
        const session = await client.state("drain1");

        owner.child.kill("SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 1500));
        expect(owner.child.exitCode).toBeNull();
        expect(owner.child.signalCode).toBeNull();
        expect(alive(session.pid)).toBe(true);

        await client.stop(lease);
        const [code] = (await once(owner.child, "exit")) as [number | null];
        expect(code).toBe(0);
      } finally {
        client.close();
      }
    },
  );

  it("should withdraw the endpoint after a replacement frontend and a natural CLI drain", async () => {
    const owner = await spawnOwner();
    const original = await NativeTerminalClient.connect(owner.socketPath);
    let replacement: NativeTerminalClient | undefined;
    try {
      await original.create({ ...shellFixture("withdraw", owner.directory), args: ["-c", "printf 'ready\\n'; read -r line; exit 19"] });
      await readUntil(original, "withdraw", "ready");
      const frontend = await waitForFrontendPid(owner.socketPath);
      process.kill(frontend, "SIGKILL");
      await waitForFrontendPid(owner.socketPath, frontend);
      replacement = await NativeTerminalClient.connect(owner.socketPath);
      const lease = await replacement.acquireController("withdraw", "drain-controller");
      const exited = once(owner.child, "exit");
      owner.child.kill("SIGTERM");
      await replacement.write(lease, "finish\n");
      const [code] = await exited;
      expect(code).toBe(0);
      expect(existsSync(owner.socketPath)).toBe(false);
      expect(existsSync(owner.socketPath + ".owner")).toBe(false);
    } finally { original.close(); replacement?.close(); }
  }, TEST_TIMEOUT);

  it(
    "should report owner and frontend loaded versions and code identities separately",
    { timeout: TEST_TIMEOUT },
    async () => {
      const owner = await spawnOwner();
      const client = await NativeTerminalClient.connect(owner.socketPath);
      try {
        const ping = (await client.ping()) as unknown as {
          hostPid: number;
          protocolVersion: number;
          owner?: { pid: number; version: string; codePath: string };
          frontend?: { pid: number; version: string; codePath: string };
        };
        expect(ping.protocolVersion).toBe(1);
        expect(ping.hostPid).toBe(owner.pid);
        expect(ping.owner?.pid).toBe(owner.pid);
        expect(typeof ping.owner?.version).toBe("string");
        expect(ping.owner?.codePath).toContain("owner-process");
        expect(typeof ping.frontend?.pid).toBe("number");
        expect(ping.frontend?.pid).not.toBe(owner.pid);
        expect(typeof ping.frontend?.version).toBe("string");
        expect(ping.frontend?.codePath).toContain("frontend-process");
      } finally {
        client.close();
      }
    },
  );

  it(
    "should keep sessions confined when the owner itself is killed",
    { timeout: TEST_TIMEOUT },
    async () => {
      const owner = await spawnOwner();
      const client = await NativeTerminalClient.connect(owner.socketPath);
      const frontendPid = await waitForFrontendPid(owner.socketPath);
      await client.create(shellFixture("doomed", owner.directory));
      const lease = await client.acquireController("doomed", "ctrl-1");
      await writeAndExpectEcho(client, lease, "doomed", "live");
      const session = await client.state("doomed");
      const pgid = readPgid(session.pid);
      client.close();

      process.kill(owner.pid, "SIGKILL");

      // The CLI group dies with its owner: no orphans.
      await waitForDeath(session.pid, "CLI");
      const deadline = Date.now() + 15_000;
      for (;;) {
        try {
          process.kill(-pgid, 0);
        } catch (error) {
          expect((error as NodeJS.ErrnoException).code).toBe("ESRCH");
          break;
        }
        if (Date.now() > deadline) throw new Error(`CLI group pgid=${pgid} still alive`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      // The orphaned frontend loses its owner and exits by itself.
      await waitForDeath(frontendPid, "orphaned frontend");
    },
  );
});
