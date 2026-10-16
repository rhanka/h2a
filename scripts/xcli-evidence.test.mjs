import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { exportEvidence } from './xcli-export-evidence.mjs';

test('receipt export refuses aliases, broad directories and existing files', () => {
  const source = fs.mkdtempSync('/tmp/xcli-evidence-source-');
  const destination = fs.mkdtempSync('/tmp/xcli-evidence-');
  const alias = fs.mkdtempSync('/tmp/xcli-evidence-');
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
  const exported = fs.mkdtempSync('/tmp/xcli-evidence-');
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
    assert.equal(fs.statSync(root).mode & 0o777, 0o700);
    assert.equal(fs.statSync(exported).mode & 0o777, 0o700);
  } finally { fs.rmSync(exported, { recursive: true, force: true }); }
});
