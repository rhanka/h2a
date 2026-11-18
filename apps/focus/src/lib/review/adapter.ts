// Comments client — API-CONTRACT.md (frozen v0). The real SvelteKit routes are the
// default. The in-page fake is used only when the backend is absent: the first
// GET .../comments answers 404 (routes not built in, or FOCUS_ARTIFACT_REVIEW off)
// or the request cannot reach the server. Once the real backend has answered, every
// error is surfaced to the UI (never a silent switch to the fake, never a duplicate).
import type { Comment, CommentsClient, CreateCommentInput } from './types';
import { createFakeClient } from './fake';

interface ApiErrorBody {
  error?: { code?: string; message?: string; saved?: boolean; comment?: Comment };
}

/** Error raised from a JSON `{ error: { code, message } }` answer of the real backend. */
export class ReviewApiError extends Error {
  readonly code: string;
  readonly status: number;
  /** The comment was stored although the request failed (e.g. agent delivery). Never retry. */
  readonly saved: boolean;
  readonly comment?: Comment;

  constructor(status: number, body: ApiErrorBody | null) {
    const code = body?.error?.code ?? `http_${status}`;
    super(body?.error?.message ?? `Request failed (${status}).`);
    this.name = 'ReviewApiError';
    this.code = code;
    this.status = status;
    this.saved = body?.error?.saved === true;
    this.comment = body?.error?.comment;
  }
}

async function readJson<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function expectOk<T>(res: Response): Promise<T> {
  const body = await readJson<T & ApiErrorBody>(res);
  if (!res.ok) throw new ReviewApiError(res.status, body);
  if (body === null) throw new ReviewApiError(res.status, { error: { code: 'bad_json', message: 'The review backend answered without JSON.' } });
  return body as T;
}

// Every write carries a JSON content type: the backend requires it (415 otherwise) and
// SvelteKit's CSRF guard refuses a content-type-less cross-site POST before the route.
const JSON_HEADERS = { 'content-type': 'application/json' };

export function createCommentsClient(
  artifactId: string,
  opts: { authorId: string; forceFake?: boolean }
): CommentsClient & { readonly backend: () => 'real' | 'fake' | 'unknown' } {
  const fake = createFakeClient(artifactId, { authorId: opts.authorId });
  const base = `/api/artifacts/${encodeURIComponent(artifactId)}`;
  let backend: 'real' | 'fake' | 'unknown' = opts.forceFake ? 'fake' : 'unknown';

  async function probe(): Promise<'real' | 'fake'> {
    if (backend !== 'unknown') return backend;
    let res: Response;
    try {
      res = await fetch(`${base}/comments`);
    } catch {
      backend = 'fake';
      return backend;
    }
    if (res.status === 404) {
      backend = 'fake';
      return backend;
    }
    // Any other answer comes from the real routes: errors are surfaced from now on.
    backend = 'real';
    return backend;
  }

  return {
    backend: () => backend,

    async listThreads(): Promise<Comment[][]> {
      if ((await probe()) === 'fake') return fake.listThreads();
      const data = await expectOk<{ threads: Comment[][] }>(await fetch(`${base}/comments`));
      return data.threads ?? [];
    },

    async create(input: CreateCommentInput): Promise<Comment> {
      if ((await probe()) === 'fake') return fake.create(input);
      const payload: Record<string, unknown> = { body: input.body };
      if (input.sectionKey) payload.sectionKey = input.sectionKey;
      if (input.threadId) payload.threadId = input.threadId;
      if (input.sendToAgent) payload.sendToAgent = true;
      return expectOk<Comment>(
        await fetch(`${base}/comments`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) })
      );
    },

    async closeThread(threadId: string): Promise<{ ok: true }> {
      if ((await probe()) === 'fake') return fake.closeThread(threadId);
      await expectOk(
        await fetch(`${base}/threads/${encodeURIComponent(threadId)}/close`, { method: 'POST', headers: JSON_HEADERS, body: '{}' })
      );
      return { ok: true };
    },

    async reopenThread(threadId: string): Promise<{ ok: true }> {
      if ((await probe()) === 'fake') return fake.reopenThread(threadId);
      await expectOk(
        await fetch(`${base}/threads/${encodeURIComponent(threadId)}/reopen`, { method: 'POST', headers: JSON_HEADERS, body: '{}' })
      );
      return { ok: true };
    },

    subscribe(onEvent: (type: string, payload: unknown) => void): () => void {
      let closed = false;
      let source: EventSource | undefined;
      let fakeOff: (() => void) | undefined;
      const openReal = () => {
        if (closed || source || typeof EventSource === 'undefined') return;
        source = new EventSource(`${base}/stream`);
        const forward = (type: string) => (e: MessageEvent) => {
          if (closed) return;
          try {
            onEvent(type, JSON.parse(e.data));
          } catch {
            onEvent(type, e.data);
          }
        };
        for (const type of ['comment.created', 'thread.closed', 'thread.reopened', 'agent.delivery', 'review.error']) {
          source.addEventListener(type, forward(type));
        }
      };
      void probe().then((mode) => {
        if (closed) return;
        if (mode === 'fake') fakeOff = fake.subscribe(onEvent);
        else openReal();
      });
      return () => {
        closed = true;
        fakeOff?.();
        source?.close();
      };
    }
  };
}
