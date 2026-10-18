import { assertIsolatedEnvironment, assertIsolatedNativeOperation, assertPrivateQualificationPath, createPrivateTestDirectory, nativeQualificationRoot, pinPrivateNativeProcess, spawnIsolatedNative as spawn, stopPrivateNativeProcesses, waitForPrivateNativeProcesses } from "./helpers/native-isolation.js";
import assert from "node:assert/strict";

import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { NativeTerminalClient } from "../../h2a-runtime/dist/native-terminal/client.js";
import { readProcessStartTime } from "../../h2a-runtime/dist/native-terminal/host.js";
import { readBootId, readMachineId, readPidNamespaceId } from "../../h2a-runtime/dist/proc-identity.js";

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
    "/home/antoinefa/.config/sentropic/h2a",
    "/home/antoinefa/h2a-workspace",
    "/home/antoinefa/h2a-workspace/.h2a",
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
    assert.throws(
      () => assertIsolatedEnvironment({
        HOME: join(qualRoot, "home"),
        XDG_RUNTIME_DIR: join(qualRoot, "rt"),
        XDG_STATE_HOME: join(qualRoot, "st"),
        XDG_CONFIG_HOME: join(qualRoot, "cfg"),
        H2A_ROOT: bad,
      }, qualRoot),
      /REFUSING/,
    );
  }
});

test("should reject aliased qualification root and ws before any inventory fixture writes", async () => {
  const lab = createPrivateTestDirectory("a");
  const outside = mkdtempSync("/tmp/h2a-r2-inventory-canary-");
  try {
    for (const child of ["alias", "ws"]) {
      const alias = join(lab, child);
      symlinkSync(outside, alias);
      let refused = false;
      try { await fixture(async () => {}, child === "alias" ? alias : lab); }
      catch (error) { assert.match(String(error), /REFUSING/); refused = true; }
      assert.deepEqual(readdirSync(outside), [], "refusal must precede the first mkdir/mkdtemp");
      assert.equal(refused, true, "aliased fixture must be refused");
      unlinkSync(alias);
    }
  } finally { rmSync(lab, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

async function fixture(body, qualRoot = nativeQualificationRoot) {
  assertPrivateQualificationPath(join(qualRoot, "ws"), nativeQualificationRoot);
  const root = createPrivateTestDirectory("q", qualRoot);
  const home = join(root, "home");
  const workspaces = join(qualRoot, "ws");
  const workspace = createPrivateTestDirectory("w-", workspaces);
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
  // The ordinary launcher detaches its host, so the test has no ChildProcess
  // handle for it. Record that fixture host's real Node exit event and observe
  // its effective exit; a host-stop response only acknowledges TERM.
  const exitEvents = join(root, "host-exits"), exitObserver = join(root, "host-exit.mjs");
  mkdirSync(exitEvents, { mode: 0o700 });
  writeFileSync(exitObserver, `import { writeFileSync, renameSync } from 'node:fs';
    import { basename, join } from 'node:path';
    if (['process.js', 'owner-process.js'].includes(basename(process.argv[1] ?? ''))) {
      process.once('exit', code => {
        const file = join(${JSON.stringify(exitEvents)}, process.pid + '.json');
        writeFileSync(file + '.tmp', JSON.stringify({pid: process.pid, code, timestamp: Date.now()}));
        renameSync(file + '.tmp', file);
      });
    }`);
  env.NODE_OPTIONS = `--import=${pathToFileURL(exitObserver).href}`;
  async function waitForHostExit(pid) {
    // B2 permits 10s to close frontend channels, then a bounded journal flush.
    const file = join(exitEvents, `${pid}.json`), deadline = Date.now() + 12_000;
    // The receipt is written by the effective owner on exit. Polling avoids
    // consuming an inotify instance for each teardown in parallel CI jobs.
    for (;;) {
      if (existsSync(file)) {
        const receipt = JSON.parse(readFileSync(file, "utf8"));
        assert.equal(receipt.pid, pid);
        return receipt;
      }
      assert.ok(Date.now() < deadline, `fixture host pid=${pid} did not emit exit within the owner shutdown bound (12000ms)`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  assertIsolatedNativeOperation(env, qualRoot);
  const paths = [join(root, "h2a-nt/native-terminal.sock"), join(root, "h2a-nt/native-terminal.lf1.sock")];
  const hosts = [], clients = [], pins = [];
  const cleanupEnv = { ...env };
  cleanupEnv.H2A_NATIVE_SOCKET = join(root, "h2a-nt/native-terminal.sock");
  function pinOwner(pid) {
    // A fixture child can exit between reading the owner's children list and
    // opening its proc directory. Retry that vanished-child observation only;
    // the final helper check still requires every private writer to be gone.
    for (let attempt = 0; attempt < 3; attempt++) {
      try { pins.push(pinPrivateNativeProcess(pid, cleanupEnv)); return; }
      catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) throw error; }
    }
  }
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
    const ping = await client.ping();
    pinOwner(ping.hostPid);
    return { child, client, ping, socketPath };
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
        pinOwner((await client.ping()).hostPid);
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
    try {
      // Every client and host below was created/adopted only inside this
      // private fixture. Resume a deliberately stopped host before cleanup.
      for (const child of hosts) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGCONT");
      }
      // CLI/MCP paths can start detached hosts without going through launch().
      // Discover only the two endpoint names inside this fixture's directory.
      for (const path of paths) {
        const client = await NativeTerminalClient.connect(path).catch(() => undefined);
        if (client) clients.push(client);
      }
      for (const client of clients) {
        let sessions;
        try { sessions = await client.list(); }
        catch { continue; } // The fixture also exercises dead/unlinked hosts.
        pinOwner((await client.ping()).hostPid);
        for (const session of sessions.filter(session => session.status !== "exited")) {
          const lease = await client.acquireController(session.id, "inventory-fixture-cleanup");
          await client.stop(lease);
          const deadline = Date.now() + 1_000;
          while ((await client.state(session.id)).status !== "exited" && Date.now() < deadline)
            await new Promise(resolve => setTimeout(resolve, 10));
          if ((await client.state(session.id)).status !== "exited") await client.stop(lease, "SIGKILL");
        }
      }
      for (const client of clients) client.close();
      for (const child of hosts) {
        if (child.exitCode !== null || child.signalCode !== null) continue;
        const exited = once(child, "exit"); child.kill("SIGTERM"); await exited;
      }
      // Detached B owners drain rather than destroying their sessions on
      // host-stop. Sessions have ended above; require their actual exit now.
      for (const path of paths) {
        const result = await run(["host-stop", "--socket", path]);
        assert.ok(result.status === 0 || /ENOENT|ECONNREFUSED/.test(result.stderr), result.stderr);
        if (result.payload?.hostPid !== undefined) await waitForHostExit(result.payload.hostPid);
      }
    } finally {
      for (const client of clients) client.close();
      // Includes setup/assertion/cleanup failure: the read-only helper knows
      // our spawned descendants and pins their identity before signalling.
      try {
        await stopPrivateNativeProcesses(cleanupEnv);
        await waitForPrivateNativeProcesses(cleanupEnv);
      } finally { for (const release of pins.reverse()) release(); }
      rmSync(root, { recursive: true, force: true });
      rmSync(workspace, { recursive: true, force: true });
    }
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

  const socketLeftBehind = existsSync(socketPath);
  assert.equal(existsSync(ownerPath), false, "injection must fail before owner recording");

  // Observe both effects before asserting, so a rollback-only mutation proves
  // the leftover endpoint AND the blocked retry with the same injection.
  delete f.env.H2A_TEST_FAIL_OWNER_WRITE;
  let host, retryError;
  try { host = await f.start(0); } catch (error) { retryError = String(error); }
  assert.deepEqual({ socketLeftBehind, restarted: host !== undefined },
    { socketLeftBehind: false, restarted: true },
    `owner-write rollback must remove the socket and permit retry: ${retryError ?? "no retry error"}`);
  assert.deepEqual(await host.client.ping(), host.ping);
  assert.ok(existsSync(ownerPath));
}));

test("should ignore stdio and journal IPC sockets on an unbound host contender", linux, () => fixture(async f => {
  mkdirSync(dirname(f.paths[0]), { mode: 0o700 });
  const contender = spawn(process.execPath, ["-e", "process.send('unbound'); setInterval(() => {}, 1000)",
    join(terminal, "process.js"), "--socket", f.paths[0]],
  { env: f.env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  f.hosts.push(contender);
  await once(contender, "message");
  const probe = (await f.run(["probe", "--id", "h2a-unbound-contender"])).payload;
  assert.equal(probe.verdict, "dead", "transport socket pairs are not a native listener");
  const launched = await f.launch("unbound-contender");
  assert.equal(launched.status, 0, JSON.stringify(launched));
}));

test("should keep socket identity unknown when the candidate Unix table is unreadable", linux, () => fixture(async f => {
  const host = await f.start();
  unlinkSync(`${f.paths[0]}.owner`);
  unlinkSync(f.paths[0]);
  const mockProc = join(f.root, "proc-unix-err");
  const pidDir = join(mockProc, String(host.child.pid));
  mkdirSync(join(pidDir, "fd"), { recursive: true });
  writeFileSync(join(pidDir, "cmdline"), `${process.execPath}\0process.js\0--socket\0${f.paths[0]}\0`);
  symlinkSync("socket:[42]", join(pidDir, "fd", "3"));
  f.env.H2A_TEST_PROC_ROOT = mockProc;
  const probe = await f.run(["probe", "--id", "h2a-unix-table-err"]);
  assert.equal(probe.payload.verdict, "unknown");
  // The unreadable Unix table is now the coded refusal (T4/F3): the frozen
  // literal names the sense; the scan reason rides as `cause`.
  assert.match(JSON.stringify(probe.payload), /active scan is unknown; refusing socket publication/);
  const launched = await f.launch("unix-table-err");
  assert.equal(launched.payload.creationAttempted, false);
  assert.deepEqual(await host.client.ping(), host.ping);
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
  // The historical dist predates short staging names. Keep its fixture
  // endpoint short enough even when this checkout is a deep worktree.
  const host = await f.start(0, legacyEntry, join(f.root, "legacy.sock"));
  await host.client.create({ id: "h2a-legacy-dead", command: "/bin/bash", args: ["--noprofile", "--norc", "-c", "read -r line"],
    cwd: f.workspace, env: f.env, cols: 80, rows: 24 });
  const exited = once(host.child, "exit"); host.child.kill("SIGKILL"); await exited;
  assert.equal((await f.run(["probe", "--id", "h2a-legacy-dead"])).payload.verdict, "dead");
  const launched = await f.launch("legacy-dead");
  assert.equal(launched.status, 0, JSON.stringify(launched));
}));

// ---------------------------------------------------------------------------
// POST-REBOOT RECOVERY (incident 2026-10-11): the boot boundary of THIS
// machine — same KNOWN pid namespace, same KNOWN machine id, DIFFERENT known
// boot id — is the strongest death proof there is, never a refusal. The CI
// seam for "a previous boot" is the DURABLE ROW CONTENT itself: rows keep the
// real namespace/machine anchors read via the production system readers and
// carry a fabricated boot id that differs from the current one. Everything
// below runs the REAL startup, publication, handshake and PTY operations — no
// helper that merely returns true.
// ---------------------------------------------------------------------------

const FABRICATED_PREVIOUS_BOOT_ID = "00000000-0000-4000-8000-000000000000";

function currentBootRowFrame() {
  const bootId = readBootId(), pidNamespace = readPidNamespaceId(), machineId = readMachineId();
  assert.ok(bootId && pidNamespace && machineId,
    "the post-reboot fixtures require this machine's /proc anchors, machine-id included");
  return { pgidBootId: bootId, pgidPidNamespace: pidNamespace, pgidMachineId: machineId };
}

function previousBootRowFrame() {
  // A row written by a previous boot of THIS machine: identical namespace and
  // machine anchors, different (fabricated) boot id — what a hard reboot
  // leaves in the persistent registry.
  return { ...currentBootRowFrame(), pgidBootId: FABRICATED_PREVIOUS_BOOT_ID };
}

function fixtureRegistryPath(f) {
  return join(f.home, ".config/sentropic/h2a/registry.json");
}

function writePgidRows(f, rows) {
  const registryPath = fixtureRegistryPath(f);
  mkdirSync(dirname(registryPath), { recursive: true, mode: 0o700 });
  const entries = rows.map((row, index) => ({
    id: `native-terminal-pty:${row.id ?? `post-reboot-${index}`}`,
    tool: "claude",
    kind: "local",
    cwd: "",
    source: "scan",
    enrolledAt: "2026-10-11T00:00:00.000Z",
    lastSeenAt: "2026-10-11T00:00:00.000Z",
    pgid: row.pgid ?? 424242,
    ...(row.owner ? {
      ownerHostPid: row.owner.pid,
      ...(row.owner.startTime !== undefined ? { ownerHostStartTime: row.owner.startTime } : {}),
    } : {}),
    ownerHostSocketPath: f.paths[0],
    ...(row.frame ?? {}),
  }));
  writeFileSync(registryPath, JSON.stringify({ version: 1, entries }));
  return registryPath;
}

async function assertServingThroughPublishedSocket(f, sessionId) {
  // Handshake through the real published endpoint, then a real PTY operation:
  // create a session that reads one line from its terminal into a scratch
  // file, deliver that line as raw keystrokes through the published socket,
  // and observe the command consume it. Nothing here is stubbed — the host,
  // the publication, the handshake and the PTY data path are all production.
  const client = await NativeTerminalClient.connect(f.paths[0]);
  f.clients.push(client);
  const ping = await client.ping();
  assert.ok(Number.isSafeInteger(ping.hostPid) && ping.hostPid > 0, "handshake must return a live host identity");
  const receipt = join(f.root, `${sessionId}-pty-receipt`);
  const ptySession = `${sessionId}-pty`;
  await client.create({ id: ptySession, command: "/bin/bash",
    args: ["--noprofile", "--norc", "-c",
      `read -r line; printf '%s' "$line" > ${JSON.stringify(receipt)}; read -r line`],
    cwd: f.workspace, env: f.env, cols: 80, rows: 24 });
  const proof = "post-reboot-proof";
  assert.equal((await f.run(["write", "--id", ptySession, "--b64", Buffer.from(proof).toString("base64")])).status, 0);
  assert.equal((await f.run(["enter", "--id", ptySession])).status, 0);
  const deadline = Date.now() + 5_000;
  for (;;) {
    let delivered = undefined;
    try {
      delivered = readFileSync(receipt, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (delivered === proof) break;
    assert.ok(Date.now() < deadline, `PTY line was never consumed by the session command: ${proof}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.match((await f.run(["capture", "--id", ptySession])).payload.text, new RegExp(proof));
}

test("should start, publish, handshake and serve a PTY over previous-boot rows after a hard reboot", linux, () => fixture(async f => {
  // The exact incident shape: the registry survived in the config home with
  // rows written by the PREVIOUS boot; the runtime directory (tmpfs) came
  // back empty — no socket, no .owner sidecar. The host MUST publish again.
  writePgidRows(f, [
    { id: "reboot-cold-1", owner: { pid: 424242, startTime: 111 }, frame: previousBootRowFrame() },
    { id: "reboot-cold-2", owner: { pid: 424243, startTime: 112 }, frame: previousBootRowFrame() },
  ]);
  assert.equal(existsSync(f.paths[0]), false);
  assert.equal((await f.run(["probe", "--id", "h2a-reboot-cold"])).payload.verdict, "dead");
  const launched = await f.launch("reboot-cold");
  assert.equal(launched.status, 0, JSON.stringify(launched));
  assert.equal(launched.payload.owner.socketPath, f.paths[0]);
  await assertServingThroughPublishedSocket(f, "h2a-reboot-cold");
}));

test("should start over previous-boot rows whose pid numbers are now recycled, touching no live process", linux, () => fixture(async f => {
  // A reboot resets the pid space: the numbers a previous boot recorded can
  // now be held by unrelated LIVE processes. The proof must neither probe
  // those numbers (reading a stranger as the owner) nor signal them.
  const survivor = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { env: f.env, stdio: "ignore" });
  try {
    const startTime = readProcessStartTime(survivor.pid);
    assert.ok(startTime !== undefined, "the recycled-pid fixture needs a readable start time");
    writePgidRows(f, [
      { id: "reboot-recycled-1", owner: { pid: survivor.pid, startTime }, frame: previousBootRowFrame() },
    ]);
    assert.equal((await f.run(["probe", "--id", "h2a-reboot-recycled"])).payload.verdict, "dead");
    const launched = await f.launch("reboot-recycled");
    assert.equal(launched.status, 0, JSON.stringify(launched));
    // The live occupant of the recycled pid number was never the owner and
    // must still be alive: nothing was signalled at it.
    process.kill(survivor.pid, 0);
    // The same real startup + handshake + PTY operation as every positive
    // scenario: publication succeeded over the recycled-pid rows.
    await assertServingThroughPublishedSocket(f, "h2a-reboot-recycled");
    process.kill(survivor.pid, 0);
  } finally {
    const exited = once(survivor, "exit");
    survivor.kill("SIGKILL");
    await exited;
  }
}));

test("should still refuse a live CURRENT-boot owner mixed with previous-boot rows", linux, () => fixture(async f => {
  const survivor = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { env: f.env, stdio: "ignore" });
  try {
    const startTime = readProcessStartTime(survivor.pid);
    assert.ok(startTime !== undefined);
    writePgidRows(f, [
      { id: "mixed-old-1", owner: { pid: 424242, startTime: 111 }, frame: previousBootRowFrame() },
      { id: "mixed-old-2", owner: { pid: 424243, startTime: 112 }, frame: previousBootRowFrame() },
      { id: "mixed-current", owner: { pid: survivor.pid, startTime }, frame: currentBootRowFrame() },
    ]);
    const probe = (await f.run(["probe", "--id", "h2a-mixed"])).payload;
    assert.equal(probe.verdict, "unknown");
    const launched = await f.launch("mixed");
    assert.equal(launched.payload.code, "native-inventory-unknown");
    assert.equal(launched.payload.creationAttempted, false);
    assert.equal(existsSync(f.paths[0]), false, "no socket may be published over a live current-boot owner");
    process.kill(survivor.pid, 0);
  } finally {
    const exited = once(survivor, "exit");
    survivor.kill("SIGKILL");
    await exited;
  }
}));

test("should still refuse a CURRENT-boot owner row without a start-time baseline among old rows", linux, () => fixture(async f => {
  writePgidRows(f, [
    { id: "baseline-old", owner: { pid: 424242, startTime: 111 }, frame: previousBootRowFrame() },
    // Current-boot row whose owner pid is long gone yet carries no baseline:
    // a dead pid alone proves nothing — the row stays indeterminate.
    { id: "baseline-current", owner: { pid: 999999 }, frame: currentBootRowFrame() },
  ]);
  const launched = await f.launch("baseline");
  assert.equal(launched.payload.code, "native-inventory-unknown");
  assert.equal(launched.payload.creationAttempted, false);
  assert.equal(existsSync(f.paths[0]), false);
}));

for (const [label, frameFactory] of [
  ["a foreign pid namespace", () => ({ ...currentBootRowFrame(), pgidPidNamespace: "4026599999" })],
  ["a foreign machine", () => ({ ...previousBootRowFrame(), pgidMachineId: "ffffffffffffffffffffffffffffffff" })],
  ["no frame anchors at all", () => ({})],
]) test(`should refuse boot-boundary-looking rows from ${label}: no false death proof`, linux, () => fixture(async f => {
  writePgidRows(f, [{ id: "foreign-looking", owner: { pid: 424242, startTime: 111 }, frame: frameFactory() }]);
  const probe = (await f.run(["probe", "--id", "h2a-foreign-looking"])).payload;
  assert.equal(probe.verdict, "unknown");
  const launched = await f.launch("foreign-looking");
  assert.equal(launched.payload.code, "native-inventory-unknown");
  assert.equal(launched.payload.creationAttempted, false);
  assert.equal(existsSync(f.paths[0]), false);
}));

test("should refuse to reclaim a current-boot socket over an unattributed pre-0.98.5 sidecar and previous-boot rows", linux, () => fixture(async f => {
  // Spec v5 T9b bounds the v3 "option A" migration by the socket inode age.
  // A CI fixture cannot forge an inode that predates the current boot —
  // birthtime is kernel-owned and the frame readers expose no falsifiable
  // environment seam — so this real-process test presents the adversarial
  // shape of the independent review: a socket created DURING the current
  // boot, a sidecar whose machine anchor is gone (pre-0.98.5) and rows of a
  // previous boot. Stale rows prove their AUTHORS dead, never that the
  // pathname is unheld (R4): reclamation is REFUSED, the socket file and the
  // sidecar survive untouched. The pre-boot-inode variant of the migration
  // (T9c) is covered through the injected ReadProcessFrame seam in
  // server.test.ts; the socket-absent cold path below stays allowed.
  const host = await f.start();
  const exited = once(host.child, "exit"); host.child.kill("SIGKILL"); await exited;
  assert.ok(existsSync(f.paths[0]));
  const ownerPath = `${f.paths[0]}.owner`;
  const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
  delete owner.machineId;
  owner.bootId = FABRICATED_PREVIOUS_BOOT_ID;
  writeFileSync(ownerPath, JSON.stringify(owner));
  writePgidRows(f, [
    { id: "migrate-old-1", owner: { pid: 424242, startTime: 111 }, frame: previousBootRowFrame() },
  ]);
  const probe = (await f.run(["probe", "--id", "h2a-migrate"])).payload;
  assert.equal(probe.verdict, "unknown");
  const launched = await f.launch("migrate");
  assert.equal(launched.payload.code, "native-inventory-unknown");
  assert.equal(launched.payload.creationAttempted, false);
  assert.ok(existsSync(f.paths[0]), "a current-boot socket is never unlinked over stale rows alone");
  const restamped = JSON.parse(readFileSync(ownerPath, "utf8"));
  assert.equal(restamped.machineId, undefined, "a refused publication must not re-stamp the sidecar");
  assert.equal(restamped.bootId, FABRICATED_PREVIOUS_BOOT_ID);
}));

test("should not block the cold path on an unattributed pre-0.98.5 sidecar", linux, () => fixture(async f => {
  // The controlled cold path: the socket pathname is gone, only a leftover
  // pre-0.98.5 sidecar remains. It is no evidence in either direction, so it
  // may not block the cold start — and publication re-stamps it.
  const ownerPath = `${f.paths[0]}.owner`;
  mkdirSync(dirname(f.paths[0]), { recursive: true, mode: 0o700 });
  writeFileSync(ownerPath, JSON.stringify({ dev: 1, ino: 1, pid: 424242, startTime: 1,
    bootId: FABRICATED_PREVIOUS_BOOT_ID, pidNamespace: currentBootRowFrame().pgidPidNamespace }), { mode: 0o600 });
  const launched = await f.launch("cold-sidecar");
  assert.equal(launched.status, 0, JSON.stringify(launched));
  await assertServingThroughPublishedSocket(f, "h2a-cold-sidecar");
  const restamped = JSON.parse(readFileSync(ownerPath, "utf8"));
  assert.equal(typeof restamped.machineId, "string", "publication must re-stamp the machine anchor");
}));

test("should refuse a machine-attributed previous-boot sidecar when a CURRENT-boot row is alive", linux, () => fixture(async f => {
  // Spec v3, gap c: the sidecar proves ITS publisher dead across the boot
  // boundary, but the registry still carries a row of THIS boot whose owner
  // is alive. The sidecar never decides alone: sidecar and registry must
  // agree, so the reclamation is refused and the stale socket stays.
  const survivor = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { env: f.env, stdio: "ignore" });
  try {
    const startTime = readProcessStartTime(survivor.pid);
    assert.ok(startTime !== undefined);
    const host = await f.start();
    const exited = once(host.child, "exit"); host.child.kill("SIGKILL"); await exited;
    assert.ok(existsSync(f.paths[0]));
    const ownerPath = `${f.paths[0]}.owner`;
    const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
    assert.equal(typeof owner.machineId, "string");
    owner.bootId = FABRICATED_PREVIOUS_BOOT_ID;
    writeFileSync(ownerPath, JSON.stringify(owner));
    writePgidRows(f, [
      { id: "sidecar-dead-row-live", owner: { pid: survivor.pid, startTime }, frame: currentBootRowFrame() },
    ]);
    const probe = (await f.run(["probe", "--id", "h2a-sidecar-row"])).payload;
    assert.equal(probe.verdict, "unknown");
    const launched = await f.launch("sidecar-row");
    assert.equal(launched.payload.code, "native-inventory-unknown");
    assert.equal(launched.payload.creationAttempted, false);
    assert.ok(existsSync(f.paths[0]), "the stale socket must not be reclaimed over a live current-boot owner");
    process.kill(survivor.pid, 0);
  } finally {
    const exited = once(survivor, "exit");
    survivor.kill("SIGKILL");
    await exited;
  }
}));

test("should reclaim a persistent stale socket through its machine-attributed previous-boot sidecar", linux, () => fixture(async f => {
  const host = await f.start();
  const exited = once(host.child, "exit"); host.child.kill("SIGKILL"); await exited;
  assert.ok(existsSync(f.paths[0]));
  // The reboot, reproduced in CI: the sidecar keeps THIS machine's anchors and
  // takes a boot id from the previous boot.
  const ownerPath = `${f.paths[0]}.owner`;
  const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
  assert.equal(typeof owner.machineId, "string", "current sidecars must carry the machine anchor");
  owner.bootId = FABRICATED_PREVIOUS_BOOT_ID;
  writeFileSync(ownerPath, JSON.stringify(owner));
  assert.equal((await f.run(["probe", "--id", "h2a-new-sidecar"])).payload.verdict, "dead");
  const launched = await f.launch("new-sidecar");
  assert.equal(launched.status, 0, JSON.stringify(launched));
  await assertServingThroughPublishedSocket(f, "h2a-new-sidecar");
}));

test("should admit no second owning host over a live host that lost its pathname, under concurrent starts", linux, () => fixture(async f => {
  const host = await f.start();
  unlinkSync(`${f.paths[0]}.owner`);
  unlinkSync(f.paths[0]);
  assert.deepEqual(await host.client.ping(), host.ping);
  const refusals = await Promise.all([f.launch("concurrent-1"), f.launch("concurrent-2")]);
  for (const refused of refusals) {
    assert.equal(refused.payload.code, "native-inventory-unknown");
    assert.equal(refused.payload.creationAttempted, false);
  }
  assert.equal(existsSync(f.paths[0]), false, "no second publisher may install the vanished pathname");
  assert.deepEqual(await host.client.ping(), host.ping, "the live host must remain the only owner");
}));
