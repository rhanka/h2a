import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { assertIsolatedEnvironment } from "./helpers/native-isolation.js";

const qualRoot = resolve(import.meta.dirname, "../../../.qual-tmp");
const keys = ["HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME"];

test("should reject every unsafe isolation variable and symlink before process startup", () => {
  mkdirSync(qualRoot, { recursive: true, mode: 0o700 });
  const root = mkdtempSync(join(qualRoot, "i"));
  const safe = Object.fromEntries(keys.map(key => [key, join(root, key)]));
  try {
    assertIsolatedEnvironment(safe, qualRoot);
    for (const key of keys) {
      for (const bad of [undefined, "/home/antoinefa", "/home/antoinefa/.local/state",
        "/home/antoinefa/.config", "/home/antoinefa/.cache-tmp/h2a-test",
        "/run/user/1000/h2a-nt", "/tmp/outside-qualification"]) {
        assert.throws(() => assertIsolatedEnvironment({ ...safe, [key]: bad }, qualRoot), /REFUSING/);
      }
      const alias = join(root, `alias-${key}`);
      symlinkSync("/home/antoinefa/.local/state", alias);
      assert.throws(() => assertIsolatedEnvironment({ ...safe, [key]: join(alias, "h2a") }, qualRoot), /REFUSING/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
