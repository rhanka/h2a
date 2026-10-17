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
  terminal.onData((data) => { output += data; });
  terminal.onExit(() => { ended = true; terminals.delete(terminal); });
  return { terminal, output: () => output, ended: () => ended,
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
    for (const reset of [`${E}[?1004l`, `${E}[?2004l`, `${E}[?1049l`, `${E}[?25h`]) {
      expect(output, `missing client reset ${JSON.stringify(reset)}`).toContain(reset);
    }
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

  it("should still reset when the wrapper itself receives SIGTERM mid-session", async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(driver.ended(), "wrapper must survive its own SIGTERM until the child ends").toBe(false);
    process.kill(innerPid, "SIGKILL");
    await until(driver.ended, "wrapper returned after inner death");
    strayPids.delete(innerPid);
    expect(driver.output()).toContain(`${E}[?1004l`);
  }, 60_000);
});
