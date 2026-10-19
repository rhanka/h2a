import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { assertDecisionDossierDocument } from '@sentropic/focus/validate';
import { baseDigest, decodeReturn, reconcile, seedManifest, validateManifest } from '@sentropic/focus/editing';
import type { EditReceipt, FocusEditingManifest, Production, ReconcileResult } from '@sentropic/focus/editing';
import { atomicWrite, readEditingState, withEditingLock, writeEditingState } from './runtime/focus/edit-receipts.js';
import type { RetainedEditingState } from './runtime/focus/edit-receipts.js';

/** The source path is explicitly supplied by the producer, never taken from return data. */
export function retainFocusBaseline(options: { source: string; stateDir: string; production: Production }): RetainedEditingState['baseline'] {
  const source = realpathSync(options.source), stateDir = resolve(options.stateDir);
  for (const value of Object.values(options.production)) if (typeof value !== 'string' || !value.length) throw new Error('Production correlation is required');
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  return withEditingLock(stateDir, () => {
    if (existsSync(join(stateDir, 'state.json'))) throw new Error('Baseline already retained; preserve its lineage');
    const document = assertDecisionDossierDocument(JSON.parse(readFileSync(source, 'utf8'))), manifest = seedManifest(document);
    const snapshot = { document, manifest };
    writeEditingState(stateDir, { schemaVersion: 1, source, production: options.production, baseline: snapshot, current: snapshot, returns: [], receipts: [] });
    atomicWrite(join(stateDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n'); return snapshot;
  });
}
export interface ImportFeedbackOptions {
  stateDir: string; input: string; format?: 'json' | 'yaml'; currentManifestPath?: string;
  /** Host-boundary seams for deterministic race/crash qualification, never payload fields. */
  beforePublish?: () => void; afterSourcePublish?: () => void;
}
export function importFocusFeedback(options: ImportFeedbackOptions): { ok: boolean; receipt: EditReceipt } {
  const stateDir = resolve(options.stateDir);
  return withEditingLock(stateDir, () => {
    let state = readEditingState(stateDir);
    if (state.pending) {
      const pending = state.pending, actual = readFileSync(state.source, 'utf8');
      if (baseDigest(JSON.parse(actual)) === baseDigest(pending.candidate.current.document)) {
        state = pending.candidate; writeEditingState(stateDir, state);
      } else if (actual === pending.expectedBytes) {
        atomicWrite(state.source, JSON.stringify(pending.candidate.current.document, null, 2) + '\n');
        state = pending.candidate; writeEditingState(stateDir, state);
      } else throw new Error('Pending publication conflicts with current source; explicit recovery required');
    }
    let value;
    try { value = decodeReturn(readFileSync(options.input, 'utf8'), options.format ?? (/\.ya?ml$/i.test(options.input) ? 'yaml' : 'json')); }
    catch (error) {
      const receipt: EditReceipt = { returnId: '', digest: '', status: 'unsupported-or-invalid-return', transactions: [], conflicts: [{ reason: (error as Error).message }] };
      state.receipts.push(receipt); writeEditingState(stateDir, state); return { ok: false, receipt };
    }
    const bytes = readFileSync(state.source, 'utf8'), document = assertDecisionDossierDocument(JSON.parse(bytes));
    const manifest: FocusEditingManifest = options.currentManifestPath ? JSON.parse(readFileSync(options.currentManifestPath, 'utf8')) : state.current.manifest;
    const result: ReconcileResult = reconcile({ baseline: state.baseline, current: { document, manifest }, value, production: state.production, lineage: state.lineage });
    const remember = (receipt: EditReceipt): void => {
      state.receipts.push(receipt);
      if (!state.returns.some(r => r.returnId === value.returnId && r.digest === value.digest)) state.returns.push(value);
      writeEditingState(stateDir, state);
    };
    if (!result.ok) { state.lineage = result.lineage; remember(result.receipt); return { ok: false, receipt: result.receipt }; }
    if (!validateManifest(result.manifest, result.document).ok) throw new Error('Invalid candidate manifest');
    options.beforePublish?.();
    if (readFileSync(state.source, 'utf8') !== bytes) {
      const receipt = { ...result.receipt, status: 'concurrent-source-change', baseHash: undefined, resultHash: undefined,
        transactions: result.receipt.transactions.map(t => ({ ...t, status: 'concurrent-source-change' })), conflicts: [{ reason: 'source-changed-before-publication' }] };
      state.lineage = { ...result.lineage, head: state.lineage?.head, tombstones: state.lineage?.tombstones ?? [],
        applied: state.lineage?.applied ?? [], applications: state.lineage?.applications ?? [],
        seen: [...(state.lineage?.seen ?? []), { returnId: value.returnId, digest: value.digest, receipt }] };
      remember(receipt); return { ok: false, receipt };
    }
    const candidate: RetainedEditingState = { ...state, current: { document: result.document, manifest: result.manifest }, lineage: result.lineage,
      returns: [...state.returns, value], receipts: [...state.receipts, result.receipt] };
    // Journal is durable before source rename. Retry resolves this window from exact digests.
    writeEditingState(stateDir, { ...state, pending: { expectedBytes: bytes, candidate } });
    atomicWrite(state.source, JSON.stringify(result.document, null, 2) + '\n');
    options.afterSourcePublish?.();
    writeEditingState(stateDir, candidate);
    return { ok: true, receipt: result.receipt };
  });
}

/** A replayed refusal stays unsuccessful: the CLI exit follows the original
 * outcome, never the replay mechanics. Only a replay of an applied return —
 * or of a legacy receipt without a recorded previous outcome — exits 0. */
const REFUSED_PREVIOUS = new Set(['conflict', 'validation-refused', 'generation-mismatch', 'superseded', 'lineage-order-indeterminate', 'identity-reuse', 'concurrent-source-change', 'unsupported-or-invalid-return']);
export function runFocusFeedbackCli(args: readonly string[], streams = { stdout: process.stdout, stderr: process.stderr }): number {
  const usage = 'Usage: h2a focus feedback retain <source.json> --state <dir> --producer <id> --generation <id> --request <id>\n       h2a focus feedback apply <return.json|yaml> --state <dir> [--manifest <current-manifest.json>]\n';
  if (args.includes('--help') || args.includes('-h')) { streams.stdout.write(usage); return 0; }
  const [action, input, ...flags] = args, params = new Map<string, string>();
  if (!['retain', 'apply'].includes(action) || !input || input.startsWith('-') || flags.length % 2) { streams.stderr.write(usage); return 2; }
  const allowed = action === 'retain' ? ['--state', '--producer', '--generation', '--request'] : ['--state', '--manifest'];
  for (let i = 0; i < flags.length; i += 2) {
    if (!allowed.includes(flags[i]) || params.has(flags[i]) || !flags[i + 1] || flags[i + 1].startsWith('-')) { streams.stderr.write(usage); return 2; }
    params.set(flags[i], flags[i + 1]);
  }
  if (!params.has('--state') || (action === 'retain' && allowed.some(k => !params.has(k)))) { streams.stderr.write(usage); return 2; }
  try {
    if (action === 'retain') {
      const snapshot = retainFocusBaseline({ source: input, stateDir: params.get('--state')!, production: { producerId: params.get('--producer')!, generationId: params.get('--generation')!, requestId: params.get('--request')! } });
      streams.stdout.write(JSON.stringify({ status: 'baseline-retained', baseHash: snapshot.manifest.baseHash, manifestBaseHash: snapshot.manifest.manifestBaseHash }) + '\n'); return 0;
    }
    const result = importFocusFeedback({ input, stateDir: params.get('--state')!, currentManifestPath: params.get('--manifest') });
    streams.stdout.write(JSON.stringify(result.receipt) + '\n');
    if (result.ok) return 0;
    if (result.receipt.status === 'already-processed' && !REFUSED_PREVIOUS.has(result.receipt.previousStatus ?? '')) return 0;
    return 1;
  } catch (error) { streams.stderr.write(`h2a focus feedback: ${(error as Error).message}\n`); return 1; }
}
