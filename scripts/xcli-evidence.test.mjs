import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { exportEvidence } from './xcli-export-evidence.mjs';
import { repo, compliantQualificationRoot } from './xcli-lab.mjs';

test('qualification roots in runner storage retain privacy, alias and child inheritance guards', () => {
  const root = compliantQualificationRoot();
  const alias = root + 'alias';
  try {
    const helper = pathToFileURL(join(repo, 'packages/h2a/test/helpers/native-isolation.js')).href;
    const probe = `const h = await import(${JSON.stringify(helper)});
      const path = h.createPrivateTestDirectory('child-');
      if (h.nativeTestEnvironment(path).H2A_TEST_QUALIFICATION_ROOT !== process.env.H2A_TEST_QUALIFICATION_ROOT)
        throw new Error('child qualification root was lost');`;
    const run = path => spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
      env: { ...process.env, H2A_TEST_QUALIFICATION_ROOT: path }, encoding: 'utf8',
    });
    const accepted = run(root);
    assert.equal(accepted.status, 0, accepted.stderr);
    fs.chmodSync(root, 0o755);
    assert.match(run(root).stderr, /REFUSING non-private/);
    fs.chmodSync(root, 0o700);
    fs.symlinkSync(root, alias);
    assert.match(run(alias).stderr, /REFUSING non-private/);
  } finally { fs.rmSync(alias, { force: true }); fs.rmSync(root, { recursive: true, force: true }); }
});

test('receipt export refuses aliases, broad directories and existing files', () => {
  const source = fs.mkdtempSync(join(tmpdir(), 'xcli-evidence-source-'));
  const destination = fs.mkdtempSync(join(tmpdir(), 'xcli-evidence-'));
  const alias = fs.mkdtempSync(join(tmpdir(), 'xcli-evidence-'));
  const previous = process.env.XCLI_EVIDENCE_EXPORT_DIR;
  try {
    fs.writeFileSync(join(source, 'receipt.json'), '{"safe":true}\n');
    process.env.XCLI_EVIDENCE_EXPORT_DIR = '/tmp';
    assert.throws(() => exportEvidence(source, ['receipt.json']));
    fs.rmdirSync(alias); fs.symlinkSync(destination, alias);
    process.env.XCLI_EVIDENCE_EXPORT_DIR = alias;
    assert.throws(() => exportEvidence(source, ['receipt.json']), /must not be aliased/);
    process.env.XCLI_EVIDENCE_EXPORT_DIR = destination;
    assert.throws(() => exportEvidence(source, ['runner.log']));
    fs.writeFileSync(join(destination, 'receipt.json'), 'preserve existing bytes');
    assert.throws(() => exportEvidence(source, ['receipt.json']), { code: 'EEXIST' });
    assert.equal(fs.readFileSync(join(destination, 'receipt.json'), 'utf8'), 'preserve existing bytes');
  } finally {
    if (previous === undefined) delete process.env.XCLI_EVIDENCE_EXPORT_DIR;
    else process.env.XCLI_EVIDENCE_EXPORT_DIR = previous;
    fs.rmSync(alias, { force: true, recursive: true });
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
  }
});

test('a source runner exports JSON receipts without exposing its private build or logs', () => {
  const exported = fs.mkdtempSync(join(tmpdir(), 'xcli-evidence-'));
  // R15 (P2-1): the spawned source runner mints a run-* root holding the
  // built sources (~114 MB). The export dir is not enough: recover the exact
  // reported root and remove it, or every run leaks one root.
  let sourceRoot = null;
  try {
    const result = spawnSync(process.execPath, ['scripts/xcli-source-tests.mjs',
      'packages/h2a/test/cli-host-status.test.js'], {
      env: { ...process.env, XCLI_EVIDENCE_EXPORT_DIR: exported },
      encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(fs.readdirSync(exported).sort(), ['execution.json', 'receipt.json']);
    for (const name of fs.readdirSync(exported)) {
      const path = join(exported, name), stat = fs.statSync(path);
      assert.equal(stat.uid, fs.statSync(exported).uid);
      assert.equal(stat.mode & 0o777, 0o600);
      assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path, 'utf8')));
    }
    const receipt = JSON.parse(fs.readFileSync(join(exported, 'receipt.json'), 'utf8'));
    assert.ok(receipt.counts.pass > 0);
    assert.equal(receipt.counts.fail, 0);
    const root = join(receipt.sourceBuild.path, '..');
    sourceRoot = root;
    assert.ok(fs.existsSync(sourceRoot), 'the reported source root exists before cleanup');
    assert.equal(fs.statSync(root).mode & 0o777, 0o700);
    assert.equal(fs.statSync(exported).mode & 0o777, 0o700);
  } finally {
    fs.rmSync(exported, { recursive: true, force: true });
    if (sourceRoot) {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      assert.equal(fs.existsSync(sourceRoot), false, 'the source root is removed, not leaked');
    }
  }
});
