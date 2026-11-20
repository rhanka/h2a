// Real-backend client (API-CONTRACT v0): JSON on every write, no silent switch to the
// fake once the real routes answered, `error.saved` surfaced without a retry.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCommentsClient, ReviewApiError } from './adapter';

type Call = { url: string; init?: RequestInit };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockFetch(handler: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

const comment = {
  id: 'c1',
  threadId: 't1',
  target: { kind: 'artifact', id: 'doc', sectionKey: 'a1:x' },
  author: { id: 'local-owner' },
  body: 'hello',
  state: 'open',
  createdAt: '2026-11-18T00:00:00.000Z',
  updatedAt: '2026-11-18T00:00:00.000Z'
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('comments client against the real backend', () => {
  it('sends close and reopen with a JSON content type', async () => {
    const calls = mockFetch(({ url }) => (url.endsWith('/comments') ? json(200, { threads: [] }) : json(200, { ok: true })));
    const client = createCommentsClient('doc', { authorId: 'local-owner' });
    await client.listThreads();
    await client.closeThread('t1');
    await client.reopenThread('t1');
    const writes = calls.filter((c) => c.init?.method === 'POST');
    expect(writes.map((c) => c.url)).toEqual(['/api/artifacts/doc/threads/t1/close', '/api/artifacts/doc/threads/t1/reopen']);
    for (const write of writes) {
      expect(new Headers(write.init?.headers).get('content-type')).toBe('application/json');
    }
    expect(client.backend()).toBe('real');
  });

  it('surfaces a saved-but-undelivered comment instead of falling back to the fake', async () => {
    const calls = mockFetch(({ url, init }) => {
      if (init?.method === 'POST') {
        return json(409, { error: { code: 'agent_no_target', message: 'Saved, but no live session owns it.', saved: true, comment } });
      }
      return json(200, { threads: [] });
    });
    const client = createCommentsClient('doc', { authorId: 'local-owner' });
    await client.listThreads();
    const failure = await client.create({ sectionKey: 'a1:x', body: 'hello', sendToAgent: true }).catch((e) => e);
    expect(failure).toBeInstanceOf(ReviewApiError);
    expect(failure.code).toBe('agent_no_target');
    expect(failure.saved).toBe(true);
    expect(failure.comment?.id).toBe('c1');
    expect(calls.filter((c) => c.init?.method === 'POST')).toHaveLength(1);
    // Nothing was written to the in-page fake.
    expect(Object.keys(localStorage).filter((k) => k.includes('doc'))).toEqual([]);
    expect(client.backend()).toBe('real');
  });

  it('uses the in-page fake only when the routes are absent (404)', async () => {
    mockFetch(() => json(404, { error: { code: 'feature_disabled', message: 'off' } }));
    const client = createCommentsClient('doc', { authorId: 'local-owner' });
    expect(await client.listThreads()).toEqual([]);
    expect(client.backend()).toBe('fake');
  });
});
