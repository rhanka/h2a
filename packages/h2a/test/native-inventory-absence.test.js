import { assertIsolatedEnvironment, assertIsolatedNativeOperation, spawnIsolatedNative as spawn } from "./helpers/native-isolation.js";
import assert from "node:assert/strict";

import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { NativeTerminalClient } from "../../h2a-runtime/dist/native-terminal/client.js";
import { readProcessStartTime } from "../../h2a-runtime/dist/native-terminal/host.js";

const repo = resolve(import.meta.dirname, "../../..");
const terminal = join(repo, "packages/h2a-runtime/dist/native-terminal");
const native = pathToFileURL(join(repo, "packages/h2a-runtime/dist/native-host.js")).href;
const legacyDir = process.env.H2A_TEST_LEGACY_HOST_DIR;
const legacyEntry = legacyDir && join(legacyDir, "packages/h2a-runtime/dist/native-terminal/process.js");
const legacyUnavailable = process.platform !== "linux" ? "historical native PTY qualification requires Linux"
  : !legacyEntry || !existsSync(legacyEntry) ? "legacy build unavailable: set H2A_TEST_LEGACY_HOST_DIR to a build of 89bbd9af^" : false;
const legacyRequired = process.env.H2A_TEST_REQUIRE_LEGACY_HOST === "1";


test("should prove isolation guard fails if any environment variable resolves to owner directories", () => {
  const qualRoot = join(repo, ".qual-tmp");
  const badHomes = [
    "/run/user/1000/h2a-nt",
    "/home/antoinefa",
    "/home/antoinefa/.local/state",
    "/home/antoinefa/.config",
    "/home/antoinefa/.cache-tmp/h2a-test",
    "/tmp/outside-qualification",
  ];
  for (const bad of badHomes) {
    assert.throws(
      () => assertIsolatedEnvironment({
        HOME: bad,
        XDG_RUNTIME_DIR: join(qualRoot, "rt"),
        XDG_STATE_HOME: join(qualRoot, "st"),
        XDG_CONFIG_HOME: join(qualRoot, "cfg"),
      }, qualRoot),
      /REFUSING/,
    );
  }
});

async function fixture(body) {
  const qualRoot = join(repo, ".qual-tmp");
  mkdirSync(qualRoot, { recursive: true });
  const root = mkdtempSync(join(qualRoot, "q"));
  const home = join(root, "home");
  const workspaces = join(qualRoot, "ws");
  mkdirSync(workspaces, { recursive: true });
  const workspace = mkdtempSync(join(workspaces, "w-"));
  mkdirSync(home, { mode: 0o700 });
  const stateHome = join(home, ".local/state");
  mkdirSync(stateHome, { recursive: true, mode: 0o700 });
  const configHome = join(home, ".config");
  mkdirSync(configHome, { recursive: true, mode: 0o700 });
  const env = { PATH: "/usr/bin:/bin", HOME: home, XDG_RUNTIME_DIR: root,
    XDG_STATE_HOME: stateHome,
    XDG_CONFIG_HOME: configHome, REMOTE_CLI_CONFIG_HOME: home,
    NODE_PATH: join(repo, "node_modules"),
    H2A_ROOT: join(workspace, ".h2a"), H2A_SESSION_HOST: "native", H2A_NATIVE_SOCKET: "", TERM: "xterm-256color",
    TMUX_TMPDIR: root };
  assertIsolatedNativeOperation(env, qualRoot);
  const paths = [join(root, "h2a-nt/native-terminal.sock"), join(root, "h2a-nt/native-terminal.lf1.sock")];
  const hosts = [], clients = [];
  async function run(args, source = false, entry = join(terminal, "op.js"), input) {
    assertIsolatedNativeOperation(env, qualRoot);
    const child = spawn(process.execPath, source ? ["--input-type=module", "-e", args] : [entry, ...args],
      { env, cwd: workspace, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    if (input !== undefined) child.stdin.end(input);
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    const [status] = await once(child, "close");
    return { status, stdout, stderr, payload: stdout.trim() ? JSON.parse(stdout.trim()) : undefined };
  }
  async function start(index = 0, entry = join(terminal, "process.js"), customSocketPath) {
    assertIsolatedNativeOperation(env, qualRoot);
    const socketPath = customSocketPath ?? paths[index];
    const child = spawn(process.execPath, [entry, "--socket", socketPath, "--generation", `fixture-${index}`,
      "--registry-path", join(home, ".config/sentropic/h2a/registry.json")], { env, stdio: ["ignore", "pipe", "pipe"] });
    hosts.push(child);
    let output = "", errors = "";
    child.stderr.on("data", data => { errors += data; });
    await new Promise((resolve, reject) => {
      child.stdout.on("data", data => { output += data; if (output.includes("h2a.native-terminal.ready")) resolve(); });
      child.once("exit", () => reject(new Error(errors)));
      child.once("error", reject);
    });
    const client = await NativeTerminalClient.connect(socketPath);
    clients.push(client);
    return { child, client, ping: await client.ping(), socketPath };
  }
  async function launch(name) {
    const result = await run(`import {startNativeSession} from ${JSON.stringify(native)};
      try { let owner; const session=startNativeSession("codex","/bin/bash",${JSON.stringify(workspace)},
        ["--noprofile","--norc","-c","read -r line"],${JSON.stringify(name)},
        {refuseExisting:true,beforeCreate:value=>{owner=value;}});console.log(JSON.stringify({session,owner})); }
      catch(error){console.log(JSON.stringify(error.toRunFailure?.(${JSON.stringify(name)})??{message:error.message}));process.exitCode=1;}`, true);
    if (result.status === 0) {
      // Only fixture-created endpoints are adopted for cleanup; never signal
      // a PID taken from a stale record or an owner's runtime directory.
      for (const path of paths) {
        if (!existsSync(path)) continue;
        const client = await NativeTerminalClient.connect(path);
        clients.push(client);
      }
    }
    return result;
  }
  function installCli() {
    const bin = join(home, "bin"), delivered = join(root, "delivered.jsonl");
    mkdirSync(bin, { mode: 0o700 });
    writeFileSync(join(bin, "codex"), `#!${process.execPath}
import {appendFileSync} from 'node:fs';
process.stdin.setRawMode(true);process.stdin.resume();
process.stdout.write('Qualification CLI\\r\\nmodel: qualification · /private/workspace\\r\\n› ');
let text='';process.stdin.on('data',bytes=>{for(const c of bytes.toString().replace(/\\x1b\\[20[01]~/g,'')){
  if(c==='\\x15'){text='';continue;}if(c==='\\r'){appendFileSync(${JSON.stringify(delivered)},JSON.stringify(text)+'\\n');
  process.stdout.write('\\r\\nWorking (esc to interrupt)\\r\\n');text='';}else{text+=c;process.stdout.write(c);}}});`, { mode: 0o700 });
    writeFileSync(join(home, ".bash_profile"), `export PATH='${bin}:/usr/bin:/bin'\n`, { mode: 0o600 });
    env.PATH = `${bin}:/usr/bin:/bin`;
    return delivered;
  }
  async function mcpLaunch(name) {
    assertIsolatedNativeOperation(env, qualRoot);
    const source = `import {runMcpStdio} from ${JSON.stringify(pathToFileURL(join(repo, "packages/h2a/dist/index.js")).href)};
      await runMcpStdio({root:${JSON.stringify(env.H2A_ROOT)},workspaceRoot:${JSON.stringify(workspace)},stdin:process.stdin,stdout:process.stdout,stderr:process.stderr});`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], { env, cwd: workspace, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stderr.on("data", data => { stderr += data; });
    const closed = once(child, "close");
    try {
      const response = new Promise((resolve, reject) => {
        child.stdout.on("data", data => {
          stdout += data;
          for (const line of stdout.split("\n").filter(Boolean)) {
            let message; try { message = JSON.parse(line); } catch { continue; }
            if (message.id === 1) resolve(message);
          }
        });
        child.once("error", reject);
        child.once("exit", () => reject(new Error(`MCP exited before launch result: ${stderr}`)));
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "h2a_run",
        arguments: { name, profile: "codex", workspace, prompt: "one cold or stale brief", background: true,
          gateway: "off", headless: false, h2aSidecar: false } } }) + "\n");
      const result = await response;
      return JSON.parse(result.result.content[0].text);
    } finally { child.stdin.end(); await closed; }
  }
  try { await body({ root, home, workspace, env, paths, hosts, clients, run, start, launch, installCli, mcpLaunch }); }
  finally {
    for (const child of hosts) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      child.kill("SIGCONT");
      const exited = once(child, "exit"); child.kill("SIGTERM"); await exited;
    }
    // Detached hosts were started only by launch() inside this private fixture.
    for (const path of paths) {
      const result = await run(["host-stop", "--socket", path]);
      assert.ok(result.status === 0 || /ENOENT|ECONNREFUSED/.test(result.stderr), result.stderr);
    }
    for (const client of clients) client.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
}

const linux = { skip: process.platform !== "linux" && "Linux native host qualification" };

test("should prove cold absence and launch on the historical endpoint", linux, () => fixture(async f => {
  assert.equal((await f.run(["probe", "--id", "h2a-cold"])).payload.verdict, "dead");
  const launched = await f.launch("cold");
  assert.equal(launched.status, 0, JSON.stringify(launched));
  assert.equal(launched.payload.owner.socketPath, f.paths[0]);
}));

test("should reclaim a SIGKILL stale historical socket and admit only one writer", linux, () => fixture(async f => {
  const host = await f.start();
  const exited = once(host.child, "exit"); host.child.kill("SIGKILL"); await exited;
  assert.ok(existsSync(f.paths[0]));
  assert.equal((await f.run(["probe", "--id", "h2a-stale"])).payload.verdict, "dead");
  const launched = await f.launch("stale");
  assert.equal(launched.status, 0, JSON.stringify(launched));
  assert.notEqual(launched.payload.owner.generation, host.ping.generation);
  const collision = await f.launch("stale");
  assert.equal(collision.payload.code, "native-name-collision");
  const inventory = (await f.run(["list"])).payload;
  assert.equal(inventory.sessions.filter(session => session.id === "h2a-stale").length, 1);
}));

test("should accept absent lf1 while the historical fenced host stays alive", linux, () => fixture(async f => {
  const host = await f.start();
  assert.equal((await f.run(["list"])).payload.complete, true);
  const launched = await f.launch("one-host");
  assert.equal(launched.status, 0, JSON.stringify(launched));
  assert.equal(launched.payload.owner.generation, host.ping.generation);
  assert.deepEqual(await host.client.ping(), host.ping);
}));

test("should preserve both live hosts and ambiguous-owner refusal", linux, () => fixture(async f => {
  const first = await f.start(), second = await f.start(1);
  for (const host of [first, second]) await host.client.create({ id: "h2a-duplicate", command: "/bin/bash",
    args: ["--noprofile", "--norc", "-c", "read -r line"], cwd: f.workspace, env: f.env, cols: 80, rows: 24 });
  assert.equal((await f.run(["probe", "--id", "h2a-duplicate"])).payload.code, "ambiguous-owner");
  const launched = await f.launch("both-live");
  assert.equal(launched.status, 0, JSON.stringify(launched));
  assert.deepEqual(await first.client.ping(), first.ping);
  assert.deepEqual(await second.client.ping(), second.ping);
}));

test("should keep a SIGSTOP host unknown and refuse creation with its endpoint and reason", linux, () => fixture(async f => {
  const host = await f.start(); host.child.kill("SIGSTOP");
  const probe = (await f.run(["probe", "--id", "h2a-hung"])).payload;
  assert.equal(probe.verdict, "unknown");
  assert.ok(probe.reason.includes(f.paths[0]));
  assert.match(probe.reason, /timed out/);
  const launched = await f.launch("hung");
  assert.equal(launched.payload.code, "native-inventory-unknown");
  assert.equal(launched.payload.creationAttempted, false);
  assert.match(launched.stdout, /timed out/);
  f.installCli();
  const cli = await f.run(["run", "codex", f.workspace, "--name", "hung-cli", "--no-gw", "--json", "--background", "--no-attach", "--no-h2a", "--prompt-stdin"], false,
    join(repo, "packages/h2a-runtime/dist/index.js"), "must never be delivered");
  assert.ok(cli.payload, JSON.stringify(cli));
  assert.equal(cli.payload.code, "native-inventory-unknown");
  assert.equal(cli.payload.creationAttempted, false);
  assert.ok(cli.stderr.includes(f.paths[0]));
  assert.match(cli.stderr, /timed out/);
  assert.match(cli.stderr, /restore probe access/);
  assert.doesNotMatch(cli.stderr, /restart the host/);
}));

test("should launch the ordinary CLI run path after a cold probe created the private directory", linux, () => fixture(async f => {
  f.installCli();
  assert.equal((await f.run(["probe", "--id", "h2a-cold-cli"])).payload.verdict, "dead");
  const result = await f.run(["run", "codex", "--name", "cold-cli", "--no-gw", "--no-attach", "--no-h2a"], false,
    join(repo, "packages/h2a-runtime/dist/index.js"));
  assert.equal(result.status, 0, JSON.stringify(result));
  assert.equal((await f.run(["probe", "--id", "h2a-cold-cli"])).payload.verdict, "live");
}));

test("should keep a missing endpoint unknown while its certified owner is alive", linux, () => fixture(async f => {
  const host = await f.start();
  unlinkSync(f.paths[0]);
  assert.equal((await f.run(["probe", "--id", "h2a-unlinked"])).payload.verdict, "unknown");
  const launched = await f.launch("unlinked");
  assert.equal(launched.payload.code, "native-inventory-unknown");
  assert.equal(launched.payload.creationAttempted, false);
  assert.equal(existsSync(f.paths[0]), false);
  assert.deepEqual(await host.client.ping(), host.ping);
}));

test("should refuse second writer when a live host without .owner lost its pathname but still serves", linux, () => fixture(async f => {
  const host = await f.start();
  if (existsSync(`${f.paths[0]}.owner`)) unlinkSync(`${f.paths[0]}.owner`);
  unlinkSync(f.paths[0]);
  assert.deepEqual(await host.client.ping(), host.ping);
  const probe = (await f.run(["probe", "--id", "h2a-unlinked-no-owner"])).payload;
  assert.equal(probe.verdict, "unknown");
  const launched = await f.launch("unlinked-no-owner");
  assert.equal(launched.payload.code, "native-inventory-unknown");
  assert.equal(launched.payload.creationAttempted, false);
  assert.deepEqual(await host.client.ping(), host.ping);
}));

test("should refuse second writer when a live host without .owner was started via path alias and lost its pathname", linux, () => fixture(async f => {
  const realRoot = join(f.root, "real");
  const linkRoot = join(f.root, "link");
  mkdirSync(realRoot, { mode: 0o700 });
  symlinkSync(realRoot, linkRoot);
  const realDir = join(realRoot, "h2a-nt");
  const linkDir = join(linkRoot, "h2a-nt");
  mkdirSync(realDir, { mode: 0o700 });
  const aliasSocket = join(linkDir, "native-terminal.sock");
  const canonicalSocket = join(realDir, "native-terminal.sock");

  const host = await f.start(0, join(terminal, "process.js"), aliasSocket);
  if (existsSync(`${aliasSocket}.owner`)) unlinkSync(`${aliasSocket}.owner`);
  if (existsSync(`${canonicalSocket}.owner`)) unlinkSync(`${canonicalSocket}.owner`);
  unlinkSync(canonicalSocket);
  assert.deepEqual(await host.client.ping(), host.ping);

  f.env.H2A_NATIVE_SOCKET = canonicalSocket;
  const probe = (await f.run(["probe", "--id", "h2a-unlinked-alias"])).payload;
  assert.equal(probe.verdict, "unknown");
  const launched = await f.launch("unlinked-alias");
  assert.equal(launched.payload.code, "native-inventory-unknown");
  assert.equal(launched.payload.creationAttempted, false);
  assert.deepEqual(await host.client.ping(), host.ping);
}));

test("should refuse second writer when alias used at startup is deleted after socket unlink while initial client still responds", linux, () => fixture(async f => {
  const realRoot = join(f.root, "real");
  const linkRoot = join(f.root, "link");
  mkdirSync(realRoot, { mode: 0o700 });
  symlinkSync(realRoot, linkRoot);
  const realDir = join(realRoot, "h2a-nt");
  const linkDir = join(linkRoot, "h2a-nt");
  mkdirSync(realDir, { mode: 0o700 });
  const aliasSocket = join(linkDir, "native-terminal.sock");
  const canonicalSocket = join(realDir, "native-terminal.sock");

  const host = await f.start(0, join(terminal, "process.js"), aliasSocket);
  if (existsSync(`${aliasSocket}.owner`)) unlinkSync(`${aliasSocket}.owner`);
  if (existsSync(`${canonicalSocket}.owner`)) unlinkSync(`${canonicalSocket}.owner`);
  unlinkSync(canonicalSocket);
  // Delete the alias symlink root
  unlinkSync(linkRoot);

  // The initial connection continues to respond
  assert.deepEqual(await host.client.ping(), host.ping);

  f.env.H2A_NATIVE_SOCKET = canonicalSocket;
  const probe = (await f.run(["probe", "--id", "h2a-deleted-alias"])).payload;
  assert.equal(probe.verdict, "unknown");
  const launched = await f.launch("deleted-alias");
  assert.equal(launched.payload.code, "native-inventory-unknown");
  assert.equal(launched.payload.creationAttempted, false);
  assert.deepEqual(await host.client.ping(), host.ping);
}));

test("should cleanly rollback published socket if .owner write fails and allow subsequent start to succeed", linux, () => fixture(async f => {
  const socketPath = f.paths[0];
  const ownerPath = `${socketPath}.owner`;

  // First start fails due to simulated failure during owner recording
  f.env.H2A_TEST_FAIL_OWNER_WRITE = "1";
  await assert.rejects(
    async () => {
      await f.start(0);
    },
    /simulated failure recording endpoint owner/i,
  );

  // The published socket must NOT have been left behind without an owner
  assert.equal(existsSync(socketPath), false, "socket must be rolled back on owner write failure");

  // Subsequent start without error must succeed cleanly
  delete f.env.H2A_TEST_FAIL_OWNER_WRITE;
  const host = await f.start(0);
  assert.deepEqual(await host.client.ping(), host.ping);
  assert.ok(existsSync(ownerPath));
}));

test("should treat /proc pid entry stat error as unknown and refuse launch", linux, () => fixture(async f => {
  const host = await f.start();
  if (existsSync(`${f.paths[0]}.owner`)) unlinkSync(`${f.paths[0]}.owner`);
  unlinkSync(f.paths[0]);
  assert.deepEqual(await host.client.ping(), host.ping);

  const mockProc = join(f.root, "proc-stat-err");
  mkdirSync(mockProc, { recursive: true });
  // Symlink loop creates ELOOP when statSync is called on the pid directory
  symlinkSync("loop", join(mockProc, "loop"));
  symlinkSync("loop", join(mockProc, String(host.child.pid)));

  f.env.H2A_TEST_PROC_ROOT = mockProc;
  const probe = (await f.run(["probe", "--id", "h2a-stat-err"])).payload;
  assert.equal(probe.verdict, "unknown");
  const launched = await f.launch("stat-err");
  assert.equal(launched.payload.code, "native-inventory-unknown");
  assert.equal(launched.payload.creationAttempted, false);
  assert.deepEqual(await host.client.ping(), host.ping);
}));

test("should treat /proc fd descriptor readlink error as unknown and refuse launch", linux, () => fixture(async f => {
  const host = await f.start();
  if (existsSync(`${f.paths[0]}.owner`)) unlinkSync(`${f.paths[0]}.owner`);
  unlinkSync(f.paths[0]);
  assert.deepEqual(await host.client.ping(), host.ping);

  const mockProc = join(f.root, "proc-fd-err");
  const pidDir = join(mockProc, String(host.child.pid));
  const fdDir = join(pidDir, "fd");
  mkdirSync(fdDir, { recursive: true });
  writeFileSync(join(pidDir, "cmdline"), `${process.execPath}\0--socket\0${f.paths[0]}\0process.js\0`);
  // A regular file in fd causes readlinkSync to throw EINVAL (non-symlink)
  writeFileSync(join(fdDir, "3"), "not-a-symlink");

  f.env.H2A_TEST_PROC_ROOT = mockProc;
  const probe = (await f.run(["probe", "--id", "h2a-fd-err"])).payload;
  assert.equal(probe.verdict, "unknown");
  const launched = await f.launch("fd-err");
  assert.equal(launched.payload.code, "native-inventory-unknown");
  assert.equal(launched.payload.creationAttempted, false);
  assert.deepEqual(await host.client.ping(), host.ping);
}));

for (const recycled of [false, true]) test(`should ${recycled ? "prove a recycled PID dead" : "refuse a live PID with matching start time"} at a refused endpoint`, linux, () => fixture(async f => {
  const host = await f.start();
  const exited = once(host.child, "exit"); host.child.kill("SIGKILL"); await exited;
  const path = `${f.paths[0]}.owner`, owner = JSON.parse(readFileSync(path, "utf8"));
  owner.pid = process.pid;
  owner.startTime = recycled ? 0 : readProcessStartTime(process.pid);
  writeFileSync(path, JSON.stringify(owner));
  const probe = (await f.run(["probe", "--id", "h2a-pid-identity"])).payload;
  assert.equal(probe.verdict, recycled ? "dead" : "unknown");
  const launched = await f.launch("pid-identity");
  assert.equal(launched.status, recycled ? 0 : 1, JSON.stringify(launched));
  if (!recycled) assert.equal(launched.payload.creationAttempted, false);
}));

for (const identity of ["missing", "malformed"]) test(`should keep a refused endpoint unknown when its owner identity is ${identity}`, linux, () => fixture(async f => {
  const host = await f.start();
  const exited = once(host.child, "exit"); host.child.kill("SIGKILL"); await exited;
  if (identity === "missing") unlinkSync(`${f.paths[0]}.owner`);
  else writeFileSync(`${f.paths[0]}.owner`, "{broken");
  assert.equal((await f.run(["probe", "--id", "h2a-unprovable"])).payload.verdict, "unknown");
  const launched = await f.launch("unprovable");
  assert.equal(launched.payload.code, "native-inventory-unknown");
  assert.equal(launched.payload.creationAttempted, false);
}));

for (const stale of [false, true]) test(`should launch through MCP h2a_run from a ${stale ? "SIGKILL stale" : "cold"} fleet`, linux, () => fixture(async f => {
  if (stale) {
    const host = await f.start();
    const exited = once(host.child, "exit"); host.child.kill("SIGKILL"); await exited;
    assert.ok(existsSync(f.paths[0]));
  }
  const delivered = f.installCli();
  const result = await f.mcpLaunch(`absence-mcp-${stale ? "stale" : "cold"}`);
  assert.equal(result.state, "started", JSON.stringify(result));
  assert.equal(result.session.socketPath, f.paths[0]);
  assert.deepEqual(readFileSync(delivered, "utf8").trim().split("\n").map(line => JSON.parse(line)), ["one cold or stale brief"]);
}));

test("should resolve a session whose historical host died as dead for restore", linux, () => fixture(async f => {
  const host = await f.start();
  await host.client.create({ id: "h2a-restore-dead", command: "/bin/bash", args: ["--noprofile", "--norc", "-c", "read -r line"],
    cwd: f.workspace, env: f.env, cols: 80, rows: 24 });
  const exited = once(host.child, "exit"); host.child.kill("SIGKILL"); await exited;
  const registry = pathToFileURL(join(repo, "packages/h2a-runtime/dist/registry.js")).href;
  const restore = pathToFileURL(join(repo, "packages/h2a-runtime/dist/restore.js")).href;
  const result = await f.run(`import {probeNativeSession,resolveManagedHost} from ${JSON.stringify(registry)};
    import {captureHostViewSnapshot,managedLiveLookupFromSnapshot} from ${JSON.stringify(restore)};
    console.log(JSON.stringify({probe:probeNativeSession("h2a-restore-dead"),owner:resolveManagedHost("h2a-restore-dead"),
      restore:managedLiveLookupFromSnapshot(captureHostViewSnapshot())("local-native",["h2a-restore-dead"])}));`, true);
  assert.equal(result.payload.probe, "dead");
  assert.equal(result.payload.restore.state, "dead");
  assert.notEqual(result.payload.owner.state, "unknown");
  const relaunched = await f.launch("restore-dead");
  assert.equal(relaunched.status, 0, JSON.stringify(relaunched));
}));

test("should prove a pre-upgrade historical host dead using its durable PID and start time", {
  skip: process.platform !== "linux" ? "Linux native host qualification"
    : !legacyRequired && legacyUnavailable,
}, () => fixture(async f => {
  assert.equal(legacyUnavailable, false, String(legacyUnavailable));
  const host = await f.start(0, legacyEntry);
  await host.client.create({ id: "h2a-legacy-dead", command: "/bin/bash", args: ["--noprofile", "--norc", "-c", "read -r line"],
    cwd: f.workspace, env: f.env, cols: 80, rows: 24 });
  const exited = once(host.child, "exit"); host.child.kill("SIGKILL"); await exited;
  assert.equal((await f.run(["probe", "--id", "h2a-legacy-dead"])).payload.verdict, "dead");
  const launched = await f.launch("legacy-dead");
  assert.equal(launched.status, 0, JSON.stringify(launched));
}));
