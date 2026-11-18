import { describe, expect, it } from 'vitest';
import { decodeAnchor, encodeAnchor, filterThreads, groupThreads, isUnread, layoutPins } from './anchor';
import type { Comment } from './types';
import { ANCHOR_CAP } from './types';

function comment(id: string, threadId: string, body: string, state: 'open' | 'closed', sectionKey: string): Comment {
  return {
    id,
    threadId,
    target: { kind: 'artifact', id: 'demo', sectionKey },
    author: { id: 'owner' },
    state,
    body,
    createdAt: `2026-11-18T10:00:0${id.slice(-1)}Z`
  };
}

describe('anchor encode/decode', () => {
  it('round-trips a text anchor and stays within the cap', () => {
    const key = encodeAnchor({
      t: 'text',
      q: { exact: 'mode commentaire aussi réactif', prefix: 'Les artefacts ', suffix: ', mais entièrement' },
      pos: { start: 10, end: 40 },
      sel: 'p:nth-of-type(1)',
      aid: 'a-intro',
      v: 'v1'
    });
    expect(key.startsWith('a1:')).toBe(true);
    expect(key.length).toBeLessThanOrEqual(ANCHOR_CAP);
    const back = decodeAnchor(key);
    expect(back?.t).toBe('text');
    if (back?.t === 'text') expect(back.q.exact).toBe('mode commentaire aussi réactif');
  });

  it('round-trips an element anchor', () => {
    const key = encodeAnchor({ t: 'element', sel: 'article > p:nth-of-type(2)', aid: 'a-scope', v: 'v1' });
    const back = decodeAnchor(key);
    expect(back).toEqual({ t: 'element', sel: 'article > p:nth-of-type(2)', aid: 'a-scope', v: 'v1' });
  });

  it('rejects garbage and non-a1 keys', () => {
    expect(decodeAnchor('hello')).toBeNull();
    expect(decodeAnchor('a1:not-json!!')).toBeNull();
    expect(decodeAnchor(undefined)).toBeNull();
  });

  it('throws ANCHOR_TOO_LONG for an oversized quote', () => {
    expect(() =>
      encodeAnchor({ t: 'text', q: { exact: 'x'.repeat(5000), prefix: '', suffix: '' }, v: 'v1' })
    ).toThrow('ANCHOR_TOO_LONG');
  });
});

describe('layoutPins', () => {
  it('sorts by Y and enforces the 28px gap', () => {
    const out = layoutPins([{ top: 100 }, { top: 105 }, { top: 90 }]);
    expect(out.map((p) => p.top)).toEqual([90, 118, 146]);
  });
});

describe('groupThreads / filterThreads / isUnread', () => {
  const key = encodeAnchor({ t: 'element', sel: 'p', aid: 'a-intro', v: 'v1' });
  const rows = [
    comment('c1', 't1', 'premier', 'open', key),
    comment('c2', 't1', 'réponse', 'open', key),
    comment('c3', 't2', 'autre fil', 'closed', key)
  ];

  it('groups flat rows by threadId, chronological', () => {
    const threads = groupThreads(rows);
    expect(threads).toHaveLength(2);
    expect(threads.find((t) => t.threadId === 't1')?.comments.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(threads.find((t) => t.threadId === 't2')?.state).toBe('closed');
    expect(threads[0].anchor?.t).toBe('element');
  });

  it('filters open / resolved / mine', () => {
    const threads = groupThreads(rows);
    expect(filterThreads(threads, 'open', 'owner')).toHaveLength(1);
    expect(filterThreads(threads, 'resolved', 'owner')).toHaveLength(1);
    expect(filterThreads(threads, 'mine', 'owner')).toHaveLength(2);
    expect(filterThreads(threads, 'mine', 'someone-else')).toHaveLength(0);
  });

  it('marks unread only for others\u2019 newer comments', () => {
    const threads = groupThreads(rows);
    const t1 = threads.find((t) => t.threadId === 't1')!;
    expect(isUnread(t1, undefined, 'owner')).toBe(false);
    expect(isUnread(t1, undefined, 'someone-else')).toBe(true);
    expect(isUnread(t1, '2026-11-18T10:00:09Z', 'someone-else')).toBe(false);
  });
});
