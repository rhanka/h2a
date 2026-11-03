import assert from "node:assert/strict";
import childProcess, { exec, execFile, execFileSync, execSync, fork, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { assertNativeTestSpawnRefused, createPrivateTestDirectory, nativeTestEnvironment } from "./helpers/native-isolation.js";
import { installationFixture } from './helpers/mh-l6-installation.js';

test("should guard real native entry points even when the test bypasses the spawn helper", () => {
  const root = createPrivateTestDirectory("sg");
  const env = nativeTestEnvironment(root);
  const directory = join(root, "native-terminal");
  mkdirSync(directory);
  try {
    for (const name of ["op.js", "process.js"]) {
      const entry = join(directory, name), marker = join(root, `${name}.executed`);
      writeFileSync(entry, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed');`);
      for (const key of ["HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "H2A_NATIVE_SOCKET"]) {
        const options = { env: { ...env, [key]: undefined } };
        for (const launch of [() => spawnSync(process.execPath, [entry], options),
          () => spawnSync(process.execPath, [name], { ...options, cwd: directory }),
          () => childProcess.spawnSync(process.execPath, [entry], options),
          () => spawn(process.execPath, [entry], options),
          () => execFile(process.execPath, [entry], options),
          () => execFileSync(process.execPath, [entry], options),
          () => exec(`"${process.execPath}" "${name}"`, { ...options, cwd: directory }),
          () => execSync(`"${process.execPath}" "${name}"`, { ...options, cwd: directory }),
          () => fork(entry, [], options)]) {
          assertNativeTestSpawnRefused(launch);
        }
        assert.equal(existsSync(marker), false);
      }
      assert.equal(spawnSync(process.execPath, [entry], { env }).status, 0);
      assert.equal(readFileSync(marker, "utf8"), "executed");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("should carry the native guard through a CLI child with a replaced environment", () => {
  const root = createPrivateTestDirectory("sg"), env = nativeTestEnvironment(root);
  const directory = join(root, "native-terminal"), marker = join(root, "executed");
  mkdirSync(directory);
  const entry = join(directory, "op.js");
  writeFileSync(entry, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'unsafe');`);
  try {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { spawnSync } from 'node:child_process';
      spawnSync(process.execPath, [${JSON.stringify(entry)}], { env: {} });
    `], { env, encoding: "utf8" });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /REFUSING/);
    assert.equal(existsSync(marker), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("should install the repo-wide boundary in each default test runner", () => {
  const repo = new URL("../../../", import.meta.url);
  for (const config of ["vitest.config.mjs", "packages/h2a-runtime/vitest.config.mjs", "packages/track/vitest.config.ts"]) {
    assert.match(readFileSync(new URL(config, repo), "utf8"), /setupFiles:.*vitest\.native-isolation\.mjs/);
  }
  assert.match(readFileSync(new URL("scripts/run-tests.mjs", repo), "utf8"),
    /scripts\/run-node-tests\.mjs/);
  assert.match(readFileSync(new URL("scripts/run-node-tests.mjs", repo), "utf8"),
    /execArgv:\s*\['--import',.*native-isolation\.js/);
});

test("should preserve a neutral loader environment while guarding child native launches", () => {
  const root = createPrivateTestDirectory("sg"), env = nativeTestEnvironment(root);
  const entry = join(root, "native-terminal/op.js"), marker = join(root, "executed");
  mkdirSync(join(root, 'native-terminal'));
  writeFileSync(entry, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'unsafe');`);
  try {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { spawnSync } from 'node:child_process';
      assert.equal(process.env.NODE_OPTIONS, undefined);
      console.log('neutral loader environment retained');
      spawnSync(process.execPath, [${JSON.stringify(entry)}], { env: {} });
    `], { env, encoding: 'utf8' });
    assert.match(child.stdout, /neutral loader environment retained/);
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /REFUSING/);
    assert.equal(existsSync(marker), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a valid image manifest without a build receipt cannot disable the native guard', () => {
  const fixture = installationFixture(), root = fixture.layout.canonicalPrefix;
  const entry = join(root, 'native-terminal/op.js'), marker = join(root, 'executed');
  mkdirSync(join(root, 'native-terminal'));
  writeFileSync(entry, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'unsafe');`);
  const image = fixture.image('unregistered-image', 1, `import {spawnSync} from 'node:child_process';
    console.log('unregistered image entered');
    spawnSync(process.execPath, [${JSON.stringify(entry)}], {env:{}});`);
  try {
    const env = { ...process.env }; delete env.NODE_OPTIONS;
    const child = spawnSync(process.execPath, [join(image.root, image.entrypoint)], { env, encoding: 'utf8' });
    assert.match(child.stdout, /unregistered image entered/);
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /REFUSING/);
    assert.equal(existsSync(marker), false);
  } finally { fixture.close(); }
});

test("should fail the test process even when production catches an unsafe native spawn", () => {
  const root = createPrivateTestDirectory("sg"), env = nativeTestEnvironment(root);
  try {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { spawnSync } from 'node:child_process';
      try { spawnSync(process.execPath, [${JSON.stringify(join(root, "native-terminal/op.js"))}], { env: {} }); }
      catch { console.log('caught by production'); }
      process.exitCode = 0;
    `], { env, encoding: "utf8" });
    assert.match(child.stdout, /caught by production/);
    assert.notEqual(child.status, 0, "a caught unsafe native launch must still fail qualification");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
