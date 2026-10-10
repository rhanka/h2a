// @ts-ignore Shared JS test isolation helper.
import { isolatedNativeTestEnvironment, spawnIsolatedNative as spawn, spawnSyncIsolatedNative as spawnSync, setupNativeTestEnvironment } from "../../../h2a/test/helpers/native-isolation.js";
setupNativeTestEnvironment(afterAll);
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type * as NodePty from "node-pty";
import { NativeTerminalHostSupervisor } from "./supervisor.js";
import { TerminalModeTracker } from "./terminal-modes.js";
import { LOCAL_WRAPPER } from "../tmux.js";

const pty: typeof NodePty = createRequire(import.meta.url)("node-pty");
const loader = fileURLToPath(import.meta.resolve("tsx"));
const E = "\x1b";
const ENABLE = `${E}[?1004;2004;1049;1000;1006h${E}[?25l${E}[>1u`;
const RESET = `${E}[<1u${E}[?1000l${E}[?1004l${E}[?1006l${E}[?2004l${E}[?1049l${E}[?25h`;
const children = new Set<ChildProcess>();
const terminals = new Set<NodePty.IPty>();
const directories = new Set<string>();
const supervisors = new Set<NativeTerminalHostSupervisor>();
const tmuxSockets = new Set<string>();

afterEach(async () => {
  for (const terminal of terminals) terminal.kill("SIGKILL");
  terminals.clear();
  for (const socket of tmuxSockets) spawnSync("tmux", ["-S", socket, "kill-server"], { stdio: "ignore" });
  tmuxSockets.clear();
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
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

async function until(accept: () => boolean): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (!accept()) {
    if (Date.now() > deadline) throw new Error("isolated terminal did not reach the expected state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fixture(replayBytes = 4096, command?: { command: string; args: string[] }) {
  const directory = await mkdtemp(join(tmpdir(), "m-"));
  directories.add(directory);
  const socketPath = join(directory, "host.sock");
  const env = { ...process.env, REMOTE_CLI_CONFIG_HOME: join(directory, "config"), H2A_NATIVE_SOCKET: socketPath };
  let host!: ChildProcess;
  const supervisor = new NativeTerminalHostSupervisor({
    socketPath,
    registryPath: join(directory, "registry.json"),
    replayBytesPerSession: replayBytes,
    generationFactory: () => "terminal-modes-test",
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
  const id = "mode-fixture";
  await client.create({
    id, command: command?.command ?? process.execPath,
    args: command?.args ?? ["-e", `process.stdin.setRawMode(true); process.stdin.resume();
      process.stdout.write(${JSON.stringify(ENABLE)} + 'ready');
      process.stdin.on('data', b => {
        if (b.includes(120)) process.exit(0);
        if (b.includes(99)) throw new Error('isolated inner crash');
        if (b.includes(116)) {
          process.stdout.write('z'.repeat(256));
          setTimeout(() => process.stdout.write('tail-ready'), 30);
        }
      });`],
    cwd: directory, env: env as Record<string, string>, cols: 80, rows: 24,
  });
  const fault = join(directory, "attach-fault.mjs");
  await writeFile(fault, `const write = process.stdout.write.bind(process.stdout);
    let armed = true;
    process.stdout.write = (chunk, ...args) => {
      if (armed && String(chunk).includes('ready')) {
        armed = false;
        setImmediate(() => { throw new Error('isolated attach crash'); });
      }
      return write(chunk, ...args);
    };`);
  const attach = (protectedByParent = false, crash = false) => {
    const attachArgs = ["--import", loader,
      ...(crash ? ["--import", fault] : []),
      fileURLToPath(new URL("./op.ts", import.meta.url)),
      "attach", "--id", id, "--socket", socketPath,
    ];
    const recovery = new URL("./attach-recovery.ts", import.meta.url).href;
    const args = protectedByParent ? ["--import", loader, "--input-type=module", "-e",
      `import { spawnSync } from 'node:child_process';
       import { withAttachTerminalRecovery } from ${JSON.stringify(recovery)};
       const ttyState = () => spawnSync('stty', ['-g'], { stdio: ['inherit', 'pipe', 'inherit'] }).stdout.toString();
       const before = ttyState();
       const result = withAttachTerminalRecovery(env => spawnSync(process.execPath,
         ${JSON.stringify(attachArgs)}, { env, stdio: 'inherit' }));
       if (ttyState() !== before) throw new Error('outer termios was not restored');
       process.exitCode = result.status ?? 1;`,
    ] : attachArgs;
    isolatedNativeTestEnvironment(env);
    const terminal = pty.spawn(process.execPath, args,
      { cwd: directory, env: env as Record<string, string>, name: "xterm-256color", cols: 80, rows: 24 });
    terminals.add(terminal);
    let output = "";
    let ended = false;
    terminal.onData((data) => { output += data; });
    terminal.onExit(() => { ended = true; terminals.delete(terminal); });
    return { terminal, output: () => output, ended: () => ended };
  };
  return { host, client, id, attach };
}

function clean(output: string): void {
  expect(output.endsWith(RESET), JSON.stringify(output)).toBe(true);
  const tracker = new TerminalModeTracker();
  tracker.feed(output);
  expect(tracker.resetSequence()).toBe("");
}

describe.skipIf(process.platform !== "linux")("native attach terminal modes on real isolated PTYs", () => {
  it.each(["inner exit", "inner crash", "host death", "SIGTERM", "SIGHUP", "SIGINT", "SIGQUIT"])(
    "should restore exactly the outstanding modes after %s", async (ending) => {
      const f = await fixture();
      const outer = f.attach();
      await until(() => outer.output().includes("ready"));
      if (ending === "inner exit") outer.terminal.write("x");
      else if (ending === "inner crash") outer.terminal.write("c");
      else if (ending === "host death") f.host.kill("SIGKILL");
      else outer.terminal.kill(ending);
      await until(outer.ended);
      clean(outer.output());
    }, 10_000,
  );

  it("should clean detach and re-establish inner modes even after replay eviction", async () => {
    const f = await fixture(128);
    const first = f.attach();
    await until(() => first.output().includes("ready"));
    first.terminal.write("t");
    await until(() => first.output().includes("tail-ready"));
    first.terminal.write("\x1c");
    await until(first.ended);
    clean(first.output());
    // Evict the original enabling sequences but keep a fresh printable tail.
    const lease = await f.client.acquireController(f.id, "test-tail");
    await f.client.write(lease, "t");
    await f.client.releaseController(lease);
    const second = f.attach();
    await until(() => second.output().includes("tail-ready"));
    const tracker = new TerminalModeTracker();
    tracker.feed(second.output());
    expect(tracker.resetSequence()).toBe(RESET);
    second.terminal.write("x");
    await until(second.ended);
    clean(second.output());
  }, 10_000);

  it("should reset the native wrapper before its shell prompt and between manual relaunches", async () => {
    // Keep the product wrapper, but replace login-shell startup in this fixture
    // so no owner profile/rc is read by the isolated PTY.
    const wrapper = LOCAL_WRAPPER.replace("exec /bin/bash -l", "exec /bin/bash --noprofile --norc -i");
    const f = await fixture(4096, {
      command: "/bin/bash",
      args: ["--noprofile", "--norc", "-c", wrapper, "relaunch-fixture", process.execPath,
        "-e", `process.stdout.write(${JSON.stringify(ENABLE)});`],
    });
    const outer = f.attach();
    await until(() => outer.output().includes("[h2a] relaunch:"));
    expect(outer.output()).toContain(`${RESET}\r`);
    expect(outer.output().indexOf(RESET)).toBeLessThan(outer.output().indexOf("[h2a]"));
    // The inherited prompt hook must also clean modes from the next command.
    outer.terminal.write("printf '\\033[?1004hmanual-incarnation-done';\r");
    await until(() => outer.output().includes("\x1b[?1004hmanual-incarnation-done"));
    await until(() => outer.output().includes("manual-incarnation-done\x1b[?1004l"));
    outer.terminal.write("exit\r");
    await until(outer.ended);
    const tracker = new TerminalModeTracker();
    tracker.feed(outer.output());
    expect(tracker.resetSequence()).toBe("");
  }, 10_000);

  it("should let a surviving launch parent restore the terminal after attach SIGKILL", async () => {
    const f = await fixture();
    const outer = f.attach(true);
    await until(() => outer.output().includes("ready"));
    const childPids = (await readFile(`/proc/${outer.terminal.pid}/task/${outer.terminal.pid}/children`, "utf8"))
      .trim().split(/\s+/).map(Number);
    expect(childPids).toHaveLength(1);
    const childPid = childPids[0]!;
    const argv = await readFile(`/proc/${childPid}/cmdline`, "utf8");
    expect(argv).toContain("/native-terminal/op.ts");
    process.kill(childPid, "SIGKILL");
    await until(outer.ended);
    clean(outer.output());
    expect((await f.client.state(f.id)).status).toBe("running");
  }, 10_000);

  it("should clean modes after an uncaught attach exception without suppressing the failure", async () => {
    const f = await fixture();
    const outer = f.attach(false, true);
    await until(outer.ended);
    expect(outer.output()).toContain("isolated attach crash");
    expect(outer.output()).toContain(RESET);
    const tracker = new TerminalModeTracker();
    tracker.feed(outer.output());
    expect(tracker.resetSequence()).toBe("");
    expect((await f.client.state(f.id)).status).toBe("running");
  }, 10_000);

  it.skipIf(spawnSync("tmux", ["-V"]).status !== 0)(
    "should leave the outer terminal clean when a private tmux client detaches", async () => {
      const directory = await mkdtemp(join(tmpdir(), "mt-"));
      directories.add(directory);
      const socket = join(directory, "tmux.sock");
      tmuxSockets.add(socket);
      const program = join(directory, "inner.mjs");
      await writeFile(program, `process.stdout.write(${JSON.stringify(ENABLE)} + 'tmux-mode-ready');
        setInterval(() => {}, 1000);`);
      const env = { ...process.env, TMUX: "", TERM: "xterm-256color" };
      const started = spawnSync("tmux", ["-S", socket, "-f", "/dev/null", "new-session", "-d", "-s", "modes",
        process.execPath, program], { env, encoding: "utf8" });
      expect(started.status, started.stderr).toBe(0);
      for (const option of ["mouse", "focus-events"]) {
        expect(spawnSync("tmux", ["-S", socket, "set-option", "-g", option, "on"], { env }).status).toBe(0);
      }
      isolatedNativeTestEnvironment(env);
      const terminal = pty.spawn("tmux", ["-S", socket, "attach-session", "-t", "modes"],
        { cwd: directory, env: env as Record<string, string>, name: "xterm-256color", cols: 80, rows: 24 });
      terminals.add(terminal);
      let output = "";
      let ended = false;
      terminal.onData((data) => { output += data; });
      terminal.onExit(() => { ended = true; terminals.delete(terminal); });
      await until(() => output.includes("tmux-mode-ready"));
      terminal.write("\x02d");
      await until(() => ended);
      expect(output).toContain("\x1b[?1049h");
      expect(output).toContain("\x1b[?2004h");
      expect(output).toContain("\x1b[?1000h");
      expect(output).toContain("\x1b[?1004l");
      const tracker = new TerminalModeTracker();
      tracker.feed(output);
      expect(tracker.resetSequence()).toBe("");
    }, 10_000,
  );
});
