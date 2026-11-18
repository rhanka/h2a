// Review kit types — DS SPEC-r3 §1 (packages/comments `Comment`, inchangé).
// Local L0: the review kit is not published yet, so these types and the components
// under `review/` are the minimal local implementation behind the same props.
// Switch note: when `@sentropic/design-system-review-*` ships, replace this module
// with the package types; no call-site change (same names/shapes).

export type CommentTargetKind = 'message' | 'canvas' | 'artifact' | 'field' | 'record';

export interface CommentTarget {
  kind: CommentTargetKind;
  id: string;
  sectionKey?: string;
  recordType?: string;
}

/** Wire state — DB literals only (§1.1). UI renders `closed` as « Resolved ». */
export type CommentState = 'open' | 'closed';

export interface CollaborationActor {
  actorId: string;
  kind: 'human' | 'agent' | 'nhi';
  displayLabel: string;
  color: string;
}

export interface CommentProvenance {
  toolCallId?: string;
  runId?: string;
}

export interface Comment {
  id: string;
  target: CommentTarget;
  threadId: string;
  author: { id: string };
  assignedTo?: string;
  state: CommentState;
  body: string;
  provenance?: CommentProvenance;
  createdAt: string;
  updatedAt?: string;
}

export type AnchorPayload =
  | {
      t: 'text';
      q: { exact: string; prefix: string; suffix: string };
      pos?: { start: number; end: number };
      sel?: string;
      aid?: string;
      v: string;
    }
  | { t: 'element'; sel: string; aid?: string; v: string }
  | { t: 'region'; rect: { x: number; y: number; width: number; height: number }; v: string };

export interface ReviewThread {
  threadId: string;
  target: CommentTarget;
  comments: Comment[];
  state: CommentState;
  anchor: AnchorPayload | null;
  anchorLabel: string;
}

export type ThreadFilter = 'all' | 'open' | 'resolved' | 'mine';

export interface CreateCommentInput {
  sectionKey: string;
  body: string;
  threadId?: string;
  sendToAgent?: boolean;
}

export interface CommentsClient {
  listThreads(): Promise<Comment[][]>;
  create(input: CreateCommentInput): Promise<Comment>;
  closeThread(threadId: string): Promise<{ ok: true }>;
  reopenThread(threadId: string): Promise<{ ok: true }>;
  subscribe(onEvent: (type: string, payload: unknown) => void): () => void;
}

export const ANCHOR_CAP = 2048;
export const SECTION_PREFIX = 'a1:';
