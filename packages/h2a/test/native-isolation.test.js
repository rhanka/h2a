import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { createPrivateTestDirectory, assertIsolatedEnvironment, nativeTestEnvironment, spawnIsolatedNative } from "./helpers/native-isolation.js";

const qualRoot = resolve(import.meta.dirname, "../../../.qual-tmp");
const keys = ["HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "H2A_NATIVE_SOCKET"];

test("should reject every unsafe isolation variable and symlink before process startup", () => {
  const root = createPrivateTestDirectory("i");
  const safe = Object.fromEntries(keys.map(key => [key, join(root, key)]));
  try {
    assertIsolatedEnvironment(safe, qualRoot);
    for (const key of keys) {
      for (const bad of [undefined, "", "relative.sock", "/home/antoinefa", "/home/antoinefa/.local/state",
        "/home/antoinefa/.config", "/home/antoinefa/.cache-tmp/h2a-test",
        "/run/user/1000/h2a-nt", "/tmp/outside-qualification"]) {
        assert.throws(() => assertIsolatedEnvironment({ ...safe, [key]: bad }, qualRoot), /REFUSING/, `${key}: ${bad}`);
      }
      const alias = join(root, `alias-${key}`);
      symlinkSync("/home/antoinefa/.local/state", alias);
      assert.throws(() => assertIsolatedEnvironment({ ...safe, [key]: join(alias, "h2a") }, qualRoot), /REFUSING/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("should refuse unsafe child environments before executing the operation", () => {
  const root = createPrivateTestDirectory("i");
  try {
    const env = nativeTestEnvironment(root), marker = join(root, "executed");
    for (const key of keys) {
      assert.throws(() => spawnIsolatedNative(process.execPath,
        ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe')`],
        { env: { ...env, [key]: "/run/user/1000/h2a-nt" } }), /REFUSING/);
    }
    assert.equal(existsSync(marker), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("should refuse direct paths and aliases before inspecting metadata outside the private root", () => {
  const root = createPrivateTestDirectory("i"), outside = mkdtempSync("/tmp/h2a-r2-metadata-canary-");
  const env = nativeTestEnvironment(root), alias = join(root, "alias");
  symlinkSync(outside, alias);
  const original = fs.lstatSync, inspected = [];
  fs.lstatSync = (path, ...args) => {
    if (String(path).startsWith(outside)) inspected.push(String(path));
    return original(path, ...args);
  };
  syncBuiltinESMExports();
  try {
    for (const HOME of [outside, join(alias, "home")])
      assert.throws(() => assertIsolatedEnvironment({ ...env, HOME }), /REFUSING/);
    assert.deepEqual(inspected, [], "guard must not inspect the refused target's metadata");
  } finally {
    fs.lstatSync = original; syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true });
  }
});
