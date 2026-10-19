import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { E, setup, change, freeze, apply, units } from './editing-fixture.js';
const current = (r: any) => ({ document: r.document, manifest: r.manifest });
it('should apply B→C once and replay only by return identity and digest', () => {
  const { doc, manifest } = setup(), r1 = freeze(doc, manifest, [change(doc, manifest, 0, 'B')]), first = apply(doc, manifest, r1);
  expect(first.ok).toBe(true); const r2 = freeze(doc, manifest, [change(doc, manifest, 0, 'C')], r1, 'R2');
  const second = apply(doc, manifest, r2, current(first), first.lineage); expect(second.ok).toBe(true);
  expect(units(second.document, second.manifest)[0].text).toBe('C');
  expect(apply(doc, manifest, r2, current(second), second.lineage).receipt.status).toBe('already-processed');
  const forged = structuredClone(r2); forged.notes[0].text = 'changed'; forged.digest = E.returnDigest(forged);
  expect(apply(doc, manifest, forged, current(second), second.lineage).receipt.status).toBe('identity-reuse');
});
it('should revoke a structural insert while keeping an independent correction of the next paragraph', () => {
  const { doc, manifest } = setup(), base = units(doc, manifest);
  const draft = structuredClone(base);
  draft.splice(1, 0, { ...draft[0], paragraphId: 'fresh:witness', text: 'X' });
  const r1 = freeze(doc, manifest, [E.diffParagraphs(base, draft, 'tx')]), first = apply(doc, manifest, r1);
  expect(first.ok).toBe(true);
  const corrected = units(first.document, first.manifest).map((p: any) => p.paragraphId === base[1].paragraphId ? { ...p, text: 'Correction tierce' } : p);
  const third = E.applyParagraphChanges(first.document, first.manifest, [E.diffParagraphs(units(first.document, first.manifest), corrected, 'tiers')]);
  const r2 = freeze(doc, manifest, [], r1, 'R2'), out = apply(doc, manifest, r2, current(third), first.lineage);
  expect(out.ok, JSON.stringify(out.conflicts)).toBe(true);
  expect(out.receipt.status).toBe('revocation-applied');
  const values = units(out.document, out.manifest);
  expect(values.some((p: any) => p.paragraphId === 'fresh:witness')).toBe(false);
  expect(values.find((p: any) => p.paragraphId === base[1].paragraphId).text).toBe('Correction tierce');
});
it('should refuse a replace whose structural anchors do not match the baseline topology', () => {
  const { doc, manifest } = setup(), base = units(doc, manifest);
  const forged = change(doc, manifest, 0, 'B');
  forged.changes[0].beforeAnchors = { parentId: null, previousParagraphId: 'paragraph:absent', nextParagraphId: null };
  const out = apply(doc, manifest, freeze(doc, manifest, [forged]));
  expect(out.ok).toBe(false); expect(out.receipt.status).toBe('conflict'); expect(out.document).toEqual(doc);
});
it('should conflict when revoking a correction whose paragraph was moved by a third party', () => {
  const { doc, manifest } = setup(), base = units(doc, manifest);
  const r1 = freeze(doc, manifest, [change(doc, manifest, 0, 'B')]);
  const first = apply(doc, manifest, r1);
  expect(first.ok).toBe(true);
  const draft = structuredClone(units(first.document, first.manifest));
  [draft[0], draft[1]] = [draft[1], draft[0]];
  const moved = E.applyParagraphChanges(first.document, first.manifest, [E.diffParagraphs(units(first.document, first.manifest), draft, 'tiers:move')]);
  expect(units(moved.document, moved.manifest)[0].paragraphId).toBe(base[1].paragraphId);
  const out = apply(doc, manifest, freeze(doc, manifest, [], r1, 'R2'), { document: moved.document, manifest: moved.manifest }, first.lineage);
  expect(out.ok).toBe(false); expect(out.receipt.status).toBe('conflict');
  expect(out.conflicts[0]).toMatchObject({ paragraphId: base[0].paragraphId });
  expect(out.document).toEqual(moved.document);
});
it('should revoke an applied correction, and revoke only the cancelled part of a two-paragraph return', () => {
  const { doc, manifest } = setup(), draft = units(doc, manifest); draft[0].text = 'B'; draft[1].text = 'Y';
  const r1 = freeze(doc, manifest, [E.diffParagraphs(units(doc, manifest), draft, 'tx')]), first = apply(doc, manifest, r1);
  const r2 = freeze(doc, manifest, [change(doc, manifest, 1, 'Y')], r1, 'R2'), partial = apply(doc, manifest, r2, current(first), first.lineage);
  expect(partial.ok).toBe(true); expect(units(partial.document, partial.manifest).slice(0, 2).map((p: any) => p.text)).toEqual([units(doc, manifest)[0].text, 'Y']);
  const r3 = freeze(doc, manifest, [], r2, 'R3'), revoked = apply(doc, manifest, r3, current(partial), partial.lineage);
  expect(revoked.ok).toBe(true); expect(revoked.document).toEqual(doc); expect(revoked.receipt.status).toBe('revocation-applied');
});
it('should name the effectively revoked changes in revocation receipts', () => {
  const { doc, manifest } = setup(), base = units(doc, manifest);
  const draft = structuredClone(base); draft[0].text = 'B'; draft[1].text = 'Y';
  const r1 = freeze(doc, manifest, [E.diffParagraphs(base, draft, 'tx')]);
  const first = apply(doc, manifest, r1);
  expect(first.ok).toBe(true);
  const revoked = apply(doc, manifest, freeze(doc, manifest, [], r1, 'R2'), current(first), first.lineage);
  expect(revoked.ok).toBe(true); expect(revoked.receipt.status).toBe('revocation-applied');
  const recorded = revoked.lineage.applications.at(-1).transactions[0];
  expect(recorded.changes.map((c: any) => [c.paragraphId, c.before, c.after])).toEqual([[base[0].paragraphId, 'B', base[0].text], [base[1].paragraphId, 'Y', base[1].text]]);
  const entry = revoked.receipt.transactions.find((t: any) => t.transactionId === recorded.transactionId);
  expect(entry, JSON.stringify(revoked.receipt.transactions)).toBeDefined();
  expect(entry.changeIds).toEqual(recorded.changes.map((c: any) => c.changeId));
  const partial = apply(doc, manifest, freeze(doc, manifest, [change(doc, manifest, 1, 'Y')], r1, 'R2b'), current(first), first.lineage);
  expect(partial.ok).toBe(true); expect(partial.receipt.status).toBe('revocation-applied');
  const recordedPartial = partial.lineage.applications.at(-1).transactions[0];
  expect(recordedPartial.changes.map((c: any) => c.paragraphId)).toEqual([base[0].paragraphId]);
  const partialEntry = partial.receipt.transactions.find((t: any) => t.transactionId === recordedPartial.transactionId);
  expect(partialEntry.changeIds).toEqual(recordedPartial.changes.map((c: any) => c.changeId));
});
it('should preserve conflicts and the unsuccessful outcome when replaying a refused return', () => {
  const { doc, manifest } = setup();
  const r1 = freeze(doc, manifest, [change(doc, manifest, 0, 'B')]);
  const diverged = E.applyParagraphChanges(doc, manifest, [change(doc, manifest, 0, 'Tiers')]);
  const out = apply(doc, manifest, r1, diverged);
  expect(out.ok).toBe(false); expect(out.receipt.status).toBe('conflict');
  expect(out.receipt.conflicts.length).toBeGreaterThan(0);
  const replay = apply(doc, manifest, r1, { document: out.document, manifest: out.manifest }, out.lineage);
  expect(replay.ok).toBe(false);
  expect(replay.receipt.status).toBe('already-processed');
  expect(replay.receipt.previousStatus).toBe('conflict');
  expect(replay.receipt.conflicts).toEqual(out.receipt.conflicts);
});
it('should refuse an insert that reuses an identity retired outside the lineage', () => {
  const { doc, manifest } = setup(), base = units(doc, manifest);
  const fresh = { ...base[0], paragraphId: 'fresh:tiers', text: 'Texte tiers' };
  const draft = [...base.slice(0, 2), fresh, ...base.slice(2)];
  const inserted = E.applyParagraphChanges(doc, manifest, [E.diffParagraphs(base, draft, 'tiers:insert')]);
  const retired = E.applyParagraphChanges(inserted.document, inserted.manifest, [E.diffParagraphs(units(inserted.document, inserted.manifest), base, 'tiers:delete')]);
  expect(retired.manifest.retiredParagraphIds).toContain('fresh:tiers');
  const returning = [...base.slice(0, 2), { ...base[0], paragraphId: 'fresh:tiers', text: 'Retour' }, ...base.slice(2)];
  const value = freeze(doc, manifest, [E.diffParagraphs(base, returning, 'tx')]);
  const out = apply(doc, manifest, value, { document: retired.document, manifest: retired.manifest });
  expect(out.ok).toBe(false); expect(out.receipt.status).toBe('conflict');
  expect(out.conflicts[0]).toMatchObject({ reason: 'reused-paragraph-id' });
  expect(out.lineage.head).toBeUndefined();
});
it('should tombstone late R1 after empty R2, and after R3 with missing intermediate R2', () => {
  const { doc, manifest } = setup(), r1 = freeze(doc, manifest, [change(doc, manifest, 0, 'B')]);
  const r2 = freeze(doc, manifest, [change(doc, manifest, 0, 'C')], r1, 'R2');
  for (const head of [freeze(doc, manifest, [], r1, 'empty-R2'), freeze(doc, manifest, [], r2, 'R3')]) {
    const first = apply(doc, manifest, head); expect(first.ok).toBe(true); expect(first.document).toEqual(doc);
    const late = apply(doc, manifest, r1, current(first), first.lineage); expect(late.ok).toBe(false); expect(late.receipt.status).toBe('superseded'); expect(late.lineage.head).toEqual(first.lineage.head); expect(late.lineage.tombstones).toEqual(first.lineage.tombstones);
  }
});
it('should fail closed on incomparable, truncated, divergent and forked ancestry without advancing the head', () => {
  const { doc, manifest } = setup(), r1 = freeze(doc, manifest), r2 = freeze(doc, manifest, [change(doc, manifest, 0, 'B')], r1, 'R2');
  const first = apply(doc, manifest, r2);
  const fork = freeze(doc, manifest, [change(doc, manifest, 0, 'C')], r1, 'fork');
  const root = freeze(doc, manifest, [change(doc, manifest, 0, 'D')], undefined, 'root');
  const divergent = freeze(doc, manifest, [], r2, 'R3'); divergent.editReturn.supersededReturnIds = ['R2', 'wrong']; divergent.digest = E.returnDigest(divergent);
  for (const v of [fork, root, divergent]) { const out = apply(doc, manifest, v, current(first), first.lineage); expect(out.ok).toBe(false); expect(out.receipt.status).toBe('lineage-order-indeterminate'); expect(out.lineage.head).toEqual(first.lineage.head); expect(out.lineage.tombstones).toEqual(first.lineage.tombstones); }
  const truncated = freeze(doc, manifest, [], undefined, 'truncated'); Object.assign(truncated.editReturn, { supersedesReturnId: 'R2', supersededReturnIds: ['R2'] }); truncated.digest = E.returnDigest(truncated);
  const t = apply(doc, manifest, truncated); expect(apply(doc, manifest, r1, current(t), t.lineage).receipt.status).toBe('lineage-order-indeterminate');
});
it('should rebase unrelated edits and reject a same-paragraph change or missing lineage attribution atomically', () => {
  const { doc, manifest } = setup(), r1 = freeze(doc, manifest, [change(doc, manifest, 0, 'B')]);
  const third = E.applyParagraphChanges(doc, manifest, [change(doc, manifest, 1, 'Tierce modification')]);
  const rebased = apply(doc, manifest, r1, third); expect(rebased.ok).toBe(true); expect(units(rebased.document, rebased.manifest)[1].text).toBe('Tierce modification');
  expect(rebased.receipt.baseHash).toBe(E.baseDigest(third.document));
  const conflicting = E.applyParagraphChanges(doc, manifest, [change(doc, manifest, 0, 'Traduction / third party')]);
  const out = apply(doc, manifest, r1, conflicting); expect(out.ok).toBe(false); expect(out.conflicts[0]).toMatchObject({ baseline: units(doc, manifest)[0].text, current: 'Traduction / third party', requested: 'B' });
  const first = apply(doc, manifest, r1), empty = freeze(doc, manifest, [], r1, 'R2');
  const modified = E.applyParagraphChanges(first.document, first.manifest, [change(first.document, first.manifest, 0, 'Third')]);
  const revoke = apply(doc, manifest, empty, modified, first.lineage); expect(revoke.ok).toBe(false); expect(revoke.conflicts[0]).toMatchObject({ lineageApplied: 'B', current: 'Third', requested: units(doc, manifest)[0].text });
  expect(apply(doc, manifest, r1, current(first)).ok).toBe(false);
});
it('should refuse missing mappings, deleted targets and mixed valid/invalid batches without mutating inputs', () => {
  const { doc, manifest } = setup(), r1 = freeze(doc, manifest, [change(doc, manifest)]), before = JSON.stringify({ doc, manifest, r1 });
  expect(apply(doc, manifest, r1, { document: doc, manifest: null }).ok).toBe(false);
  const bad = structuredClone(r1); bad.editReturn.transactions[0].changes.push({ ...bad.editReturn.transactions[0].changes[0], changeId: 'second', before: 'wrong' }); bad.digest = E.returnDigest(bad);
  expect(apply(doc, manifest, bad).ok).toBe(false); expect(JSON.stringify({ doc, manifest, r1 })).toBe(before);
});
it('should keep reconciliation framework and IO free', () => {
  const source = readFileSync(new URL('../src/editing/reconcile.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/node:|svelte|tiptap|@sentropic\/track|\bfetch\(|Date\.now|Math\.random/);
});
it('should revoke structural insert, delete and move with byte-identical baseline layout', () => {
  for (const operation of ['insert', 'delete', 'move']) {
    const { doc, manifest } = setup(), base = units(doc, manifest), draft = structuredClone(base);
    if (operation === 'insert') draft.splice(1, 0, { ...draft[0], paragraphId: 'fresh', text: 'Nouveau' });
    if (operation === 'delete') draft.splice(0, 1);
    if (operation === 'move') [draft[0], draft[1]] = [draft[1], draft[0]];
    const r1 = freeze(doc, manifest, [E.diffParagraphs(base, draft, 'tx')]), first = apply(doc, manifest, r1);
    expect(first.ok, operation).toBe(true);
    const empty = freeze(doc, manifest, [], r1, 'R2'), revoked = apply(doc, manifest, empty, current(first), first.lineage);
    expect(revoked.ok, operation + JSON.stringify(revoked.conflicts)).toBe(true); expect(revoked.document, operation).toEqual(doc);
  }
});
it('should issue a validation receipt for malformed transactions instead of throwing', () => {
  const { doc, manifest } = setup();
  for (const value of [null, { editReturn: { transactions: [null] } }, { editReturn: { transactions: [{ changes: null }] } }]) {
    expect(apply(doc, manifest, value).receipt.status).toBe('validation-refused');
  }
});
it('should bind even a refused valid return identity to its original digest', () => {
  const { doc, manifest } = setup(), r1 = freeze(doc, manifest, [change(doc, manifest, 0, 'B')]);
  const first = apply(doc, manifest, r1), unrelated = freeze(doc, manifest, [], undefined, 'other-root');
  const refused = apply(doc, manifest, unrelated, current(first), first.lineage); expect(refused.receipt.status).toBe('lineage-order-indeterminate');
  const forged = structuredClone(unrelated); forged.notes[0].text = 'changed'; forged.digest = E.returnDigest(forged);
  expect(apply(doc, manifest, forged, current(first), refused.lineage).receipt.status).toBe('identity-reuse');
});
