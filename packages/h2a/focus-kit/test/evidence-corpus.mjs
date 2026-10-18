import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { evidenceFixture, digest, source } from './evidence-fixtures.mjs';
const manifestUrl = new URL('./fixtures/evidence-corpus.v1.json', import.meta.url);
export const corpusHash = digest(readFileSync(manifestUrl));
export function corpus(root) {
  const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
  const groups = Array.from({ length: manifest.groups }, () => []);
  for (const f of manifest.files) {
    assert.match(f.blob, /^[a-f0-9]{40}$/);
    assert.ok((/^(packages|docs|scripts|apps|contrib|deploy|evaluations|examples)\//.test(f.path) && !/(^|\/)\./.test(f.path))
      || /^\.github\/workflows\//.test(f.path) || (!f.path.includes('/') && /\.md$/.test(f.path)), `Non-source corpus path: ${f.path}`);
  }
  // Shallow CI prepares these frozen Git objects from manifest.reference.
  // Never read host configuration or bootstrap-mutated files.
  const batch = spawnSync('git', ['cat-file', '--batch'], { cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
    input: manifest.files.map(f => f.blob).join('\n') + '\n', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(batch.status, 0, batch.stderr?.toString());
  let offset = 0;
  manifest.files.forEach((f, i) => {
    const end = batch.stdout.indexOf(10, offset), header = batch.stdout.subarray(offset, end).toString('ascii');
    assert.equal(header, `${f.blob} blob ${f.bytes}`, `Missing frozen source blob: ${f.path}`);
    const bytes = batch.stdout.subarray(end + 1, end + 1 + f.bytes); offset = end + 2 + f.bytes;
    assert.equal(digest(bytes), f.sha256, `Frozen real corpus changed: ${f.path}`);
    groups[i % groups.length].push(Buffer.from(`\n--- ${f.path} @ ${manifest.reference} ---\n`), bytes);
  });
  mkdirSync(join(root, 'corpus'), { recursive: true });
  const large = evidenceFixture(20_000, 2);
  groups.forEach((pieces, i) => {
    const bytes = Buffer.concat(pieces), id = `repository-${i}`;
    writeFileSync(join(root, 'corpus', `${id}.txt`), bytes);
    large.sources.push({ ...source(id, bytes), title: `Repository source group ${i + 1}`,
      origin: { uri: `urn:h2a:git-corpus:${manifest.reference}:${id}:${digest(bytes)}` } });
  });
  large.citations.push({ id: 'real', sourceId: 'repository-0', label: 'Pièces du dépôt', locator: { kind: 'lines', start: 1, end: 2 } });
  const small = evidenceFixture(), doubled = evidenceFixture(40_000, 31);
  const legacy = JSON.parse(readFileSync(new URL('../dossier.template.json', import.meta.url), 'utf8'));
  return { legacy, small, large, doubled };
}
