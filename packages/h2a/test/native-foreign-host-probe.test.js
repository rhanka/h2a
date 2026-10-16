import {
  createPrivateTestDirectory, nativeTestEnvironment, spawnIsolatedNative,
  pinPrivateNativeProcess, stopPrivateNativeProcesses, waitForPrivateNativeProcesses,
} from "./helpers/native-isolation.js";
import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, linkSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
  async function proof(socketPath, denyPid) {
    const script = join(root, "proof.mjs");
    writeFileSync(script, `
      import fs from 'node:fs';
      import { join } from 'node:path';
      import { syncBuiltinESMExports } from 'node:module';
      const denied = join(process.env.H2A_TEST_PROC_ROOT, ${JSON.stringify(String(denyPid))}, 'fd');
      const readdir = fs.readdirSync;
      fs.readdirSync = (path, ...args) => {
        if (${denyPid !== undefined} && path === denied) {
          console.error('UNEXPECTED_FD_INSPECTION');
          throw Object.assign(new Error('fixture fd access denied'), { code: 'EACCES' });
        }
        return readdir(path, ...args);
      };
      syncBuiltinESMExports();
      const { proveNativeTerminalEndpointAbsent } = await import(${JSON.stringify(pathToFileURL(join(terminal, "server.js")).href)});
      try {
        console.log(JSON.stringify({ absent: await proveNativeTerminalEndpointAbsent(
          process.argv[2], { code: 'ENOENT' }) }));
      } catch (error) {
        console.log(JSON.stringify({ code: error.code, cause: error.cause?.message }));
      }
    `);
    const result = await start([script, socketPath]).closed;
    assert.equal(result.status, 0, JSON.stringify(result));
    assert.doesNotMatch(result.stderr, /UNEXPECTED_FD_INSPECTION/, JSON.stringify(result));
    return JSON.parse(result.stdout);
  }
  async function legacyHost(socketPath, directBind = false) {
    // A real pre-directory-FD listener: same bind/link/unlink grammar, no
    // retained directory handle. Only its transport, not an old dist, is needed.
    // Keep CommonJS explicit even under the repository's ESM package scope.
    const script = join(root, "legacy-process.cjs");
    writeFileSync(script, `
      const fs = require('node:fs'), net = require('node:net'), path = require('node:path');
      const published = process.argv[3], directory = path.dirname(published);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const staged = ${directBind} ? published : path.join(directory, '.native-t.' + process.pid + '.12345678.sock');
      const server = net.createServer(socket => socket.on('data', data => socket.write(data)));
      server.listen(staged, () => {
        fs.chmodSync(staged, 0o600);
        if (staged !== published) {
          fs.linkSync(staged, published);
          fs.unlinkSync(staged);
        }
        console.log('legacy-ready');
      });
    `);
    const launched = start([script, "--socket", socketPath], "ignore", 30_000);
    await Promise.race([launched.closed, new Promise(resolve => {
      launched.child.stdout.on("data", () => {
        if (launched.output().stdout.includes("legacy-ready")) resolve();
      });
    })]);
    assert.match(launched.output().stdout, /legacy-ready/, JSON.stringify(launched.output()));
    const connection = createConnection(socketPath);
    clients.push({ close: () => connection.destroy() });
    await once(connection, "connect");
    const parent = statSync(dirname(socketPath));
    const fdDir = `/proc/${launched.child.pid}/fd`;
    assert.ok(!readdirSync(fdDir).some(fd => {
      const info = statSync(join(fdDir, fd));
      return info.isDirectory() && info.dev === parent.dev && info.ino === parent.ino;
    }), "legacy host must not pin its bind directory");
    return { ...launched, async ping() {
      const response = once(connection, "data");
      connection.write("alive");
      assert.equal((await response)[0].toString(), "alive");
    } };
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
  try { await body({ root, env, paths, host, legacyHost, session, op, proof, start, deletedForeignHost }); }
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
    assert.deepEqual(await f.proof(target), { code: "H2A_ENDPOINT_LIVE_OWNER" });
    const result = await f.op(["probe", "--socket", target, "--id", "h2a-alias"]);
    assert.equal(result.status, 0, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).verdict, "unknown", JSON.stringify(result));
    assert.equal(existsSync(target), false, "the probe must never republish a live endpoint");
  }));

for (const removed of ["alias", "directory"]) test(`should prove the same-named target absent beside a symlink foreign host with a lost ${removed}`,
  { timeout: 12_000 }, context => fixture(context, async f => {
    const real = join(f.root, "real"), alias = join(f.root, "alias");
    mkdirSync(join(real, "h2a-nt"), { recursive: true, mode: 0o700 });
    symlinkSync(real, alias);
    const host = await f.host(join(alias, "h2a-nt", basename(f.paths[0])));
    if (removed === "alias") unlinkSync(alias);
    else rmSync(real, { recursive: true });
    assert.equal((await host.client.ping()).hostPid, host.child.pid);
    assert.deepEqual(await f.proof(f.paths[0]), { absent: true });
  }));

for (const index of [0, 1]) test(`should distinguish endpoint ${index} from its companion after the host alias is lost`,
  { timeout: 12_000 }, context => fixture(context, async f => {
    const alias = join(f.root, "alias");
    mkdirSync(dirname(f.paths[index]), { recursive: true, mode: 0o700 });
    symlinkSync(f.root, alias);
    const host = await f.host(join(alias, "h2a-nt", basename(f.paths[index])));
    unlinkSync(alias);
    assert.equal((await host.client.ping()).hostPid, host.child.pid);
    assert.deepEqual(await f.proof(f.paths[1 - index]), { absent: true });
    assert.equal((await f.proof(f.paths[index])).code, "H2A_ENDPOINT_LIVE_OWNER");
  }));

for (const foreign of ["companion", "directory"]) test(`should avoid inspecting a resolvable ${foreign} host's descriptors`,
  { timeout: 12_000 }, context => fixture(context, async f => {
    const host = await f.host(foreign === "companion" ? f.paths[0] : join(f.root, "foreign", basename(f.paths[1])));
    assert.deepEqual(await f.proof(f.paths[1], host.child.pid), { absent: true });
  }));

test("should prove the target absent when the bind directory is replaced at the same pathname", { timeout: 12_000 }, context =>
  fixture(context, async f => {
    const host = await f.host();
    rmSync(dirname(f.paths[0]), { recursive: true });
    mkdirSync(dirname(f.paths[0]), { mode: 0o700 });
    assert.equal((await host.client.ping()).hostPid, host.child.pid);
    assert.deepEqual(await f.proof(f.paths[0]), { absent: true });
  }));

test("should retain a live target when its startup alias is retargeted", { timeout: 12_000 }, context =>
  fixture(context, async f => {
    const real = join(f.root, "real"), other = join(f.root, "other"), alias = join(f.root, "alias");
    for (const directory of [real, other]) mkdirSync(join(directory, "h2a-nt"), { recursive: true, mode: 0o700 });
    symlinkSync(real, alias);
    const host = await f.host(join(alias, "h2a-nt", basename(f.paths[0])));
    const target = join(real, "h2a-nt", basename(f.paths[0]));
    unlinkSync(target);
    unlinkSync(`${target}.owner`);
    unlinkSync(alias);
    symlinkSync(other, alias);
    assert.equal((await host.client.ping()).hostPid, host.child.pid);
    assert.deepEqual(await f.proof(target), { code: "H2A_ENDPOINT_LIVE_OWNER" });
  }));

test("should preserve direct socket inode evidence across endpoint names", { timeout: 12_000 }, context =>
  fixture(context, async f => {
    const host = await f.legacyHost(f.paths[0], true);
    linkSync(f.paths[0], f.paths[1]);
    await host.ping();
    assert.deepEqual(await f.proof(f.paths[1]), { code: "H2A_ENDPOINT_LIVE_OWNER" });
  }));

test("should attribute a resolvable legacy symlink listener without a directory FD", { timeout: 12_000 }, context =>
  fixture(context, async f => {
    const real = join(f.root, "real"), alias = join(f.root, "alias");
    mkdirSync(real, { mode: 0o700 });
    symlinkSync(real, alias);
    const host = await f.legacyHost(join(alias, basename(f.paths[0])));
    await host.ping();
    assert.deepEqual(await f.proof(join(real, basename(f.paths[0]))), { code: "H2A_ENDPOINT_LIVE_OWNER" });
  }));

for (const removed of ["alias", "directory"]) test(`should exclude a differently named legacy endpoint without a directory FD after losing its ${removed}`,
  { timeout: 12_000 }, context => fixture(context, async f => {
    const real = join(f.root, "real"), alias = join(f.root, "alias");
    mkdirSync(real, { mode: 0o700 });
    symlinkSync(real, alias);
    const host = await f.legacyHost(join(alias, basename(f.paths[0])));
    if (removed === "alias") unlinkSync(alias);
    else rmSync(real, { recursive: true });
    await host.ping();
    assert.deepEqual(await f.proof(f.paths[1]), { absent: true });
  }));

test("should keep an opaque same-named legacy listener without a directory FD unknown", { timeout: 12_000 }, context =>
  fixture(context, async f => {
    const directory = join(f.root, "legacy");
    const host = await f.legacyHost(join(directory, basename(f.paths[0])));
    rmSync(directory, { recursive: true });
    await host.ping();
    assert.equal((await f.proof(f.paths[0])).code, "H2A_ENDPOINT_SCAN_UNKNOWN");
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
