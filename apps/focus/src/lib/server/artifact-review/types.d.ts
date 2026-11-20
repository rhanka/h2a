// Types for the Focus Web artifact review backend (DS review kit contract r6, h2a API contract r6).
//
// The wire comment shape is the existing `Comment` type of `@sentropic/comments` (packages/comments),
// restated here so the dependency-free modules of this directory can be type-checked without importing
// the package. Two DS r6 rules shape the adapter boundary:
//   - state:  r6 §1.1 — single truth 'open' | 'closed' (shown « Resolved »); C1a/C1b runs before C2 so
//     neither C2 nor the adapter carries any 'closed' <-> 'resolved' mapping.
//   - target: r6 §1.2 — a Postgres read-back says kind 'record' + recordType 'artifact'; this API only
//     ever returns kind 'artifact' and drops non-artifact rows sharing the same context id.
//   - authorship: r6 §1.3 — ReviewComment enriches Comment host-side with `authorship` (never persisted
//     in the store; `color` is display-only and re-derived on read).

export type CommentState = 'open' | 'closed';

export type ActorKind = 'human' | 'agent' | 'nhi';

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

export interface ArtifactTarget {
  kind: 'artifact';
  id: string;
  sectionKey?: string;
}

export interface CommentAuthor {
  id: string;
  kind?: ActorKind;
  displayLabel?: string;
}

export interface CommentProvenance {
  toolCallId?: string;
  runId?: string;
}

/** DS r6 §1.3 author view model, redeclared without api/ imports. */
export interface CollaborationActor {
  actorId: string;
  kind: ActorKind;
  displayLabel: string;
  color: string;
}

/** Host-enriched authorship view model (DS r6 §1.3, never stored in cluster-mesh). */
export interface CommentAuthorship {
  author: CollaborationActor;
  sponsor?: CollaborationActor;
  runId?: string;
}

/** A comment as returned by this API: target.kind is always 'artifact', state is 'open' | 'closed', authorship enriched. */
export interface ReviewComment {
  id: string;
  tenant?: TenantContext;
  target: ArtifactTarget;
  threadId: string;
  author: CommentAuthor;
  authorship: CommentAuthorship;
  assignedTo?: string;
  state: CommentState;
  body: string;
  provenance?: CommentProvenance;
  createdAt: string;
  updatedAt?: string;
}

/** The 10-verb `@sentropic/comments` CommentStore port subset this backend calls (no `setProvenance`, G18). */
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
  get?(tenant: TenantContext, id: string): Promise<unknown | null>;
  edit?(tenant: TenantContext, id: string, patch: { body?: string }): Promise<unknown>;
  delete?(tenant: TenantContext, id: string): Promise<void>;
  listByTarget(tenant: TenantContext, query: { kind: string; id: string; sectionKey?: string }): Promise<unknown[]>;
  listThread(tenant: TenantContext, threadId: string): Promise<unknown[]>;
  setState(tenant: TenantContext, threadId: string, state: CommentState): Promise<unknown[]>;
  assign?(tenant: TenantContext, threadId: string, assigneeId: string | null): Promise<unknown[]>;
}

export interface StoreInfo {
  kind: 'memory' | 'cluster-mesh-http' | 'unconfigured' | string;
  durable: boolean;
  label: string;
}

export interface CreateCommentInput {
  tenant: string;
  target: ArtifactTarget;
  body: string;
  author?: CommentAuthor;
  provenance?: CommentProvenance;
  actorKind?: ActorKind;
}

export interface ReplyInput {
  tenant: string;
  target: ArtifactTarget;
  threadId: string;
  body: string;
  author?: CommentAuthor;
  provenance?: CommentProvenance;
  actorKind?: ActorKind;
}

export interface EditCommentInput {
  tenant: string;
  target: Pick<ArtifactTarget, 'kind' | 'id'>;
  commentId: string;
  body: string;
}

export interface RemoveCommentInput {
  tenant: string;
  target: Pick<ArtifactTarget, 'kind' | 'id'>;
  commentId: string;
}

export interface SetStateInput {
  tenant: string;
  target: Pick<ArtifactTarget, 'kind' | 'id'>;
  threadId: string;
  state: CommentState;
}

export interface AssignThreadInput {
  tenant: string;
  target: Pick<ArtifactTarget, 'kind' | 'id'>;
  threadId: string;
  assigneeId: string | null;
}

/**
 * Server-side CommentsAdapter aligned on DS r6 §1.4: tenant (= workspaceId) on every verb,
 * thread verbs keyed by threadId, row verbs keyed by commentId, reply typed with target (incl. sectionKey),
 * no closed<->resolved mapping, no reanchor until S5.
 */
export interface CommentsAdapter {
  store: StoreInfo;
  /** True when changes made outside this server can only be seen by polling the store. */
  polling: boolean;
  list(tenant: string, target: Pick<ArtifactTarget, 'kind' | 'id'>): Promise<ReviewComment[]>;
  listThread(tenant: string, target: Pick<ArtifactTarget, 'kind' | 'id'>, threadId: string): Promise<ReviewComment[]>;
  create(input: CreateCommentInput): Promise<ReviewComment>;
  reply(input: ReplyInput): Promise<ReviewComment>;
  edit(input: EditCommentInput): Promise<ReviewComment>;
  remove(input: RemoveCommentInput): Promise<void>;
  setState(input: SetStateInput): Promise<ReviewComment[]>;
  assign(input: AssignThreadInput): Promise<ReviewComment[]>;
  onCommentCreated?: (listener: (comment: ReviewComment) => void) => () => void;
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

export interface ReviewOwner {
  id: string;
  displayLabel: string;
}

export interface ParticipantPrincipal {
  id: string;
  displayLabel: string;
  role: 'commenter' | 'editor' | 'admin';
  canComment: boolean;
}

export interface ResolvedAgentInfo {
  actorId: string;
  kind?: 'agent' | 'nhi';
  displayLabel: string;
  runId?: string;
}

export type ResolveAgentFn = (context: {
  comment: Omit<ReviewComment, 'authorship'>;
  toolCallId: string;
  runId?: string;
}) => ResolvedAgentInfo | null | undefined;

export interface ReviewConfig {
  enabled: boolean;
  commentsUrl?: string;
  commentsToken?: string;
  requireClusterMesh: boolean;
  tenantId: string;
  workspaceId: string;
  owner: ReviewOwner;
  workspaceMembers?: string[];
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
  origin?: string;
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
