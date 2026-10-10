import assert from "node:assert/strict";
import childProcess, { spawn, spawnSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { isMainThread } from "node:worker_threads";
import fs, { closeSync, constants, lstatSync, mkdirSync, mkdtempSync, openSync, readlinkSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const nativeQualificationRoot = resolve(import.meta.dirname, "../../../../.qual-tmp");

function rejectOwnerPath(path) {
  assert.ok(path !== "/home/antoinefa" && ![
    "/run/user/1000", "/home/antoinefa/.local/state", "/home/antoinefa/.config",
  ].some(root => path === root || path.startsWith(`${root}/`))
    && !path.startsWith("/home/antoinefa/.cache-tmp/h2a-"),
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
  const env = { PATH: "/usr/bin:/bin", TERM: "xterm-256color", HOME: join(root, "home"),
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
  Object.assign(process.env, env);
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

function isNode(command) {
  return command === process.execPath || /(?:^|[/\\])node(?:js|\.exe)?$/.test(command);
}

function guardedEnvironment(command, args, env, cwd = process.cwd()) {
  if ([command, ...args].some(arg => nativeEntry.test(String(arg))
    || nativeEntry.test(resolve(cwd, String(arg))))) {
    try { guardSpawn(args, { env }); }
    catch (error) {
      const state = childProcess.ChildProcess.prototype[guardInstalled];
      if (!state.expectedRefusals) state.violations.push(String(error));
      throw error;
    }
  }
  if (!isNode(command)) return env;
  // Carry the boundary through CLI/worker children even with a minimal env.
  const options = env.NODE_OPTIONS ?? "";
  return privateProcessEnvironment({ ...env,
    NODE_OPTIONS: options.includes(preload) ? options : `${options} ${preload}`.trim() });
}

function privateProcessEnvironment(env) {
  // Non-native tests may intentionally use incomplete or non-lab environments.
  // A real native launch has already been required to pass the complete guard.
  if (!["HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME"].every(key =>
    env[key]?.startsWith(`${nativeQualificationRoot}/`)) || env.H2A_NATIVE_SOCKET === undefined) return env;
  assertIsolatedNativeOperation(env);
  if (env.H2A_TEST_PROC_ROOT) return env; // Preserve deliberately injected error fixtures.
  // One view per fixture in this running test process. A later campaign must
  // never inherit dangling descriptor links left by a killed earlier child.
  let root = privateProcessRoots.get(env.XDG_RUNTIME_DIR);
  if (!root) {
    root = createPrivateTestDirectory("proc-owned-", env.XDG_RUNTIME_DIR);
    privateProcessRoots.set(env.XDG_RUNTIME_DIR, root);
  }
  return { ...env, H2A_TEST_PROC_ROOT: root, H2A_TEST_OWNED_PROC_ROOT: root };
}

function installProcessViewVariables(env) {
  for (const key of ["H2A_TEST_PROC_ROOT", "H2A_TEST_OWNED_PROC_ROOT"])
    if (env[key] !== undefined) process.env[key] = env[key];
}

function registerPrivateProcess(pid, env, replace = false) {
  if (process.platform !== "linux" || !pid || !env.H2A_TEST_PROC_ROOT
    || env.H2A_TEST_PROC_ROOT !== env.H2A_TEST_OWNED_PROC_ROOT) return () => {};
  const root = env.H2A_TEST_PROC_ROOT;
  assertPrivateQualificationPath(root, nativeQualificationRoot);
  const entry = join(root, String(pid));
  // Pin this process's proc directory, not a recyclable PID pathname. A host
  // preload replaces its parent's pin with its own before the parent exits.
  const fd = openSync(`/proc/${pid}`, constants.O_RDONLY | constants.O_DIRECTORY);
  const target = `/proc/${process.pid}/fd/${fd}`;
  try {
    if (replace) { try { unlinkSync(entry); } catch (error) { if (error.code !== "ENOENT") throw error; } }
    symlinkSync(target, entry);
  } catch (error) {
    closeSync(fd);
    if (error.code === "EEXIST") return () => {};
    throw error;
  }
  return () => {
    try { unlinkSync(entry); } catch (error) { if (error.code !== "ENOENT") throw error; }
    closeSync(fd);
  };
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
      envPairs: Object.entries(guarded).map(([key, value]) => `${key}=${value}`) });
    if (this.pid) this.once("exit", registerPrivateProcess(this.pid, guarded));
    return result;
  };
  childProcess.spawnSync = function (command, args, options) {
    if (!Array.isArray(args)) { options = args; args = []; }
    const env = guardedEnvironment(command, args, options?.env ?? process.env, options?.cwd);
    return actualSpawnSync(command, args, { ...options, env });
  };
  // Node's sync exec helpers retain an internal spawnSync reference.
  childProcess.execFileSync = function (command, args, options) {
    if (!Array.isArray(args)) { options = args; args = []; }
    const env = guardedEnvironment(command, args, options?.env ?? process.env, options?.cwd);
    return actualExecFileSync(command, args, { ...options, env });
  };
  childProcess.execSync = function (command, options) {
    const env = guardedEnvironment(command, [], options?.env ?? process.env, options?.cwd);
    return actualExecSync(command, { ...options, env });
  };
  const state = { violations: [], expectedRefusals: 0 };
  state.processRoots = privateProcessRoots;
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
  fs.realpathSync = function (path, ...args) {
    // Defense in depth for malformed process fixtures: never canonicalize an
    // external candidate, even if a fixture accidentally names one. The
    // production scanner receives its normal fs implementation outside tests.
    if (new Error().stack?.match(/native-terminal[/\\]server\.[jt]s/))
      assertPrivateQualificationPath(String(path), nativeQualificationRoot);
    return actualRealpath(path, ...args);
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
      try { return !/\) [ZX] /.test(fs.readFileSync(join(root, entry, "stat"), "utf8")); }
      catch (error) { if (error.code === "ENOENT" || error.code === "ESRCH") return false; throw error; }
    });
    if (alive.length === 0) return;
    assert.ok(Date.now() < deadline, `fixture processes still writing after host shutdown: ${alive.join(", ")}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

installNativeTestSpawnGuard();
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
