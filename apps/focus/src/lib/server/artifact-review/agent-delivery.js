// sendToAgent (`onCommentCreated` -> `h2a send`): hand a HUMAN comment (`!c.provenance?.toolCallId`) to
// the artifact's owning session, whatever its CLI (DS r6 §4, Appendix C).
//
// Flow: the comment is already saved and read back -> `isHumanComment(comment)` verifies `!provenance.toolCallId`
// -> the owning session is resolved with the SAME ladder as every other Focus delivery (`h2a-target.js`)
// -> one signed h2a message is deposited in the root that session reads.
//
// Security & contract (DS r6 §4, §9, Appendix C):
//   - Payload carries ONLY: `tenant, target (id + sectionKey?), artifactId, threadId, commentId, authorship,
//     excerpt, anchor (decoded, present on replies too), provenance?, recipient` plus C2d MCP verb hints.
//   - NEVER carries the full body beyond the excerpt, NEVER carries an endpoint URL or credential.
//   - The agent re-reads the thread, replies (with mandatory non-empty `provenance.toolCallId`, synthetic
//     `agent:<sessionId>:<seq>` outside MCP), posts `"Resolved in <version|commit>"` and closes via the
//     dedicated cluster-mesh MCP provider (C2d).
//   - Every refusal is a ReviewError returned to the UI; nothing is retried silently or redirected.

import { excerptOf } from './anchor.js';
import { buildCollaborationActor, isHumanComment } from './comments-adapter.js';
import { ReviewError } from './errors.js';

export const COMMENT_REQUEST_KIND = 'h2a.comment-request';
export const COMMENT_REQUEST_VERSION = 1;
export const CLUSTER_MESH_MCP_PROVIDER = 'cluster-mesh-artifact-comments';

/**
 * DS r6 §1.3 `CollaborationActor` for a human principal. `color` is display-only and derived, never
 * persisted.
 * @param {import('./types').ReviewOwner} owner
 * @returns {import('./types').CollaborationActor}
 */
export function collaborationActor(owner) {
  return buildCollaborationActor({
    actorId: owner.id,
    kind: 'human',
    displayLabel: owner.displayLabel
  });
}

/**
 * Build the h2a message for one human comment: a readable first line, the r6 §4 / Appendix C payload as
 * JSON, then the C2d MCP reply/resolve instructions. Never carries the full body beyond the excerpt,
 * never carries an endpoint URL or credential.
 *
 * @param {{
 *   comment: import('./types').ReviewComment,
 *   anchor: Record<string, unknown> | null,
 *   owner: import('./types').ReviewOwner,
 *   recipient: string,
 *   tenant: string
 * }} input
 */
export function buildCommentRequest({ comment, anchor, owner, recipient, tenant }) {
  const artifactId = comment.target.id;
  const authorship = comment.authorship ?? { author: collaborationActor(owner) };
  const syntheticToolCallId = `agent:${recipient}:1`;
  const replyArgs = {
    tenant,
    target: comment.target,
    threadId: comment.threadId,
    body: '<your reply>',
    provenance: { toolCallId: syntheticToolCallId }
  };
  const payload = {
    kind: COMMENT_REQUEST_KIND,
    v: COMMENT_REQUEST_VERSION,
    tenant,
    target: comment.target,
    artifactId,
    threadId: comment.threadId,
    commentId: comment.id,
    authorship,
    excerpt: excerptOf(comment.body),
    anchor,
    ...(comment.provenance ? { provenance: comment.provenance } : {}),
    recipient,
    replyChannel: {
      provider: CLUSTER_MESH_MCP_PROVIDER,
      verbs: {
        readThread: { verb: 'listThread', args: { tenant, threadId: comment.threadId } },
        reply: { verb: 'reply', args: replyArgs },
        closeThread: { verb: 'setState', args: { tenant, threadId: comment.threadId, state: 'closed' } },
        reopenThread: { verb: 'setState', args: { tenant, threadId: comment.threadId, state: 'open' } }
      }
    }
  };
  const lead =
    `[h2a comment-request] ${authorship.author.displayLabel} commented on artifact ${artifactId} (thread ${comment.threadId}): ` +
    `"${excerptOf(comment.body, 120)}"`;
  const text = [
    lead,
    '',
    JSON.stringify(payload, null, 2),
    '',
    'Re-read the thread through your configured cluster-mesh MCP provider (C2d) before acting (the thread is the authority, not this excerpt):',
    `  MCP listThread({ tenant: ${JSON.stringify(tenant)}, threadId: ${JSON.stringify(comment.threadId)} })`,
    'Reply in the same thread with a non-empty provenance.toolCallId (injected by MCP; outside MCP use agent:<sessionId>:<seq>):',
    `  MCP reply(${JSON.stringify(replyArgs)})`,
    'When handled, reply "Resolved in <version|commit>" first, then close the thread:',
    `  MCP setState({ tenant: ${JSON.stringify(tenant)}, threadId: ${JSON.stringify(comment.threadId)}, state: "closed" })`
  ].join('\n');
  return { text, payload };
}

/**
 * @param {import('./types').LiveSessionSummary} session
 */
function describe(session) {
  return {
    instance: session.instance,
    name: session.name ?? null,
    workspace: session.workspace?.path ?? null,
    root: session.root ?? null
  };
}

/**
 * Filter a host-side `onCommentCreated` callback so only human comments (`!c.provenance?.toolCallId`)
 * trigger downstream delivery (DS r6 §4 loop guard).
 * @param {(comment: import('./types').ReviewComment) => unknown} handler
 * @returns {(comment: import('./types').ReviewComment) => unknown}
 */
export function filterHumanComments(handler) {
  return (comment) => {
    if (!isHumanComment(comment)) return undefined;
    return handler(comment);
  };
}

/**
 * @param {{
 *   comment: import('./types').ReviewComment,
 *   anchor: Record<string, unknown> | null,
 *   owner: import('./types').ReviewOwner,
 *   origin?: string,
 *   tenant: string,
 *   requested?: string,
 *   resolveTarget: (input: { requested?: string }) => import('./types').TargetResolutionLike | Promise<import('./types').TargetResolutionLike>,
 *   send: (input: { target: string, targetRoot?: string, text: string }) => Promise<import('./types').SendResult>
 * }} input
 * @returns {Promise<import('./types').DeliveryResult>}
 */
export async function deliverCommentToAgent(input) {
  const { comment } = input;
  if (!isHumanComment(comment)) {
    throw new ReviewError(
      'loop_guard',
      400,
      'A comment carrying provenance.toolCallId is non-human and never triggers h2a send (loop guard).'
    );
  }
  const saved = `Comment ${comment.id} is saved in thread ${comment.threadId}`;
  /** @type {import('./types').TargetResolutionLike} */
  let resolution;
  try {
    resolution = await input.resolveTarget({ requested: input.requested });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ReviewError('agent_delivery_failed', 502, `${saved}, but the owning session could not be resolved: ${reason}`, {
      delivery: { status: 'failed' }
    });
  }
  if (resolution.binMissing) {
    throw new ReviewError('h2a_unavailable', 503, `${saved}, but no h2a binary is available to deliver it.`, {
      delivery: { status: 'h2a-unavailable', remedy: resolution.remedy ?? null }
    });
  }
  if (!resolution.target) {
    throw new ReviewError(
      'agent_no_target',
      409,
      `${saved}, but no live h2a session can receive it (${resolution.reason}); nothing was sent.`,
      {
        delivery: {
          status: 'no-target',
          reason: resolution.reason,
          remedy: resolution.remedy ?? null,
          live: resolution.live.map(describe)
        }
      }
    );
  }
  if (resolution.ambiguous) {
    throw new ReviewError(
      'agent_target_ambiguous',
      409,
      `${saved}, but ${resolution.candidates.length} live sessions answer for this repository; nothing was sent. ` +
        'Choose one (agentTarget) or pin FOCUS_H2A_TARGET.',
      { delivery: { status: 'ambiguous', reason: resolution.reason, candidates: resolution.candidates.map(describe) } }
    );
  }
  const target = resolution.target;
  const request = buildCommentRequest({
    comment,
    anchor: input.anchor,
    owner: input.owner,
    recipient: target,
    tenant: input.tenant
  });
  /** @type {import('./types').SendResult} */
  let sent;
  try {
    sent = await input.send({ target, targetRoot: resolution.targetRoot, text: request.text });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ReviewError('agent_delivery_failed', 502, `${saved}, but sending it to ${target} failed: ${reason}`, {
      delivery: { status: 'failed', target, targetRoot: resolution.targetRoot ?? null }
    });
  }
  return {
    status: sent.recipientLive ? 'delivered' : 'deposited-dormant',
    target,
    ...(resolution.targetRoot ? { targetRoot: resolution.targetRoot } : {}),
    recipientLive: Boolean(sent.recipientLive),
    reason: resolution.reason,
    ...(sent.relay ? { relay: sent.relay } : {}),
    ...(sent.envelopeId ? { envelopeId: sent.envelopeId } : {})
  };
}
