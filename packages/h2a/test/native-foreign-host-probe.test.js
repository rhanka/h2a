import {
  createPrivateTestDirectory, nativeTestEnvironment, spawnIsolatedNative,
  pinPrivateNativeProcess, stopPrivateNativeProcesses, waitForPrivateNativeProcesses,
} from "./helpers/native-isolation.js";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { NativeTerminalClient } from "../../h2a-runtime/dist/native-terminal/client.js";

const terminal = resolve(import.meta.dirname, "../../h2a-runtime/dist/native-terminal");
const cli = resolve(import.meta.dirname, "../dist/bin.js");

async function fixture(context, body) {
  assert.equal(process.platform, "linux", "real procfs qualification requires Linux; never skip");
  const root = createPrivateTestDirectory("f");
  const env = { ...nativeTestEnvironment(root), H2A_NATIVE_SOCKET: "" };
  // Only the unrelated tmux inventory is stubbed: the public CLI must see
  // known absence without consulting any owner tmux server. Native hosts,
  // sessions, procfs, attach and stop all execute the real product code.
  const bin = join(root, "bin");
  mkdirSync(bin, { mode: 0o700 });
  writeFileSync(join(bin, "tmux"), "#!/bin/sh\nif [ \"$1\" = -V ]; then echo 'tmux 3.4'; exit 0; fi\necho 'no server running' >&2\nexit 1\n", { mode: 0o700 });
  env.PATH = `${bin}:/usr/bin:/bin`;
  const paths = [join(root, "h2a-nt/native-terminal.sock"), join(root, "h2a-nt/native-terminal.lf1.sock")];
  const clients = [];
  const processes = [];
  let cleanupPromise;
  function start(args, input = "ignore", timeout = 10_000) {
    context.signal.throwIfAborted();
    assert.equal(cleanupPromise, undefined, "cannot spawn after fixture teardown");
    const child = spawnIsolatedNative(process.execPath, args, {
      env, cwd: root, stdio: [input, "pipe", "pipe"], timeout, killSignal: "SIGKILL",
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    let spawnError;
    child.once("error", error => { spawnError = error.message; });
    const closed = new Promise(resolve => {
      child.once("close", (status, signal) => resolve({ status, signal, stdout, stderr,
        ...(spawnError ? { error: spawnError } : {}) }));
    });
    const launched = { child, closed, output: () => ({ stdout, stderr }) };
    processes.push(launched);
    return launched;
  }
  async function host(socketPath = paths[0]) {
    const process = start([join(terminal, "process.js"), "--socket", socketPath,
      "--registry-path", join(env.XDG_CONFIG_HOME, "registry.json")], "ignore", 30_000);
    await Promise.race([process.closed, new Promise(resolve => {
      process.child.stdout.on("data", () => {
        if (process.output().stdout.includes("h2a.native-terminal.ready")) resolve();
      });
    })]);
    assert.match(process.output().stdout, /h2a.native-terminal.ready/, JSON.stringify(process.output()));
    const client = await NativeTerminalClient.connect(socketPath);
    clients.push(client);
    assert.equal((await client.ping()).hostPid, process.child.pid);
    return { ...process, client, socketPath };
  }
  async function op(args) {
    return start([join(terminal, "op.js"), ...args]).closed;
  }
  async function session(host, id) {
    return host.client.create({ id, command: "/bin/bash",
      args: ["--noprofile", "--norc", "-c", "printf 'foreign-probe-ready\\n'; while IFS= read -r line; do printf '%s\\n' \"$line\"; done"],
      cwd: root, env, cols: 80, rows: 24 });
  }
  async function deletedForeignHost() {
    const directory = join(root, "foreign");
    const foreign = await host(join(directory, "native-terminal.sock"));
    rmSync(directory, { recursive: true });
    assert.equal(existsSync(directory), false);
    assert.equal((await foreign.client.ping()).hostPid, foreign.child.pid,
      "the foreign listener must still be alive after its directory is deleted");
    return foreign;
  }
  function cleanup() {
    return cleanupPromise ??= (async () => {
      for (const client of clients) client.close();
      // Own ChildProcess handles and pinned descendants only, including journals
      // and PTYs. This is bounded and awaits exit even after a failed assertion.
      const pins = [];
      const errors = [];
      try {
        for (const { child } of processes) {
          if (child.exitCode !== null || child.signalCode !== null) continue;
          try { pins.push(pinPrivateNativeProcess(child.pid, { ...env, H2A_NATIVE_SOCKET: paths[0] })); }
          catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) errors.push(error); }
        }
        await Promise.all(processes.map(async ({ child, closed }) => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGCONT");
            child.kill("SIGTERM");
          }
          const escalation = setTimeout(() => child.kill("SIGKILL"), 1_000);
          try { await closed; } finally { clearTimeout(escalation); }
        }));
        await stopPrivateNativeProcesses(env);
        await waitForPrivateNativeProcesses(env);
        assert.deepEqual(errors, [], "all owned process trees must be pinned before teardown");
      } finally {
        for (const release of pins.reverse()) release();
        rmSync(root, { recursive: true, force: true });
      }
      context.diagnostic("owned hosts, operations, journals and PTYs stopped and reaped");
    })();
  }
  // Node runs this hook even when it cancels the body on a test timeout.
  context.after(cleanup);
  try { await body({ root, env, paths, host, session, op, start, deletedForeignHost }); }
  finally { await cleanup(); }
}

test("should prove the target absent beside a foreign host with a deleted socket directory", { timeout: 12_000 }, context =>
  fixture(context, async f => {
    await f.deletedForeignHost();
    const result = await f.op(["probe", "--socket", f.paths[1], "--id", "h2a-absent"]);
    assert.equal(result.status, 0, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).verdict, "dead", JSON.stringify(result));
  }));

test("should find a real live session on the target", { timeout: 12_000 }, context =>
  fixture(context, async f => {
    const host = await f.host();
    await f.session(host, "h2a-live");
    const result = await f.op(["probe", "--socket", f.paths[0], "--id", "h2a-live"]);
    assert.equal(result.status, 0, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).verdict, "live", JSON.stringify(result));
  }));

test("should refuse absence when the target host lost its alias, socket and owner sidecar", { timeout: 12_000 }, context =>
  fixture(context, async f => {
    const real = join(f.root, "real"), alias = join(f.root, "alias");
    mkdirSync(join(real, "h2a-nt"), { recursive: true, mode: 0o700 });
    symlinkSync(real, alias);
    const host = await f.host(join(alias, "h2a-nt/native-terminal.sock"));
    const target = join(real, "h2a-nt/native-terminal.sock");
    unlinkSync(`${target}.owner`);
    unlinkSync(target);
    unlinkSync(alias);
    assert.equal((await host.client.ping()).hostPid, host.child.pid);
    const result = await f.op(["probe", "--socket", target, "--id", "h2a-alias"]);
    assert.equal(result.status, 0, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).verdict, "unknown", JSON.stringify(result));
    assert.equal(existsSync(target), false, "the probe must never republish a live endpoint");
  }));

for (const index of [0, 1]) test(`should attach and kill a real session on endpoint ${index} beside a deleted foreign host`,
  { timeout: 30_000 }, context => fixture(context, async f => {
    const host = await f.host(f.paths[index]);
    const id = `h2a-foreign-${index}`;
    await f.session(host, id);
    await f.deletedForeignHost();
    const slug = `foreign-${index}`;
    const attach = f.start([cli, "attach", slug, "--local"], "pipe");
    // Public CLI discovery performs several bounded absence proofs. Wait for
    // actual replay (or process exit), rather than timing that preflight with
    // a shorter polling budget. The operation's own timeout still kills it.
    await Promise.race([attach.closed, new Promise(resolve => {
      attach.child.stdout.on("data", () => {
        if (attach.output().stdout.includes("foreign-probe-ready")) resolve();
      });
    })]);
    if (attach.child.exitCode === null) attach.child.stdin.end(Buffer.from([0x1c]));
    const attached = await attach.closed;
    // Exercise kill even when attach failed: the red run must prove BOTH
    // product operations refuse the owner because of the unrelated host.
    const killed = await f.start([cli, "stop", slug]).closed;
    context.diagnostic(JSON.stringify({ attached, killed }));
    assert.deepEqual([attached.status, killed.status], [0, 0], JSON.stringify({ attached, killed }));
    assert.match(attached.stdout, /foreign-probe-ready/);
    assert.equal((await host.client.state(id)).status, "exited");
  }));
