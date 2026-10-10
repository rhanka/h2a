import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readlinkSync } from "node:fs";
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
    "H2A_NATIVE_HOST_LOG"]) {
    if (env[key]) assertPrivateQualificationPath(env[key], root);
  }
  if (env.TMUX) assertPrivateQualificationPath(env.TMUX.split(",")[0], root);
}

export function isolatedNativeTestEnvironment(overrides = {}) {
  const env = Object.fromEntries(["HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME",
    "H2A_NATIVE_SOCKET", "TMPDIR", "TMUX_TMPDIR", "REMOTE_CLI_CONFIG_HOME", "H2A_ROOT"]
    .map(key => [key, process.env[key]]));
  Object.assign(env, overrides);
  assertIsolatedEnvironment(env);
  return env;
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
  return env;
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

function guardSpawn(args, options = {}) {
  assertIsolatedNativeOperation(options.env ?? process.env);
  for (const flag of ["--socket", "--registry-path"]) {
    const index = args.indexOf(flag);
    if (index !== -1) assertPrivateQualificationPath(args[index + 1], nativeQualificationRoot);
  }
}

export function spawnIsolatedNative(command, args = [], options = {}) {
  guardSpawn(args, options);
  return spawn(command, args, options);
}

export function spawnSyncIsolatedNative(command, args = [], options = {}) {
  guardSpawn(args, options);
  return spawnSync(command, args, options);
}
