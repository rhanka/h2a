/**
 * Lot L4-replies (D10) — real-VTE acceptance.
 *
 * Runs the A.3 capture against a REAL responding terminal: `gnome-terminal`
 * under a private `Xvfb` + private D-Bus session (see `vte-harness.mjs`),
 * with HOME/XDG/DISPLAY/bus/runtime state under the lot's L0 temp roots and
 * the lot-branch build run from the fixture prefix. The test observes
 * through the INNER side (receipt files): the VTE's answers reach the inner
 * reader only when the bridge+host let them through.
 *
 * On a machine without the VTE binaries this file reports INCOMPLETE
 * (loudly, never a silent skip): D10 qualification there is incomplete and
 * the deterministic results in `terminal-replies.functional.test.ts` stand
 * separately.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, constants, openSync, readFileSync, writeSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { NativeTerminalHostSupervisor } from "./supervisor.js";
import { LOCAL_WRAPPER } from "../tmux.js";

const E = "\x1b";
const TUI_QUERIES = `${E}[c${E}[?2026$p${E}[>q`;

function haveBinary(name: string): boolean {
  return spawnSync("command", ["-v", name], { encoding: "utf8" }).status === 0;
}

const vteAvailable =
  process.platform === "linux" &&
  haveBinary("Xvfb") &&
  haveBinary("dbus-run-session") &&
  haveBinary("gnome-terminal");

if (!vteAvailable) {
  process.stderr.write(
    "[h2a] VTE qualification INCOMPLETE: need Xvfb + dbus-run-session + gnome-terminal; " +
      "deterministic results stand separately.\n",
  );
}

const children: ChildProcess[] = [];
const directories: string[] = [];
const supervisors: NativeTerminalHostSupervisor[] = [];

afterEach(async () => {
  for (const supervisor of supervisors.splice(0)) supervisor.disconnect();
  for (const child of children.splice(0)) {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function until(accept: () => boolean | Promise<boolean>, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await accept())) {
    if (Date.now() > deadline) throw new Error("VTE fixture did not reach the expected state");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function freeDisplay(): string {
  for (let n = 91; n < 100; n++) {
    try {
      readFileSync(`/tmp/.X11-unix/X${n}`);
    } catch {
      return String(n);
    }
  }
  throw new Error("VTE qualification: no free X display in :91–:99");
}

describe.skipIf(!vteAvailable)("lot L4-replies VTE acceptance (D10)", () => {
  it("should leave the post-CLI reader clean against a real responding terminal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vteq-"));
    directories.push(directory);
    const socketPath = join(directory, "host.sock");
    const receiptA = join(directory, "receipt-a.log");
    const receiptB = join(directory, "receipt-b.log");
    const env = { ...process.env, REMOTE_CLI_CONFIG_HOME: join(directory, "config"), H2A_NATIVE_SOCKET: socketPath };

    const supervisor = new NativeTerminalHostSupervisor({
      socketPath,
      registryPath: join(directory, "registry.json"),
      replayBytesPerSession: 4096,
      generationFactory: () => "vte-qualification",
      spawnHost: (options) => {
        const loader = fileURLToPath(import.meta.resolve("tsx"));
        const host = spawn(process.execPath, ["--import", loader,
          fileURLToPath(new URL("./process.ts", import.meta.url)),
          "--socket", socketPath, "--generation", options.generation,
          "--replay-bytes", String(options.replayBytesPerSession),
          "--registry-path", options.registryPath!,
        ], { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] });
        children.push(host);
        return host;
      },
    });
    supervisors.push(supervisor);
    const client = await supervisor.client();

    const loader = fileURLToPath(import.meta.resolve("tsx"));
    const opTs = fileURLToPath(new URL("./op.ts", import.meta.url));
    const harness = fileURLToPath(new URL("./vte-harness.mjs", import.meta.url));

    async function runHarness(id: string, fifo: string, out: string, err: string): Promise<ChildProcess> {
      const child = spawn(process.execPath, [harness,
        "--display", freeDisplay(), "--tmp", directory, "--socket", socketPath,
        "--id", id, "--op", opTs, "--tsx", loader,
        "--fifo", fifo, "--out", out, "--err", err,
      ], { cwd: directory, env, stdio: "ignore" });
      children.push(child);
      return child;
    }

    async function openWriter(fifo: string): Promise<number> {
      const deadline = Date.now() + 30_000;
      for (;;) {
        try {
          return openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENXIO") throw error;
          if (Date.now() > deadline) throw new Error("VTE qualification: no FIFO reader came up");
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }

    // Phase A (validity gate): the VTE really answers a live query — the
    // inner reader logs the outer DA reply while the asker is alive.
    await client.create({
      id: "vte-a", command: process.execPath,
      args: ["-e", `process.stdin.setRawMode(true); process.stdin.resume();
        const fs = require('node:fs');
        process.stdout.write(${JSON.stringify(`${E}[c`)});
        setTimeout(() => process.exit(0), 4000);
        try { fs.unlinkSync(${JSON.stringify(receiptA)}); } catch {}
        process.stdin.on('data', (b) => fs.appendFileSync(${JSON.stringify(receiptA)}, JSON.stringify(String(b)) + '\\n'));`],
      cwd: directory, env: env as Record<string, string>, cols: 80, rows: 24,
    });
    const fifoA = join(directory, "fifo-a");
    const harnessA = await runHarness("vte-a", fifoA, join(directory, "out-a.log"), join(directory, "err-a.log"));
    const writerA = await openWriter(fifoA);
    await until(async () => {
      try {
        const content = await readFile(receiptA, "utf8");
        return /\x1b\[\?[0-9;]*c/.test(content);
      } catch { return false; }
    });
    // The VTE answered for real: the live TUI reply crossed while outstanding.
    const receiptAContent = await readFile(receiptA, "utf8");
    expect(receiptAContent).toMatch(/\x1b\[\?[0-9;]*c/);
    closeSync(writerA);
    await until(() => harnessA.exitCode !== null);

    // Phase B (A.3): the TUI exits at once; the post-CLI reader (byte logger)
    // must stay clean while human bytes cross verbatim and ordered.
    const wrapper = LOCAL_WRAPPER.replace("exec /bin/bash -l", `exec /usr/bin/tee ${receiptB}`);
    await client.create({
      id: "vte-b", command: "/bin/bash",
      args: ["--noprofile", "--norc", "-c", wrapper,
        "[h2a] resume in this shell: test-resume", "h2a-vte-b",
        process.execPath, "-e",
        `process.stdout.write(${JSON.stringify(TUI_QUERIES)});setTimeout(() => process.exit(0), 200);`],
      cwd: directory, env: { ...env, H2A_NATIVE_TERMINAL: "1" } as Record<string, string>, cols: 80, rows: 24,
    });
    const fifoB = join(directory, "fifo-b");
    const harnessB = await runHarness("vte-b", fifoB, join(directory, "out-b.log"), join(directory, "err-b.log"));
    const writerB = await openWriter(fifoB);
    // Let the CLI exit and the VTE's delayed answers arrive, then type.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    writeSync(writerB, "HUMAN-VTE-1\r");
    await new Promise((resolve) => setTimeout(resolve, 500));
    writeSync(writerB, "HUMAN-VTE-2\r");
    await new Promise((resolve) => setTimeout(resolve, 500));
    closeSync(writerB);
    await until(() => harnessB.exitCode !== null);
    const receiptBContent = await readFile(receiptB, "utf8");
    expect(receiptBContent).toContain("HUMAN-VTE-1");
    expect(receiptBContent).toContain("HUMAN-VTE-2");
    expect(receiptBContent.indexOf("HUMAN-VTE-1")).toBeLessThan(receiptBContent.indexOf("HUMAN-VTE-2"));
    // Zero reply bytes reached the post-CLI reader against the real VTE.
    expect(receiptBContent).not.toMatch(/\x1b\[\?[0-9;]*c/);
    expect(receiptBContent).not.toMatch(/\x1b\[\d+;\d+R/);
    expect(receiptBContent).not.toMatch(/\x1b\[\?[0-9;]*\$y/);
  }, 120_000);
});
