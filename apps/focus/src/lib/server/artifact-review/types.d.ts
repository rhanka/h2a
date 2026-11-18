// Types for the Focus Web artifact review backend (DS review kit contract r3, h2a API contract v0).
//
// The comment shape is the existing `Comment` type of `@sentropic/comments` (packages/comments), restated
// here so the dependency-free modules of this directory can be type-checked without importing the package.
// Two r3 deviations from the published 0.3.1 port are absorbed by the adapter, never exposed:
//   - state: the port says 'open' | 'resolved'; the wire and this API say 'open' | 'closed' (r3 §1.1);
//   - target: a Postgres read-back says kind 'record' + recordType 'artifact'; this API only ever
//     returns kind 'artifact' (r3 §1.2).

export type CommentState = 'open' | 'closed';

export interface TenantContext {
  tenantId: string;
  workspaceId: string;
  userId: string;
  sessionId?: string;
  runId?: string;
}

export interface CommentTarget {
  kind: string;
  id: string;
  sectionKey?: string;
  recordType?: string;
}

export interface CommentAuthor {
  id: string;
  kind?: 'human' | 'agent' | 'nhi';
  displayLabel?: string;
}

export interface CommentProvenance {
  toolCallId?: string;
  runId?: string;
}

/** A comment as returned by this API: target.kind is always 'artifact', state is 'open' | 'closed'. */
export interface ReviewComment {
  id: string;
  tenant?: TenantContext;
  target: { kind: 'artifact'; id: string; sectionKey?: string };
  threadId: string;
  author: CommentAuthor;
  assignedTo?: string;
  state: CommentState;
  body: string;
  provenance?: CommentProvenance;
  createdAt: string;
  updatedAt?: string;
}

/** The subset of the `@sentropic/comments` CommentStore port this backend calls. */
export interface CommentStorePort {
  add(tenant: TenantContext, input: {
    tenant: TenantContext;
    target: CommentTarget;
    author: CommentAuthor;
    body: string;
    threadId?: string;
    assignedTo?: string;
    provenance?: CommentProvenance;
  }): Promise<unknown>;
  listByTarget(tenant: TenantContext, query: { kind: string; id: string; sectionKey?: string }): Promise<unknown[]>;
  listThread(tenant: TenantContext, threadId: string): Promise<unknown[]>;
  setState(tenant: TenantContext, threadId: string, state: any): Promise<unknown[]>;
}

export interface StoreInfo {
  kind: 'memory' | 'cluster-mesh-http' | string;
  durable: boolean;
  label: string;
}

export interface CreateCommentInput {
  artifactId: string;
  sectionKey?: string;
  body: string;
  author: CommentAuthor;
  provenance?: CommentProvenance;
}

export interface ReplyInput {
  artifactId: string;
  threadId: string;
  body: string;
  author: CommentAuthor;
  provenance?: CommentProvenance;
}

/**
 * Server-side CommentsAdapter: the cluster-mesh binding behind the Focus Web routes. The kit-facing r3
 * `CommentsAdapter` is these routes plus a thin browser client; this object is what they call.
 */
export interface CommentsAdapter {
  store: StoreInfo;
  /** True when changes made outside this server can only be seen by polling the store. */
  polling: boolean;
  list(artifactId: string): Promise<ReviewComment[]>;
  listThread(artifactId: string, threadId: string): Promise<ReviewComment[]>;
  create(input: CreateCommentInput): Promise<ReviewComment>;
  reply(input: ReplyInput): Promise<ReviewComment>;
  setState(input: { artifactId: string; threadId: string; state: CommentState }): Promise<ReviewComment[]>;
}

export interface ReviewEvent {
  event: string;
  data: unknown;
}

export interface ReviewEvents {
  subscribe(artifactId: string, listener: (event: ReviewEvent) => void): Promise<() => void>;
  refresh(artifactId: string): Promise<void>;
  publish(artifactId: string, event: ReviewEvent): void;
  close(): void;
}

/** DS r3 §1.3 author view model, verbatim (canvas-live/contracts.ts). */
export interface CollaborationActor {
  actorId: string;
  kind: 'human' | 'agent' | 'nhi';
  displayLabel: string;
  color: string;
}

export interface ReviewOwner {
  id: string;
  displayLabel: string;
}

export interface ReviewConfig {
  enabled: boolean;
  commentsUrl?: string;
  commentsToken?: string;
  tenantId: string;
  workspaceId: string;
  owner: ReviewOwner;
  relayInstance?: string;
  pollMs: number;
}

export interface LiveSessionSummary {
  instance: string;
  name?: string;
  workspace?: { path?: string; label?: string };
  root?: string;
}

export interface TargetResolutionLike {
  target?: string;
  targetRoot?: string;
  reason: string;
  live: LiveSessionSummary[];
  candidates: LiveSessionSummary[];
  ambiguous: boolean;
  remedy?: string;
  binMissing: boolean;
}

export interface SendResult {
  recipient?: string;
  recipientLive: boolean;
  dormant?: boolean;
  envelopeId?: string;
  relay?: string;
}

export interface DeliveryResult {
  status: 'delivered' | 'deposited-dormant';
  target: string;
  targetRoot?: string;
  recipientLive: boolean;
  reason: string;
  relay?: string;
  envelopeId?: string;
}

export interface DeliverInput {
  comment: ReviewComment;
  anchor: Record<string, unknown> | null;
  origin: string;
  requested?: string;
}

export interface ReviewRuntime {
  adapter: CommentsAdapter;
  events: ReviewEvents;
  deliverComment(input: DeliverInput): Promise<DeliveryResult>;
}

export interface ReviewRequestEvent {
  request: Request;
  url: URL;
  params: Record<string, string | undefined>;
  getClientAddress(): string;
}
