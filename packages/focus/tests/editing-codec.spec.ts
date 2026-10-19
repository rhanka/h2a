import { expect, it } from 'vitest';
import { E, setup, units } from './editing-fixture.js';
import { readFileSync } from 'node:fs';
it('should preserve every untouched source byte, including CRLF, tables, lists, fences and final whitespace', () => {
  const { doc, manifest } = setup(), before = JSON.stringify(doc);
  expect(E.applyParagraphChanges(doc, manifest, [])).toEqual({ document: doc, manifest });
  expect(JSON.stringify(doc)).toBe(before);
  expect(units(doc, manifest).filter((u: any) => u.nodeId === 'p/~')).toHaveLength(2);
  const draft = units(doc, manifest); draft[0].text = 'Un **texte** exact 😀';
  const tx = E.diffParagraphs(units(doc, manifest), draft, 'tx');
  const result = E.applyParagraphChanges(doc, manifest, [tx]);
  const beforeProse = doc.sections[0] as any;
  expect(result.document.sections[0].markdown).toBe(beforeProse.markdown.replace('Identique 😀  \r\nligne', 'Un **texte** exact 😀'));
  expect(E.validateManifest(result.manifest, result.document).ok).toBe(true);
});
it('should keep unsupported nested list paragraphs opaque pending the real DS codec witness', () => {
  const segments = E.segmentMarkdown('- un\n  - deux\n\n# Titre\n\nTexte\n\n<div>opaque</div>\n\n![image](https://x)');
  expect(segments.filter((s: any) => s.editable).map((s: any) => s.text)).toEqual(['Texte']);
});
it('should preserve the reduced influence slice without qualifying its business content or presentation', () => {
  const source = JSON.parse(readFileSync(new URL('./fixtures/influnified-edit-source.json', import.meta.url), 'utf8'));
  const returned = JSON.parse(readFileSync(new URL('./fixtures/influnified-edit-return.json', import.meta.url), 'utf8'));
  expect(source.fixtureProvenance.qualifiedRealDossier).toBe(false);
  expect(E.validateReturn(returned.value, source.document, source.manifest).ok).toBe(true);
  expect(E.applyParagraphChanges(source.document, source.manifest, []).document).toEqual(source.document);
  expect(E.segmentMarkdown(source.document.sections[0].markdown).some((s: any) => !s.editable && s.text.startsWith('- '))).toBe(true);
});
