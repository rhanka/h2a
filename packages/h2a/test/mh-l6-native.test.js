import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { buildReleaseNative, verifyReleaseNative } from '../../../scripts/build-release-native.mjs';

const test = (name, body) => {
  if (!process.env.MH_L6_CASE || process.env.MH_L6_CASE === name) nodeTest(name, body);
};
function assets() {
  const root = process.env.MH_L6_NATIVE_ASSETS;
  assert.ok(root?.startsWith('/tmp/mh-l6-toolchain-'), 'private pinned inputs and precompiled artifact mandatory; never skip');
  return root;
}
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'mh-l6-native-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function copied(t) {
  const root = fixture(t), artifact = join(root, 'artifact');
  const lock = JSON.parse(fs.readFileSync(new URL('../../../scripts/release/native-toolchain.lock.json', import.meta.url)));
  const archive = new URL('../../../scripts/release/' + lock.archive.path, import.meta.url);
  assert.equal(createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), lock.archive.sha256);
  fs.mkdirSync(artifact, { mode: 0o700 });
  execFileSync('/usr/bin/tar', ['-xzf', archive.pathname, '--no-same-owner', '-C', artifact]);
  return { root, artifact, payload: join(artifact, 'payload'),
    binary: join(artifact, 'payload/node_modules/node-pty/build/Release/pty.node') };
}
test('U10 should reproduce the registered native payload from the pinned release archives in a second build root', async t => {
  const root = fixture(t), reference = verifyReleaseNative(join(assets(), 'primary'));
  const built = await buildReleaseNative(join(root, 'rebuilt'), { archives: assets() });
  assert.deepEqual(verifyReleaseNative(built.root), { ...reference, payload: built.payload });
  assert.equal(built.commands.length, 1);
  assert.equal(built.commands[0].code, 0);
  t.diagnostic(JSON.stringify({ ...built, commands: built.commands }));
});
test('U10 should load the real precompiled node-pty and join a private PTY without any user compiler', async t => {
  const f = copied(t), verified = verifyReleaseNative(f.artifact), bin = join(f.root, 'no-compilers');
  fs.mkdirSync(bin);
  const marker = join(f.root, 'unexpected-compiler');
  for (const name of ['c++', 'cc', 'zig', 'node-gyp']) fs.writeFileSync(join(bin, name), `#!/bin/sh\nprintf unexpected > '${marker}'\nexit 71\n`, { mode: 0o755 });
  const previous = process.env.PATH; process.env.PATH = bin;
  try {
    assert.equal(verifyReleaseNative(f.artifact).binaryDigest, verified.binaryDigest);
    const require = createRequire(import.meta.url), pty = require(join(verified.payload, 'node_modules/node-pty'));
    const child = pty.spawn(process.execPath, ['-e', 'process.stdout.write("pinned-release-real-pty")'], {
      cwd: f.root, name: 'xterm', cols: 80, rows: 24, env: { PATH: bin, HOME: f.root, XDG_RUNTIME_DIR: f.root }
    });
    let output = ''; child.onData(bytes => { output += bytes; });
    const deadline = setTimeout(() => child.kill('SIGKILL'), 10000);
    const result = await new Promise(resolve => child.onExit(resolve)); clearTimeout(deadline);
    assert.equal(result.exitCode, 0); assert.match(output, /pinned-release-real-pty/);
    assert.equal(fs.existsSync(marker), false);
    const pkg = JSON.parse(fs.readFileSync(join(verified.payload, 'node_modules/node-pty/package.json')));
    assert.equal(pkg.name, 'node-pty'); assert.equal(pkg.version, '1.1.0');
    assert.equal(pkg.scripts, undefined); assert.equal(pkg.dependencies, undefined);
  } finally { process.env.PATH = previous; }
});
test('U10 should refuse altered precompiled binary bytes before they reach require', t => {
  const f = copied(t); fs.appendFileSync(f.binary, 'late altered ELF');
  assert.throws(() => verifyReleaseNative(f.artifact), /native_artifact_mismatch/);
});
test('U10 should refuse altered real node-pty JavaScript even if the ELF is intact', t => {
  const f = copied(t); fs.appendFileSync(join(f.payload, 'node_modules/node-pty/lib/index.js'), '\nthrow Error("late external effect");\n');
  assert.throws(() => verifyReleaseNative(f.artifact), /native_artifact_mismatch/);
});
test('U10 should refuse a hardlinked precompiled artifact rather than sharing mutable ELF bytes', t => {
  const f = copied(t); fs.linkSync(f.binary, join(f.root, 'shared.node'));
  assert.throws(() => verifyReleaseNative(f.artifact), /native_file_unqualified/);
});
test('U10 should refuse a symlinked binary pointing outside the precompiled payload', t => {
  const f = copied(t), external = join(f.root, 'external.node');
  fs.renameSync(f.binary, external); fs.symlinkSync(external, f.binary);
  assert.throws(() => verifyReleaseNative(f.artifact), /native_payload_link_or_special_file/);
});
test('U10 should refuse an unrecorded file and a changed payload mode', t => {
  const f = copied(t), extra = join(f.payload, 'node_modules/node-pty/extra.js');
  fs.writeFileSync(extra, 'export {};');
  assert.throws(() => verifyReleaseNative(f.artifact), /native_artifact_mismatch/);
  fs.unlinkSync(extra); fs.chmodSync(f.binary, 0o644);
  assert.throws(() => verifyReleaseNative(f.artifact), /native_artifact_mismatch/);
});
test('U10 should reject a missing precompiled binary without falling back to sources or scripts', t => {
  const f = copied(t); fs.unlinkSync(f.binary);
  let error;
  try { verifyReleaseNative(f.artifact); } catch (cause) { error = cause; }
  assert.equal(fs.existsSync(f.binary), false, 'a consumer must not recreate the missing ELF');
  assert.equal(error?.code, 'ENOENT');
  assert.equal(fs.existsSync(join(f.artifact, 'build')), false);
});
for (const [field, value, description] of [['node', '23.0.0', 'Node major'], ['modules', '0', 'Node ABI'], ['napi', '7', 'N-API level']]) {
  test(`U10 should reject an unqualified ${description} before consuming the artifact or compiling`, async t => {
    const f = fixture(t), original = Object.getOwnPropertyDescriptor(process.versions, field);
    try {
      Object.defineProperty(process.versions, field, { value, configurable: true });
      assert.throws(() => verifyReleaseNative(join(assets(), 'primary')), /native_profile_unqualified/);
      await assert.rejects(buildReleaseNative(join(f, 'refused'), { archives: assets() }), /native_profile_unqualified/);
      assert.equal(fs.existsSync(join(f, 'refused')), false);
    } finally { Object.defineProperty(process.versions, field, original); }
  });
}
test('U10 should reject a libc below the target baseline before consuming the artifact or compiling', async t => {
  const f = fixture(t), original = process.report.getReport;
  try {
    process.report.getReport = () => ({ header: { glibcVersionRuntime: '2.30' } });
    assert.throws(() => verifyReleaseNative(join(assets(), 'primary')), /native_profile_unqualified/);
    await assert.rejects(buildReleaseNative(join(f, 'refused'), { archives: assets() }), /native_profile_unqualified/);
    assert.equal(fs.existsSync(join(f, 'refused')), false);
  } finally { process.report.getReport = original; }
});
test('U10 should refuse an altered or extended artifact descriptor', t => {
  const f = copied(t), path = join(f.artifact, 'native-artifact.json'), original = JSON.parse(fs.readFileSync(path));
  for (const patch of [{ recipeDigest: 'sha256:' + '0'.repeat(64) }, { binaryDigest: 'sha256:' + '0'.repeat(64) }, { unknown: true }]) {
    fs.writeFileSync(path, JSON.stringify({ ...original, ...patch }));
    assert.throws(() => verifyReleaseNative(f.artifact), /native_artifact_mismatch/);
  }
});
test('U10 should reject an unqualified architecture before consuming the artifact or compiling', async t => {
  const f = fixture(t), original = Object.getOwnPropertyDescriptor(process, 'arch');
  try {
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
    assert.throws(() => verifyReleaseNative(join(assets(), 'primary')), /native_profile_unqualified/);
    await assert.rejects(buildReleaseNative(join(f, 'refused'), { archives: assets() }), /native_profile_unqualified/);
    assert.equal(fs.existsSync(join(f, 'refused')), false);
  } finally { Object.defineProperty(process, 'arch', original); }
});
test('U10 should reject an unpinned compiler archive before its first instruction executes', async t => {
  const root = fixture(t), inputs = join(root, 'archives'), fake = join(root, 'fake');
  fs.mkdirSync(inputs); fs.mkdirSync(fake);
  const zig = join(fake, 'zig-x86_64-linux-0.14.1'), marker = join(root, 'untrusted-compiler-executed');
  fs.mkdirSync(zig); fs.mkdirSync(join(zig, 'lib'));
  for (const name of ['libcxx', 'libcxxabi', 'libunwind']) {
    fs.mkdirSync(join(zig, 'lib', name)); fs.writeFileSync(join(zig, 'lib', name, 'LICENSE.TXT'), 'fixture');
  }
  fs.writeFileSync(join(zig, 'LICENSE'), 'fixture');
  fs.writeFileSync(join(zig, 'zig'), `#!/bin/sh\nprintf executed > '${marker}'\nexit 0\n`, { mode: 0o755 });
  execFileSync('/usr/bin/tar', ['-cJf', join(inputs, 'zig.tar.xz'), '-C', fake, 'zig-x86_64-linux-0.14.1']);
  for (const name of ['node-headers.tar.xz', 'node-pty.tgz', 'node-addon-api.tgz']) fs.copyFileSync(join(assets(), name), join(inputs, name));
  let error;
  try { await buildReleaseNative(join(root, 'refused'), { archives: inputs }); } catch (cause) { error = cause; }
  assert.equal(fs.existsSync(marker), false, 'unverified compiler must never execute');
  assert.match(error?.message ?? '', /native_input_digest_mismatch:zig.tar.xz/);
  assert.equal(fs.existsSync(join(root, 'refused')), false);
});
