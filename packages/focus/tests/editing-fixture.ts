import * as api from '../src/editing/index.js';
import type { DecisionDossierDocument } from '../src/model.js';
export const E = api as any;
export const document = (): DecisionDossierDocument => ({
  ref: 'decision:é/"~', subject: 'synthetic', title: 'Synthetic editing witness', hash: 'draft-opaque', cursor: 'rev-1',
  sections: [
    { kind: 'prose', id: 'p/~', targetRef: 'section:é/"~', markdown: 'Identique 😀  \r\nligne\r\n\r\nIdentique 😀  \r\nligne\r\n\r\n| A | B |\r\n| - | - |\r\n| x | y |\r\n\r\n- préservé\r\n  - imbriqué\r\n\r\n```js\r\nx()\r\n```\r\n\r\n' },
    { kind: 'question', id: 'q', targetRef: 'question:q', question: 'Pourquoi ?', recommendedAnswer: 'Raison exacte', recommendedOptionId: 'o', state: 'open' },
    { kind: 'optionSet', id: 'os', targetRef: 'options:os', questionId: 'q', options: [{ kind: 'option', id: 'o', targetRef: 'option:o', label: 'Choix', body: 'Corps', annotation: 'none' }] },
  ], interactions: [{ name: 'amend', targetRef: 'section:é/"~', label: 'Amender', enabled: false }],
  provenance: { source: 'synthetic; never a path instruction', readAt: '2026-10-18T12:00:00Z' }, amendmentTrace: [],
});
export const production = { producerId: 'producer:synthetic', generationId: 'generation:1', requestId: 'request:1' };
export const setup = () => { const doc = document(); const manifest = E.seedManifest(doc); return { doc, manifest }; };
export const units = (doc: any, manifest: any) => E.readParagraphs(doc, manifest);
export const change = (doc: any, manifest: any, index = 0, after = 'Correction exacte') => {
  const draft = units(doc, manifest); draft[index] = { ...draft[index], text: after };
  return E.diffParagraphs(units(doc, manifest), draft, 'transaction:1');
};
export const freeze = (doc: any, manifest: any, transactions: any[] = [], previous?: any, returnId = 'R1') => E.freezeReturn({
  document: doc, manifest, production, scope: null, answers: [{ questionId: 'q', targetRef: 'question:q', optionIds: ['o'], text: '' }],
  notes: [{ targetRef: 'question:q', text: 'Été 😀\n  texte  \n\n' }, { targetRef: 'option:o', text: null }],
  transactions, previous, returnId, capturedAt: '2026-10-18T12:00:00Z',
});
export const apply = (doc: any, manifest: any, value: any, current = { document: doc, manifest }, lineage?: any) => E.reconcile({
  baseline: { document: doc, manifest }, current, value, lineage, production,
});
