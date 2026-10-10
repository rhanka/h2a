import assert from "node:assert/strict";
import { lstatSync, readlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

function rejectOwnerPath(path) {
  assert.ok(path !== "/home/antoinefa" && ![
    "/run/user/1000", "/home/antoinefa/.local/state", "/home/antoinefa/.config",
  ].some(root => path === root || path.startsWith(`${root}/`))
    && !path.startsWith("/home/antoinefa/.cache-tmp/h2a-"),
  `REFUSING owner path before filesystem access: ${path}`);
}

// Resolve existing ancestors without following a symlink into owner state.
function resolvedPath(path, depth = 0) {
  const absolute = resolve(path);
  rejectOwnerPath(absolute);
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
        ...parts.slice(index + 1)), depth + 1);
    }
  }
  return current;
}

export function assertPrivateQualificationPath(path, root) {
  const actual = resolvedPath(path);
  const rel = relative(resolvedPath(root), actual);
  assert.ok(rel === "" || (!rel.startsWith("..") && !rel.startsWith("/")),
    `REFUSING path outside qualification root: ${actual}`);
}

export function assertIsolatedEnvironment(env, root) {
  for (const key of ["HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME"]) {
    assert.ok(env[key], `REFUSING missing isolation variable: ${key}`);
    assertPrivateQualificationPath(env[key], root);
  }
  for (const key of ["TMPDIR", "TMUX_TMPDIR", "REMOTE_CLI_CONFIG_HOME", "H2A_ROOT",
    "H2A_NATIVE_SOCKET", "H2A_NATIVE_HOST_LOG"]) {
    if (env[key]) assertPrivateQualificationPath(env[key], root);
  }
}

export function isolatedNativeTestEnvironment(overrides = {}) {
  const env = Object.fromEntries(["HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME"]
    .map(key => [key, process.env[key]]));
  Object.assign(env, overrides);
  assertIsolatedEnvironment(env, resolve(import.meta.dirname, "../../../../.qual-tmp"));
  return env;
}
