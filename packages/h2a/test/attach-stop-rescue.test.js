import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// These tests must never discover the owner's host or configuration.
import {
  createPrivateTestDirectory, nativeTestEnvironment, installNativeTestEnvironment,
  spawnIsolatedNative as spawn, spawnSyncIsolatedNative as spawnSync, pinPrivateNativeProcess,
  stopPrivateNativeProcesses, waitForPrivateNativeProcesses,
} from "./helpers/native-isolation.js";
const { NativeTerminalClient } = await import("../../h2a-runtime/dist/native-terminal/client.js");
const runtime = join(import.meta.dirname, "../../h2a-runtime/dist");

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(read, accept, label) {
  const deadline = Date.now() + 3_000;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    assert.ok(Date.now() < deadline, `${label}: ${JSON.stringify(value)}`);
    await delay(20);
  }
}
function output(child) {
  child.text = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { child.text += data; });
  child.done = once(child, "exit");
  return child;
}
async function exited(child) {
  await eventually(() => ({ code: child.exitCode, signal: child.signalCode, text: child.text }),
    value => value.code !== null || value.signal !== null, "client must exit");
  return child.done;
}
async function fixture(t) {
  const root = createPrivateTestDirectory("rescue-");
  const env = nativeTestEnvironment(root, { TMUX: "", NO_COLOR: "1", H2A_NATIVE_HOST_LOG: join(root, "host.log") });
  const tmux = args => spawnSync("tmux", args, { env, encoding: "utf8", timeout: 2_000 });
  let tmuxStarted = false;
  const restore = installNativeTestEnvironment(env);
  let client;
  const pins = [];
  t.after(async () => {
    client?.close();
    try {
      try {
        if (tmuxStarted) {
          const stopped = tmux(["kill-server"]);
          assert.equal(stopped.status, 0, stopped.stderr);
        }
      } finally {
        await stopPrivateNativeProcesses(env);
        await waitForPrivateNativeProcesses(env);
      }
    } finally {
      for (const release of pins) release();
      restore();
      rmSync(root, { recursive: true, force: true });
    }
  });
  const launch = (entry, args) => output(spawn(process.execPath, [join(runtime, entry), ...args],
    { env, cwd: root, stdio: ["pipe", "pipe", "pipe"] }));
  // The CLI requires a known tmux inventory even for recorded native targets.
  // Give it a real private server, never the owner's default socket.
  const started = tmux(["-f", "/dev/null", "new-session", "-d", "-s", "inventory", "/bin/cat"]);
  assert.equal(started.status, 0, started.stderr);
  tmuxStarted = true;
  const tmuxPid = tmux(["display-message", "-p", "#{pid}"]);
  assert.equal(tmuxPid.status, 0, tmuxPid.stderr);
  pins.push(pinPrivateNativeProcess(Number(tmuxPid.stdout.trim()), env));
  mkdirSync(join(env.REMOTE_CLI_CONFIG_HOME, ".config/sentropic/h2a"), { recursive: true });
  const host = launch("native-terminal/process.js", ["--socket", env.H2A_NATIVE_SOCKET]);
  await eventually(() => host.text, text => text.includes("h2a.native-terminal.ready"), "native host readiness");
  client = await NativeTerminalClient.connect(env.H2A_NATIVE_SOCKET);
  const id = "h2a-rescue";
  const state = await client.create({ id, command: "/bin/cat", args: [], cwd: root, env,
    cols: 80, rows: 24 });
  pins.push(pinPrivateNativeProcess(state.pid, env));
  // The real CLI resolver uses the same durable row as run, alongside the host's PGID row.
  const { enrollFromRun } = await import("../../h2a-runtime/dist/registry.js");
  enrollFromRun({ profile: "codex", slug: "rescue", tmuxSession: id, hostKind: "local-native",
    cwd: root, sessionClass: "human", convId: "11111111-1111-4111-8111-111111111111" });
  const attach = (extra = []) => launch("native-terminal/op.js", ["attach", "--id", id, ...extra]);
  const cli = args => launch("index.js", args);
  const attached = async child => {
    await eventually(() => client.state(id), s => s.controlled, `attach pid=${child.pid} must control`);
  };
  const echo = async child => {
    child.stdin.write("rescue-echo\n");
    await eventually(() => child.text, text => text.includes("rescue-echo"), "attached input/output bridge");
  };
  const ttyAttach = () => {
    const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
    const command = [process.execPath, join(runtime, "native-terminal/op.js"), "attach", "--id", id].map(quote).join(" ");
    return output(spawn("script", ["-q", "-e", "-f", "-c", command, "/dev/null"],
      { env, cwd: root, stdio: ["pipe", "pipe", "pipe"] }));
  };
  return { root, env, client, id, attach, ttyAttach, cli, attached, echo, launch };
}

test("stop must kill a session controlled by a live attach and explain its detach", async t => {
  const f = await fixture(t);
  const first = f.attach();
  await f.attached(first);
  await f.echo(first);
  const stop = f.cli(["stop", "rescue", "--reason", "restart"]);
  const [code] = await exited(stop);
  assert.equal(code, 0, stop.text);
  assert.match(stop.text, /native session rescue killed/);
  assert.equal((await f.client.state(f.id)).status, "exited");
  const [attachCode, signal] = await exited(first);
  assert.equal(attachCode, 0, first.text);
  assert.equal(signal, null);
  assert.match(first.text, /session stopped|session was stopped/i);
});

test("second attach must identify the holder and offer explicit takeover", async t => {
  const f = await fixture(t);
  const first = f.attach();
  await f.attached(first);
  const second = f.attach();
  const [code] = await exited(second);
  assert.equal(code, 1, second.text);
  assert.match(second.text, new RegExp(`pid=${first.pid}\\b`));
  assert.match(second.text, /tty=\S+/);
  assert.match(second.text, /since=\d{4}-\d\d-\d\dT/);
  assert.match(second.text, /--takeover/);
  await f.echo(first);
});

test("native stop alias must work without an input lease or explicit incarnation flags", async t => {
  const f = await fixture(t);
  const first = f.attach();
  await f.attached(first);
  const stop = f.launch("native-terminal/op.js", ["stop", "--id", f.id]);
  assert.equal((await exited(stop))[0], 0, stop.text);
  assert.equal((await f.client.state(f.id)).status, "exited");
  assert.equal((await exited(first))[0], 0, first.text);
});

test("takeover must identify a real terminal and detach its attach process cleanly", async t => {
  const f = await fixture(t);
  const first = f.ttyAttach();
  await f.attached(first);
  const holder = (await f.client.state(f.id)).controller;
  assert.ok(Number.isSafeInteger(holder?.pid) && holder.pid > 0);
  assert.match(holder.tty, /^\/dev\/pts\/\d+$/);
  assert.ok(Number.isFinite(Date.parse(holder.since)));
  const refused = f.attach();
  assert.equal((await exited(refused))[0], 1, refused.text);
  assert.ok(refused.text.includes(`pid=${holder.pid} tty=${holder.tty} since=${holder.since}`), refused.text);
  const second = f.attach(["--takeover"]);
  assert.equal((await exited(first))[0], 0, first.text);
  await f.echo(second);
});

test("attach --takeover must detach the old client cleanly and retain exclusive input", async t => {
  const f = await fixture(t);
  const first = f.attach();
  await f.attached(first);
  // Exercise the public option through the real CLI and its synchronous adapter.
  const second = f.cli(["attach", "rescue", "--takeover"]);
  const [code, signal] = await exited(first);
  assert.equal(code, 0, first.text);
  assert.equal(signal, null);
  assert.match(first.text, /taken over.*pid=|takeover.*pid=/i);
  assert.equal(second.exitCode, null, second.text);
  await f.echo(second);
  const third = f.attach();
  assert.equal((await exited(third))[0], 1, third.text);
  assert.match(third.text, /already has a controller/);
});

test("SIGKILL of a controller must automatically release it for the next attach", async t => {
  const f = await fixture(t);
  const first = f.attach();
  await f.attached(first);
  first.kill("SIGKILL");
  assert.equal((await exited(first))[1], "SIGKILL");
  const second = f.attach();
  await f.attached(second);
  await f.echo(second);
});

test("run resume collision hints must include a working takeover command", async t => {
  const f = await fixture(t);
  const first = f.attach();
  await f.attached(first);
  const run = f.cli(["run", "codex", "-r", "rescue", "--name", "rescue"]);
  assert.equal((await exited(run))[0], 1, run.text);
  assert.match(run.text, /already exists/);
  assert.match(run.text, /h2a attach rescue --takeover/);
  assert.match(run.text, /h2a stop rescue --reason restart/);
});

test("native kill failures must retain the actual host diagnostic", async t => {
  const f = await fixture(t);
  const failure = f.launch("native-terminal/op.js", ["kill", "--id", "h2a-missing"]);
  assert.equal((await exited(failure))[0], 1);
  assert.match(failure.text, /missing/);
  const adapter = output(spawn(process.execPath, ["--input-type=module", "-e",
    `import { killNativeSession } from ${JSON.stringify(join(runtime, "native-host.js"))};
     process.exitCode = killNativeSession('h2a-missing') ? 42 : 1;`],
    { env: f.env, cwd: f.root, stdio: ["pipe", "pipe", "pipe"] }));
  assert.equal((await exited(adapter))[0], 1, adapter.text);
  assert.match(adapter.text, /native host operation kill failed:.*missing/);
});

test("stale stop fences and old controller cleanup must not affect the live holder", async t => {
  const f = await fixture(t);
  const first = f.attach();
  await f.attached(first);
  const state = await f.client.state(f.id);
  await assert.rejects(f.client.stopIfIncarnation(f.id, "stale-generation", state.incarnation), /stale terminal host generation/);
  await assert.rejects(f.client.stopIfIncarnation(f.id, state.generation, "stale-incarnation"), /stale terminal session incarnation/);
  assert.equal((await f.client.state(f.id)).status, "running");
  await f.echo(first);

  const other = await NativeTerminalClient.connect(f.env.H2A_NATIVE_SOCKET);
  t.after(() => other.close());
  const lease = await other.acquireController(f.id, "explicit-takeover", "human", { takeover: true, pid: process.pid, tty: "test-controller" });
  assert.equal((await exited(first))[0], 0, first.text);
  // Closing the old connection must not release the new epoch's controller.
  const holder = await f.client.state(f.id);
  assert.equal(holder.controlled, true);
  assert.equal(holder.controllerEpoch, lease.epoch);
  await other.write(lease, "new-controller\n");
  await assert.rejects(f.client.acquireController(f.id, "uninvited"), /already has a controller/);
});
