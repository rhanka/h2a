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
 * On a machine without the VTE binaries — or where no X server can run
 * (the L0 test barrier mounts /tmp/.X11-unix read-only, so Xvfb cannot
 * create its socket/lock there) — this file reports INCOMPLETE (loudly,
 * never a silent skip): D10 qualification there is incomplete and the
 * deterministic results in `terminal-replies.functional.test.ts` stand
 * separately.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, constants, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
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
  // `command` is a shell builtin, not an executable: resolve through sh.
  return spawnSync("/bin/sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).status === 0;
}

function canRunXServer(): boolean {
  // A real VTE needs a real X server, and Xvfb needs a writable
  // /tmp/.X11-unix (socket + lock file) — the L0 filesystem barrier mounts
  // it read-only, so no X server can run inside the authorised envelope no
  // matter which binaries are installed. Probe it directly: fast, honest.
  try {
    const probe = join("/tmp/.X11-unix", `.h2a-vte-probe-${process.pid}`);
    writeFileSync(probe, "probe");
    rmSync(probe);
    return true;
  } catch {
    return false;
  }
}

const vteAvailable =
  process.platform === "linux" &&
  haveBinary("Xvfb") &&
  haveBinary("dbus-run-session") &&
  haveBinary("gnome-terminal") &&
  canRunXServer();

if (!vteAvailable) {
  process.stderr.write(
    "[h2a] VTE qualification INCOMPLETE: need Xvfb + dbus-run-session + gnome-terminal " +
      "AND a writable /tmp/.X11-unix (the L0 barrier mounts it read-only, so Xvfb " +
      "cannot create its socket/lock there: `Could not create lock file`); " +
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

    async function runHarness(id: string, fifo: string, out: string, err: string, harnessErr: string): Promise<ChildProcess> {
      const harnessErrFd = openSync(harnessErr, "a");
      const child = spawn(process.execPath, [harness,
        "--display", freeDisplay(), "--tmp", directory, "--socket", socketPath,
        "--id", id, "--op", opTs, "--tsx", loader,
        "--fifo", fifo, "--out", out, "--err", err,
      ], { cwd: directory, env, stdio: ["ignore", "ignore", harnessErrFd] });
      children.push(child);
      return child;
    }

    async function openWriter(fifo: string, harnessErr: string): Promise<number> {
      const deadline = Date.now() + 60_000;
      let lastCode: string | undefined;
      for (;;) {
        try {
          return openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          lastCode = code;
          // ENOENT: the harness has not created the FIFO yet; ENXIO: created
          // but no reader yet (gnome-terminal still coming up). Both are the
          // expected rendezvous, not failures.
          if (code !== "ENXIO" && code !== "ENOENT") throw error;
          if (Date.now() > deadline) {
            let harnessSaid = "";
            try {
              harnessSaid = readFileSync(harnessErr, "utf8");
            } catch { /* no harness log at all */ }
            throw new Error(
              `VTE qualification: no FIFO reader came up (last open error: ${lastCode}; harness said: ${JSON.stringify(harnessSaid.slice(-2000))})`,
            );
          }
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
    const harnessErrA = join(directory, "harness-a.log");
    const harnessA = await runHarness("vte-a", fifoA, join(directory, "out-a.log"), join(directory, "err-a.log"), harnessErrA);
    const writerA = await openWriter(fifoA, harnessErrA);
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
    const harnessErrB = join(directory, "harness-b.log");
    const harnessB = await runHarness("vte-b", fifoB, join(directory, "out-b.log"), join(directory, "err-b.log"), harnessErrB);
    const writerB = await openWriter(fifoB, harnessErrB);
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
  }, 240_000);
});
