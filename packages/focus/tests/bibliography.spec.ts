import { describe, it, expect } from 'vitest';
import { evidenceFixture } from '../../h2a/focus-kit/test/evidence-fixtures.mjs';
import { bibliography, evidenceIndex } from '../src/render/evidence.js';
import { renderHtml } from '../src/render/html.js';

describe('bibliographic citations', () => {
  it('should number citations once and show exact source locations', () => {
    const doc = evidenceFixture();
    doc.sources[0].origin = { repo: 'fixture', revision: 'abc123', path: 'docs/spec.md' };
    expect(bibliography(doc).map(e => [e.number, e.location])).toEqual([
      [1, 'fixture@abc123:docs/spec.md:12–13'], [2, 'urn:fixture:capture · État observé'],
    ]);
    expect(evidenceIndex(doc)).toContain('Sources\n1 · Preuve distante · Source long · fixture@abc123:docs/spec.md:12–13');
  });
  it('should link section and option calls to an escaped source list without buttons', () => {
    const doc = evidenceFixture();
    doc.citations[0].label = '<img src=x>';
    const html = renderHtml(doc, { renderMarkdown: text => text, sanitizeHtml: html => html });
    expect(html).toContain('href="#focus-source-1" aria-label="Source 1">[1]</a>');
    expect(html).toContain('href="#focus-source-2" aria-label="Source 2">[2]</a>');
    expect(html).toContain('<h2>Sources</h2><ol>');
    expect(html).toContain('id="focus-source-1">&lt;img src=x&gt;');
    expect(html).toContain('download="evidence-long">Télécharger</a>');
    expect(html).toContain('href="data:application/octet-stream;base64,');
    expect(html).not.toContain('<button');
  });
});
