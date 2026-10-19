import { expect, it } from 'vitest';
import { E, setup, units } from './editing-fixture.js';
it('should seed distinct stable identities for duplicate source text and bind the exact source, never presentation', () => {
  const { doc, manifest } = setup(); expect(E.seedManifest(doc)).toEqual(manifest);
  const ps = units(doc, manifest); expect(ps[0].text).toBe(ps[1].text); expect(ps[0].paragraphId).not.toBe(ps[1].paragraphId);
  expect(ps.find((p: any) => p.field === 'recommendedAnswer').text).toBe('Raison exacte');
  expect(E.validateManifest(manifest, doc).ok).toBe(true);
  expect(E.validateManifest({ ...manifest, manifestId: 'other' }, doc).ok).toBe(false);
});
it('should preserve explicit identities across an agent revision with an insertion before the second paragraph', () => {
  const { doc, manifest } = setup(), old = units(doc, manifest), next = structuredClone(doc) as any;
  next.sections[0].markdown = 'Nouveau\n\n' + next.sections[0].markdown;
  const mapping = manifest.paragraphs.map((p: any) => p.nodeId === 'p/~' ? { ...p, range: { ...p.range, start: p.range.start + 9, end: p.range.end + 9 }, order: p.order + 1 } : p);
  mapping.push({ ...manifest.paragraphs[0], paragraphId: 'fresh:insert', range: { start: 0, end: 7, unit: 'utf16' }, order: 0 });
  const carried = E.carryManifest(next, manifest, mapping);
  expect(units(next, carried).find((p: any) => p.paragraphId === old[1].paragraphId).text).toBe(old[1].text);
});
