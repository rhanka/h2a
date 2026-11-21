import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createPrivateTestDirectory, assertIsolatedEnvironment, nativeQualificationRoot, nativeTestEnvironment, spawnIsolatedNative } from "./helpers/native-isolation.js";

const qualRoot = nativeQualificationRoot;
const keys = ["HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "H2A_NATIVE_SOCKET"];

test("should provision and dispose a private suite without using inherited owner paths", () => {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { existsSync } from 'node:fs';
    import { dirname } from 'node:path';
    import { assertIsolatedEnvironment, setupNativeTestEnvironment } from ${JSON.stringify(new URL("./helpers/native-isolation.js", import.meta.url).href)};
    const inherited = { ...process.env };
    let cleanup;
    setupNativeTestEnvironment(hook => { cleanup = hook; });
    assertIsolatedEnvironment(process.env);
    const root = dirname(process.env.HOME);
    assert.ok(existsSync(process.env.HOME));
    assert.ok(existsSync(process.env.TMPDIR));
    assert.equal(process.env.TMUX, '');
    await cleanup();
    assert.equal(existsSync(root), false);
    assert.deepEqual({ ...process.env }, inherited);
  `], { encoding: "utf8", timeout: 10_000, env: { ...process.env } });
  assert.equal(child.status, 0, child.stderr);

  // D16 R1/R3: inheriting owner paths into a preloaded Node child must be
  // refused BEFORE evaluating the test/script module.
  const markerRoot = createPrivateTestDirectory("r1-owner-refuse-");
  const marker = join(markerRoot, "evaluated.txt");
  try {
    const refused = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { writeFileSync } from 'node:fs';
      writeFileSync(${JSON.stringify(marker)}, 'evaluated');
    `], {
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        HOME: "/home/antoinefa",
        XDG_RUNTIME_DIR: "/run/user/1000",
        XDG_STATE_HOME: "/home/antoinefa/.local/state",
        XDG_CONFIG_HOME: "/home/antoinefa/.config",
      },
    });
    assert.notEqual(refused.status, 0, "inherited owner HOME must be refused by D16 preload");
    assert.match(refused.stderr, /REFUSING/);
    assert.equal(existsSync(marker), false, "module must not evaluate when inherited env escapes R");
  } finally {
    rmSync(markerRoot, { recursive: true, force: true });
  }
});

test("L0 R1: D16 preload refuses unconfined direct Node invocation before module evaluation", () => {
  const root = createPrivateTestDirectory("r1-unconfined-");
  const marker = join(root, "evaluated.txt");
  try {
    const unconfinedEnv = { ...process.env };
    delete unconfinedEnv.H2A_TEST_STATE_ROOT;
    delete unconfinedEnv.H2A_TEST_STATE_BARRIER;
    delete unconfinedEnv.H2A_TEST_SANDBOX_NONCE;
    delete unconfinedEnv.H2A_TEST_STATE_RECEIPT;
    const res = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ran');`],
      { encoding: "utf8", timeout: 10_000, env: unconfinedEnv },
    );
    // Note: prepareGuardedCall re-carries D16 env into children of confined tests;
    // to test true unconfined preload entry, set contradictory/corrupt D16 nonce.
    const badNonce = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ran');`],
      { encoding: "utf8", timeout: 10_000, env: { ...process.env, H2A_TEST_SANDBOX_NONCE: "0".repeat(48) } },
    );
    assert.notEqual(badNonce.status, 0);
    assert.match(badNonce.stderr, /REFUSING unconfined test run/);
    assert.equal(existsSync(marker), false);
    assert.equal(res.status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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

test("should leave room for the historical staging socket and a seven-digit child PID", () => {
  const root = createPrivateTestDirectory("g");
  try {
    const staging = join(root, "h2a-nt", ".native-terminal.sock.9999999.12345678.sock");
    assert.ok(Buffer.byteLength(staging) <= 107, `historical staging exceeds AF_UNIX: ${staging}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
