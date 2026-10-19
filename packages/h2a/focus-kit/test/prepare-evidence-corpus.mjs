import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// A depth-one checkout can omit frozen blobs once their working files evolve.
// Fetch only the exact reference that owns the corpus; never rebase its bytes.
const repo = process.cwd();
const manifest = JSON.parse(readFileSync(join(repo, 'packages/h2a/focus-kit/test/fixtures/evidence-corpus.v1.json'), 'utf8'));
assert.match(manifest.reference, /^[a-f0-9]{40}$/);
const result = spawnSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', manifest.reference],
  { cwd: repo, encoding: 'utf8' });
assert.equal(result.status, 0, `Cannot prepare frozen evidence corpus: ${result.stderr}`);
console.log(`Prepared frozen evidence corpus Git objects at ${manifest.reference}`);
