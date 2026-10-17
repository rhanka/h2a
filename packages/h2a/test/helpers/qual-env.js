import assert from "node:assert/strict";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const qualificationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.qual-tmp");

const within = (path, root) => path === root || path.startsWith(root + sep);

// Resolve existing ancestors too: an absent store is a valid test case, but a
// symlink (including a dangling one) must never hide an escape before mkdir.
function canonicalPath(path) {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    try {
      lstatSync(absolute);
    } catch (missing) {
      if (missing.code !== "ENOENT") throw missing;
      return join(canonicalPath(dirname(absolute)), basename(absolute));
    }
    assert.fail(`qualification path escapes .qual-tmp via a dangling symlink: ${absolute}`);
  }
}

// Capture the actual caller's directories before any test changes process.env.
// The account home remains protected even when HOME points at a CI fixture.
const ownerHomes = [...new Set([homedir(), userInfo().homedir].map(canonicalPath))];
const ownerDirs = [...new Set([
  ...ownerHomes.flatMap(home => [".config", ".local", ".cache", ".codex", ".claude", ".h2a", "h2a-workspace"].map(leaf => join(home, leaf))),
  ...["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "REMOTE_CLI_CONFIG_HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "H2A_ROOT", "H2A_NATIVE_SOCKET"].flatMap(key => process.env[key] ? [process.env[key]] : []),
  ...(process.getuid ? [`/run/user/${process.getuid()}`] : [])
].map(canonicalPath))];

export function assertQualifiedPath(path) {
  const actual = canonicalPath(path);
  const message = `qualification path escapes .qual-tmp or a private temporary root: ${actual}`;
  assert.ok(!ownerHomes.includes(actual) && !ownerDirs.some(dir => within(actual, dir)), message);
  const root = canonicalPath(qualificationRoot);
  assert.ok(root === join(canonicalPath(dirname(qualificationRoot)), basename(qualificationRoot)), message);
  const absolute = resolve(path);
  if (within(absolute, qualificationRoot) || within(absolute, root)) {
    assert.ok(within(actual, root), message);
  } else {
    const temp = canonicalPath(tmpdir());
    const tempParent = within(absolute, resolve(tmpdir())) ? resolve(tmpdir()) : temp;
    assert.ok(absolute !== tempParent && within(absolute, tempParent), message);
    // Admit only the private first directory below the system temp parent,
    // never /tmp itself, a shared directory, or a symlink to an owner path.
    const privateRoot = join(tempParent, relative(tempParent, absolute).split(sep)[0]);
    const info = lstatSync(privateRoot);
    const actualRoot = realpathSync(privateRoot);
    assert.ok(info.isDirectory() && (info.mode & 0o077) === 0 &&
      (!process.getuid || info.uid === process.getuid()) &&
      within(actual, actualRoot) &&
      ![...ownerHomes, ...ownerDirs].some(dir => within(dir, actualRoot)), message);
  }
  return actual;
}

export function qualifiedEnvironment(dir) {
  dir = assertQualifiedPath(dir);
  const env = { PATH: process.env.PATH, NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-old-space-size=256" };
  for (const [key, leaf] of Object.entries({ HOME: "home", XDG_CONFIG_HOME: "xdg-config", XDG_DATA_HOME: "xdg-data", XDG_STATE_HOME: "xdg-state", XDG_CACHE_HOME: "xdg-cache", XDG_RUNTIME_DIR: "runtime", TMPDIR: "tmp", REMOTE_CLI_CONFIG_HOME: "config", CODEX_HOME: "codex" })) {
    env[key] = join(dir, leaf);
    assertQualifiedPath(env[key]);
    mkdirSync(env[key], { recursive: true, mode: 0o700 });
    assertQualifiedPath(env[key]);
  }
  return env;
}
