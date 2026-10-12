import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertQualifiedPath, qualificationRoot, qualifiedEnvironment } from "./helpers/qual-env.js";

function fixture(t, parent = tmpdir()) {
  const dir = mkdtempSync(join(parent, "h2a-qual-guard-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("qualification accepts a private temp root and an absent store within it", t => {
  const dir = fixture(t);
  assert.equal(assertQualifiedPath(dir), realpathSync(dir));
  assert.equal(assertQualifiedPath(join(dir, "absent", "store")), join(realpathSync(dir), "absent", "store"));
  const env = qualifiedEnvironment(dir);
  assert.equal(env.HOME, join(realpathSync(dir), "home"));
  assert.equal(env.XDG_RUNTIME_DIR, join(realpathSync(dir), "runtime"));
  assert.ok(existsSync(env.HOME));
  assert.ok(existsSync(env.XDG_RUNTIME_DIR));
});

test("qualification rejects the shared temp parent and non-private roots", t => {
  assert.throws(() => assertQualifiedPath(tmpdir()), /escapes .qual-tmp/);
  const dir = fixture(t);
  chmodSync(dir, 0o755);
  assert.throws(() => qualifiedEnvironment(dir), /escapes .qual-tmp/);
  assert.equal(existsSync(join(dir, "home")), false, "rejection precedes environment creation");
});

test("qualification rejects symlink escapes before creating environment directories", t => {
  mkdirSync(qualificationRoot, { recursive: true, mode: 0o700 });
  const dirs = [fixture(t), fixture(t, qualificationRoot)];
  const outside = fixture(t);
  for (const dir of dirs) {
    symlinkSync(outside, join(dir, "escape"), "dir");
    symlinkSync(join(outside, "missing"), join(dir, "dangling"), "dir");
    symlinkSync(userInfo().homedir, join(dir, "owner"), "dir");
    symlinkSync(outside, join(dir, "home"), "dir");
    for (const leaf of ["escape", "dangling", "owner"]) {
      assert.throws(() => assertQualifiedPath(join(dir, leaf, "absent")), /escapes .qual-tmp/);
    }
    assert.throws(() => qualifiedEnvironment(dir), /escapes .qual-tmp/);
  }
  assert.equal(existsSync(join(outside, "xdg-config")), false);
});

test("qualification protects the caller's real environment even when its directories are private temp roots", t => {
  const dir = fixture(t);
  const protectedEnv = {};
  for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "REMOTE_CLI_CONFIG_HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "H2A_ROOT"]) {
    protectedEnv[key] = join(dir, key.toLowerCase());
    mkdirSync(protectedEnv[key], { mode: 0o700 });
  }
  protectedEnv.H2A_NATIVE_SOCKET = join(protectedEnv.XDG_RUNTIME_DIR, "native-terminal.sock");
  const helper = new URL("./helpers/qual-env.js", import.meta.url).href;
  const script = `
    import assert from "node:assert/strict";
    import { userInfo } from "node:os";
    import { assertQualifiedPath, qualifiedEnvironment } from ${JSON.stringify(helper)};
    for (const path of ${JSON.stringify([dir, ...Object.values(protectedEnv)])}.concat(userInfo().homedir)) {
      assert.throws(() => assertQualifiedPath(path), /escapes .qual-tmp/);
      assert.throws(() => qualifiedEnvironment(path), /escapes .qual-tmp/);
    }
  `;
  execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { PATH: process.env.PATH, TMPDIR: tmpdir(), ...protectedEnv }
  });
});
