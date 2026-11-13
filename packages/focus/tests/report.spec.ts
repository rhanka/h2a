import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as validation from '../src/validation/index.js';
import { renderHtml, renderMd, renderTerminal } from '../src/index.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/benchmark-report.json', import.meta.url), 'utf8'));
const validate = (doc: unknown) => validation.validateFocusForPresentation(doc);
const codes = (doc: unknown) => { const r = validate(doc); return r.ok ? [] : r.issues.map(i => i.code); };
const require = createRequire(import.meta.url);

describe('explicit benchmark reports', () => {
  it('should preserve the complete report without inventing questions', () => {
    const doc = fixture();
    expect(validate(doc)).toEqual({ ok: true, value: doc });
    for (const output of [renderMd(doc), renderTerminal(doc), renderHtml(doc, { renderMarkdown: s => s, sanitizeHtml: s => s })]) {
      for (const text of ['Rapport', 'Reproductible', 'Graphique clair', 'Graphique sombre', 'Annexe de méthode', 'chaque mesure provient']) expect(output).toContain(text);
      expect(output).not.toMatch(/préco:|focus-question|Recommandation|0 question/);
    }
  });
  it('should keep the N3 decision-only validator closed to reports', () => {
    expect(validation.validateDecisionDossierForPresentation(fixture()).ok).toBe(false);
    const d = fixture(); delete d.kind;
    const result = validation.validateDecisionDossierForPresentation(d);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map(i => i.code)).toContain('missing_question');
    expect(codes(d)).toContain('missing_question');
  });
  it('should reject implicit, unknown or mixed report envelopes', () => {
    for (const kind of ['REPORT', '', null, 'decision']) expect(validate({ ...fixture(), kind }).ok).toBe(false);
    const d = fixture(); delete d.schemaVersion;
    expect(codes(d)).toContain('unsupported_version');
    for (const section of [
      { kind: 'question', id: 'q', targetRef: 'q', question: 'Choose?', state: 'open' },
      { kind: 'optionSet', id: 'o', targetRef: 'o', options: [] },
      { kind: 'outcome', id: 'out', targetRef: 'out', modality: 'comment', statement: 'Conclusion' },
    ]) expect(codes({ ...fixture(), sections: [...fixture().sections, section] })).toContain('report_decision_content');
    expect(codes({ ...fixture(), interactions: [{ name: 'decide', targetRef: 'summary', label: 'Decide', enabled: false }] })).toContain('report_interactions');
  });
  it('should retain evidence, glossary and the November prose gates', () => {
    for (const [change, code] of [
      [(d: any) => { d.sources[0].sha256 = '0'.repeat(64); }, 'source_digest'],
      [(d: any) => { d.citations[0].locator.end = 999; }, 'citation_range'],
      [(d: any) => { d.sections[0].citationRefs = ['absent']; }, 'unresolved_citation'],
      [(d: any) => { d.sections[0].markdown = 'En bref : API reste disponible.'; }, 'undefined_code'],
      [(d: any) => { d.sections[0].markdown = 'En bref : WP1 reste disponible.'; }, 'no_internal_id_or_lot_code_in_prose'],
      [(d: any) => { d.sections[0].markdown = 'Résumé sans introduction.'; }, 'report_summary_first'],
      [(d: any) => { d.sections[0].markdown = 'En bref : ' + 'mot '.repeat(65) + '.'; }, 'cell_max_60_words'],
    ] as const) { const d = fixture(); change(d); expect(codes(d)).toContain(code); }
  });
  it('should count shared text without requiring a question reading time', () => {
    const d = fixture();
    d.sections = Array.from({ length: 30 }, (_, i) => ({ ...d.sections[0], id: `s${i}`, targetRef: `s${i}` }));
    d.annexes[0].backRefs = ['s0']; d.readability.readingBudgetMinutes = 1;
    expect(codes(d)).toContain('reading_budget_exceeded');
  });
  it.each([60, 61, 71])('should count an escaped pipe inside a %i-word rendered cell', words => {
    const text = (count: number) => Array.from({ length: count }, (_, i) => i % 10 === 9 ? 'stable.' : 'stable').join(' ');
    const cell = `${text(30)} \\| ${text(words - 31)}`;
    for (const header of [false, true]) {
      const d = fixture();
      d.sections[1].markdown = header
        ? `| ${cell} | Observation |\n| --- | --- |\n| Mesure | Stable |`
        : `| Mesure | Observation |\n| --- | --- |\n| ${cell} | Stable |`;
      const result = validate(d);
      if (words <= 60) expect(result).toEqual({ ok: true, value: d });
      else {
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({
          code: 'cell_max_60_words',
          path: '$.sections[1].markdown',
          message: expect.stringContaining(`found ${words} words`),
        }));
      }
    }
  });
  it('should keep unescaped pipes as boundaries between individually bounded cells', () => {
    const d = fixture();
    const cell = 'Mesure stable. '.repeat(20).trim();
    d.sections[1].markdown = `| Mesure | Observation |\n| --- | --- |\n| ${cell} | ${cell} |`;
    expect(validate(d)).toEqual({ ok: true, value: d });
  });
  it.each([60, 61])('should count all %i literal words in HTML-like table cells', words => {
    const cells = [
      `<${Array(words).fill('stable.').join(' ')}>`,
      `<span title=" ${Array(words - 3).fill('stable.').join(' ')} ">`,
    ];
    for (const cell of cells) for (const header of [false, true]) {
      const d = fixture();
      d.sections[1].markdown = header
        ? `| ${cell} | Observation |\n| --- | --- |\n| Mesure | Stable |`
        : `| Mesure | Observation |\n| --- | --- |\n| ${cell} | Stable |`;
      const result = validate(d);
      if (words === 60) expect(result).toEqual({ ok: true, value: d });
      else {
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({
          code: 'cell_max_60_words', path: '$.sections[1].markdown',
          message: expect.stringContaining(`found ${words} words`),
        }));
      }
    }
  });
  it('should retain the implicit-choice guard in reports', () => {
    const d = fixture(); d.sections[0].markdown = 'En bref : le tableau décrit la détection versus le contrôle.';
    expect(codes(d)).toContain('hidden_decision');
  });
  it('should keep reports strict even with the historical hello fixture identity', () => {
    const d = fixture(); d.ref = 'decision:s1-hello'; d.hash = 'draft:s1-hello-report';
    d.sections[0].markdown = 'En bref : ' + 'mot '.repeat(65) + '.';
    expect(codes(d)).toContain('cell_max_60_words');
  });
  it('should append a closed report schema while preserving every historical digest', () => {
    const Ajv = require('ajv/dist/2020.js').default;
    const schema = JSON.parse(readFileSync(new URL('../schemas/report-document.v1.schema.json', import.meta.url), 'utf8'));
    const check = new Ajv({ strict: false }).compile(schema);
    expect(check(fixture()), JSON.stringify(check.errors)).toBe(true);
    for (const change of [
      (d: any) => { delete d.kind; },
      (d: any) => { d.kind = 'unknown'; },
      (d: any) => { d.sections[0].questionId = 'q'; },
      (d: any) => { d.sections.push({ kind: 'question', id: 'q', targetRef: 'q', question: 'Choose?', state: 'open' }); },
      (d: any) => { d.interactions.push({ name: 'decide', targetRef: 'summary', label: 'Choose', enabled: false }); },
    ]) { const d = fixture(); change(d); expect(check(d)).toBe(false); expect(validate(d).ok).toBe(false); }
    const frozen = [
      ['v1.0', '725bc07e7c6b6ad51a1f720cc9fb02649d8f31bc54e71c61c350fd20058c8852'],
      ['v1', 'f4b5247f025e99081c20fd9a8b0ed98b32a061c4a98597010be0264e5e564c6c'],
      ['v2.0', '1a8059e5264785cd15c74b7fcfc04cbe42c575203b4232af43819e094846f5a9'],
      ['v2', '058894550812b4a06eec57b9350e054e775ed657a05e8d451b16effcd3ba3702'],
    ];
    for (const [version, digest] of frozen) {
      const bytes = readFileSync(new URL(`../schemas/decision-dossier-document.${version}.schema.json`, import.meta.url));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
      expect(new Ajv({ strict: false }).compile(JSON.parse(bytes.toString()))(fixture())).toBe(false);
    }
  });
});
