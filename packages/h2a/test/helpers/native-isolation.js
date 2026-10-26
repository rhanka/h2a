import assert from "node:assert/strict";
import { recordCiOwnedProcess } from '../../../../scripts/ci-owned-process.mjs';
import childProcess, { spawn, spawnSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { isMainThread } from "node:worker_threads";
import { once } from "node:events";
import fs, { closeSync, constants, lstatSync, mkdirSync, mkdtempSync, openSync, readlinkSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import os from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash } from 'node:crypto';
import { verifyImage } from '../../src/runtime/handover/image.js';
import { digest } from '../../src/runtime/handover/wire.js';

// Test-only short root for deep worktrees whose AF_UNIX paths would overflow.
// The runner creates it with mkdtemp; every child carries the same boundary.
const shortQualificationRoot = process.env.H2A_TEST_QUALIFICATION_ROOT;
if (shortQualificationRoot !== undefined) {
  assert.ok(/^\/tmp\/h2a-qual-[A-Za-z0-9]+$/.test(shortQualificationRoot), "REFUSING invalid short qualification root");
  const info = lstatSync(shortQualificationRoot);
  assert.ok(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() && (info.mode & 0o777) === 0o700,
    "REFUSING non-private short qualification root");
}
// The repo default must also fit the historical host's longer staging name,
// including a mkdtemp suffix and seven-digit PID in deeply nested worktrees.
export const nativeQualificationRoot = shortQualificationRoot ?? resolve(import.meta.dirname, "../../../../.q");

const ownerHome = os.userInfo?.()?.homedir ?? os.homedir();
const ownerUid = os.userInfo?.()?.uid;
const ownerRun = ownerUid !== undefined ? `/run/user/${ownerUid}` : undefined;

function rejectOwnerPath(path) {
  const exactForbidden = [ownerHome].filter(Boolean);
  const prefixForbidden = [
    ownerRun,
    ownerHome ? join(ownerHome, ".local/state") : undefined,
    ownerHome ? join(ownerHome, ".config") : undefined,
    ownerHome ? join(ownerHome, "h2a-workspace") : undefined,
  ].filter(Boolean);

  assert.ok(
    !exactForbidden.includes(path) &&
    !prefixForbidden.some(root => path === root || path.startsWith(`${root}/`)) &&
    (!ownerHome || !path.startsWith(join(ownerHome, ".cache-tmp/h2a-"))),
    `REFUSING owner path before filesystem access: ${path}`);
}

// Resolve existing ancestors without following a symlink into owner state.
function resolvedPath(path, depth = 0, boundary) {
  const absolute = resolve(path);
  rejectOwnerPath(absolute);
  if (boundary) {
    const rel = relative(boundary, absolute);
    assert.ok(rel === "" || (!rel.startsWith("..") && !rel.startsWith("/")),
      `REFUSING path outside qualification root before filesystem access: ${absolute}`);
  }
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
    if (info.isSymbolicLink()) {
      return resolvedPath(join(resolve(dirname(current), readlinkSync(current)),
        ...parts.slice(index + 1)), depth + 1, boundary);
    }
  }
  return current;
}

export function assertPrivateQualificationPath(path, root) {
  const actualRoot = resolvedPath(root, 0, resolve(root));
  assert.equal(actualRoot, resolve(root), "REFUSING aliased qualification root before mutation");
  const actual = resolvedPath(path, 0, actualRoot);
  const rel = relative(actualRoot, actual);
  assert.ok(rel === "" || (!rel.startsWith("..") && !rel.startsWith("/")),
    `REFUSING path outside qualification root: ${actual}`);
}

export function createPrivateTestDirectory(prefix, parent = nativeQualificationRoot) {
  assertPrivateQualificationPath(parent, nativeQualificationRoot);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  return mkdtempSync(join(parent, prefix));
}

export function assertIsolatedEnvironment(env, root = nativeQualificationRoot) {
  for (const key of ["HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "H2A_NATIVE_SOCKET"]) {
    assert.ok(env[key] && isAbsolute(env[key]), `REFUSING missing or relative isolation variable: ${key}`);
    assertPrivateQualificationPath(env[key], root);
  }
  for (const key of ["TMPDIR", "TMUX_TMPDIR", "REMOTE_CLI_CONFIG_HOME", "H2A_ROOT",
    "H2A_NATIVE_HOST_LOG", "H2A_TEST_PROC_ROOT", "H2A_TEST_OWNED_PROC_ROOT"]) {
    if (env[key]) assertPrivateQualificationPath(env[key], root);
  }
  if (env.TMUX) assertPrivateQualificationPath(env.TMUX.split(",")[0], root);
}

export function isolatedNativeTestEnvironment(overrides = {}) {
  const env = Object.fromEntries(["HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME",
    "H2A_NATIVE_SOCKET", "TMPDIR", "TMUX_TMPDIR", "REMOTE_CLI_CONFIG_HOME", "H2A_ROOT",
    "H2A_TEST_PROC_ROOT", "H2A_TEST_OWNED_PROC_ROOT", "NODE_OPTIONS"]
    .map(key => [key, process.env[key]]));
  Object.assign(env, overrides);
  assertIsolatedEnvironment(env);
  const prepared = privateProcessEnvironment(env);
  if (overrides === process.env) installProcessViewVariables(prepared);
  return prepared;
}

// Fleet qualification deliberately selects the two default generations with
// an empty override. Validate both effective sockets, rather than skipping it.
export function assertIsolatedNativeOperation(env, root = nativeQualificationRoot) {
  if (env.H2A_NATIVE_SOCKET !== "") return assertIsolatedEnvironment(env, root);
  const directory = join(env.XDG_RUNTIME_DIR ?? "", "h2a-nt");
  assertIsolatedEnvironment({ ...env, H2A_NATIVE_SOCKET: join(directory, "native-terminal.sock") }, root);
  assertPrivateQualificationPath(join(directory, "native-terminal.lf1.sock"), root);
}

// A complete child fixture never inherits owner configuration or socket overrides.
export function nativeTestEnvironment(root, overrides = {}) {
  assertPrivateQualificationPath(root, nativeQualificationRoot);
  const env = { ...(nativeQualificationRoot.startsWith("/tmp/") ? { H2A_TEST_QUALIFICATION_ROOT: nativeQualificationRoot } : {}), PATH: "/usr/bin:/bin", TERM: "xterm-256color", HOME: join(root, "home"),
    XDG_RUNTIME_DIR: root, XDG_STATE_HOME: join(root, "state"), XDG_CONFIG_HOME: join(root, "config"),
    H2A_NATIVE_SOCKET: join(root, "host.sock"), REMOTE_CLI_CONFIG_HOME: join(root, "config"),
    TMPDIR: join(root, "tmp"), TMUX_TMPDIR: root, H2A_ROOT: join(root, "store"), ...overrides };
  assertIsolatedEnvironment(env);
  for (const key of ["HOME", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "REMOTE_CLI_CONFIG_HOME", "TMPDIR"])
    mkdirSync(env[key], { recursive: true, mode: 0o700 });
  return privateProcessEnvironment(env);
}

export function installNativeTestEnvironment(env) {
  assertIsolatedEnvironment(env);
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  };
}

// Ordinary Node/Vitest runners need no private launcher. Each suite owns its
// complete environment; inherited owner overrides never become fixture paths.
export function setupNativeTestEnvironment(registerCleanup) {
  const root = createPrivateTestDirectory("s");
  const env = nativeTestEnvironment(root, {
    TMUX: "", H2A_NATIVE_HOST_LOG: join(root, "state", "native-host.log"),
  });
  const restoreEnvironment = installNativeTestEnvironment(env);
  registerCleanup(async () => {
    try {
      await stopPrivateNativeProcesses(env);
      await waitForPrivateNativeProcesses(env);
      rmSync(root, { recursive: true, force: true });
      privateProcessRoots.delete(root);
    } finally { restoreEnvironment(); }
  });
}

function guardSpawn(args, options = {}) {
  assertIsolatedNativeOperation(options.env ?? process.env);
  for (const flag of ["--socket", "--registry-path"]) {
    const index = args.indexOf(flag);
    if (index !== -1) assertPrivateQualificationPath(args[index + 1], nativeQualificationRoot);
  }
}

// Mandatory test boundary: partial mocks and indirect adapter calls must not
// bypass the same guard as explicit fixture launchers. This module is also the
// Node preload and Vitest setup file; it never ships in the native runtime.
const guardInstalled = Symbol.for("h2a.test.nativeSpawnGuard");
const preload = `--import=${import.meta.url}`;
const nativeEntry = /(?:^|[/\\\s"'])(?:op|process)\.[jt]s(?:$|[\s"'])/;
const privateProcessRoots = childProcess.ChildProcess.prototype[guardInstalled]?.processRoots ?? new Map();
const privateChildren = childProcess.ChildProcess.prototype[guardInstalled]?.children ?? new Map();
const privatePins = childProcess.ChildProcess.prototype[guardInstalled]?.pins ?? new Map();
const closedProcessRoots = childProcess.ChildProcess.prototype[guardInstalled]?.closedRoots ?? new Set();
const builtImages = childProcess.ChildProcess.prototype[guardInstalled]?.builtImages ?? new Set();
const builtLaunchers = childProcess.ChildProcess.prototype[guardInstalled]?.builtLaunchers ?? new Set();
const builtRouters = childProcess.ChildProcess.prototype[guardInstalled]?.builtRouters ?? new Set();
const imageTestEntries = childProcess.ChildProcess.prototype[guardInstalled]?.imageTestEntries ?? new Map();
const receiptKey = Symbol.for('h2a.test.closedBuildReceipt');
if (!globalThis[receiptKey]) Object.defineProperty(globalThis, receiptKey, { value: receipt => {
  if (!/^sha256:[0-9a-f]{64}$/.test(receipt?.digest)) throw new Error('invalid test build receipt');
  if (receipt.kind === 'image') {
    builtImages.add(receipt.digest);
    if (receipt.entrypoints) {
      assert.ok(Array.isArray(receipt.entrypoints) && receipt.entrypoints.every(path =>
        typeof path === 'string' && !isAbsolute(path) && !path.split('/').includes('..')));
      imageTestEntries.set(receipt.digest, new Set(receipt.entrypoints));
    }
  }
  else if (receipt.kind === 'launcher') builtLaunchers.add(receipt.digest);
  else if (receipt.kind === 'router') builtRouters.add(receipt.digest);
  else throw new Error('invalid test build receipt kind');
} });
const closedInvocations = new WeakSet();

function assertNeutralFixturePath(path) {
  assert.ok(typeof path === 'string' && isAbsolute(path));
  let boundary;
  if (path.startsWith(nativeQualificationRoot + '/')) boundary = nativeQualificationRoot;
  else if (path.startsWith('/tmp/')) boundary = '/tmp/' + path.slice(5).split('/')[0];
  else {
    const repo = resolve(import.meta.dirname, '../../../..');
    const parent = [join(repo, 'tmp/test-runtime'), join(repo, '.qual-tmp')]
      .find(root => path.startsWith(root + '/'));
    assert.ok(parent);
    if (parent.endsWith('/tmp/test-runtime')) assert.ok(path.startsWith(parent + '/h2a-test-root-'));
    boundary = join(parent, relative(parent, path).split('/')[0]);
  }
  const info = lstatSync(boundary);
  assert.ok(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() && (info.mode & 0o077) === 0);
  assertPrivateQualificationPath(path, boundary);
}

function closedBuildInvocation(command, args, env) {
  if (!isNode(command)) return false;
  const argv = args[0] === command ? args.slice(1) : args;
  const entry = argv.find((value, index) => argv.slice(0, index).every(arg => /^--max-old-space-size=[0-9]+$/.test(arg)) && !value.startsWith('-'));
  if (typeof entry !== 'string' || !isAbsolute(entry) || !/\.[cm]?js$/.test(entry)) return false;
  try {
    // The builder receipt alone grants nothing about paths or mutable bytes.
    // Check the private fixture and reverify the actual installed image. These
    // entries enforce their own closed-image loader policy, which deliberately
    // refuses any additional preload (including this test instrumentation).
    assertNeutralFixturePath(entry);
    for (const key of ['HOME', 'XDG_RUNTIME_DIR', 'XDG_STATE_HOME', 'XDG_CONFIG_HOME']) assertNeutralFixturePath(env[key]);
    const entryHash = 'sha256:' + createHash('sha256').update(fs.readFileSync(entry)).digest('hex');
    if (builtLaunchers.has(entryHash) || builtRouters.has(entryHash)) return true;
    for (let root = dirname(entry), depth = 0; depth < 8; root = dirname(root), depth++) {
      assertNeutralFixturePath(root);
      const path = join(root, 'manifest.json');
      let document;
      try { document = JSON.parse(fs.readFileSync(path, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') continue; return false; }
      const manifests = document.kind === 'h2a-published-payload' ? Object.values(document.manifests) : [document];
      for (const manifest of manifests) {
        const hash = digest(manifest);
        const relativeEntry = relative(root, entry);
        const declared = Object.values(manifest.entrypoints).includes(relativeEntry) || imageTestEntries.get(hash)?.has(relativeEntry);
        if (!builtImages.has(hash) || !declared || !manifest.files.some(file => file.path === relativeEntry && file.type === 'file')) continue;
        verifyImage(root, manifest, hash);
        return true;
      }
      return false;
    }
  } catch { /* Missing receipts, changed bytes or foreign paths keep the guard. */ }
  return false;
}

function isNode(command) {
  return command === process.execPath || /(?:^|[/\\])node(?:js|\.exe)?$/.test(command);
}

function preloadedArguments(command, args, env) {
  if (closedInvocations.has(env)) return args;
  if (!isNode(command) || args.includes(preload) || env.NODE_OPTIONS?.includes(preload)) return args;
  // Keep deliberately neutral child environments neutral. The test boundary
  // belongs to the invocation, not NODE_OPTIONS (closed images reject loaders
  // injected through that ambient variable).
  return args[0] === command ? [args[0], preload, ...args.slice(1)] : [preload, ...args];
}

function guardedEnvironment(command, args, env, cwd = process.cwd()) {
  if (closedBuildInvocation(command, args, env)) { closedInvocations.add(env); return env; }
  const argv = args[0] === command ? args.slice(1) : args;
  // Reading a pinned Git blob named process.ts/op.ts executes no native host.
  // Keep the exception exact: no options, aliases, abbreviated refs or shell.
  const pinnedBlobRead = /(?:^|[/\\])git(?:\.exe)?$/.test(command) && argv.length === 2 &&
    argv[0] === 'show' && /^[0-9a-f]{40}:[^\r\n]+$/.test(argv[1]);
  if (!pinnedBlobRead && [command, ...args].some(arg => nativeEntry.test(String(arg))
    || nativeEntry.test(resolve(cwd, String(arg))))) {
    try { guardSpawn(args, { env }); }
    catch (error) {
      const state = childProcess.ChildProcess.prototype[guardInstalled];
      if (!state.expectedRefusals) state.violations.push(String(error));
      throw error;
    }
  }
  assert.ok(!closedProcessRoots.has(env.H2A_TEST_OWNED_PROC_ROOT), "REFUSING spawn after native fixture teardown");
  if (!isNode(command)) return env;
  // Carry the boundary through CLI/worker children even with a minimal env.
  const prepared = privateProcessEnvironment(env);
  assert.ok(!closedProcessRoots.has(prepared.H2A_TEST_OWNED_PROC_ROOT), "REFUSING spawn after native fixture teardown");
  return prepared;
}

function privateProcessEnvironment(env) {
  // Non-native tests may intentionally use incomplete or non-lab environments.
  // A real native launch has already been required to pass the complete guard.
  if (!["HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME"].every(key =>
    env[key]?.startsWith(`${nativeQualificationRoot}/`)) || env.H2A_NATIVE_SOCKET === undefined) return env;
  assertIsolatedNativeOperation(env);
  if (shortQualificationRoot) env = { ...env, H2A_TEST_QUALIFICATION_ROOT: shortQualificationRoot };
  if (env.H2A_TEST_PROC_ROOT) return env; // Preserve deliberately injected error fixtures.
  // One view per fixture in this running test process. A later campaign must
  // never inherit dangling descriptor links left by a killed earlier child.
  let root = privateProcessRoots.get(env.XDG_RUNTIME_DIR);
  if (!root) {
    root = createPrivateTestDirectory("proc-owned-", env.XDG_RUNTIME_DIR);
    privateProcessRoots.set(env.XDG_RUNTIME_DIR, root);
  }
  return { ...env, ...(shortQualificationRoot ? { H2A_TEST_QUALIFICATION_ROOT: shortQualificationRoot } : {}), H2A_TEST_PROC_ROOT: root, H2A_TEST_OWNED_PROC_ROOT: root };
}

function installProcessViewVariables(env) {
  for (const key of ["H2A_TEST_PROC_ROOT", "H2A_TEST_OWNED_PROC_ROOT"])
    if (env[key] !== undefined) process.env[key] = env[key];
}

function registerPrivateProcess(pid, env, replace = false, survivor = false) {
  if (pid) recordCiOwnedProcess(pid);
  if (process.platform !== "linux" || !pid || !env.H2A_TEST_PROC_ROOT
    || env.H2A_TEST_PROC_ROOT !== env.H2A_TEST_OWNED_PROC_ROOT) return () => {};
  const root = env.H2A_TEST_PROC_ROOT;
  assertPrivateQualificationPath(root, nativeQualificationRoot);
  const entry = join(root, String(pid));
  // Pin this process's proc directory, not a recyclable PID pathname. A host
  // preload replaces its parent's pin with its own before the parent exits.
  const fd = openSync(`/proc/${pid}`, constants.O_RDONLY | constants.O_DIRECTORY);
  const target = `/proc/${process.pid}/fd/${fd}`;
  const pin = entry + ".pin";
  let published = target;
  let pinned = false;
  try {
    // Explicit pins belong to the surviving test process. A late child preload
    // cannot retire this anchor, even if it races publication of the PID entry.
    if (survivor) { symlinkSync(target, pin); pinned = true; }
    else if (replace) {
      try { published = readlinkSync(pin); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    if (replace) { try { unlinkSync(entry); } catch (error) { if (error.code !== "ENOENT") throw error; } }
    symlinkSync(published, entry);
  } catch (error) {
    if (pinned) unlinkSync(pin);
    closeSync(fd);
    if (error.code === "EEXIST") return () => {};
    throw error;
  }
  if (survivor) {
    if (!privatePins.has(root)) privatePins.set(root, new Set());
    privatePins.get(root).add(pid);
  }
  return () => {
    // An old child's exit hook must never unlink a newer parent's pin.
    try { if (readlinkSync(entry) === target) unlinkSync(entry); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (survivor) {
      try { if (readlinkSync(pin) === target) unlinkSync(pin); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      privatePins.get(root)?.delete(pid);
    }
    closeSync(fd);
  };
}

// For children launched outside node:child_process (PTYs/tmux), the test must
// call this with the PID returned by its own launcher, after the child is ready.
// The Linux PTY crash-containment wrapper has a real command child: pin the
// owned descendants too, by walking only this launcher's pinned task children.
// Keep the pin in the surviving test process: a SIGKILL cannot run the child's
// exit hook, and its self-held /proc descriptor becomes inaccessible at death.
// Release only after waitForPrivateNativeProcesses proves the pinned child dead.
export function pinPrivateNativeProcess(pid, env = process.env) {
  assertIsolatedEnvironment(env);
  const prepared = privateProcessEnvironment(env);
  if (process.platform !== "linux") return registerPrivateProcess(pid, prepared, true, true);
  const releases = [], queue = [pid], seen = new Set();
  try {
    for (const child of queue) {
      if (seen.has(child)) continue;
      seen.add(child);
      assert.ok(seen.size <= 64, "private fixture process tree exceeds 64 children");
      releases.push(registerPrivateProcess(child, prepared, true, true));
      let children;
      try {
        children = fs.readFileSync(join(prepared.H2A_TEST_OWNED_PROC_ROOT, child + ".pin", "task", String(child), "children"), "utf8");
      } catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) continue; throw error; }
      for (const entry of children.trim().split(/\s+/).filter(Boolean)) {
        assert.match(entry, /^[1-9]\d*$/);
        queue.push(Number(entry));
      }
    }
  } catch (error) { for (const release of releases.reverse()) release(); throw error; }
  const release = () => { for (const release of releases.reverse()) release(); };
  release.pids = [...seen];
  return release;
}

export function installNativeTestSpawnGuard() {
  const prototype = childProcess.ChildProcess.prototype;
  if (prototype[guardInstalled]) return;
  const actualSpawn = prototype.spawn, actualSpawnSync = childProcess.spawnSync;
  const actualExecFileSync = childProcess.execFileSync, actualExecSync = childProcess.execSync;
  prototype.spawn = function (options) {
    const env = Object.fromEntries(options.envPairs.map(pair => {
      const index = pair.indexOf("=");
      return [pair.slice(0, index), pair.slice(index + 1)];
    }));
    const guarded = guardedEnvironment(options.file, options.args, env, options.cwd ?? process.cwd());
    const result = actualSpawn.call(this, { ...options,
      args: preloadedArguments(options.file, options.args, guarded),
      envPairs: Object.entries(guarded).map(([key, value]) => `${key}=${value}`) });
    if (this.pid) {
      const release = registerPrivateProcess(this.pid, guarded);
      const root = guarded.H2A_TEST_OWNED_PROC_ROOT;
      if (root && root === guarded.H2A_TEST_PROC_ROOT) {
        if (!privateChildren.has(root)) privateChildren.set(root, new Set());
        privateChildren.get(root).add(this);
      }
      this.once("exit", () => { privateChildren.get(root)?.delete(this); release(); });
    }
    return result;
  };
  childProcess.spawnSync = function (command, args, options) {
    if (args != null && typeof args !== 'object') throw new TypeError('args must be an array or an options object');
    if (!Array.isArray(args)) { options = args; args = []; }
    const env = guardedEnvironment(command, args, options?.env ?? process.env, options?.cwd);
    return actualSpawnSync(command, preloadedArguments(command, args, env), { ...options, env });
  };
  // Node's sync exec helpers retain an internal spawnSync reference.
  childProcess.execFileSync = function (command, args, options) {
    if (args != null && typeof args !== 'object') throw new TypeError('args must be an array or an options object');
    if (!Array.isArray(args)) { options = args; args = []; }
    const env = guardedEnvironment(command, args, options?.env ?? process.env, options?.cwd);
    return actualExecFileSync(command, preloadedArguments(command, args, env), { ...options, env });
  };
  childProcess.execSync = function (command, options) {
    const env = guardedEnvironment(command, [], options?.env ?? process.env, options?.cwd);
    return actualExecSync(command, { ...options, env });
  };
  const state = { violations: [], expectedRefusals: 0 };
  state.processRoots = privateProcessRoots;
  state.children = privateChildren;
  state.pins = privatePins;
  state.closedRoots = closedProcessRoots;
  state.builtImages = builtImages;
  state.builtLaunchers = builtLaunchers;
  state.builtRouters = builtRouters;
  state.imageTestEntries = imageTestEntries;
  Object.defineProperty(prototype, guardInstalled, { value: state });
  const failUnexpected = () => {
    if (state.violations.length) {
      process.exitCode = 1;
      process.stderr.write(`Unexpected unsafe native test launches: ${JSON.stringify(state.violations)}\n`);
    }
  };
  process.once("beforeExit", failUnexpected);
  process.once("exit", failUnexpected);
  const actualRealpath = fs.realpathSync;
  function guardRealpath(path) {
    // Defense in depth for malformed process fixtures: never canonicalize an
    // external candidate, even if a fixture accidentally names one. The
    // production scanner receives its normal fs implementation outside tests.
    if (new Error().stack?.match(/native-terminal[/\\]server\.[jt]s/))
      assertPrivateQualificationPath(String(path), nativeQualificationRoot);
  }
  fs.realpathSync = function (path, ...args) {
    guardRealpath(path);
    return actualRealpath(path, ...args);
  };
  fs.realpathSync.native = function (path, ...args) {
    guardRealpath(path);
    return actualRealpath.native(path, ...args);
  };
  syncBuiltinESMExports();
}

export function assertNativeTestSpawnRefused(operation) {
  const state = childProcess.ChildProcess.prototype[guardInstalled];
  state.expectedRefusals += 1;
  try { assert.throws(operation, /REFUSING/); }
  finally { state.expectedRefusals -= 1; }
}

export function assertNoNativeTestSpawnViolations() {
  assert.deepEqual(childProcess.ChildProcess.prototype[guardInstalled].violations, [],
    "no caught unsafe native launch may pass qualification");
}

// Stop only handles this test spawned and descendants discovered through
// their pinned task/children views. A synthetic row or socket sidecar never
// authorizes a signal. Pin before host death so its journal stays observable.
export async function stopPrivateNativeProcesses(env) {
  const root = env.H2A_TEST_OWNED_PROC_ROOT ?? privateProcessRoots.get(env.XDG_RUNTIME_DIR);
  if (!root) return;
  assertPrivateQualificationPath(root, nativeQualificationRoot);
  closedProcessRoots.add(root);
  const children = [...(privateChildren.get(root) ?? [])];
  const releases = [];
  const known = new Set(privatePins.get(root) ?? []);
  const errors = [];
  const exited = children.map(child => child.exitCode === null && child.signalCode === null
    ? once(child, "exit") : Promise.resolve());
  const prepared = { ...env, H2A_TEST_PROC_ROOT: root, H2A_TEST_OWNED_PROC_ROOT: root };
  const live = pid => {
    try { return !/\) [ZX] /.test(fs.readFileSync(join(root, pid + ".pin", "stat"), "utf8")); }
    catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return false; throw error; }
  };
  const signal = (pid, name) => {
    try { if (live(pid)) process.kill(pid, name); }
    catch (error) { if (error.code !== "ESRCH") errors.push(error); }
  };
  try {
    for (const child of children) {
      try {
        const release = pinPrivateNativeProcess(child.pid, prepared);
        releases.push(release);
        for (const pid of release.pids ?? [child.pid]) known.add(pid);
      }
      catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) errors.push(error); }
    }
    const owned = () => [...known].filter(pid => pid !== process.pid);
    for (const pid of owned()) { signal(pid, "SIGCONT"); signal(pid, "SIGTERM"); }
    const deadline = performance.now() + 500;
    while (owned().some(live) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    // Revisit descendants before escalation, including a partially completed
    // PTY create. Kill descendants before their parent can abandon them.
    for (const pid of owned().filter(live)) {
      try {
        const release = pinPrivateNativeProcess(pid, prepared);
        releases.push(release);
        for (const pid of release.pids ?? [pid]) known.add(pid);
      }
      catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) errors.push(error); }
    }
    for (const pid of owned().reverse()) signal(pid, "SIGKILL");
    let timer;
    try {
      await Promise.race([Promise.all(exited), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("fixture child exit was not reaped within 1000ms")), 1000);
      })]);
    } finally { clearTimeout(timer); }
    await waitForPrivateNativeProcesses(prepared);
    if (errors.length) throw new AggregateError(errors, "private fixture process teardown failed");
  } finally {
    for (const release of releases.reverse()) release();
    privateChildren.delete(root);
  }
}

export async function waitForPrivateNativeProcesses(env) {
  const root = env.H2A_TEST_OWNED_PROC_ROOT ?? privateProcessRoots.get(env.XDG_RUNTIME_DIR);
  if (!root) return;
  assertPrivateQualificationPath(root, nativeQualificationRoot);
  const deadline = Date.now() + 1_000;
  for (;;) {
    let entries;
    try { entries = fs.readdirSync(root); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    const alive = entries.filter(entry => /^\d+$/.test(entry) && Number(entry) !== process.pid).filter(entry => {
      try {
        // Prefer the survivor anchor over the shared PID publication.
        let path = join(root, entry);
        try { readlinkSync(path + ".pin"); path += ".pin"; }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        return !/\) [ZX] /.test(fs.readFileSync(join(path, "stat"), "utf8"));
      }
      catch (error) { if (error.code === "ENOENT" || error.code === "ESRCH") return false; throw error; }
    });
    if (alive.length === 0) return;
    assert.ok(Date.now() < deadline, `fixture processes still writing after host shutdown: ${alive.join(", ")}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

installNativeTestSpawnGuard();
recordCiOwnedProcess(process.pid);
// Also protect native entry points reached via shell/PTY wrappers.
if (nativeEntry.test(process.argv[1] ?? "")) guardSpawn(process.argv.slice(1), { env: process.env });
const processEnvironment = privateProcessEnvironment(process.env);
installProcessViewVariables(processEnvironment);
if (isMainThread && process.env.H2A_TEST_PROC_ROOT === process.env.H2A_TEST_OWNED_PROC_ROOT)
  process.once("exit", registerPrivateProcess(process.pid, process.env, true));

export function spawnIsolatedNative(command, args = [], options = {}) {
  guardSpawn(args, options);
  return spawn(command, args, options);
}

export function spawnSyncIsolatedNative(command, args = [], options = {}) {
  guardSpawn(args, options);
  return spawnSync(command, args, options);
}
