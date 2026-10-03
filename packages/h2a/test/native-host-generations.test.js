import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { NativeTerminalClient } from "../../h2a-runtime/dist/native-terminal/client.js";
import { defaultNativeTerminalSocketPath } from "../../h2a-runtime/dist/native-terminal/socket-path.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtime = join(repo, "packages/h2a-runtime/dist/native-host.js");
const legacyDir = process.env.H2A_TEST_LEGACY_HOST_DIR;
const legacyEntry = legacyDir && join(legacyDir, "packages/h2a-runtime/dist/native-terminal/process.js");
const unavailable = process.platform !== "linux" ? "historical native PTY qualification requires Linux"
  : !legacyEntry || !existsSync(legacyEntry) ? "legacy build unavailable: set H2A_TEST_LEGACY_HOST_DIR to a build of 89bbd9af^ (spec §8/L0)" : false;
const required = process.env.H2A_TEST_REQUIRE_LEGACY_HOST === "1";

// Resolve existing ancestors too, so a symlink cannot smuggle an owner path
// through an apparently private socket/config/registry/workspace directory.
function resolvedPath(path) {
  let ancestor = resolve(path);
  const suffix = [];
  while (!existsSync(ancestor)) {
    suffix.unshift(ancestor.slice(dirname(ancestor).length + 1));
    ancestor = dirname(ancestor);
  }
  return join(realpathSync(ancestor), ...suffix);
}

function assertPrivatePaths(root, paths) {
  for (const path of paths) {
    const actual = resolvedPath(path);
    assert.ok(actual !== "/run/user/1000/h2a-nt" && !actual.startsWith("/run/user/1000/h2a-nt/"),
      `REFUSING owner runtime path: ${actual}`);
    const rel = relative(root, actual);
    assert.ok(rel === "" || (!rel.startsWith("..") && !rel.startsWith("/")),
      `REFUSING path outside qualification fixture: ${actual}`);
  }
  assert.equal(statSync(root).mode & 0o777, 0o700);
}

function start(command, args, env) {
  const child = spawn(command, args, { env, cwd: env.HOME, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", status => resolve({ status, stdout, stderr }));
  });
  return { child, closed, output: () => ({ stdout, stderr }) };
}

async function eventually(read, predicate) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = await read();
    if (predicate(value)) return value;
    assert.ok(Date.now() < deadline, `observable condition did not arrive: ${JSON.stringify(value)}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function withLegacy(context, body) {
  assert.equal(unavailable, false, String(unavailable)); // Required evidence must never skip.
  const root = realpathSync(mkdtempSync("/tmp/h2a-qual-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const socketPath = join(root, "h2a-nt", "native-terminal.sock");
  const registryPath = join(home, ".config/sentropic/h2a/registry.json");
  const env = { PATH: "/usr/bin:/bin", HOME: home, XDG_RUNTIME_DIR: root,
    XDG_CONFIG_HOME: join(home, ".config"), REMOTE_CLI_CONFIG_HOME: home,
    H2A_ROOT: join(workspace, ".h2a"), H2A_SESSION_HOST: "native",
    H2A_NATIVE_SOCKET: socketPath, TMPDIR: join(root, "tmp"), TERM: "xterm-256color" };
  for (const path of [home, workspace, env.TMPDIR]) mkdirSync(path, { mode: 0o700 });
  assertPrivatePaths(root, [home, workspace, socketPath, registryPath, env.XDG_CONFIG_HOME, env.H2A_ROOT, env.TMPDIR,
    defaultNativeTerminalSocketPath(env)]);
  assert.equal(defaultNativeTerminalSocketPath(env), socketPath);
  context.diagnostic(`isolation: ${JSON.stringify({ root, socketPath, home, registryPath, workspace })}`);
  const host = start(process.execPath, [legacyEntry, "--socket", socketPath, "--generation", `legacy-${root.split("-").pop()}`,
    "--registry-path", registryPath], env);
  let client;
  const children = [host];
  try {
    await eventually(() => host.output(), output => {
      assert.equal(host.child.exitCode, null, output.stderr);
      return output.stdout.includes("h2a.native-terminal.ready");
    });
    client = await NativeTerminalClient.connect(socketPath);
    const ping = await client.ping();
    assert.equal(ping.hostPid, host.child.pid);
    assert.equal(Object.hasOwn(ping, "launchFence"), false);
    const sentinel = await client.create({ id: "legacy-sentinel", command: "/bin/bash",
      args: ["--noprofile", "--norc", "-c", "printf 'sentinel-ready\\n'; while IFS= read -r line; do printf 'sentinel:%s\\n' \"$line\"; done"],
      cwd: workspace, env, cols: 80, rows: 24 });
    const lease = await client.acquireController(sentinel.id, "qualification-sentinel");
    const exchange = async text => {
      await client.write(lease, `${text}\r`);
      await eventually(() => client.readOutput(sentinel.id, 0), output =>
        output.chunks.some(chunk => chunk.data.includes(`sentinel:${text}`)));
    };
    await exchange("before-launch");
    await body({ root, home, workspace, socketPath, env, ping, sentinel, client, children,
      async unchanged() {
        assert.deepEqual(await client.ping(), ping);
        const state = await client.state(sentinel.id);
        for (const key of ["pid", "generation", "incarnation", "status"]) assert.equal(state[key], sentinel[key]);
        await exchange("after-launch"); // SAME connection and controller lease.
        context.diagnostic(`sentinel unchanged: ${JSON.stringify({ pid: sentinel.pid, generation: sentinel.generation, incarnation: sentinel.incarnation, io: "before/after on same connection" })}`);
      } });
  } finally {
    client?.close();
    for (const handle of children.reverse()) {
      if (handle.child.exitCode === null && handle.child.signalCode === null) handle.child.kill("SIGTERM");
      await handle.closed;
    }
    rmSync(root, { recursive: true, force: true });
  }
}

test("should select a second compatible host and preserve the historical sentinel (spec §8/L0; L2 pending)", {
  skip: !required && unavailable,
  todo: !unavailable && process.env.H2A_TEST_LEGACY_RED !== "1" ? "spec §8/L0: second-host selection awaits L2 owner ratification" : false,
}, async context => {
  await withLegacy(context, async fixture => {
    // Empty override exercises automatic selection, bounded to the explicitly
    // checked XDG_RUNTIME_DIR; an imposed endpoint has its separate test below.
    const env = { ...fixture.env, H2A_NATIVE_SOCKET: "" };
    assertPrivatePaths(fixture.root, [defaultNativeTerminalSocketPath(env)]);
    const source = `import {startNativeSession,ensureNativeHost} from ${JSON.stringify(pathToFileURL(runtime).href)};
      try { let ownership; const started = startNativeSession("codex", "/bin/bash", ${JSON.stringify(fixture.workspace)},
        ["--noprofile", "--norc", "-c", "printf 'new-launch-ready\\n'; read -r line"], "qualification-new",
        {terminateOnAgentExit:true, refuseExisting:true, beforeCreate:value=>{ownership=value;}});
        console.log(JSON.stringify({started,ownership,host:ensureNativeHost()}));
      } catch(error) { console.error(error.message); process.exitCode=1; }`;
    const launch = start(process.execPath, ["--input-type=module", "-e", source], env);
    fixture.children.push(launch);
    launch.child.stdin.end();
    const result = await launch.closed;
    context.diagnostic(`raw historical launch: ${JSON.stringify(result)}`);
    await fixture.unchanged();
    assert.equal(result.status, 0, result.stderr);
    const { host, ownership, started } = JSON.parse(result.stdout);
    assert.equal(host.launchFence, true);
    assert.notEqual(host.hostPid, fixture.ping.hostPid);
    assert.notEqual(host.generation, fixture.ping.generation);
    assert.notEqual(host.socketPath, fixture.socketPath);
    assert.equal(ownership.generation, host.generation);
    assert.ok(started.pid > 0);
    const second = await NativeTerminalClient.connect(host.socketPath);
    try {
      assert.equal((await second.state(started.name)).incarnation, ownership.incarnation);
      await eventually(() => second.readOutput(started.name, 0), output => output.chunks.some(chunk => chunk.data.includes("new-launch-ready")));
    } finally { second.close(); }
  });
});
