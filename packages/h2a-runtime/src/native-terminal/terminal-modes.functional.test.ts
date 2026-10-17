// @ts-ignore Shared JS test isolation helper.
import { isolatedNativeTestEnvironment, nativeQualificationRoot, pinPrivateNativeProcess, spawnIsolatedNative as spawn, spawnSyncIsolatedNative as spawnSync, setupNativeTestEnvironment, waitForPrivateNativeProcesses } from "../../../h2a/test/helpers/native-isolation.js";
setupNativeTestEnvironment(afterAll);
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readlink, readdir, rm, writeFile } from "node:fs/promises";
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
const processPins = new Set<() => void>();

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
  await waitForPrivateNativeProcesses(process.env);
  for (const release of processPins) release();
  processPins.clear();
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

async function allTasksStopped(pid: number, deadline: number): Promise<void> {
  // node-pty waits in a native worker thread. A stopped leader alone does not
  // prove that the waitpid thread has reached the group stop.
  const taskRoot = `/proc/${pid}/task`;
  for (;;) {
    const tasks = await readdir(taskRoot);
    expect(tasks.length).toBeGreaterThan(0);
    const stats = await Promise.all(tasks.map(tid => readFile(join(taskRoot, tid, "stat"), "utf8")));
    const confirmed = await readdir(taskRoot);
    if (stats.every(stat => /\) [Tt] /.test(stat))) {
      if (tasks.sort().join(",") === confirmed.sort().join(",")) return;
    }
    expect(Date.now()).toBeLessThan(deadline);
    await new Promise(resolve => setTimeout(resolve, 10));
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
  // A distinct file forces a real late preload even when tsx canonicalizes
  // module query strings. Preserve the original qualification boundary.
  const latePreload = join(directory, "late-native-isolation.mjs");
  await writeFile(latePreload, (await readFile(new URL("../../../h2a/test/helpers/native-isolation.js", import.meta.url), "utf8"))
    .replace('resolve(import.meta.dirname, "../../../../.q")', JSON.stringify(nativeQualificationRoot))
    .replaceAll('../../src/runtime/handover/', new URL('../../../h2a/src/runtime/handover/', import.meta.url).href));
  const created = await client.create({
    id, command: command?.command ?? process.execPath,
    args: command?.args ?? ["-e", `process.stdin.setRawMode(true); process.stdin.resume();
      process.stdout.write(${JSON.stringify(ENABLE)} + 'ready inner-node-' + process.pid);
      process.stdin.on('data', b => {
        if (b.includes(112)) import(${JSON.stringify(latePreload)})
          .then(() => process.stdout.write('late-pin-installed:' + JSON.stringify({pid:process.pid,root:process.env.H2A_TEST_OWNED_PROC_ROOT})));
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
  const crashTrigger = join(directory, "attach-crash");
  await writeFile(fault, `import { watch } from 'node:fs';
    const write = process.stdout.write.bind(process.stdout);
    let armed = true;
    process.stdout.write = (chunk, ...args) => {
      if (armed && String(chunk).includes('ready')) {
        armed = false;
        const trigger = watch(${JSON.stringify(directory)}, (_event, file) => {
          if (file !== 'attach-crash') return;
          trigger.close();
          setImmediate(() => { throw new Error('isolated attach crash'); });
        });
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
    return { terminal, output: () => output, ended: () => ended,
      pin: () => {
        // Both PTYs need a descriptor held by the surviving test process.
        processPins.add(pinPrivateNativeProcess(created.pid, env));
        processPins.add(pinPrivateNativeProcess(terminal.pid, env));
      } };
  };
  return { host, client, id, attach, crashTrigger, innerPid: created.pid, procRoot: env.H2A_TEST_OWNED_PROC_ROOT!,
    pinChild: (pid: number) => { processPins.add(pinPrivateNativeProcess(pid, env)); } };
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
      outer.pin();
      if (ending === "inner exit") outer.terminal.write("x");
      else if (ending === "inner crash") outer.terminal.write("c");
      else if (ending === "host death") f.host.kill("SIGKILL");
      else outer.terminal.kill(ending);
      await until(outer.ended);
      clean(outer.output());
    }, 10_000,
  );

  it("should inspect a killed inner PTY while its stopped host cannot reap it", async () => {
    const f = await fixture();
    const outer = f.attach();
    await until(() => outer.output().includes("ready"));
    outer.pin();
    f.host.kill("SIGSTOP");
    try {
      const deadline = Date.now() + 4_000;
      await allTasksStopped(f.host.pid!, deadline);
      process.kill(f.innerPid, "SIGKILL");
      let stat = "";
      while (!/\) [ZX] /.test(stat)) {
        stat = await readFile(join(f.procRoot, String(f.innerPid), "stat"), "utf8");
        expect(Date.now()).toBeLessThan(deadline);
        if (!/\) [ZX] /.test(stat)) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(stat).toMatch(/\) [ZX] /);
    } finally {
      f.host.kill("SIGCONT");
    }
  }, 10_000);

  it("should retain the parent pin after a late preload and prove the unreaped inner child dead", async () => {
    const f = await fixture();
    const outer = f.attach();
    await until(() => outer.output().includes("ready"));
    outer.pin();
    const nodePid = Number(/inner-node-(\d+)/.exec(outer.output())![1]);
    const ownedChildren = (await readFile(`/proc/${f.innerPid}/task/${f.innerPid}/children`, "utf8"))
      .trim().split(/\s+/).map(Number);
    expect(ownedChildren).toContain(nodePid);
    const entry = join(f.procRoot, String(nodePid));
    outer.terminal.write("p");
    await until(() => outer.output().includes("late-pin-installed"));
    const parentPin = await readlink(entry);
    f.host.kill("SIGSTOP");
    process.kill(f.innerPid, "SIGSTOP");
    try {
      const deadline = Date.now() + 4_000;
      await allTasksStopped(f.host.pid!, deadline);
      await allTasksStopped(f.innerPid, deadline);
      process.kill(nodePid, "SIGKILL");
      let stat = "";
      while (!/\) [ZX] /.test(stat)) {
        stat = await readFile(join(entry, "stat"), "utf8");
        expect(Date.now()).toBeLessThan(deadline);
        if (!/\) [ZX] /.test(stat)) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(stat).toMatch(/\) [ZX] /);
      expect(parentPin.startsWith(`/proc/${process.pid}/fd/`)).toBe(true);
    } finally {
      process.kill(f.innerPid, "SIGCONT");
      f.host.kill("SIGCONT");
    }
  }, 10_000);

  it("should clean detach and re-establish inner modes even after replay eviction", async () => {
    const f = await fixture(128);
    const first = f.attach();
    await until(() => first.output().includes("ready"));
    first.pin();
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
    second.pin();
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
    outer.pin();
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
    outer.pin();
    const childPids = (await readFile(`/proc/${outer.terminal.pid}/task/${outer.terminal.pid}/children`, "utf8"))
      .trim().split(/\s+/).map(Number);
    expect(childPids).toHaveLength(1);
    const childPid = childPids[0]!;
    const argv = await readFile(`/proc/${childPid}/cmdline`, "utf8");
    expect(argv).toContain("/native-terminal/op.ts");
    f.pinChild(childPid);
    process.kill(childPid, "SIGKILL");
    await until(outer.ended);
    clean(outer.output());
    expect((await f.client.state(f.id)).status).toBe("running");
  }, 10_000);

  it("should clean modes after an uncaught attach exception without suppressing the failure", async () => {
    const f = await fixture();
    const outer = f.attach(false, true);
    await until(() => outer.output().includes("ready"));
    outer.pin();
    await writeFile(f.crashTrigger, "crash");
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
      const pane = spawnSync("tmux", ["-S", socket, "display-message", "-p", "-t", "modes", "#{pane_pid}"],
        { env, encoding: "utf8" });
      expect(pane.status, pane.stderr).toBe(0);
      expect(pane.stdout.trim()).toMatch(/^[1-9]\d*$/);
      processPins.add(pinPrivateNativeProcess(Number(pane.stdout.trim()), env));
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
