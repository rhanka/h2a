/**
 * Lot L4-replies (D10) RED — terminal replies never reach the shell.
 *
 * Runs on the double-`node-pty` deterministic machinery (same fixture shape
 * as `terminal-modes.functional.test.ts`): the outer emulator never answers
 * DA/DECRPM/XTVERSION itself, so the test injects the outer replies the way
 * a real VTE would emit them — including split across chunks and delayed
 * past the CLI exit — and asserts zero reply bytes reach the post-CLI shell
 * while live TUI replies and human input keep flowing. Real-VTE acceptance
 * lives in `vte-qualification.functional.test.ts`.
 */
// @ts-ignore Shared JS test isolation helper.
import { isolatedNativeTestEnvironment, pinPrivateNativeProcess, spawnIsolatedNative as spawn, setupNativeTestEnvironment, waitForPrivateNativeProcesses } from "../../../h2a/test/helpers/native-isolation.js";
setupNativeTestEnvironment(afterAll);
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type * as NodePty from "node-pty";
import { NativeTerminalHostSupervisor } from "./supervisor.js";
import { LOCAL_WRAPPER } from "../tmux.js";

const pty: typeof NodePty = createRequire(import.meta.url)("node-pty");
const loader = fileURLToPath(import.meta.resolve("tsx"));
const E = "\x1b";
// The A.3 capture: a TUI that emits startup queries and exits at once.
const TUI_QUERIES = `${E}[c${E}[?2026$p${E}[?1016$p${E}[>q`;
const children = new Set<ChildProcess>();
const terminals = new Set<NodePty.IPty>();
const directories = new Set<string>();
const supervisors = new Set<NativeTerminalHostSupervisor>();
const processPins = new Set<() => void>();

afterEach(async () => {
  for (const terminal of terminals) terminal.kill("SIGKILL");
  terminals.clear();
  for (const supervisor of supervisors) supervisor.disconnect();
  supervisors.clear();
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, "exit");
      child.kill("SIGKILL");
      await ended;
    }
  }
  children.clear();
  await waitForPrivateNativeProcesses(process.env);
  for (const release of processPins) release();
  processPins.clear();
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

async function until(accept: () => boolean): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (!accept()) {
    if (Date.now() > deadline) throw new Error("isolated terminal did not reach the expected state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

type Fixture = {
  client: Awaited<ReturnType<NativeTerminalHostSupervisor["client"]>>;
  id: string;
  attach: () => {
    terminal: NodePty.IPty;
    output: () => string;
    ended: () => boolean;
    pin: () => void;
  };
};

async function fixture(replayBytes = 4096, inner?: { command: string; args: string[]; env?: Record<string, string> }): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "r-"));
  directories.add(directory);
  const socketPath = join(directory, "host.sock");
  const env = { ...process.env, REMOTE_CLI_CONFIG_HOME: join(directory, "config"), H2A_NATIVE_SOCKET: socketPath };
  let host!: ChildProcess;
  const supervisor = new NativeTerminalHostSupervisor({
    socketPath,
    registryPath: join(directory, "registry.json"),
    replayBytesPerSession: replayBytes,
    generationFactory: () => "terminal-replies-test",
    spawnHost: (options) => {
      host = spawn(process.execPath, ["--import", loader,
        fileURLToPath(new URL("./process.ts", import.meta.url)),
        "--socket", socketPath, "--generation", options.generation,
        "--replay-bytes", String(options.replayBytesPerSession),
        "--registry-path", options.registryPath!,
      ], { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] });
      children.add(host);
      return host;
    },
  });
  supervisors.add(supervisor);
  const client = await supervisor.client();
  const id = "reply-fixture";
  await client.create({
    id, command: inner?.command ?? process.execPath,
    args: inner?.args ?? ["-e", "setTimeout(() => {}, 30000);"],
    cwd: directory, env: { ...env, ...(inner?.env ?? {}) } as Record<string, string>, cols: 80, rows: 24,
  });
  const attach = () => {
    const attachArgs = ["--import", loader,
      fileURLToPath(new URL("./op.ts", import.meta.url)),
      "attach", "--id", id, "--socket", socketPath,
    ];
    isolatedNativeTestEnvironment(env);
    const terminal = pty.spawn(process.execPath, attachArgs,
      { cwd: directory, env: env as Record<string, string>, name: "xterm-256color", cols: 80, rows: 24 });
    terminals.add(terminal);
    let output = "";
    let ended = false;
    terminal.onData((data) => { output += data; });
    terminal.onExit(() => { ended = true; terminals.delete(terminal); });
    return { terminal, output: () => output, ended: () => ended,
      pin: () => { processPins.add(pinPrivateNativeProcess(terminal.pid, env)); } };
  };
  return { client, id, attach };
}

/** The fake TUI under the real wrapper: prints queries, exits, drops to a marker shell. */
function wrapperInner(script: string, dropToShell = "exec /bin/bash --noprofile --norc -i"): { command: string; args: string[]; env: Record<string, string> } {
  const wrapper = LOCAL_WRAPPER.replace("exec /bin/bash -l", dropToShell);
  return {
    command: "/bin/bash",
    args: ["--noprofile", "--norc", "-c", wrapper,
      "[h2a] resume in this shell: test-resume   (or Ctrl-D to end this session)",
      "h2a-fixture", process.execPath, "-e", script],
    env: { H2A_NATIVE_TERMINAL: "1" },
  };
}
/**
 * Byte-exact post-CLI reader: `cat` echoes every received byte raw, so a
 * leaked reply is observable as itself (a cooked shell would caret-notate or
 * swallow it in readline). Human bytes must still cross verbatim and ordered.
 */
function catInner(script: string): { command: string; args: string[]; env: Record<string, string> } {
  return wrapperInner(script, "exec /bin/cat");
}

describe.skipIf(process.platform !== "linux")("lot L4-replies RED: replies never reach the shell", () => {
  it("should leave the shell input line empty when a TUI emits startup queries and exits at once", async () => {
    const f = await fixture(4096, wrapperInner(
      `process.stdout.write(${JSON.stringify(TUI_QUERIES)});setTimeout(() => process.exit(0), 100);`,
    ));
    const outer = f.attach();
    await until(() => outer.output().includes("[h2a] resume in this shell:"));
    outer.pin();
    // The outer VTE answers AFTER the CLI is gone (delayed past the exit).
    await new Promise((resolve) => setTimeout(resolve, 300));
    outer.terminal.write(`${E}[?1;2c${E}[?2026;1$y${E}[?1016;1$y${E}P>|XTerm(382)${E}\\`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    // The shell line buffer must be intact: the human command runs cleanly.
    outer.terminal.write("echo shell-check-done\r");
    await until(() => outer.output().includes("shell-check-done"));
    const output = outer.output();
    expect(output).toContain("shell-check-done");
    // Zero reply bytes reached the shell input line.
    expect(output).not.toContain(`${E}[?1;2c`);
    expect(output).not.toContain(`${E}[?2026;1$y`);
    expect(output).not.toContain("XTerm(382)");
    outer.terminal.write("\x1c");
    await until(outer.ended);
  }, 30_000);

  it("should consume split late replies after CLI exit without changing the shell input", async () => {
    const f = await fixture(4096, catInner(
      `process.stdout.write(${JSON.stringify(TUI_QUERIES)});setTimeout(() => process.exit(0), 100);`,
    ));
    const outer = f.attach();
    await until(() => outer.output().includes("[h2a] resume in this shell:"));
    outer.pin();
    await new Promise((resolve) => setTimeout(resolve, 300));
    // One reply split across two stdin chunks (chunk-safe parser), then
    // human bytes: the human bytes cross verbatim, the reply never does.
    outer.terminal.write(`${E}[?1;`);
    await new Promise((resolve) => setTimeout(resolve, 120));
    outer.terminal.write(`2c`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    outer.terminal.write(`HUMAN-SPLIT-1\r`);
    await until(() => outer.output().includes("HUMAN-SPLIT-1"));
    const output = outer.output();
    expect(output).toContain("HUMAN-SPLIT-1");
    expect(output).not.toContain(`${E}[?1;2c`);
    outer.terminal.write("\x1c");
    await until(outer.ended);
  }, 30_000);

  it("should still forward human input typed during the drain window, in order", async () => {
    const f = await fixture(4096, catInner(
      `process.stdout.write(${JSON.stringify(TUI_QUERIES)});setTimeout(() => process.exit(0), 100);`,
    ));
    const outer = f.attach();
    await until(() => outer.output().includes("[h2a] resume in this shell:"));
    outer.pin();
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Reply bytes interleaved with human typing: human bytes cross verbatim
    // and ordered around the swallowed replies.
    outer.terminal.write(`${E}[?1;2cHUMAN-ORDER-1\r`);
    await until(() => outer.output().includes("HUMAN-ORDER-1"));
    outer.terminal.write(`HUMAN-ORDER-2${E}[24;80R\r`);
    await until(() => outer.output().includes("HUMAN-ORDER-2"));
    const output = outer.output();
    expect(output).toContain("HUMAN-ORDER-1");
    expect(output).toContain("HUMAN-ORDER-2");
    expect(output.indexOf("HUMAN-ORDER-1")).toBeLessThan(output.indexOf("HUMAN-ORDER-2"));
    expect(output).not.toContain(`${E}[?1;2c`);
    expect(output).not.toContain(`${E}[24;80R`);
    outer.terminal.write("\x1c");
    await until(outer.ended);
  }, 30_000);

  it("should swallow the outer CPR answer to a host-intercepted cursor query", async () => {
    const f = await fixture(4096, catInner(
      `process.stdout.write("tui asks cursor " + ${JSON.stringify(`${E}[6n`)});setTimeout(() => process.exit(0), 100);`,
    ));
    const outer = f.attach();
    await until(() => outer.output().includes("[h2a] resume in this shell:"));
    outer.pin();
    await new Promise((resolve) => setTimeout(resolve, 300));
    // The host already answered the 6n itself; the outer duplicate is swallowed.
    outer.terminal.write(`${E}[24;80R`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    outer.terminal.write("HUMAN-CPR-1\r");
    await until(() => outer.output().includes("HUMAN-CPR-1"));
    const output = outer.output();
    expect(output).toContain("HUMAN-CPR-1");
    expect(output).not.toContain(`${E}[24;80R`);
    outer.terminal.write("\x1c");
    await until(outer.ended);
  }, 30_000);

  it("should preserve live TUI replies and bracketed human paste", async () => {
    const f = await fixture(4096, {
      command: process.execPath,
      args: ["-e", `process.stdin.setRawMode(true); process.stdin.resume();
        process.stdout.write(${JSON.stringify(`${E}[c`)});
        process.stdin.on('data', (b) => {
          const s = String(b);
          if (s.includes('[?1;2c')) process.stdout.write('GOT-DA-REPLY\\n');
          if (s.includes('200~')) process.stdout.write('GOT-PASTE:' + JSON.stringify(s) + '\\n');
          if (s.includes('q')) process.exit(0);
        });`],
    });
    const outer = f.attach();
    await until(() => outer.output().includes(`${E}[c`));
    outer.pin();
    // Live query answered while the asker is alive: applied, TUI proceeds.
    await new Promise((resolve) => setTimeout(resolve, 200));
    outer.terminal.write(`${E}[?1;2c`);
    await until(() => outer.output().includes("GOT-DA-REPLY"));
    // Bracketed paste crosses verbatim, reply bytes inside stay paste, not replies.
    outer.terminal.write(`${E}[200~${E}[?1;2c-paste${E}[201~`);
    await until(() => outer.output().includes("GOT-PASTE:"));
    expect(outer.output()).toContain(`GOT-PASTE:"\\u001b[200~\\u001b[?1;2c-paste\\u001b[201~"`);
    outer.terminal.write("q");
    await until(outer.ended);
  }, 30_000);

  it("should not reissue XTVersion, DA or DECRQM queries from replay", async () => {
    const f = await fixture(128, {
      command: process.execPath,
      args: ["-e", `process.stdin.setRawMode(true); process.stdin.resume();
        process.stdout.write(${JSON.stringify(TUI_QUERIES + "ready")});
        process.stdin.on('data', (b) => {
          const s = String(b);
          // Filler FIRST (one append under the 128-byte buffer so it is
          // retained, not self-evicted), then the queries, so the retained
          // tail after eviction carries queries into the gap repaint.
          if (s.includes('t')) { process.stdout.write('z'.repeat(100)); setTimeout(() => process.stdout.write(${JSON.stringify(TUI_QUERIES)}), 30); }
          if (s.includes('x')) process.exit(0);
        });`],
    });
    const first = f.attach();
    await until(() => first.output().includes("ready"));
    first.pin();
    first.terminal.write("\x1c");
    await until(first.ended);
    // Print filler THEN the queries so the retained tail after eviction
    // carries queries into the gap repaint.
    const lease = await f.client.acquireController(f.id, "test-tail");
    await f.client.write(lease, "t");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await f.client.releaseController(lease);
    const second = f.attach();
    await until(() => (second.output().match(/z/g) ?? []).length > 80);
    second.pin();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const repaint = second.output();
    expect(repaint).toContain("z".repeat(50));
    expect(repaint).not.toContain(`${E}[c`);
    expect(repaint).not.toContain(`${E}[>q`);
    expect(repaint).not.toContain(`${E}[?2026$p`);
    expect(repaint).not.toContain(`${E}[?1016$p`);
    second.terminal.write("x");
    await until(second.ended);
  }, 30_000);
});
