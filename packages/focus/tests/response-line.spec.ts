import { describe, it, expect } from 'vitest';
import { decisionCodes, responseLine, optionCode } from '../../focus-interactive/src/response-line.js';

describe('portable decision response', () => {
  const questions = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];
  const sets = questions.map(q => ({ questionId: q.id, options: [{ id: `${q.id}-a` }, { id: `${q.id}-b` }] }));
  it('should keep unanswered questions explicit without selecting recommendations', () => {
    expect(responseLine(questions, sets, new Map())).toBe('D1 — · D2 — · D3 —');
  });
  it('should update the whole response in question order after a choice changes', () => {
    const selected = new Map([['three', 'three-a'], ['one', 'one-a'], ['two', 'two-b']]);
    expect(responseLine(questions, sets, selected)).toBe('D1 A · D2 B · D3 A');
    selected.set('one', 'one-b');
    expect(responseLine(questions, sets, selected)).toBe('D1 B · D2 B · D3 A');
  });
  it('should combine split option sets and refuse an unknown selection', () => {
    expect(responseLine([{ id: 'one' }], [sets[0]!, { questionId: 'one', options: [{ id: 'extra' }] }], new Map([['one', 'extra']]))).toBe('D1 C');
    expect(responseLine(questions, sets, new Map([['one', 'removed']]))).toBe('D1 — · D2 — · D3 —');
    expect(responseLine([], [], new Map())).toBe('');
    expect([0, 25, 26, 27].map(optionCode)).toEqual(['A', 'Z', 'AA', 'AB']);
  });
  it('should preserve authored decision numbers without colliding with generated codes', () => {
    const numbered = [{ id: 'D2' }, { id: 'D11' }];
    expect(responseLine(numbered, [{ questionId: 'D2', options: [{ id: 'D2-A' }] }], new Map([['D2', 'D2-A']]))).toBe('D2 A · D11 —');
    expect(decisionCodes([{ id: 'generic' }, ...numbered, { id: 'another' }])).toEqual(['D1', 'D2', 'D11', 'D3']);
  });
});
