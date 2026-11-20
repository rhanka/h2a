// In-page fake implementing API-CONTRACT.md exactly (until the backend lane lands).
// Same shapes as the real routes; persisted in localStorage so a reload keeps state
// (acceptance: « reload and see state persisted »). The real adapter tries the
// HTTP routes first and falls back here — switching to the backend needs no UI change.
import type { Comment, CreateCommentInput } from './types';

const BUS_KEY = 'focus-review:fake:bus';
export const FAKE_STORAGE_PREFIX = 'focus-review:fake:v1:';

function storageKey(artifactId: string): string {
  return `${FAKE_STORAGE_PREFIX}${artifactId}`;
}

function load(artifactId: string): Comment[] {
  try {
    const raw = localStorage.getItem(storageKey(artifactId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Comment[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(artifactId: string, rows: Comment[]): void {
  try {
    localStorage.setItem(storageKey(artifactId), JSON.stringify(rows));
  } catch (err) {
    // Browser-storage failure must surface (never silent): rethrow so the UI can alert.
    throw err instanceof Error ? err : new Error('STORAGE_FAILED');
  }
}

function emit(artifactId: string, type: string, payload: unknown): void {
  window.dispatchEvent(new CustomEvent(BUS_KEY, { detail: { artifactId, type, payload } }));
}

export interface FakeOptions {
  authorId: string;
  agentDelayMs?: number;
}

export function createFakeClient(artifactId: string, opts: FakeOptions) {
  const agentAuthorId = opts.authorId; // D1 fallback: agent posts under the owner id.
  const agentDelay = opts.agentDelayMs ?? 700;
  let agentTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleAgentReply(threadId: string, triggerBody: string): void {
    if (agentTimer) clearTimeout(agentTimer);
    agentTimer = setTimeout(() => {
      const rows = load(artifactId);
      const reply: Comment = {
        id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        target: rows.find((r) => r.threadId === threadId)?.target ?? { kind: 'artifact', id: artifactId },
        threadId,
        author: { id: agentAuthorId },
        state: 'open',
        body: `Réponse de l'agent (fake) — bien reçu : « ${triggerBody.slice(0, 80)} ». Je traite ce point et je mets à jour l'artefact.`,
        provenance: { runId: 'run-fake-1' },
        createdAt: new Date().toISOString()
      };
      rows.push(reply);
      try {
        save(artifactId, rows);
      } catch {
        return;
      }
      emit(artifactId, 'comment.created', reply);
    }, agentDelay);
  }

  return {
    async listThreads(): Promise<Comment[][]> {
      const rows = load(artifactId);
      const byThread = new Map<string, Comment[]>();
      for (const r of rows) {
        const list = byThread.get(r.threadId) ?? [];
        list.push(r);
        byThread.set(r.threadId, list);
      }
      return [...byThread.values()].map((list) => [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    },

    async create(input: CreateCommentInput): Promise<Comment> {
      const rows = load(artifactId);
      const id = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const comment: Comment = {
        id,
        target: { kind: 'artifact', id: artifactId, sectionKey: input.sectionKey },
        threadId: input.threadId ?? id,
        author: { id: opts.authorId },
        state: 'open',
        body: input.body,
        createdAt: new Date().toISOString()
      };
      // Replies inherit the thread anchor from the root row.
      if (input.threadId) {
        const root = rows.find((r) => r.threadId === input.threadId);
        if (root) comment.target = { ...root.target };
      }
      rows.push(comment);
      save(artifactId, rows);
      emit(artifactId, 'comment.created', comment);
      if (input.sendToAgent) scheduleAgentReply(comment.threadId, input.body);
      return comment;
    },

    async closeThread(threadId: string): Promise<{ ok: true }> {
      const rows = load(artifactId);
      for (const r of rows) if (r.threadId === threadId) r.state = 'closed';
      save(artifactId, rows);
      emit(artifactId, 'thread.closed', { threadId });
      return { ok: true };
    },

    async reopenThread(threadId: string): Promise<{ ok: true }> {
      const rows = load(artifactId);
      for (const r of rows) if (r.threadId === threadId) r.state = 'open';
      save(artifactId, rows);
      emit(artifactId, 'thread.reopened', { threadId });
      return { ok: true };
    },

    subscribe(onEvent: (type: string, payload: unknown) => void): () => void {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail as { artifactId: string; type: string; payload: unknown };
        if (detail?.artifactId !== artifactId) return;
        onEvent(detail.type, detail.payload);
      };
      window.addEventListener(BUS_KEY, handler);
      return () => window.removeEventListener(BUS_KEY, handler);
    }
  };
}

export function clearFakeArtifact(artifactId: string): void {
  try {
    localStorage.removeItem(storageKey(artifactId));
  } catch {
    /* ignore */
  }
}
