// @ts-ignore Shared JS test isolation helper.
import { createPrivateTestDirectory, nativeTestEnvironment, pinPrivateNativeProcess, setupNativeTestEnvironment, waitForPrivateNativeProcesses } from "../../h2a/test/helpers/native-isolation.js";
setupNativeTestEnvironment(afterAll);
import { spawnSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type * as NodePty from "node-pty";

const pty: typeof NodePty = createRequire(import.meta.url)("node-pty");
const loader = fileURLToPath(import.meta.resolve("tsx"));
const tmuxModule = pathToFileURL(join(import.meta.dirname, "tmux.ts")).href;
const E = "\x1b";

const terminals = new Set<NodePty.IPty>();
const directories = new Set<string>();
const strayPids = new Set<number>();
const processPins = new Set<() => void>();

afterEach(async () => {
  for (const terminal of terminals) {
    try { terminal.kill("SIGKILL"); } catch { /* already exited */ }
  }
  terminals.clear();
  for (const pid of strayPids) {
    try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
  }
  strayPids.clear();
  for (const release of processPins) release();
  processPins.clear();
  await waitForPrivateNativeProcesses(process.env);
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

async function until(accept: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    let ok = false;
    try { ok = accept(); } catch { ok = false; }
    if (ok) return;
    if (Date.now() > deadline) throw new Error(`isolated terminal timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function spawnDriver(env: Record<string, string>, driver: string, extraEnv: Record<string, string> = {}) {
  const terminal = pty.spawn(process.execPath,
    ["--import", loader, "--input-type=module", "-e", driver],
    { cwd: env.HOME as string, env: { ...env, ...extraEnv } as Record<string, string>, name: "xterm-256color", cols: 80, rows: 24 });
  terminals.add(terminal);
  let output = "";
  let ended = false;
  let exitCode: number | undefined;
  let exitSignal: number | string | undefined;
  terminal.onData((data) => { output += data; });
  terminal.onExit((event) => {
    ended = true;
    exitCode = (event as { exitCode?: number }).exitCode;
    exitSignal = (event as { signal?: number | string }).signal;
    terminals.delete(terminal);
  });
  return { terminal, output: () => output, ended: () => ended,
    exit: () => ({ exitCode, exitSignal }),
    pin: () => { processPins.add(pinPrivateNativeProcess(terminal.pid, env)); } };
}

async function writeInnerScript(directory: string): Promise<string> {
  const inner = join(directory, "inner-tui.mjs");
  await writeFile(inner,
    `process.stdout.write(${JSON.stringify(`${E}[?1004h${E}[?2004h${E}[?1000h${E}[?1006h${E}[?1049h${E}[?25l`)});\n` +
    `process.stdout.write("treset-inner-ready pid=" + process.pid + "\\n");\n` +
    `setInterval(() => {}, 1000);\n`);
  return inner;
}

function innerPidOf(output: string): number {
  const pid = Number(/treset-inner-ready pid=(\d+)/.exec(output)?.[1]);
  expect(pid, `inner pid in ${JSON.stringify(output)}`).toBeGreaterThan(0);
  return pid;
}

async function writeRawInnerScript(directory: string): Promise<string> {
  const inner = join(directory, "inner-raw.mjs");
  await writeFile(inner,
    `const { spawnSync } = await import("node:child_process");\n` +
    `process.stdout.write("treset-inner-ready pid=" + process.pid + "\\n");\n` +
    `spawnSync("stty", ["-icanon", "-echo"], { stdio: "inherit" });\n` +
    `setInterval(() => {}, 1000);\n`);
  return inner;
}

describe.skipIf(process.platform !== "linux")("client terminal sane-state reset on real isolated PTYs", () => {
  it("should reset focus/paste/mouse modes after a foreground CLI crash", async () => {
    const root = createPrivateTestDirectory("treset-fg-");
    directories.add(root);
    const env = nativeTestEnvironment(root) as Record<string, string>;
    const inner = await writeInnerScript(root);
    const driver = spawnDriver(env,
      `import { runLocalCliForeground } from ${JSON.stringify(tmuxModule)};\n` +
      `process.exit(runLocalCliForeground(process.execPath, [process.env.TRESET_INNER]));\n`,
      { TRESET_INNER: inner });
    await until(() => driver.output().includes("treset-inner-ready"), "inner TUI modes enabled");
    driver.pin();
    const innerPid = innerPidOf(driver.output());
    strayPids.add(innerPid);
    process.kill(innerPid, "SIGKILL");
    await until(driver.ended, "foreground wrapper returned");
    strayPids.delete(innerPid);
    const output = driver.output();
    // rev351-4.2: pin every mode family, not just four. The fixed sequence
    // must survive a real SIGKILL of the child.
    for (const reset of [`${E}[?1004l`, `${E}[?2004l`, `${E}[?1000l`, `${E}[?1002l`, `${E}[?1006l`, `${E}[?1049l`, `${E}[?25h`, `${E}[=0u`, `${E}[<16u`]) {
      expect(output, `missing client reset ${JSON.stringify(reset)}`).toContain(reset);
    }
    // rev351-1.1: a child killed by SIGKILL must report 137, never 0.
    expect(driver.exit().exitCode, `wrapper exit ${JSON.stringify(driver.exit())}`).toBe(137);
  }, 60_000);

  it("should emit the client reset after the whole tmux client tree is killed", async () => {
    // tmux 3.6 re-emits a partial reset itself when its client tree dies, so
    // the classic modes prove nothing here. Assert the markers only the h2a
    // wrapper emits (kitty/modifier/outer modes tmux never touches): with the
    // tree frozen and killed, they can only come from the product fix.
    const root = createPrivateTestDirectory("treset-tmux-");
    directories.add(root);
    const env = nativeTestEnvironment(root) as Record<string, string>;
    const started = spawnSync("tmux", ["-f", "/dev/null", "new-session", "-d", "-s", "h2a-treset",
      "-x", "80", "-y", "24", "/bin/bash", "--noprofile", "--norc", "-c",
      `printf 'treset-pane-ready\\n'; exec sleep 60`], { env, encoding: "utf8" });
    expect(started.status, started.stderr).toBe(0);
    const driver = spawnDriver(env,
      `import { attachLocalSession } from ${JSON.stringify(tmuxModule)};\n` +
      `process.exit(attachLocalSession("h2a-treset"));\n`);
    await until(() => {
      const probe = spawnSync("tmux", ["display-message", "-p", "-t", "h2a-treset", "#{session_attached}"],
        { env, encoding: "utf8" });
      return probe.status === 0 && probe.stdout.trim() === "1";
    }, "tmux client attached");
    driver.pin();
    const { readFile } = await import("node:fs/promises");
    const descendants = async (pid: number): Promise<number[]> => {
      const found: number[] = [];
      const queue = [pid];
      while (queue.length > 0) {
        const current = queue.pop()!;
        let children = "";
        try {
          children = await readFile(`/proc/${current}/task/${current}/children`, "utf8");
        } catch { continue; }
        for (const child of children.trim().split(/\s+/).filter(Boolean).map(Number)) {
          if (child > 0 && child !== pid) { found.push(child); queue.push(child); }
        }
      }
      return found;
    };
    const tree = await descendants(driver.terminal.pid);
    expect(tree.length, "tmux client tree under the driver").toBeGreaterThan(0);
    // Freeze the whole tree first: a survivor could otherwise restore the
    // outer modes in the gap between two kills, hiding the product hole.
    for (const pid of tree) {
      try { process.kill(pid, "SIGSTOP"); } catch { /* already dead */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    for (const pid of tree) {
      try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
    }
    await until(driver.ended, "attach wrapper returned after client tree kill");
    spawnSync("tmux", ["kill-server"], { env, stdio: "ignore" });
    const output = driver.output();
    for (const reset of [`${E}[=0u`, `${E}[>4;0m`, `${E}[?47l`, `${E}[?1047l`, `${E}[?1015l`, `${E}[?2026l`]) {
      expect(output, `missing client reset ${JSON.stringify(reset)}`).toContain(reset);
    }
  }, 60_000);

  it("should emit the client reset when the tmux server dies first (host death)", async () => {
    // rev351-4.2: the previous test leaves the server alive during the client
    // kill; a dead server (kill-server) must still return the wrapper with a
    // reset. Without the wrapper only tmux's own partial cleanup would run.
    const root = createPrivateTestDirectory("treset-hostdeath-");
    directories.add(root);
    const env = nativeTestEnvironment(root) as Record<string, string>;
    const started = spawnSync("tmux", ["-f", "/dev/null", "new-session", "-d", "-s", "h2a-treset-dead",
      "-x", "80", "-y", "24", "/bin/bash", "--noprofile", "--norc", "-c",
      `printf 'treset-pane-ready\\n'; exec sleep 60`], { env, encoding: "utf8" });
    expect(started.status, started.stderr).toBe(0);
    const driver = spawnDriver(env,
      `import { attachLocalSession } from ${JSON.stringify(tmuxModule)};\n` +
      `process.exit(attachLocalSession("h2a-treset-dead"));\n`);
    await until(() => {
      const probe = spawnSync("tmux", ["display-message", "-p", "-t", "h2a-treset-dead", "#{session_attached}"],
        { env, encoding: "utf8" });
      return probe.status === 0 && probe.stdout.trim() === "1";
    }, "tmux client attached");
    driver.pin();
    // Host death first: the server is gone before the client tree is reaped.
    spawnSync("tmux", ["kill-server"], { env, stdio: "ignore" });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const { readFile } = await import("node:fs/promises");
    try {
      const children = await readFile(`/proc/${driver.terminal.pid}/task/${driver.terminal.pid}/children`, "utf8");
      for (const child of children.trim().split(/\s+/).filter(Boolean).map(Number)) {
        try { process.kill(child, "SIGKILL"); } catch { /* already dead */ }
      }
    } catch { /* driver already reaped */ }
    await until(driver.ended, "attach wrapper returned after server death");
    const output = driver.output();
    for (const reset of [`${E}[=0u`, `${E}[>4;0m`, `${E}[?47l`, `${E}[?1047l`, `${E}[?1015l`, `${E}[?2026l`]) {
      expect(output, `missing client reset ${JSON.stringify(reset)}`).toContain(reset);
    }
  }, 60_000);

  it("should die promptly when the wrapper itself receives SIGTERM (no blocking)", async () => {
    // rev351-1.2: trapping signals around blocking spawnSync disabled the
    // kernel's prompt kill and blocked the wrapper until the child ended on
    // its own (the old test even encoded that block as "must survive"). With
    // no trapping the wrapper keeps its default disposition and dies at once;
    // like SIGKILL-to-self, no JS reset can run on this path (residual).
    const root = createPrivateTestDirectory("treset-sig-");
    directories.add(root);
    const env = nativeTestEnvironment(root) as Record<string, string>;
    const inner = await writeInnerScript(root);
    const driver = spawnDriver(env,
      `import { runLocalCliForeground } from ${JSON.stringify(tmuxModule)};\n` +
      `process.exit(runLocalCliForeground(process.execPath, [process.env.TRESET_INNER]));\n`,
      { TRESET_INNER: inner });
    await until(() => driver.output().includes("treset-inner-ready"), "inner TUI modes enabled");
    driver.pin();
    const innerPid = innerPidOf(driver.output());
    strayPids.add(innerPid);
    process.kill(driver.terminal.pid, "SIGTERM");
    await until(driver.ended, "wrapper died promptly on its own SIGTERM (no blocking)");
    try { process.kill(innerPid, "SIGKILL"); } catch { /* already reaped */ }
    strayPids.delete(innerPid);
  }, 60_000);

  it("should reset every mode and report 143 when only the child receives SIGTERM", async () => {
    // rev351-1.1/4.1: the old SIGTERM test proved nothing (it SIGKILLed the
    // child itself and asserted a single mode). Killing the CHILD with SIGTERM
    // must reset all modes and report 128+15, never 0.
    const root = createPrivateTestDirectory("treset-childsig-");
    directories.add(root);
    const env = nativeTestEnvironment(root) as Record<string, string>;
    const inner = await writeInnerScript(root);
    const driver = spawnDriver(env,
      `import { runLocalCliForeground } from ${JSON.stringify(tmuxModule)};\n` +
      `process.exit(runLocalCliForeground(process.execPath, [process.env.TRESET_INNER]));\n`,
      { TRESET_INNER: inner });
    await until(() => driver.output().includes("treset-inner-ready"), "inner TUI modes enabled");
    driver.pin();
    const innerPid = innerPidOf(driver.output());
    strayPids.add(innerPid);
    process.kill(innerPid, "SIGTERM");
    await until(driver.ended, "wrapper returned after child SIGTERM");
    strayPids.delete(innerPid);
    const output = driver.output();
    for (const reset of [`${E}[?1004l`, `${E}[?2004l`, `${E}[?1000l`, `${E}[?1002l`, `${E}[?1006l`, `${E}[?1049l`, `${E}[?25h`, `${E}[=0u`, `${E}[<16u`]) {
      expect(output, `missing client reset ${JSON.stringify(reset)}`).toContain(reset);
    }
    expect(driver.exit().exitCode, `wrapper exit ${JSON.stringify(driver.exit())}`).toBe(143);
  }, 60_000);

  it("should restore termios after a raw-leaving CLI is SIGKILLed", async () => {
    // rev351-3.2: setRawMode(false) alone can be a no-op after the CHILD
    // changed the kernel termios (libuv caches the parent mode); only an
    // explicit stty restore brings back echo + canonical mode.
    const root = createPrivateTestDirectory("treset-termios-");
    directories.add(root);
    const env = nativeTestEnvironment(root) as Record<string, string>;
    const inner = await writeRawInnerScript(root);
    const driver = spawnDriver(env,
      `import { spawnSync } from "node:child_process";\n` +
      `import { runLocalCliForeground } from ${JSON.stringify(tmuxModule)};\n` +
      `const before = spawnSync("stty", ["-g"], { encoding: "utf8", stdio: [process.stdin.fd, "pipe", "ignore"] }).stdout.trim();\n` +
      `runLocalCliForeground(process.execPath, [process.env.TRESET_INNER_RAW]);\n` +
      `const after = spawnSync("stty", ["-g"], { encoding: "utf8", stdio: [process.stdin.fd, "pipe", "ignore"] }).stdout.trim();\n` +
      `process.stdout.write("TRESET-TERMIOS before=" + before + " after=" + after + "\\n");\n` +
      `process.exit(0);\n`,
      { TRESET_INNER_RAW: inner });
    await until(() => driver.output().includes("treset-inner-ready"), "raw inner ready");
    driver.pin();
    const innerPid = innerPidOf(driver.output());
    strayPids.add(innerPid);
    // Let the inner apply stty -icanon -echo before killing it.
    await new Promise((resolve) => setTimeout(resolve, 500));
    process.kill(innerPid, "SIGKILL");
    await until(() => driver.output().includes("TRESET-TERMIOS"), "termios compared");
    await until(driver.ended, "termios driver returned");
    strayPids.delete(innerPid);
    const line = /TRESET-TERMIOS before=(\S+) after=(\S+)/.exec(driver.output());
    expect(line, `termios line in ${JSON.stringify(driver.output().slice(-500))}`).not.toBeNull();
    expect(line![2], "termios restored after raw-leaving SIGKILL").toBe(line![1]);
  }, 60_000);
});
