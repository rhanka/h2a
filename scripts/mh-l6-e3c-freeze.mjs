// Regenerate the committed E3c comparative freeze of the published .6 dists.
//
// Reads the verified private fixture root (MH_L5_ARTIFACTS, prepared by
// scripts/mh-l6-legacy-fixtures.mjs), extracts the real published runtime
// .6 and h2a .6 tarballs to a fresh temp dir, hashes the full published
// runtime dist closure plus the published h2a upgrade-installer subset,
// compares the six E3a native entries against the local build, and writes
// docs/plan/mh-l6/dist-freeze-0986.json. The read-only tarballs are never
// written; only temp dirs. Usage:
//   MH_L5_ARTIFACTS=$root node scripts/mh-l6-e3c-freeze.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function walk(root) {
  const out = {};
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`freeze_symlink:${relative(root, path)}`);
      if (entry.isDirectory()) { visit(path); continue; }
      if (entry.isFile()) out[relative(root, path)] = hash(fs.readFileSync(path));
    }
  };
  visit(root);
  return out;
}

assert.ok(process.env.MH_L5_ARTIFACTS, 'official published fixtures mandatory; never skip');
const fixtures = fs.realpathSync(process.env.MH_L5_ARTIFACTS);
const receipt = JSON.parse(fs.readFileSync(join(fixtures, 'receipt.json'), 'utf8'));
const work = fs.mkdtempSync(join(tmpdir(), 'mh-l6-e3c-'));
try {
  const published = {};
  for (const [file, dir] of [['sentropic-h2a-runtime-0.98.6.tgz', 'runtime'], ['sentropic-h2a-0.98.6.tgz', 'h2a']]) {
    const record = receipt.verified.find(row => row.file === file);
    if (!record) throw new Error(`receipt_missing:${file}`);
    const archive = join(fixtures, file);
    if (hash(fs.readFileSync(archive)) !== record.sha256) throw new Error(`tarball_mismatch:${file}`);
    const dest = join(work, dir);
    fs.mkdirSync(dest);
    cp.execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', dest]);
    published[dir] = join(dest, 'package');
  }
  const publishedRuntime = walk(join(published.runtime, 'dist'));
  const publishedUpgrade = walk(join(published.h2a, 'dist/runtime/upgrade'));
  const localRuntime = walk('packages/h2a-runtime/dist');
  const localUpgrade = walk('packages/h2a/dist/runtime/upgrade');
  const entries = [['launch-guard.js', 'launch-guard.js'],
    ['native-host.js', 'native-host.js'],
    ['native-terminal/op.js', 'native-terminal/op.js'],
    ['native-terminal/process.js', 'native-terminal/process.js'],
    ['native-terminal/supervisor.js', 'native-terminal/supervisor.js'],
    ['native-terminal/journal.js', 'native-terminal/journal.js']];
  const comparison = entries.map(([name, rel]) => {
    const local = localRuntime[rel] ?? localUpgrade[rel];
    const pub = publishedRuntime[rel];
    if (!local || !pub) throw new Error(`freeze_entry_missing:${name}`);
    return { name, local: local.slice(0, 16), published: pub.slice(0, 16), outcome: local === pub ? 'identical' : 'differing' };
  });
  const ledger = {
    generated: 'scripts/mh-l6-e3c-freeze.mjs',
    tarballs: {
      'sentropic-h2a-runtime-0.98.6.tgz': receipt.verified.find(row => row.file === 'sentropic-h2a-runtime-0.98.6.tgz').sha256,
      'sentropic-h2a-0.98.6.tgz': receipt.verified.find(row => row.file === 'sentropic-h2a-0.98.6.tgz').sha256,
    },
    publishedRuntimeDist: publishedRuntime,
    publishedH2aUpgrade: publishedUpgrade,
    sixEntryComparison: comparison,
    localCounts: { runtimeDist: Object.keys(localRuntime).length, upgradeClosure: Object.keys(localUpgrade).length },
    regen: 'MH_L5_ARTIFACTS=$root node scripts/mh-l6-e3c-freeze.mjs (after deliberate local dist change only)',
  };
  fs.writeFileSync('docs/plan/mh-l6/dist-freeze-0986.json', JSON.stringify(ledger, null, 2) + '\n');
  const identical = comparison.filter(row => row.outcome === 'identical').map(row => row.name);
  process.stdout.write(`E3c freeze: ${Object.keys(publishedRuntime).length} published runtime files, ${Object.keys(publishedUpgrade).length} published upgrade files, identical=[${identical}]\n`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
