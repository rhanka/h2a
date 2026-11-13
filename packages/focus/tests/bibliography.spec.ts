import { describe, it, expect } from 'vitest';
import { evidenceFixture } from '../../h2a/focus-kit/test/evidence-fixtures.mjs';
import { bibliography, evidenceIndex } from '../src/render/evidence.js';
import { renderMd } from '../src/render/md.js';
import { renderTerminal } from '../src/render/terminal.js';
import { renderHtml } from '../src/render/html.js';

describe('bibliographic citations', () => {
  it('should reserve document-specific source anchors even when content uses the same id', () => {
    const doc = evidenceFixture();
    const id = bibliography(doc)[0].anchorId;
    doc.sections[0].id = id;
    const entries = bibliography(doc);
    expect(entries[0].anchorId).not.toBe(id);
    expect(new Set(entries.map(e => e.anchorId)).size).toBe(entries.length);
    expect(bibliography({ ...doc, ref: `${doc.ref}-other` })[0].anchorId).not.toBe(entries[0].anchorId);
    const html = renderHtml(doc, { renderMarkdown: text => text, sanitizeHtml: html => html });
    expect(html).toContain(`href="#${entries[0].anchorId}"`);
    expect(html.match(new RegExp(`id="${entries[0].anchorId}"`, 'g'))).toHaveLength(1);
  });
  it('should resolve section, option, group and annex calls in Markdown and plain text', () => {
    const doc = evidenceFixture();
    for (const text of [renderMd(doc), renderTerminal(doc)]) {
      expect(text).toContain('Sources\n[1] Preuve distante · Source long · urn:fixture:long:12–13');
      expect(text).toContain('[2] Capture · Source capture · urn:fixture:capture · État observé');
      expect(text).toContain('context → [1]');
      expect(text).toContain('portable → [2]');
      expect(text).toContain('claim: Les pièces étayent la proposition. → [1], [2], Source long');
      expect(text).toContain('detail → [1]');
      expect(text).not.toContain('→ late');
      expect(text).not.toContain('→ picture');
    }
  });
  it('should number citations once and show exact source locations', () => {
    const doc = evidenceFixture();
    doc.sources[0].origin = { repo: 'fixture', revision: 'abc123', path: 'docs/spec.md' };
    expect(bibliography(doc).map(e => [e.number, e.location])).toEqual([
      [1, 'fixture@abc123:docs/spec.md:12–13'], [2, 'urn:fixture:capture · État observé'],
    ]);
    expect(evidenceIndex(doc)).toContain('Sources\n[1] Preuve distante · Source long · fixture@abc123:docs/spec.md:12–13');
  });
  it('should link section and option calls to an escaped source list without buttons', () => {
    const doc = evidenceFixture();
    doc.citations[0].label = '<img src=x>';
    const [first, second] = bibliography(doc);
    const html = renderHtml(doc, { renderMarkdown: text => text, sanitizeHtml: html => html });
    expect(html).toContain(`href="#${first.anchorId}" aria-label="Source 1">[1]</a>`);
    expect(html).toContain(`href="#${second.anchorId}" aria-label="Source 2">[2]</a>`);
    expect(html).toContain('<h2>Sources</h2><ol>');
    expect(html).toContain(`id="${first.anchorId}">&lt;img src=x&gt;`);
    expect(html).toContain('download="evidence-long">Télécharger</a>');
    expect(html).toContain('href="data:application/octet-stream;base64,');
    expect(html).not.toContain('<button');
  });
});
