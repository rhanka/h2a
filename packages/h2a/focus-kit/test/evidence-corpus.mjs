import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { evidenceFixture, digest, source } from './evidence-fixtures.mjs';
const manifestUrl = new URL('./fixtures/evidence-corpus.v1.json', import.meta.url);
export const corpusHash = digest(readFileSync(manifestUrl));
export function corpus(root) {
  const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
  const groups = Array.from({ length: manifest.groups }, () => []);
  manifest.files.forEach((f, i) => {
    const bytes = readFileSync(new URL(`../../../../${f.path}`, import.meta.url));
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
