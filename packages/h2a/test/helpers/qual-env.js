import assert from "node:assert/strict";
import { mkdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const qualificationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.qual-tmp");

export function assertQualifiedPath(path) {
  const root = realpathSync(qualificationRoot);
  const actual = realpathSync(path);
  assert.ok(actual === root || actual.startsWith(root + sep), `qualification path escapes .qual-tmp: ${actual}`);
  return actual;
}

export function qualifiedEnvironment(dir) {
  assertQualifiedPath(dir);
  const env = { PATH: process.env.PATH, NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-old-space-size=256" };
  for (const [key, leaf] of Object.entries({ HOME: "home", XDG_CONFIG_HOME: "xdg-config", XDG_DATA_HOME: "xdg-data", XDG_STATE_HOME: "xdg-state", XDG_CACHE_HOME: "xdg-cache", XDG_RUNTIME_DIR: "runtime", TMPDIR: "tmp", REMOTE_CLI_CONFIG_HOME: "config", CODEX_HOME: "codex" })) {
    env[key] = join(dir, leaf);
    mkdirSync(env[key], { recursive: true, mode: 0o700 });
    assertQualifiedPath(env[key]);
  }
  return env;
}
