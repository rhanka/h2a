import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { evidenceFixture } from '../../h2a/focus-kit/test/evidence-fixtures.mjs';
import { validateDecisionDossierDocument as validate } from '../src/validation/index.js';

describe('versioned evidence contract', () => {
  it('should accept more than 25 complete sources and distant CRLF Unicode citations', () => {
    const doc = evidenceFixture(20_000, 31);
    const result = validate(doc);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.value).toEqual(doc);
  });
  it('should preserve legacy documents without inventing an evidence envelope', () => {
    const doc = JSON.parse(readFileSync(new URL('../../h2a/focus-kit/dossier.template.json', import.meta.url), 'utf8'));
    expect(validate(doc)).toEqual({ ok: true, value: doc });
  });
  const cases: [string, (d: any) => void, string][] = [
    ['future version', d => { d.schemaVersion = 99; }, 'unsupported_version'],
    ['digest', d => { d.sources[0].sha256 = '0'.repeat(64); }, 'source_digest'],
    ['size', d => { d.sources[0].size++; }, 'source_size'],
    ['base64', d => { d.sources[0].data += '!'; }, 'source_encoding'],
    ['media', d => { d.sources[0].mediaType = 'image/svg+xml'; }, 'unsupported_media'],
    ['text decoding', d => { d.sources[0] = { ...d.sources[0], data: '/w==', size: 1, sha256: 'a8100ae6aa1940d0b663bb31cd466142ebbdbd5187131b92d93818987832eb89' }; }, 'source_encoding'],
    ['duplicate source', d => { d.sources.push(d.sources[0]); }, 'duplicate_id'],
    ['unknown citation source', d => { d.citations[0].sourceId = 'absent'; }, 'unresolved_source'],
    ['unknown citation', d => { d.sections[0].citationRefs = ['absent']; }, 'unresolved_citation'],
    ['unknown option citation', d => { d.sections.find((s: any) => s.kind === 'optionSet').options[0].citationRefs = ['absent']; }, 'unresolved_citation'],
    ['range overflow', d => { d.citations[0].locator.end = 14; }, 'citation_range'],
    ['range backwards', d => { d.citations[0].locator.start = 13; d.citations[0].locator.end = 12; }, 'citation_range'],
    ['image lines', d => { d.citations[1].locator = { kind: 'lines', start: 1, end: 1 }; }, 'citation_media'],
    ['fake image', d => { d.sources[1].data = d.sources[0].data; d.sources[1].size = d.sources[0].size; d.sources[1].sha256 = d.sources[0].sha256; }, 'image_metadata'],
    ['image dimensions', d => { d.sources[1].width = 2; }, 'image_metadata'],
    ['executable annex', d => { d.annexes[0].blocks.push({ kind: 'html', text: '<script>bad()</script>' }); }, 'invalid_evidence'],
    ['hidden question', d => { d.annexes[0].blocks.push({ kind: 'question', question: 'Hidden?' }); }, 'invalid_evidence'],
    ['unknown origin field', d => { d.sources[0].origin.fetch = true; }, 'invalid_evidence'],
    ['empty id', d => { d.sources[0].id = ''; }, 'invalid_evidence'],
    ['annex backlink', d => { d.annexes[0].backRefs = ['absent']; }, 'unresolved_target'],
  ];
  for (const [name, change, code] of cases) it(`should refuse ${name} with an identified evidence diagnostic`, () => {
    const doc = evidenceFixture(); change(doc);
    const result = validate(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some(i => i.code === code && i.path.startsWith('$')),
      JSON.stringify(result.issues)).toBe(true);
  });
});
