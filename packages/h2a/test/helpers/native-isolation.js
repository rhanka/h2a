import assert from "node:assert/strict";
import childProcess, { spawn, spawnSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { isMainThread } from "node:worker_threads";
import { once } from "node:events";
import fs, { closeSync, constants, lstatSync, mkdirSync, mkdtempSync, openSync, readlinkSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import os from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

// Test-only short root for deep worktrees whose AF_UNIX paths would overflow.
// The runner creates it with mkdtemp; every child carries the same boundary.
//
// Lot L0: when the authorised launcher marks the run (H2A_TEST_STATE_ROOT +
// attestation), the qualification root is that run root — never the real
// /tmp (owner /tmp rule) and never the repo checkout (read-only under the
// filesystem barrier). Otherwise the legacy /tmp short-root contract holds.
function readAttestedStateRoot() {
  const marker = process.env.H2A_TEST_STATE_ROOT;
  const attestationPath = process.env.H2A_TEST_STATE_ATTESTATION;
  if (!marker || !attestationPath) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(attestationPath, "utf8"));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || parsed.version !== 1
    || typeof parsed.root !== "string" || typeof parsed.nonce !== "string"
    || parsed.nonce.length < 16 || resolve(parsed.root) !== resolve(marker)) {
    return undefined;
  }
  return marker;
}
/**
 * Round-3 (reviews pr382-r3): the sanctioned T10 namespace-qualification
 * entry. scripts/run-namespace-qualification.mjs must observe REAL host PID
 * and network namespaces, so it cannot run inside the filesystem barrier
 * (bwrap would nest namespaces and invalidate the qualification). It marks
 * its run with H2A_TEST_QUALIFICATION_ROOT pointing at a caller-owned
 * private 0700 dir, and all fixture state roots derive from it — real state
 * stays untouched. This is a bounded exemption, not a fallback: any other
 * unconfined invocation still refuses below.
 */
function readValidQualificationRoot(env = process.env) {
  const shortQualificationRoot = env.H2A_TEST_QUALIFICATION_ROOT;
  if (shortQualificationRoot === undefined) return undefined;
  if (!/^\/tmp\/h2a-qual-[A-Za-z0-9]+$/.test(shortQualificationRoot)) return undefined;
  let info;
  try {
    info = lstatSync(shortQualificationRoot);
  } catch {
    return undefined;
  }
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700) {
    return undefined;
  }
  return shortQualificationRoot;
}
export function assertConfinedTestEnvironment(env = process.env) {
  if (readAttestedStateRoot() === undefined && readValidQualificationRoot(env) === undefined) {
    throw new Error("REFUSING unconfined test run before test evaluation: no valid test-state attestation (run through scripts/test-sandbox.mjs)");
  }
  if (env.H2A_TEST_STATE_BARRIER !== "1" && readValidQualificationRoot(env) === undefined) {
    throw new Error("REFUSING unconfined test run before test evaluation: filesystem barrier not active (run through scripts/test-sandbox.mjs)");
  }
}
const attestedStateRoot = readAttestedStateRoot();
const shortQualificationRoot = readValidQualificationRoot();
if (shortQualificationRoot !== undefined && attestedStateRoot === undefined) {
  assert.ok(typeof shortQualificationRoot === "string" && shortQualificationRoot.length > 0, "REFUSING invalid short qualification root");
}
if (attestedStateRoot !== undefined) {
  mkdirSync(attestedStateRoot, { recursive: true, mode: 0o700 });
}
// The repo default must also fit the historical host's longer staging name,
// including a mkdtemp suffix and seven-digit PID in deeply nested worktrees.
export const nativeQualificationRoot = attestedStateRoot ?? shortQualificationRoot ?? resolve(import.meta.dirname, "../../../../.q");

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
  // Lot L0: the owner /tmp rule mandates run roots under
  // ~/.cache-tmp/h2a-test/, which the historical cache ban below would
  // refuse. Carve out exactly the launcher-attested run root (a private
  // mkdtemp dir tied to this run by attestation); every other h2a-* cache
  // path stays banned.
  const attested = typeof readAttestedStateRoot === "function" ? readAttestedStateRoot() : undefined;
  const underAttested = attested !== undefined && (path === attested || path.startsWith(`${attested}/`));

  assert.ok(
    !exactForbidden.includes(path) &&
    !prefixForbidden.some(root => path === root || path.startsWith(`${root}/`)) &&
    (underAttested || !ownerHome || !path.startsWith(join(ownerHome, ".cache-tmp/h2a-"))),
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

/**
 * Round-3 CI repair: translate barrier-overlay checkout paths to their
 * run-root backing dir before enforcing the qualification root. The mapping
 * is launcher-declared (H2A_TEST_STATE_OVERLAYS, JSON [{path, shadow}]) and
 * honored ONLY with the barrier active and only when the shadow resolves
 * inside the asserted root — a mapping can only redirect INTO confinement,
 * never out. Malformed entries are ignored (fail closed, refuse as usual).
 */
export function applyTestStateOverlays(candidate, env = process.env, root = nativeQualificationRoot) {
  if (env.H2A_TEST_STATE_BARRIER !== "1") return candidate;
  let parsed;
  try {
    parsed = JSON.parse(env.H2A_TEST_STATE_OVERLAYS ?? "");
  } catch {
    return candidate;
  }
  if (!Array.isArray(parsed)) return candidate;
  const absolute = resolve(candidate);
  const actualRoot = resolve(root);
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null
      || typeof entry.path !== "string" || typeof entry.shadow !== "string") continue;
    if (!isAbsolute(entry.path) || !isAbsolute(entry.shadow)) continue;
    const shadow = resolve(entry.shadow);
    const shadowRel = relative(actualRoot, shadow);
    if (!(shadowRel === "" || (!shadowRel.startsWith("..") && !shadowRel.startsWith("/")))) continue;
    const rel = relative(resolve(entry.path), absolute);
    if (rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"))) return join(shadow, rel);
  }
  return candidate;
}

export function assertPrivateQualificationPath(path, root, env = process.env) {
  const actualRoot = resolvedPath(root, 0, resolve(root));
  assert.equal(actualRoot, resolve(root), "REFUSING aliased qualification root before mutation");
  const actual = resolvedPath(applyTestStateOverlays(path, env, root), 0, actualRoot);
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
  // Round-3 CI repair: the fixture PATH keeps the toolchain directory of the
  // node running the tests (shebang `#!/usr/bin/env node` children, npm
  // lifecycle `node ...` scripts) ahead of the minimal /usr/bin:/bin. A
  // hardcoded /usr/bin:/bin only works where the OS ships a node there —
  // hosted CI runners carry it beside the runner-selected node instead.
  const toolDir = dirname(process.execPath);
  const fixturePath = toolDir === "/usr/bin" || toolDir === "/bin" ? "/usr/bin:/bin" : `${toolDir}:/usr/bin:/bin`;
  // The barrier-overlay mapping is launcher-declared confinement metadata
  // (like H2A_TEST_QUALIFICATION_ROOT above): fixture children enforce the
  // same translated guards, so it travels with the fixture env.
  const overlayPassthrough = process.env.H2A_TEST_STATE_OVERLAYS !== undefined
    ? { H2A_TEST_STATE_OVERLAYS: process.env.H2A_TEST_STATE_OVERLAYS }
    : {};
  const env = { ...(nativeQualificationRoot.startsWith("/tmp/") ? { H2A_TEST_QUALIFICATION_ROOT: nativeQualificationRoot } : {}), ...overlayPassthrough, PATH: fixturePath, TERM: "xterm-256color", HOME: join(root, "home"),
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
  assert.ok(!closedProcessRoots.has(env.H2A_TEST_OWNED_PROC_ROOT), "REFUSING spawn after native fixture teardown");
  if (!isNode(command)) return env;
  // Carry the boundary through CLI/worker children even with a minimal env.
  const options = env.NODE_OPTIONS ?? "";
  const prepared = privateProcessEnvironment({ ...env,
    NODE_OPTIONS: options.includes(preload) ? options : `${options} ${preload}`.trim() });
  // Lot L0: Node children run this same preload through NODE_OPTIONS, so a
  // child without the confinement triple would fail the import-time gate in
  // a different way than its confined parent. Propagate the triple (when
  // this process has it) so children verify inside the same barrier. An
  // unconfined parent has nothing to propagate and the gate still refuses.
  for (const key of ["H2A_TEST_STATE_ROOT", "H2A_TEST_STATE_ATTESTATION", "H2A_TEST_STATE_BARRIER", "H2A_TEST_STATE_OVERLAYS"]) {
    if (prepared[key] === undefined && process.env[key] !== undefined) prepared[key] = process.env[key];
  }
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
  // Lot L0: preserve Node's overload contract — only a missing args or an
  // options object normalizes; any other non-array args (a number, a string)
  // must still throw exactly as the unpatched spawnSync would (the a5
  // execution-evidence control pins the throw for a malformed step).
  function normalizeSyncArgs(args, options) {
    if (args === undefined || (typeof args === "object" && args !== null && !Array.isArray(args))) {
      return [[], args];
    }
    return [args, options];
  }
  childProcess.spawnSync = function (command, args, options) {
    [args, options] = normalizeSyncArgs(args, options);
    const env = guardedEnvironment(command, args, options?.env ?? process.env, options?.cwd);
    return actualSpawnSync(command, args, { ...options, env });
  };
  // Node's sync exec helpers retain an internal spawnSync reference.
  childProcess.execFileSync = function (command, args, options) {
    [args, options] = normalizeSyncArgs(args, options);
    const env = guardedEnvironment(command, args, options?.env ?? process.env, options?.cwd);
    return actualExecFileSync(command, args, { ...options, env });
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

// Lot L0: importing this preload establishes the isolated worker roots
// immediately and refuses an unconfined invocation before any test or product
// module above is evaluated. Idempotent per process (Symbol.for survives
// vitest's fresh module registries inside one worker).
const importConfinement = Symbol.for("h2a.test.importConfinement");
if (globalThis[importConfinement] === undefined) {
  globalThis[importConfinement] = false;
}
if (globalThis[importConfinement] === false) {
  globalThis[importConfinement] = true;
  // The gate always runs: no attestation + barrier, no test evaluation.
  assertConfinedTestEnvironment(process.env);
  // Roots are established only when this process is not already isolated:
  // a fixture child spawned with a deliberate isolated env (socket, state
  // roots) must keep it — re-rooting it would redirect its state writes
  // away from the fixture the test observes.
  let alreadyIsolated = false;
  try {
    assertIsolatedEnvironment(process.env);
    alreadyIsolated = true;
  } catch {
    alreadyIsolated = false;
  }
  if (!alreadyIsolated && attestedStateRoot !== undefined) {
    const workerRoot = mkdtempSync(join(attestedStateRoot, "w-"));
    installNativeTestEnvironment(nativeTestEnvironment(workerRoot));
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
