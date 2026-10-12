import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { assertNativeTestSpawnRefused, createPrivateTestDirectory, installNativeTestEnvironment, isolatedNativeTestEnvironment, nativeTestEnvironment, pinPrivateNativeProcess, waitForPrivateNativeProcesses } from "./helpers/native-isolation.js";

const server = pathToFileURL(new URL("../../h2a-runtime/dist/native-terminal/server.js", import.meta.url).pathname).href;

test("should exclude unrelated process sockets before any external metadata access", () => {
  const root = createPrivateTestDirectory("pv"), outside = createPrivateTestDirectory("canary-");
  const env = nativeTestEnvironment(root);
  try {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const outside = ${JSON.stringify(outside)}, inspected = [];
      const original = Object.fromEntries(['readdirSync','statSync','lstatSync','readFileSync','readlinkSync','realpathSync']
        .map(key => [key, fs[key]]));
      for (const key of Object.keys(original)) fs[key] = (path, ...args) => {
        const name = String(path);
        // Model an owner's host in the GLOBAL process view without reading it.
        if (key === 'readdirSync' && name === '/proc') return ['424242'];
        if (key === 'statSync' && name === '/proc/424242') return { uid: process.getuid() };
        if (key === 'readFileSync' && name === '/proc/424242/cmdline')
          return 'node\\0process.js\\0--socket\\0' + outside + '/owner.sock\\0';
        if (name === outside || name.startsWith(outside + '/')) {
          inspected.push(key + ':' + name);
          throw Object.assign(new Error('external metadata canary'), { code: 'EACCES' });
        }
        return original[key](path, ...args);
      };
      syncBuiltinESMExports();
      const { proveNativeTerminalEndpointAbsent } = await import(${JSON.stringify(server)});
      let absent, error;
      try { absent = await proveNativeTerminalEndpointAbsent(${JSON.stringify(join(root, "absent.sock"))}, { code: 'ENOENT' }); }
      catch (caught) { error = String(caught); }
      console.log(JSON.stringify({ inspected, absent, error, procRoot: process.env.H2A_TEST_PROC_ROOT }));
    `], { env, encoding: "utf8", timeout: 10_000 });
    assert.equal(child.status, 0, child.stderr);
    const observation = JSON.parse(child.stdout);
    assert.deepEqual(observation.inspected, [], `no external metadata: ${child.stdout}`);
    assert.equal(observation.absent, true, child.stdout);
    assert.ok(observation.procRoot?.startsWith(root + "/"), "the scanner must use the private process view");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test("should retain missing optional variables when installing the in-process fixture view", () => {
  const root = createPrivateTestDirectory("pv");
  const restoreEnvironment = installNativeTestEnvironment({ ...nativeTestEnvironment(root), H2A_TEST_QUALIFICATION_ROOT: undefined });
  try {
    assert.equal(process.env.H2A_TEST_QUALIFICATION_ROOT, undefined,
      'an absent optional variable must not become the string "undefined" in child environments');
    delete process.env.H2A_ROOT;
    isolatedNativeTestEnvironment(process.env);
    assert.equal(process.env.H2A_ROOT, undefined);
    assert.ok(process.env.H2A_TEST_PROC_ROOT.startsWith(root + "/"));
  } finally { restoreEnvironment(); rmSync(root, { recursive: true, force: true }); }
});

test("should reject an external process view before starting any native operation", () => {
  const root = createPrivateTestDirectory("pv"), env = nativeTestEnvironment(root);
  try {
    assertNativeTestSpawnRefused(() => spawnSync(process.execPath, [new URL("../../h2a-runtime/dist/native-terminal/op.js", import.meta.url).pathname,
      "probe", "--id", "must-not-run"], { env: { ...env, H2A_TEST_PROC_ROOT: "/tmp/outside-process-view" } }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("should prove a private PTY child dead after SIGKILL without its exit hook", async () => {
  const root = createPrivateTestDirectory("pv"), env = nativeTestEnvironment(root);
  const pty = createRequire(new URL("../../h2a-runtime/package.json", import.meta.url))("node-pty");
  const terminal = pty.spawn(process.execPath, ["-e", "console.log('pin-ready'); setInterval(() => {}, 1000)"],
    { cwd: root, env, name: "xterm-256color", cols: 80, rows: 24 });
  let ended = false;
  const exited = new Promise(resolve => terminal.onExit(event => { ended = true; resolve(event); }));
  let release;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("private PTY readiness deadline")), 4000);
      terminal.onData(data => { if (data.includes("pin-ready")) { clearTimeout(timer); resolve(); } });
    });
    release = pinPrivateNativeProcess(terminal.pid, env);
    await assert.rejects(waitForPrivateNativeProcesses(env), /fixture processes still writing/);
    terminal.kill("SIGKILL");
    await exited;
    await waitForPrivateNativeProcesses(env);
  } finally {
    if (!ended) terminal.kill("SIGKILL");
    await exited;
    release?.();
    rmSync(root, { recursive: true, force: true });
  }
});

test("should fail private process teardown when stat is unreadable", async () => {
  const root = createPrivateTestDirectory("pv"), env = nativeTestEnvironment(root);
  const entry = join(env.H2A_TEST_OWNED_PROC_ROOT, "424242");
  mkdirSync(entry); // Synthetic identity: never access an external /proc PID.
  const read = fs.readFileSync;
  fs.readFileSync = (path, ...args) => {
    if (path === join(entry, "stat")) throw Object.assign(new Error("private stat denied"), { code: "EACCES" });
    return read(path, ...args);
  };
  try { await assert.rejects(waitForPrivateNativeProcesses(env), { code: "EACCES" }); }
  finally { fs.readFileSync = read; rmSync(root, { recursive: true, force: true }); }
});

test("should preserve native realpath in a guarded child with a replaced environment", () => {
  const root = createPrivateTestDirectory("pv"), env = nativeTestEnvironment(root);
  try {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e",
      "import fs from 'node:fs'; console.log(fs.realpathSync.native(process.cwd()));"],
      { cwd: root, env, encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), root);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
