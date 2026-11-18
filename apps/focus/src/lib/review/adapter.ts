// Comments client — API-CONTRACT.md (figé). Tries the real SvelteKit routes first;
// falls back to the in-page fake until the backend lane lands. When the backend PR
// exists, delete the fallback (or keep it behind `?fake=1` for tests) — no UI change.
import type { Comment, CommentsClient, CreateCommentInput } from './types';
import { createFakeClient } from './fake';

interface ApiError {
  error?: { code?: string; message?: string };
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`BAD_JSON_${res.status}`);
  }
}

export function createCommentsClient(
  artifactId: string,
  opts: { authorId: string; forceFake?: boolean }
): CommentsClient {
  const fake = createFakeClient(artifactId, { authorId: opts.authorId });
  const base = `/api/artifacts/${encodeURIComponent(artifactId)}`;
  let useFake = !!opts.forceFake;

  return {
    async listThreads(): Promise<Comment[][]> {
      if (!useFake) {
        try {
          const res = await fetch(`${base}/comments`);
          if (res.ok) {
            const data = await readJson<{ threads: Comment[][] }>(res);
            return data.threads ?? [];
          }
          useFake = true;
        } catch {
          useFake = true;
        }
      }
      return fake.listThreads();
    },

    async create(input: CreateCommentInput): Promise<Comment> {
      if (!useFake) {
        try {
          const res = await fetch(`${base}/comments`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input)
          });
          if (res.ok) return readJson<Comment>(res);
          const err = (await readJson<ApiError>(res).catch(() => ({}))) as ApiError;
          if (res.status === 400 && err.error?.code) throw new Error(err.error.code);
          useFake = true;
        } catch (e) {
          if (e instanceof Error && e.message.startsWith('ANCHOR')) throw e;
          useFake = true;
        }
      }
      return fake.create(input);
    },

    async closeThread(threadId: string): Promise<{ ok: true }> {
      if (!useFake) {
        try {
          const res = await fetch(`${base}/threads/${encodeURIComponent(threadId)}/close`, { method: 'POST' });
          if (res.ok) return { ok: true };
          useFake = true;
        } catch {
          useFake = true;
        }
      }
      return fake.closeThread(threadId);
    },

    async reopenThread(threadId: string): Promise<{ ok: true }> {
      if (!useFake) {
        try {
          const res = await fetch(`${base}/threads/${encodeURIComponent(threadId)}/reopen`, { method: 'POST' });
          if (res.ok) return { ok: true };
          useFake = true;
        } catch {
          useFake = true;
        }
      }
      return fake.reopenThread(threadId);
    },

    subscribe(onEvent: (type: string, payload: unknown) => void): () => void {
      let closed = false;
      let source: EventSource | undefined;
      const fakeOff = fake.subscribe(onEvent);
      if (!useFake && typeof EventSource !== 'undefined') {
        try {
          source = new EventSource(`${base}/stream`);
          const forward = (type: string) => (e: MessageEvent) => {
            if (closed) return;
            try {
              onEvent(type, JSON.parse(e.data));
            } catch {
              onEvent(type, e.data);
            }
          };
          source.addEventListener('comment.created', forward('comment.created'));
          source.addEventListener('thread.closed', forward('thread.closed'));
          source.addEventListener('thread.reopened', forward('thread.reopened'));
          source.onerror = () => {
            // SSE unavailable → fake bus already subscribed; keep it.
          };
        } catch {
          source = undefined;
        }
      }
      return () => {
        closed = true;
        fakeOff();
        source?.close();
      };
    }
  };
}
