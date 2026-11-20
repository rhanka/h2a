import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, FAKE_STORAGE_PREFIX } from './fake';
import { encodeAnchor } from './anchor';

const ARTIFACT = 'demo-fake';
const key = encodeAnchor({ t: 'element', sel: 'p', aid: 'a-intro', v: 'v1' });

describe('fake adapter (API-CONTRACT in-page)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates, replies, closes, reopens and persists across instances', async () => {
    const client = createFakeClient(ARTIFACT, { authorId: 'owner' });
    const root = await client.create({ sectionKey: key, body: 'Premier fil' });
    expect(root.threadId).toBe(root.id);
    const reply = await client.create({ sectionKey: '', body: 'Réponse', threadId: root.threadId });
    expect(reply.threadId).toBe(root.threadId);

    let threads = await client.listThreads();
    expect(threads).toHaveLength(1);
    expect(threads[0]).toHaveLength(2);

    await client.closeThread(root.threadId);
    threads = await client.listThreads();
    expect(threads[0].every((c) => c.state === 'closed')).toBe(true);

    await client.reopenThread(root.threadId);
    // A fresh instance reads the same localStorage state (reload persistence).
    const fresh = createFakeClient(ARTIFACT, { authorId: 'owner' });
    threads = await fresh.listThreads();
    expect(threads[0].every((c) => c.state === 'open')).toBe(true);
    expect(localStorage.getItem(`${FAKE_STORAGE_PREFIX}${ARTIFACT}`)).toContain('Premier fil');
  });

  it('emits SSE-shaped events and an agent reply when sendToAgent is set', async () => {
    vi.useRealTimers();
    const client = createFakeClient(ARTIFACT, { authorId: 'owner', agentDelayMs: 20 });
    const events: string[] = [];
    const off = client.subscribe((type) => events.push(type));
    const root = await client.create({ sectionKey: key, body: 'Question pour l\u2019agent', sendToAgent: true });
    expect(events).toContain('comment.created');
    await new Promise((r) => setTimeout(r, 80));
    const threads = await client.listThreads();
    const agentReply = threads[0].find((c) => c.provenance?.runId === 'run-fake-1');
    expect(agentReply?.provenance?.runId).toBe('run-fake-1');
    expect(events.filter((e) => e === 'comment.created').length).toBeGreaterThanOrEqual(2);
    off();
    void root;
  });

  it('surfaces storage failures instead of failing silently', async () => {
    const client = createFakeClient(ARTIFACT, { authorId: 'owner' });
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    await expect(client.create({ sectionKey: key, body: 'boom' })).rejects.toThrow('QuotaExceeded');
    spy.mockRestore();
  });
});
