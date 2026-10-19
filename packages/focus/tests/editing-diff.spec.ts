import { expect, it } from 'vitest';
import { E, setup, units } from './editing-fixture.js';
it('should coalesce typing against the baseline and emit no change after undo-all', () => {
  const { doc, manifest } = setup(), base = units(doc, manifest), draft = structuredClone(base);
  draft[1].text = 'C'; draft[1].text = 'Correction';
  const tx = E.diffParagraphs(base, draft, 'tx'); expect(tx.changes).toHaveLength(1);
  expect(tx.changes[0]).toMatchObject({ paragraphId: base[1].paragraphId, before: base[1].text, after: 'Correction' });
  expect(E.diffParagraphs(base, base, 'undo').changes).toEqual([]);
});
it('should express split, merge, move and paste with identities and explicit anchors', () => {
  const { doc, manifest } = setup(), base = units(doc, manifest), draft = structuredClone(base);
  const fresh = { ...draft[0], paragraphId: 'fresh:paste', text: 'Suite' }; draft[0].text = 'Début'; draft.splice(1, 0, fresh);
  const tx = E.diffParagraphs(base, draft, 'split'); expect(tx.changes.map((c: any) => c.operation)).toEqual(['replace', 'insert']);
  const split = E.applyParagraphChanges(doc, manifest, [tx]); expect(units(split.document, split.manifest)[0].paragraphId).toBe(base[0].paragraphId);
  const merged = structuredClone(base); merged[0].text += merged[1].text; merged.splice(1, 1);
  const merge = E.diffParagraphs(base, merged, 'merge'); expect(merge.changes.some((c: any) => c.operation === 'delete' && c.paragraphId === base[1].paragraphId)).toBe(true);
  const moved = structuredClone(base); [moved[0], moved[1]] = [moved[1], moved[0]];
  const move = E.diffParagraphs(base, moved, 'move'); expect(move.changes.some((c: any) => c.operation === 'move')).toBe(true);
  const applied = E.applyParagraphChanges(doc, manifest, [move]); expect(units(applied.document, applied.manifest)[0].paragraphId).toBe(base[1].paragraphId);
});
it('should refuse a replace whose output anchors do not match the baseline topology', () => {
  const { doc, manifest } = setup(), base = units(doc, manifest);
  const draft = structuredClone(base); draft[0].text = 'B';
  const tx = E.diffParagraphs(base, draft, 'tx');
  tx.changes[0].anchors = { parentId: null, previousParagraphId: 'paragraph:absent', nextParagraphId: null };
  expect(() => E.applyParagraphChanges(doc, manifest, [tx])).toThrow('structural-precondition');
});
