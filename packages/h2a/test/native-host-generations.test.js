import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
function resolvedPath(path, depth = 0) {
  const absolute = resolve(path);
  assert.ok(absolute !== "/run/user/1000/h2a-nt" && !absolute.startsWith("/run/user/1000/h2a-nt/"),
    `REFUSING owner runtime path before filesystem access: ${absolute}`);
  assert.ok(depth < 32, "REFUSING cyclic qualification symlink");
  const parts = absolute.split("/").filter(Boolean);
  let current = "/";
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    let info;
    try { info = lstatSync(current); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      return join(current, ...parts.slice(index + 1));
    }
    if (info.isSymbolicLink()) return resolvedPath(join(resolve(dirname(current), readlinkSync(current)),
      ...parts.slice(index + 1)), depth + 1);
  }
  return current;
}

test("should refuse owner runtime paths, escaping symlinks and uncontained paths before starting any process", {
  skip: process.platform !== "linux" && "Linux qualification path guard",
}, () => {
  const root = realpathSync(mkdtempSync("/tmp/h2a-qual-"));
  try {
    for (const path of ["/run/user/1000/h2a-nt/socket", "/run/user/1000/h2a-nt/../h2a-nt/socket", "/tmp/outside-qualification/socket"]) {
      assert.throws(() => assertPrivatePaths(root, [path]), /REFUSING/);
    }
    const link = join(root, "escape");
    symlinkSync("/run/user/1000/h2a-nt", link);
    assert.throws(() => assertPrivatePaths(root, [join(link, "socket")]));
    assertPrivatePaths(root, [join(root, "new-directory/socket")]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

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

async function withLegacy(context, body, historicalEntry = legacyEntry) {
  assert.equal(unavailable, false, String(unavailable)); // Required evidence must never skip.
  const root = realpathSync(mkdtempSync("/tmp/h2a-qual-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const socketPath = join(root, "h2a-nt", "native-terminal.sock");
  const registryPath = join(home, ".config/sentropic/h2a/registry.json");
  const env = { PATH: "/usr/bin:/bin", HOME: home, XDG_RUNTIME_DIR: root,
    XDG_CONFIG_HOME: join(home, ".config"), REMOTE_CLI_CONFIG_HOME: home,
    H2A_ROOT: join(workspace, ".h2a"), H2A_SESSION_HOST: "native",
    H2A_NATIVE_SOCKET: socketPath, TMPDIR: join(root, "tmp"), TMUX_TMPDIR: join(root, "tmp"), TERM: "xterm-256color" };
  for (const path of [home, workspace, env.TMPDIR]) mkdirSync(path, { mode: 0o700 });
  assertPrivatePaths(root, [home, workspace, socketPath, registryPath, env.XDG_CONFIG_HOME, env.H2A_ROOT, env.TMPDIR,
    defaultNativeTerminalSocketPath(env)]);
  assert.equal(defaultNativeTerminalSocketPath(env), socketPath);
  context.diagnostic(`isolation: ${JSON.stringify({ root, socketPath, home, registryPath, workspace })}`);
  const host = start(process.execPath, [historicalEntry, "--socket", socketPath, "--generation", `legacy-${root.split("-").pop()}`,
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
    assert.equal(ping.launchFence === true, historicalEntry !== legacyEntry);
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

async function compatibleHost(fixture, entry = join(repo, "packages/h2a-runtime/dist/native-terminal/process.js")) {
  const socketPath = join(dirname(fixture.socketPath), "native-terminal.lf1.sock");
  assertPrivatePaths(fixture.root, [socketPath]);
  const host = start(process.execPath, [entry,
    "--socket", socketPath, "--generation", "compatible-qualification", "--registry-path",
    join(fixture.home, ".config/sentropic/h2a/registry.json")], fixture.env);
  fixture.children.push(host);
  await eventually(() => host.output(), output => {
    assert.equal(host.child.exitCode, null, output.stderr);
    return output.stdout.includes("h2a.native-terminal.ready");
  });
  return { socketPath, host };
}

async function op(fixture, args, overrides = {}) {
  const child = start(process.execPath, [join(repo, "packages/h2a-runtime/dist/native-terminal/op.js"), ...args],
    { ...fixture.env, H2A_NATIVE_SOCKET: "", ...overrides });
  fixture.children.push(child);
  child.child.stdin.end();
  const result = await child.closed;
  return { ...result, payload: result.stdout.trim() ? JSON.parse(result.stdout.trim()) : undefined };
}

async function echoSession(client, fixture, id) {
  return client.create({ id, command: "/bin/bash", args: ["--noprofile", "--norc", "-c",
    "printf 'ready\\n'; while IFS= read -r line; do printf 'echo:%s\\n' \"$line\"; done"],
    cwd: fixture.workspace, env: fixture.env, cols: 80, rows: 24 });
}

test("should retain an already-compatible historical launch host", {
  skip: process.platform !== "linux" ? unavailable : !required && unavailable,
}, async context => withLegacy(context, async fixture => {
  await compatibleHost(fixture);
  const source = `import {startNativeSession} from ${JSON.stringify(pathToFileURL(runtime).href)};
    let owner;const started=startNativeSession("codex","/bin/bash",${JSON.stringify(fixture.workspace)},
      ["--noprofile","--norc","-c","read -r line"],"compatible-historical",{beforeCreate:value=>{owner=value;},refuseExisting:true});
    console.log(JSON.stringify({owner,started}));`;
  const launch = start(process.execPath, ["--input-type=module", "-e", source], { ...fixture.env, H2A_NATIVE_SOCKET: "" });
  fixture.children.push(launch);launch.child.stdin.end();
  const result = await launch.closed;
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).owner.socketPath, fixture.socketPath);
  await fixture.unchanged();
}, join(repo, "packages/h2a-runtime/dist/native-terminal/process.js")));

test("should verify launchFence rather than trusting the compatible socket name", {
  skip: process.platform !== "linux" ? unavailable : !required && unavailable,
}, async context => withLegacy(context, async fixture => {
  const compatible = await compatibleHost(fixture, legacyEntry);
  const source = `import {startNativeSession} from ${JSON.stringify(pathToFileURL(runtime).href)};
    try{startNativeSession("codex","/bin/bash",${JSON.stringify(fixture.workspace)},[],"false-capability",{beforeCreate:()=>{}});}
    catch(error){console.log(JSON.stringify(error.toRunFailure("false-capability")));process.exitCode=1;}`;
  const launch = start(process.execPath, ["--input-type=module", "-e", source], { ...fixture.env, H2A_NATIVE_SOCKET: "" });
  fixture.children.push(launch);launch.child.stdin.end();
  const result = await launch.closed;
  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.code, "native-host-capability-mismatch");
  assert.equal(failure.creationAttempted, false);
  assert.equal(failure.host.socketPath, compatible.socketPath);
  await fixture.unchanged();
}));

test("should fence a structured headless launch on the compatible generation", {
  skip: process.platform !== "linux" ? unavailable : !required && unavailable,
}, async context => withLegacy(context, async fixture => {
  const compatible = await compatibleHost(fixture);
  const source = `import {startNativeHeadlessSession} from ${JSON.stringify(pathToFileURL(runtime).href)};
    let owner;const started=startNativeHeadlessSession("codex","/bin/bash",${JSON.stringify(fixture.workspace)},
      ["--noprofile","--norc","-c","printf 'headless-once\\\\n'"],${JSON.stringify(join(fixture.root, "result.json"))},
      ${JSON.stringify(join(fixture.root, "output.log"))},"headless-generation",undefined,true,undefined,undefined,value=>{owner=value;});
    console.log(JSON.stringify({owner,started}));`;
  const launch = start(process.execPath, ["--input-type=module", "-e", source], { ...fixture.env, H2A_NATIVE_SOCKET: "" });
  fixture.children.push(launch);launch.child.stdin.end();
  const result = await launch.closed;
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).owner.socketPath, compatible.socketPath);
  await eventually(async () => existsSync(join(fixture.root, "result.json")), Boolean);
  assert.equal(JSON.parse(readFileSync(join(fixture.root, "result.json"), "utf8")).exitCode, 0);
  await fixture.unchanged();
}));

test("should clean a guard's owned incarnation on its receipt socket only", {
  skip: process.platform !== "linux" ? unavailable : !required && unavailable,
}, async context => withLegacy(context, async fixture => {
  const compatible = await compatibleHost(fixture);
  const second = await NativeTerminalClient.connect(compatible.socketPath);
  try {
    const id = "h2a-guard-duplicate";
    const old = await echoSession(fixture.client, fixture, id);
    const owned = await echoSession(second, fixture, id);
    const receiptPath = join(fixture.root, "guard-launch.json");
    const guard = start(process.execPath, [join(repo, "packages/h2a-runtime/dist/launch-guard.js"), receiptPath],
      { ...fixture.env, H2A_NATIVE_SOCKET: "", H2A_RUN_LAUNCH_TOKEN: "qualification-guard" });
    fixture.children.push(guard);
    guard.child.stdin.end(JSON.stringify({ ownership: { host: "native", sessions: [{ name: id,
      generation: owned.generation, incarnation: owned.incarnation, socketPath: compatible.socketPath }] } }) + "\n");
    const result = await guard.closed;
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(receiptPath, "utf8")).state, "stopped");
    assert.equal((await second.state(id)).status, "exited");
    assert.equal((await fixture.client.state(id)).pid, old.pid);
    assert.equal((await fixture.client.state(id)).status, "running");
    await fixture.unchanged();
  } finally { second.close(); }
}));

test("should launch once through MCP h2a_run on the compatible fleet and deliver one brief", {
  skip: process.platform !== "linux" ? unavailable : !required && unavailable,
}, async context => withLegacy(context, async fixture => {
  const compatible = await compatibleHost(fixture);
  const bin = join(fixture.home, "bin");
  mkdirSync(bin, { mode: 0o700 });
  const delivered = join(fixture.root, "delivered.jsonl");
  assertPrivatePaths(fixture.root, [bin, delivered]);
  writeFileSync(join(bin, "codex"), `#!${process.execPath}
import {appendFileSync} from 'node:fs';
process.stdin.setRawMode(true); process.stdin.resume();
process.stdout.write('Qualification CLI\\r\\nmodel: qualification · /private/workspace\\r\\n› ');
let text=''; process.stdin.on('data', bytes=>{
  const chunk=bytes.toString().replace(/\\x1b\\[20[01]~/g,'');
  for (const character of chunk) {
    if(character==='\\x15') {text='';continue;}
    if(character==='\\r') {
      appendFileSync(${JSON.stringify(delivered)},JSON.stringify(text)+'\\n');
      process.stdout.write('\\r\\nWorking (esc to interrupt)\\r\\n');text='';
    } else {text+=character;process.stdout.write(character);}
  }
});`, { mode: 0o700 });
  // The runtime's bash login wrapper must resolve only this trivial fixture.
  writeFileSync(join(fixture.home, ".bash_profile"), `export PATH='${bin}:/usr/bin:/bin'\n`, { mode: 0o600 });
  const request = { name: "qualification-mcp", profile: "codex", workspace: fixture.workspace,
    prompt: "one qualification brief", background: true, gateway: "off", headless: false, h2aSidecar: false };
  const source = `import {runMcpStdio} from ${JSON.stringify(pathToFileURL(join(repo, "packages/h2a/dist/index.js")).href)};
    await runMcpStdio({root:${JSON.stringify(fixture.env.H2A_ROOT)},workspaceRoot:${JSON.stringify(fixture.workspace)},
      stdin:process.stdin,stdout:process.stdout,stderr:process.stderr});`;
  const mcp = start(process.execPath, ["--input-type=module", "-e", source], { ...fixture.env, PATH: `${bin}:/usr/bin:/bin`, H2A_NATIVE_SOCKET: "" });
  fixture.children.push(mcp);
  const responses = () => mcp.output().stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  mcp.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "h2a_run", arguments: request } }) + "\n");
  // This is the real launch/readiness protocol; use its existing response
  // budget, rather than the short fixture host-start polling budget.
  const deadline = Date.now() + 49_000;
  while (!responses().some(response => response.id === 1)) {
    assert.ok(Date.now() < deadline, JSON.stringify(mcp.output()));
    assert.equal(mcp.child.exitCode, null, JSON.stringify(mcp.output()));
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const first = JSON.parse(responses().find(response => response.id === 1).result.content[0].text);
  context.diagnostic(`MCP real launch: ${JSON.stringify(first)}`);
  assert.equal(first.state, "started", JSON.stringify(first));
  assert.equal(first.session.socketPath, compatible.socketPath);
  mcp.child.stdin.end(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "h2a_run", arguments: { ...request, prompt: "must never deliver twice" } } }) + "\n");
  const result = await mcp.closed;
  assert.equal(result.status, 0, result.stderr);
  const secondResult = JSON.parse(responses().find(response => response.id === 2).result.content[0].text);
  assert.deepEqual(secondResult, first);
  assert.deepEqual(readFileSync(delivered, "utf8").trim().split("\n").map(line => JSON.parse(line)), [request.prompt]);
  const second = await NativeTerminalClient.connect(compatible.socketPath);
  try {
    assert.equal((await second.list()).filter(session => session.id === "h2a-qualification-mcp").length, 1);
    const receipt = JSON.parse(readFileSync(join(fixture.workspace, ".h2a/runs/qualification-mcp/launch.json"), "utf8"));
    assert.equal(receipt.ownership.sessions[0].socketPath, compatible.socketPath);
  } finally { second.close(); }
  await fixture.unchanged();
}));

test("should route each by-name operation to the observed owner across real historical and compatible hosts", {
  skip: process.platform !== "linux" ? unavailable : !required && unavailable,
}, async context => withLegacy(context, async fixture => {
  const compatible = await compatibleHost(fixture);
  const second = await NativeTerminalClient.connect(compatible.socketPath);
  try {
    for (const [client, socketPath, id] of [[fixture.client, fixture.socketPath, "h2a-old"], [second, compatible.socketPath, "h2a-new"]]) {
      const state = await echoSession(client, fixture, id);
      assert.equal((await op(fixture, ["state", "--id", id])).payload.socketPath, socketPath);
      assert.equal((await op(fixture, ["probe", "--id", id])).payload.state.socketPath, socketPath);
      assert.equal((await op(fixture, ["pid", "--id", id])).payload.pid, state.pid);
      for (const [verb, flags] of [["write", ["--b64", Buffer.from("route-write").toString("base64")]],
        ["enter", []], ["paste", ["--b64", Buffer.from("route-paste").toString("base64")]],
        ["enter", []], ["resize", ["--cols", "91", "--rows", "27"]]]) {
        const result = await op(fixture, [verb, "--id", id, ...flags]);
        assert.equal(result.status, 0, `${verb} ${id}: ${result.stderr}`);
      }
      assert.match((await op(fixture, ["capture", "--id", id])).payload.text, /route-write/);
      const driven = await op(fixture, ["drive", "--id", id, "--target", id,
        "--b64", Buffer.from("route-drive").toString("base64")], { H2A_WAKE_DEFER_ACTIVITY_MS: "0" });
      assert.equal(driven.payload.outcome, "driven", JSON.stringify(driven));
      await eventually(() => client.readOutput(id, 0), output => output.chunks.some(chunk => chunk.data.includes("echo:route-drive")));
      const actuatorSource = `import {createH2aPtyActuator,resolveActuationTarget} from ${JSON.stringify(pathToFileURL(join(repo, "packages/h2a/dist/runtime/drive/pty-actuator.js")).href)};
        const ref=${JSON.stringify(`h2a-pty:v1:${id}`)};const target=resolveActuationTarget(ref);
        const actuator=createH2aPtyActuator({resolveActuationTarget:()=>target});
        const result=await actuator.actuate({action:"drive",registration:{actuatorRef:ref},resolvedInstruction:{instructionLine:"route-actuator"}});
        console.log(JSON.stringify({target,result}));`;
      const actuator = start(process.execPath, ["--input-type=module", "-e", actuatorSource],
        { ...fixture.env, H2A_NATIVE_SOCKET: "", H2A_WAKE_DEFER_ACTIVITY_MS: "0" });
      fixture.children.push(actuator);actuator.child.stdin.end();
      const actuation = await actuator.closed;
      assert.equal(actuation.status, 0, actuation.stderr);
      assert.equal(JSON.parse(actuation.stdout).target.socketPath, socketPath);
      assert.equal(JSON.parse(actuation.stdout).result.outcome, "acted");
      await eventually(() => client.readOutput(id, 0), output => output.chunks.some(chunk => chunk.data.includes("echo:route-actuator")));
      const sidecarSource = `import {startNativeH2aSidecar} from ${JSON.stringify(pathToFileURL(runtime).href)};
        const started=startNativeH2aSidecar(${JSON.stringify(id)},${JSON.stringify(fixture.workspace)},"read -r line");
        console.log(JSON.stringify({started}));`;
      const sidecar = start(process.execPath, ["--input-type=module", "-e", sidecarSource], { ...fixture.env, H2A_NATIVE_SOCKET: "" });
      fixture.children.push(sidecar);sidecar.child.stdin.end();
      const companion = await sidecar.closed;
      assert.equal(companion.status, 0, companion.stderr);
      assert.equal(JSON.parse(companion.stdout).started, true);
      assert.equal((await op(fixture, ["state", "--id", `${id}.h2a`])).payload.socketPath, socketPath);
      const attach = start(process.execPath, [join(repo, "packages/h2a-runtime/dist/native-terminal/op.js"), "attach", "--id", id],
        { ...fixture.env, H2A_NATIVE_SOCKET: "" });
      fixture.children.push(attach);
      await eventually(() => client.state(id), state => state.controlled === true);
      attach.child.stdin.end(Buffer.from([0x1c]));
      assert.equal((await attach.closed).status, 0);
      const stop = await op(fixture, ["kill-if-incarnation", "--id", id, "--generation", state.generation,
        "--incarnation", String(state.incarnation)]);
      assert.equal(stop.status, 0, stop.stderr);
      assert.equal((await client.state(id)).status, "exited");
      const treeSource = `import {killNativeSessionTree} from ${JSON.stringify(pathToFileURL(runtime).href)};
        console.log(JSON.stringify({stopped:killNativeSessionTree(${JSON.stringify(id)})}));`;
      const tree = start(process.execPath, ["--input-type=module", "-e", treeSource], { ...fixture.env, H2A_NATIVE_SOCKET: "" });
      fixture.children.push(tree);tree.child.stdin.end();
      const stoppedTree = await tree.closed;
      assert.equal(stoppedTree.status, 0, stoppedTree.stderr);
      assert.equal(JSON.parse(stoppedTree.stdout).stopped, true);
      assert.equal((await client.state(`${id}.h2a`)).status, "exited");
      const killed = await echoSession(client, fixture, `${id}-kill`);
      assert.equal((await op(fixture, ["kill", "--id", killed.id])).status, 0);
      const stopped = await echoSession(client, fixture, `${id}-stop`);
      assert.equal((await op(fixture, ["stop", "--id", stopped.id])).status, 0);
      assert.equal((await client.state(stopped.id)).status, "exited");
      const fencedStop = await echoSession(client, fixture, `${id}-fenced-stop`);
      assert.equal((await op(fixture, ["stop-if-incarnation", "--id", fencedStop.id, "--generation", fencedStop.generation,
        "--incarnation", String(fencedStop.incarnation)])).status, 0);
      assert.equal((await client.state(fencedStop.id)).status, "exited");
      context.diagnostic(`routing ${socketPath}: state, probe, pid, write, paste, enter, resize, capture, drive, attach, kill-if-incarnation, kill passed`);
    }
    const listed = (await op(fixture, ["list"])).payload;
    assert.equal(listed.complete, true);
    assert.equal(listed.sessions.find(session => session.id === "legacy-sentinel").socketPath, fixture.socketPath);
    await fixture.unchanged();
  } finally { second.close(); }
}));

test("should refuse ambiguous owners without attaching, writing, driving or stopping either session", {
  skip: process.platform !== "linux" ? unavailable : !required && unavailable,
}, async context => withLegacy(context, async fixture => {
  const compatible = await compatibleHost(fixture);
  const second = await NativeTerminalClient.connect(compatible.socketPath);
  try {
    const id = "h2a-duplicate";
    await echoSession(fixture.client, fixture, id);
    await echoSession(second, fixture, id);
    const listed = (await op(fixture, ["list"])).payload;
    assert.equal(listed.sessions.filter(session => session.id === id).length, 2);
    for (const verb of ["state", "probe", "pid", "capture", "write", "paste", "enter", "resize", "attach", "kill", "stop", "kill-if-incarnation", "stop-if-incarnation", "drive"]) {
      const result = await op(fixture, [verb, "--id", id, "--target", id, "--b64", Buffer.from("forbidden").toString("base64"),
        "--generation", "g", "--incarnation", "i", "--cols", "80", "--rows", "24"]);
      assert.equal(result.payload?.code, "ambiguous-owner", `${verb}: ${JSON.stringify(result)}`);
    }
    const source = `import {createH2aPtyActuator} from ${JSON.stringify(pathToFileURL(join(repo, "packages/h2a/dist/runtime/drive/pty-actuator.js")).href)};
      import {writePresence} from ${JSON.stringify(pathToFileURL(join(repo, "packages/h2a/dist/runtime/local-files/presence.js")).href)};
      const at=new Date().toISOString();writePresence(process.env.H2A_ROOT,{sessionId:"qualification-ambiguous",instance:${JSON.stringify(id)},
        host:"codex",startedAt:at,heartbeatAt:at,state:"live",interests:{scopes:[],negotiations:[]},subscribedTopics:[],
        launchContext:{cwd:${JSON.stringify(fixture.workspace)},command:"/bin/true"}});
      let relaunches=0;const port=createH2aPtyActuator({relaunchers:{opaque:{relance:async()=>{relaunches++;return true;}}}});
      const registration={actuatorRef:${JSON.stringify(`h2a-pty:v1:${id}`)}};
      const state=await port.probeState(registration.actuatorRef);
      const driven=await port.actuate({action:"drive",registration,resolvedInstruction:{instructionLine:"forbidden"}});
      const relaunched=await port.actuate({action:"relaunch",registration});
      console.log(JSON.stringify({state,driven,relaunched,relaunches}));`;
    const actuator = start(process.execPath, ["--input-type=module", "-e", source], { ...fixture.env, H2A_NATIVE_SOCKET: "" });
    fixture.children.push(actuator);actuator.child.stdin.end();
    const result = await actuator.closed;
    assert.equal(result.status, 0, result.stderr);
    const verdict = JSON.parse(result.stdout);
    assert.equal(verdict.state, "unknown");
    assert.equal(verdict.driven.outcome, "failed");
    assert.equal(verdict.relaunched.outcome, "deferred");
    assert.equal(verdict.relaunches, 0);
    for (const client of [fixture.client, second]) {
      assert.equal((await client.state(id)).status, "running");
      assert.equal((await client.state(id)).controlled, false);
      assert.ok(!(await client.readOutput(id, 0)).chunks.some(chunk => chunk.data.includes("forbidden")));
    }
    await fixture.unchanged();
  } finally { second.close(); }
}));

test("should refuse agent and sidecar collisions before any containment registry write", {
  skip: process.platform !== "linux" ? unavailable : !required && unavailable,
}, async context => withLegacy(context, async fixture => {
  await compatibleHost(fixture);
  for (const colliding of ["h2a-collision-agent", "h2a-collision-sidecar.h2a"]) {
    await echoSession(fixture.client, fixture, colliding);
    const registryPath = join(fixture.home, ".config/sentropic/h2a/registry.json");
    const before = readFileSync(registryPath, "utf8");
    const source = `import {startNativeSession} from ${JSON.stringify(pathToFileURL(runtime).href)};
      try {startNativeSession("codex","/bin/bash",${JSON.stringify(fixture.workspace)},[],${JSON.stringify(colliding.endsWith(".h2a") ? "collision-sidecar" : "collision-agent")},
        {beforeCreate:()=>{},refuseExisting:true,onCreateAttempt:()=>{throw new Error("create marker reached");}});}
      catch(error){console.log(JSON.stringify(error.toRunFailure?.("collision") ?? {message:error.message}));process.exitCode=1;}`;
    const launch = start(process.execPath, ["--input-type=module", "-e", source], { ...fixture.env, H2A_NATIVE_SOCKET: "" });
    fixture.children.push(launch); launch.child.stdin.end();
    const result = await launch.closed;
    const failure = JSON.parse(result.stdout);
    assert.equal(result.status, 1);
    assert.equal(failure.code, "native-name-collision");
    assert.equal(failure.id, colliding);
    assert.equal(failure.state, "not-started");
    assert.equal(failure.creationAttempted, false);
    assert.equal(readFileSync(registryPath, "utf8"), before);
  }
  await fixture.unchanged();
}));

test("should report an incomplete inventory and unknown absence when the historical endpoint is unreachable", {
  skip: process.platform !== "linux" ? unavailable : !required && unavailable,
}, async context => withLegacy(context, async fixture => {
  const compatible = await compatibleHost(fixture);
  const second = await NativeTerminalClient.connect(compatible.socketPath);
  try {
    await echoSession(second, fixture, "h2a-survivor");
    const historical = fixture.children[0];
    historical.child.kill("SIGTERM"); // Only a host started by this fixture.
    await historical.closed;
    const inventory = (await op(fixture, ["list"])).payload;
    assert.equal(inventory.complete, false);
    assert.equal((await op(fixture, ["probe", "--id", "h2a-missing"])).payload.verdict, "unknown");
    assert.equal((await op(fixture, ["probe", "--id", "h2a-survivor"])).payload.verdict, "live");
    const source = `import {startNativeSession} from ${JSON.stringify(pathToFileURL(runtime).href)};
      try{startNativeSession("codex","/bin/bash",${JSON.stringify(fixture.workspace)},[],"missing",{beforeCreate:()=>{},
        onCreateAttempt:()=>{throw new Error("creation must never be reached");}});}
      catch(error){console.log(JSON.stringify(error.toRunFailure?.("missing")??{message:error.message}));process.exitCode=1;}`;
    const launch = start(process.execPath, ["--input-type=module", "-e", source], { ...fixture.env, H2A_NATIVE_SOCKET: "" });
    fixture.children.push(launch);launch.child.stdin.end();
    const result = await launch.closed;
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).code, "native-inventory-unknown");
    assert.equal(JSON.parse(result.stdout).creationAttempted, false);
    assert.equal((await second.list()).filter(session => session.id === "h2a-missing").length, 0);
  } finally { second.close(); }
}));

test("should select a second compatible host and preserve the historical sentinel (spec §8/L0; phase A)", {
  skip: process.platform !== "linux" ? unavailable : !required && unavailable,
}, async context => {
  await withLegacy(context, async fixture => {
    await compatibleHost(fixture);
    // Empty override exercises automatic selection, bounded to the explicitly
    // checked XDG_RUNTIME_DIR; an imposed endpoint has its separate test below.
    const env = { ...fixture.env, H2A_NATIVE_SOCKET: "" };
    assertPrivatePaths(fixture.root, [defaultNativeTerminalSocketPath(env)]);
    const source = `import {startNativeSession,ensureNativeHost} from ${JSON.stringify(pathToFileURL(runtime).href)};
      try { let ownership; const started = startNativeSession("codex", "/bin/bash", ${JSON.stringify(fixture.workspace)},
        ["--noprofile", "--norc", "-c", "printf 'new-launch-ready\\n'; read -r line"], "qualification-new",
        {terminateOnAgentExit:true, refuseExisting:true, beforeCreate:value=>{ownership=value;}});
        console.log(JSON.stringify({started,ownership,host:ensureNativeHost({fenced:true})}));
      } catch(error) { console.error(error.message); process.exitCode=1; }`;
    const launch = start(process.execPath, ["--input-type=module", "-e", source], env);
    fixture.children.push(launch);
    launch.child.stdin.end();
    const result = await launch.closed;
    context.diagnostic(`raw historical launch: ${JSON.stringify(result)}`);
    await fixture.unchanged();
    if (result.status !== 0) {
      assert.match(result.stderr, /does not provide launchFence|native host cannot reserve launch ownership;/);
      assert.deepEqual((await fixture.client.list()).map(session => session.id), ["legacy-sentinel"]);
    }
    await context.test("should serve the new fenced launch on a second compatible host (spec §8/L0)", async () => {
      assert.equal(result.status, 0, result.stderr);
      const { host, ownership, started } = JSON.parse(result.stdout);
      assert.equal(host.launchFence, true);
      assert.notEqual(host.hostPid, fixture.ping.hostPid);
      assert.notEqual(host.generation, fixture.ping.generation);
      assert.notEqual(host.socketPath, fixture.socketPath);
      assert.equal(ownership.generation, host.generation);
      assert.equal(ownership.socketPath, host.socketPath);
      assert.ok(started.pid > 0);
      assertPrivatePaths(fixture.root, [host.socketPath]);
      const second = await NativeTerminalClient.connect(host.socketPath);
      try {
        assert.equal((await second.state(started.name)).incarnation, ownership.incarnation);
        await eventually(() => second.readOutput(started.name, 0), output => output.chunks.some(chunk => chunk.data.includes("new-launch-ready")));
      } finally { second.close(); }
    });
  });
});

test("should refuse an explicitly imposed historical endpoint before creation with the typed CLI diagnostic (spec §7/D5)", {
  skip: process.platform !== "linux" ? unavailable : !required && unavailable,
}, async context => {
  await withLegacy(context, async fixture => {
    const launch = start(process.execPath, [join(repo, "packages/h2a/dist/bin.js"), "run", "codex", fixture.workspace,
      "--no-attach", "--background", "--json", "--name", "qualification-explicit", "--prompt-stdin", "--no-h2a", "--no-gw"], fixture.env);
    fixture.children.push(launch);
    launch.child.stdin.end("trivial qualification brief");
    const result = await launch.closed;
    context.diagnostic(`raw explicit-endpoint launch: ${JSON.stringify(result)}`);
    await fixture.unchanged();
    assert.equal(result.status, 1);
    assert.ok(!result.stderr.includes('"phase":"creation-attempted"'), result.stderr);
    assert.match(result.stderr, /Launch refused before creation/);
    assert.match(result.stderr, /No restart of the existing host is necessary/);
    assert.deepEqual(JSON.parse(result.stdout), {
      kind: "h2a.run.failure", version: 1, state: "not-started", launchId: "qualification-explicit",
      code: "native-host-capability-mismatch", phase: "host-selection", creationAttempted: false, retrySafe: true,
      missingCapabilities: ["launchFence"],
      host: { socketPath: fixture.socketPath, generation: fixture.ping.generation, hostPid: fixture.ping.hostPid },
      recovery: { action: "select-compatible-generation", automaticRetry: false },
    });
    assert.deepEqual((await fixture.client.list()).map(session => session.id), ["legacy-sentinel"]);
  });
});
