import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as E from '@sentropic/focus/editing';
const consumer = await import('../../dist/focus-feedback.js');
const production = { producerId: 'producer:test', generationId: 'generation:test', requestId: 'request:test' };
const doc = () => ({ ref: 'decision:manual', subject: 'Synthetic', title: 'Synthetic manual return', hash: 'opaque', cursor: '1', sections: [
  { kind: 'prose', id: 'p', targetRef: 'p', markdown: 'A\n\nX' },
], interactions: [], provenance: { source: '/never/open/this', readAt: '2026-10-18T12:00:00Z' }, amendmentTrace: [] });
export function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'focus-feedback-'));
  try {
    const source = join(root, 'source.json'), stateDir = join(root, 'state'); writeFileSync(source, JSON.stringify(doc()));
    const retained = consumer.retainFocusBaseline({ source, stateDir, production });
    const freeze = (texts, previous, returnId = 'R1') => {
      const base = E.readParagraphs(retained.document, retained.manifest), draft = structuredClone(base);
      for (const [index, text] of Object.entries(texts)) draft[Number(index)].text = text;
      return E.freezeReturn({ document: retained.document, manifest: retained.manifest, production, scope: null, answers: [], notes: [{ targetRef: 'p', text: '  note\n\n' }],
        transactions: [E.diffParagraphs(base, draft, 'tx')], returnId, capturedAt: '2026-10-18T12:00:00Z', previous });
    };
    const consume = (value, options = {}) => { const path = join(root, 'return.json'); writeFileSync(path, E.encodeReturn(value)); return consumer.importFocusFeedback({ stateDir, input: path, ...options }); };
    return fn({ root, source, stateDir, retained, freeze, consume, production, consumer });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
