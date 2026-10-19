import type { DecisionDossierDocument } from '../model.js';
import type { EditTransaction, FocusEditingManifest, FocusReturn, ParagraphChange, Production } from './contract.js';
import { validateReturn, validateReturnStructure } from './contract.js';
import { fieldKey, readParagraphs, validateManifest, sourceNode, sealManifest } from './anchors.js';
import { applyParagraphChanges, diffParagraphs, paragraphAnchors } from './diff.js';
import { baseDigest, canonicalJson } from './digest.js';

export interface EditingSnapshot { document: DecisionDossierDocument; manifest: FocusEditingManifest }
export interface EditingConflict { paragraphId?: string; reason: string; baseline?: string | null; lineageApplied?: string | null; current?: string | null; requested?: string | null }
export interface EditReceipt {
  returnId: string; digest: string; status: string; baseHash?: string; resultHash?: string;
  previousStatus?: string;
  transactions: { transactionId: string; changeIds: string[]; status: string }[];
  conflicts: EditingConflict[];
}
export interface ReturnLineage {
  baseHash: string; manifestBaseHash: string; production: Production;
  head?: { returnId: string; supersededReturnIds: string[] };
  tombstones: string[]; seen: { returnId: string; digest: string; receipt: EditReceipt }[];
  applied: EditTransaction[];
  applications: { returnId: string; baseHash: string; resultHash: string; transactions: EditTransaction[] }[];
}
export interface ReconcileInput { baseline: EditingSnapshot; current: EditingSnapshot; value: unknown; production: Production; lineage?: ReturnLineage }
export interface ReconcileResult extends EditingSnapshot { ok: boolean; lineage: ReturnLineage; receipt: EditReceipt; conflicts: EditingConflict[] }

/** Source gaps are addressed by paragraph identities, never matched by prose similarity. */
function fieldGaps(snapshot: EditingSnapshot, field: FocusEditingManifest['fields'][number]): Map<string, string> {
  const source = sourceNode(snapshot.document, field)[field.field] as string;
  const ps = snapshot.manifest.paragraphs.filter(p => fieldKey(p) === fieldKey(field)).sort((a, b) => a.order - b.order);
  const gaps = new Map<string, string>();
  for (let i = 0; i <= ps.length; i++) gaps.set(canonicalJson([ps[i - 1]?.paragraphId ?? null, ps[i]?.paragraphId ?? null]), source.slice(ps[i - 1]?.range.end ?? 0, ps[i]?.range.start ?? source.length));
  return gaps;
}
/** Restore the original layout of structural edits, replaying independent third-party units.
 * The source baseline supplies exact separators; unrelated source gaps remain current. */
function restoreStructuralFields(baseline: EditingSnapshot, applied: EditingSnapshot, current: EditingSnapshot, keys: Set<string>, restoreIds: ReadonlySet<string>): EditingSnapshot {
  const document = structuredClone(current.document), paragraphs = structuredClone(current.manifest.paragraphs.filter(p => !keys.has(fieldKey(p))));
  for (const f of baseline.manifest.fields.filter(f => keys.has(fieldKey(f)))) {
    const previous = readParagraphs(applied.document, applied.manifest).filter(p => fieldKey(p) === fieldKey(f));
    const now = readParagraphs(current.document, current.manifest).filter(p => fieldKey(p) === fieldKey(f));
    const independent = diffParagraphs(previous, now, 'reconciler:independent');
    // Pure text corrections carry the applied layout in their anchors. Re-anchor
    // them onto the baseline topology before replaying: the text precondition
    // stays third-party, but the topology precondition must describe the base
    // being replayed onto, not the layout the lineage had already changed.
    const baseValues = readParagraphs(baseline.document, baseline.manifest).filter(p => fieldKey(p) === fieldKey(f));
    for (const c of independent.changes) {
      if (c.operation !== 'replace') continue;
      const at = baseValues.findIndex(p => p.paragraphId === c.paragraphId);
      if (at < 0) continue;
      const reanchored = paragraphAnchors(baseValues, at);
      c.beforeAnchors = { ...reanchored };
      c.anchors = { ...reanchored };
    }
    const rebased = applyParagraphChanges(baseline.document, baseline.manifest, independent.changes.length ? [independent] : [], restoreIds);
    const baseGaps = fieldGaps(baseline, f), appliedGaps = fieldGaps(applied, f), currentGaps = fieldGaps(current, f), restoredGaps = fieldGaps(rebased, f);
    for (const [key, gap] of currentGaps) {
      if (appliedGaps.has(key) && gap !== appliedGaps.get(key) && baseGaps.get(key) !== appliedGaps.get(key)) throw new Error('structural-gap-diverged');
      if (!appliedGaps.has(key) || baseGaps.get(key) === appliedGaps.get(key)) restoredGaps.set(key, gap);
    }
    const ps = rebased.manifest.paragraphs.filter(p => fieldKey(p) === fieldKey(f)).sort((a, b) => a.order - b.order);
    const source = sourceNode(rebased.document, f)[f.field] as string;
    let text = '';
    ps.forEach((p, index) => {
      text += restoredGaps.get(canonicalJson([ps[index - 1]?.paragraphId ?? null, p.paragraphId])) ?? '';
      const value = source.slice(p.range.start, p.range.end), start = text.length; text += value;
      paragraphs.push({ ...p, range: { start, end: text.length, unit: 'utf16' } });
    });
    text += restoredGaps.get(canonicalJson([ps.at(-1)?.paragraphId ?? null, null])) ?? '';
    sourceNode(document, f)[f.field] = text;
  }
  const active = new Set(paragraphs.map(p => p.paragraphId));
  const retiredParagraphIds = [...new Set([...current.manifest.retiredParagraphIds, ...current.manifest.paragraphs.map(p => p.paragraphId)])].filter(id => !active.has(id));
  return { document, manifest: sealManifest({ ...current.manifest, baseHash: baseDigest(document), paragraphs, retiredParagraphIds }) };
}

/** Data in/data out. Persistence and the final publication boundary belong to the host. */
export function reconcile(input: ReconcileInput): ReconcileResult {
  const { baseline, current, production } = input;
  const lineage: ReturnLineage = structuredClone(input.lineage ?? { baseHash: baseline.manifest.baseHash, manifestBaseHash: baseline.manifest.manifestBaseHash, production, tombstones: [], seen: [], applied: [], applications: [] });
  const value = input.value as FocusReturn;
  let rememberIdentity = false;
  const result = (status: string, conflicts: EditingConflict[] = [], candidate: EditingSnapshot = current, ok = false, appliedTransition?: EditTransaction): ReconcileResult => {
    const transactions = (validateReturnStructure(value) ? value.editReturn.transactions : []).map(t => ({ transactionId: t.transactionId, changeIds: t.changes.map(c => c.changeId), status }));
    // The receipt names the changes the reconciler effectively applied or
    // revoked — including revocation inverses the incoming return never
    // listed — so a revocation is auditable by change identity.
    if (ok && appliedTransition && appliedTransition.changes.length) transactions.push({ transactionId: appliedTransition.transactionId, changeIds: appliedTransition.changes.map(c => c.changeId), status });
    const receipt: EditReceipt = { returnId: typeof value?.returnId === 'string' ? value.returnId : '', digest: typeof value?.digest === 'string' ? value.digest : '', status,
      transactions, conflicts };
    if (ok) { receipt.baseHash = baseDigest(current.document); receipt.resultHash = baseDigest(candidate.document); }
    if (rememberIdentity && !lineage.seen.some(s => s.returnId === value.returnId)) lineage.seen.push({ returnId: value.returnId, digest: value.digest, receipt });
    return { ok, ...structuredClone(candidate), lineage, receipt, conflicts };
  };
  const validation = validateReturn(value, baseline.document, baseline.manifest);
  if (!validation.ok) return result('validation-refused', validation.issues.map(reason => ({ reason })));
  if (canonicalJson(value.production) !== canonicalJson(production) || lineage.baseHash !== baseline.manifest.baseHash || lineage.manifestBaseHash !== baseline.manifest.manifestBaseHash || canonicalJson(lineage.production) !== canonicalJson(production)) return result('generation-mismatch');
  const seen = lineage.seen.find(s => s.returnId === value.returnId);
  if (seen) {
    const out = result(seen.digest === value.digest ? 'already-processed' : 'identity-reuse');
    // A replay reports the original diagnostic, never an empty success: the
    // unsuccessful character of a refused return survives the replay.
    out.receipt.previousStatus = seen.receipt.status;
    out.receipt.conflicts = seen.receipt.conflicts;
    if (seen.digest === value.digest) { out.receipt.baseHash = seen.receipt.baseHash; out.receipt.resultHash = seen.receipt.resultHash; }
    return out;
  }
  rememberIdentity = true;
  if (lineage.tombstones.includes(value.returnId) || lineage.head?.supersededReturnIds.includes(value.returnId)) return result('superseded');
  if (lineage.head) {
    const at = value.editReturn.supersededReturnIds.indexOf(lineage.head.returnId);
    if (at < 0 || canonicalJson(value.editReturn.supersededReturnIds.slice(at + 1)) !== canonicalJson(lineage.head.supersededReturnIds)) {
      const fork = value.editReturn.supersedesReturnId === lineage.head.supersededReturnIds[0];
      return result('lineage-order-indeterminate', [{ reason: fork ? 'fork' : 'ancestry-does-not-prove-succession' }]);
    }
  }
  if (!validateManifest(current.manifest, current.document).ok || current.manifest.manifestId !== baseline.manifest.manifestId) return result('conflict', [{ reason: 'mapping-loss' }]);
  try {
    const desired = applyParagraphChanges(baseline.document, baseline.manifest, value.editReturn.transactions);
    // Compare the whole submitted batch before publication, including previously applied units
    // that this cumulative head no longer requests.
    const base = readParagraphs(baseline.document, baseline.manifest), actual = readParagraphs(current.document, current.manifest);
    const applied = applyParagraphChanges(baseline.document, baseline.manifest, lineage.applied);
    const appliedValues = readParagraphs(applied.document, applied.manifest), desiredValues = readParagraphs(desired.document, desired.manifest);
    const oldChanges = lineage.applied.flatMap(t => t.changes), newChanges = value.editReturn.transactions.flatMap(t => t.changes);
    const affected = new Set([...oldChanges, ...newChanges].map(c => c.paragraphId)), conflicts: EditingConflict[] = [];
    for (const id of affected) {
      const b = base.find(p => p.paragraphId === id), a = actual.find(p => p.paragraphId === id), r = appliedValues.find(p => p.paragraphId === id), d = desiredValues.find(p => p.paragraphId === id);
      const recorded = oldChanges.filter(c => c.paragraphId === id), expected = recorded.length ? r : b;
      const sameAddress = !expected || (!!a && fieldKey(a) === fieldKey(expected));
      let matches = (a?.text ?? null) === (expected?.text ?? null) && sameAddress;
      // Every affected unit carries a topology precondition, including pure
      // text replacements: a paragraph moved by a third party no longer
      // matches, even when its text is unchanged.
      if (matches && expected && a) {
        const expectedList = (recorded.length ? appliedValues : base).filter(p => fieldKey(p) === fieldKey(expected));
        const actualList = actual.filter(p => fieldKey(p) === fieldKey(a));
        matches = canonicalJson(paragraphAnchors(expectedList, expectedList.indexOf(expected))) === canonicalJson(paragraphAnchors(actualList, actualList.indexOf(a)));
      }
      if (!matches) conflicts.push({ paragraphId: id, reason: 'precondition-or-attribution', baseline: b?.text ?? null, ...(recorded.length ? { lineageApplied: r?.text ?? null } : {}), current: a?.text ?? null, requested: d?.text ?? null });
    }
    if (conflicts.length) return result('conflict', conflicts);
    const structuralFields = new Set(oldChanges.filter(c => c.operation !== 'replace').map(fieldKey));
    // Only identities this lineage retired may be restored: revocation must
    // revive lineage content, while a collision with a third-party
    // retirement refuses instead of reassigning the identity (D13).
    const deletedIds = (txs: EditTransaction[]): string[] => txs.flatMap(t => t.changes).filter(c => c.operation === 'delete').map(c => c.paragraphId);
    const restoreIds = new Set([...deletedIds(lineage.applied), ...lineage.applications.flatMap(a => deletedIds(a.transactions))]);
    const sourceRestored = restoreStructuralFields(baseline, applied, current, structuralFields, restoreIds);
    const inverse: ParagraphChange[] = oldChanges.filter(c => !structuralFields.has(fieldKey(c))).slice().reverse().map(c => ({ ...c, operation: c.operation === 'insert' ? 'delete' : c.operation === 'delete' ? 'insert' : c.operation,
      before: c.after, after: c.before, beforeAnchors: c.operation === 'delete' ? null : c.anchors, anchors: c.beforeAnchors ?? c.anchors }));
    const restored = applyParagraphChanges(sourceRestored.document, sourceRestored.manifest, inverse.length ? [{ transactionId: 'reconciler:revoke', changes: inverse }] : [], restoreIds);
    const candidate = applyParagraphChanges(restored.document, restored.manifest, value.editReturn.transactions, restoreIds);
    if (!validateManifest(candidate.manifest, candidate.document).ok) return result('conflict', [{ reason: 'result-mapping' }]);
    const transition = diffParagraphs(actual, readParagraphs(candidate.document, candidate.manifest), `application:${value.returnId}`);
    const revoked = oldChanges.some(c => !newChanges.some(n => n.paragraphId === c.paragraphId));
    const out = result(revoked ? 'revocation-applied' : 'applied', [], candidate, true, transition);
    lineage.head = { returnId: value.returnId, supersededReturnIds: [...value.editReturn.supersededReturnIds] };
    lineage.tombstones = [...new Set([...lineage.tombstones, ...value.editReturn.supersededReturnIds])];
    lineage.applied = structuredClone(value.editReturn.transactions);
    lineage.applications.push({ returnId: value.returnId, baseHash: out.receipt.baseHash!, resultHash: out.receipt.resultHash!, transactions: transition.changes.length ? [transition] : [] });
    return out;
  } catch (error) { return result('conflict', [{ reason: error instanceof Error ? error.message : 'reconciliation-failed' }]); }
}
