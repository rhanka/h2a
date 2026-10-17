import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import cp from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

const test = (name, fn) => { if (!process.env.MH_L6_CASE || name === process.env.MH_L6_CASE) nodeTest(name, fn); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ledger = JSON.parse(fs.readFileSync('docs/plan/mh-l6/dist-freeze-0986.json', 'utf8'));
const SIX = ['launch-guard.js', 'native-host.js', 'native-terminal/op.js',
  'native-terminal/process.js', 'native-terminal/supervisor.js', 'native-terminal/journal.js'];

function walk(root) {
  const out = {};
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { visit(path); continue; }
      if (entry.isFile()) out[relative(root, path)] = hash(fs.readFileSync(path));
    }
  };
  visit(root);
  return out;
}

// Extract the real published .6 tarballs (byte-verified against their
// receipt) to a private temp dir; never the read-only source.
function published(t) {
  assert.ok(process.env.MH_L5_ARTIFACTS, 'official published fixtures mandatory; never skip');
  const fixtures = fs.realpathSync(process.env.MH_L5_ARTIFACTS);
  const receipt = JSON.parse(fs.readFileSync(join(fixtures, 'receipt.json'), 'utf8'));
  const work = fs.mkdtempSync(join(tmpdir(), 'mh-l6-dist-freeze-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const roots = {};
  for (const [file, key] of [['sentropic-h2a-runtime-0.98.6.tgz', 'runtime'], ['sentropic-h2a-0.98.6.tgz', 'h2a']]) {
    const record = receipt.verified.find(row => row.file === file);
    assert.ok(record, `receipt must list ${file}`);
    const archive = join(fixtures, file);
    assert.equal(hash(fs.readFileSync(archive)), record.sha256, 'freeze the actual published tarball bytes');
    assert.equal(record.sha256, ledger.tarballs[file], 'ledger must bind the exact published tarballs');
    const dest = join(work, key);
    fs.mkdirSync(dest);
    cp.execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', dest]);
    roots[key] = join(dest, 'package');
  }
  return roots;
}

test('E3 should pin the full published runtime .6 dist closure byte for byte', t => {
  assert.equal(typeof walk, 'function', 'dist freeze walk required');
  const roots = published(t);
  const recomputed = walk(join(roots.runtime, 'dist'));
  assert.equal(Object.keys(recomputed).length, 400);
  assert.deepEqual(recomputed, ledger.publishedRuntimeDist);
});

test('E3 should reproduce the six-entry native diagnostic against the local build', t => {
  const roots = published(t);
  const local = walk('packages/h2a-runtime/dist');
  const pub = walk(join(roots.runtime, 'dist'));
  const same = name => local[name] === pub[name];
  assert.equal(same('launch-guard.js'), true, 'launch-guard.js stays byte-identical to published .6');
  const differing = SIX.filter(name => !same(name));
  assert.equal(differing.length, 5);
  assert.deepEqual(SIX.map(name => (same(name) ? 'identical' : 'differing')),
    ledger.sixEntryComparison.map(row => row.outcome));
});

test('E3 should pin the published h2a .6 upgrade installer subset', t => {
  const roots = published(t);
  const recomputed = walk(join(roots.h2a, 'dist/runtime/upgrade'));
  assert.ok(recomputed['index.js'], 'published upgrade installer present');
  assert.deepEqual(recomputed, ledger.publishedH2aUpgrade);
});
