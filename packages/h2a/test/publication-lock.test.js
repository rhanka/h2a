import { createPrivateTestDirectory, nativeTestEnvironment, spawnIsolatedNative as spawn, setupNativeTestEnvironment, stopPrivateNativeProcesses } from "./helpers/native-isolation.js";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { NativeTerminalClient } from "../../h2a-runtime/dist/native-terminal/client.js";

setupNativeTestEnvironment(test.after);
const entry = resolve(import.meta.dirname, "../../h2a-runtime/dist/native-terminal/process.js");
function fixture() {
  const root = createPrivateTestDirectory("k");
  const env = nativeTestEnvironment(root, { H2A_NATIVE_HOST_LOG: join(root, "state", "journal") });
  return { root, env, path: join(root, "h") };
}
function child(command, args, env) {
  const process = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  process.stdout.on("data", bytes => { stdout += bytes; });
  process.stderr.on("data", bytes => { stderr += bytes; });
  const exited = once(process, "exit");
  const closed = once(process, "close");
  return { process, exited, closed, output: () => ({ stdout, stderr }) };
}
async function stop(started) {
  if (started.process.exitCode === null && started.process.signalCode === null) {
    started.process.kill("SIGKILL"); await started.exited;
  }
  await started.closed;
}
async function ready(started, marker = "ready") {
  while (!started.output().stdout.includes(marker)) {
    await Promise.race([once(started.process.stdout, "data"), started.exited.then(() => { throw new Error(started.output().stderr); })]);
  }
}

function fixtureCleanup(t, f, children) {
  let cleanup;
  const run = () => cleanup ??= (async () => {
    // Pin descendants before host death and reap even if Node cancels the test.
    try { await stopPrivateNativeProcesses(f.env); }
    finally { for (const started of children) await stop(started); }
    rmSync(f.root, { recursive: true, force: true });
  })();
  t.after(run);
  return run;
}

test("should bound cross-process publication lock contention at 5 seconds and release only its own resources", { timeout: 9_000 }, async (t) => {
  const f = fixture(), secret = randomUUID();
  const children = [], cleanup = fixtureCleanup(t, f, children);
  const identity = join(f.root, ".h2a-native-terminal.lock-id");
  writeFileSync(identity, `${secret}\n`, { mode: 0o600 });
  const address = "\0h2a-terminal-lock-" + createHash("sha256").update(`${process.getuid()}:${f.path}:${secret}`).digest("hex");
  const holder = child(process.execPath, ["--input-type=module", "-e", `import {createServer} from 'node:net';
    const server=createServer();server.listen(${JSON.stringify(address)},()=>console.log('ready'));`], f.env);
  children.push(holder);
  let contender;
  try {
    await ready(holder);
    const begun = Date.now();
    contender = child(process.execPath, [entry, "--socket", f.path, "--registry-path", join(f.root, "registry.json")], f.env);
    children.push(contender);
    const [status] = await contender.closed;
    assert.equal(status, 3, contender.output().stderr);
    assert.match(contender.output().stderr, /H2A_SOCKET_PUBLICATION_TIMEOUT/);
    assert.match(contender.output().stderr, /terminal host socket publication timed out/);
    assert.ok(Date.now() - begun >= 4_900 && Date.now() - begun < 6_200);
    assert.equal(holder.process.exitCode, null);
    assert.equal(readFileSync(identity, "utf8").trim(), secret);
    assert.equal(existsSync(f.path), false);
    assert.match(readFileSync(join(f.env.XDG_STATE_HOME, "h2a", "native-host.log"), "utf8"), /"event":"startupError"/);
  } finally { await cleanup(); }
});

test("should release the startup election when its launcher is SIGKILLed", { timeout: 8_000 }, async t => {
  const f = fixture(), children = [];
  const cleanup = fixtureCleanup(t, f, children);
  const module = pathToFileURL(resolve(import.meta.dirname, "../../h2a-runtime/dist/native-terminal/server.js")).href;
  const prefix = `import {withNativeTerminalStartupLock} from ${JSON.stringify(module)};`;
  try {
    const holder = child(process.execPath, ["--input-type=module", "-e", `${prefix}
      await withNativeTerminalStartupLock(${JSON.stringify(f.path)}, () => new Promise(() => console.log('ready')));`], f.env);
    children.push(holder);
    await ready(holder);
    const successor = child(process.execPath, ["--input-type=module", "-e", `${prefix}
      console.log('waiting');
      await withNativeTerminalStartupLock(${JSON.stringify(f.path)}, async () => console.log('entered'));`], f.env);
    children.push(successor);
    await ready(successor, 'waiting');
    assert.doesNotMatch(successor.output().stdout, /entered/);
    await stop(holder);
    assert.equal((await successor.closed)[0], 0, successor.output().stderr);
    assert.match(successor.output().stdout, /entered/);
  } finally { await cleanup(); }
});

test("should admit only one owning host under simultaneous cross-process publication", { timeout: 8_000 }, async (t) => {
  const f = fixture(), children = [];
  const cleanup = fixtureCleanup(t, f, children);
  let client;
  try {
    for (let i = 0; i < 2; i++) children.push(child(process.execPath, [entry, "--socket", f.path, "--generation", `publisher-${i}`,
      "--registry-path", join(f.root, "registry.json")], f.env));
    const [loser, status] = await Promise.race(children.map(async c => [c, (await c.closed)[0]]));
    assert.equal(status, 3, loser.output().stderr);
    // Scenario 9 v5: the losing publisher sees the LIVE winner through the
    // active scan and gets the coded double-publication refusal.
    assert.match(loser.output().stderr, /H2A_ENDPOINT_LIVE_OWNER/);
    assert.match(loser.output().stderr, /endpoint owned by a live older host/);
    const winner = children.find(c => c !== loser);
    assert.equal(winner.process.exitCode, null);
    await ready(winner, '"kind":"h2a.native-terminal.ready"');
    client = await NativeTerminalClient.connect(f.path);
    assert.equal((await client.ping()).hostPid, winner.process.pid);
    assert.equal((await client.ping()).generation, `publisher-${children.indexOf(winner)}`);
  } finally { client?.close(); await cleanup(); }
});
