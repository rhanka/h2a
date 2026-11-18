// sendToAgent: hand an owner comment to the artifact's owning session, whatever its CLI (DS r3 §4).
//
// Flow: the comment is already saved and read back → the owning session is resolved with the SAME ladder
// as every other Focus delivery (`h2a-target.js`: requested, FOCUS_H2A_TARGET, emitter, workspace path,
// name, sole) → one signed h2a message is deposited in the root that session reads. The message is a
// pointer plus a bounded excerpt: the thread in the comment store stays the authority, and the agent is
// told to re-read it before acting.
//
// Replying: the published comment surface has no artifact comment verb an agent can call yet (gap G1,
// sentropic lot C2), so the message tells the agent how to reply through this Focus Web server on
// loopback. The reply is stored under the OWNER id with `provenance.runId` naming the agent run (r3
// fallback until owner decision D1), and a row carrying provenance never triggers a new send (loop guard).
//
// Every refusal is a ReviewError the route returns to the UI: no target, several candidates, h2a missing,
// or a failed send. Nothing is retried silently and nothing is redirected to another session.

import { createHash } from 'node:crypto';

import { excerptOf } from './anchor.js';
import { ReviewError } from './errors.js';

export const COMMENT_REQUEST_KIND = 'h2a.comment-request';
export const COMMENT_REQUEST_VERSION = 1;

const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#ca8a04', '#4f46e5'];

/**
 * DS r3 §1.3 `CollaborationActor` for the owner principal. `color` is display-only and derived, never
 * persisted.
 * @param {import('./types').ReviewOwner} owner
 * @returns {import('./types').CollaborationActor}
 */
export function collaborationActor(owner) {
  const digest = createHash('sha256').update(owner.id).digest();
  return {
    actorId: owner.id,
    kind: 'human',
    displayLabel: owner.displayLabel,
    color: AVATAR_COLORS[digest[0] % AVATAR_COLORS.length]
  };
}

/**
 * @param {string} value
 */
function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the h2a message for one comment: a readable first line, the r3 §4 payload as JSON, then the reply
 * instructions. Never the full body beyond the excerpt.
 *
 * @param {{
 *   comment: import('./types').ReviewComment,
 *   anchor: Record<string, unknown> | null,
 *   owner: import('./types').ReviewOwner,
 *   origin: string,
 *   recipient: string,
 *   tenant: string
 * }} input
 */
export function buildCommentRequest({ comment, anchor, owner, origin, recipient, tenant }) {
  const artifactId = comment.target.id;
  const base = `${origin}/api/artifacts/${encodeURIComponent(artifactId)}`;
  const threadUrl = `${base}/threads/${encodeURIComponent(comment.threadId)}`;
  const replyBody = { threadId: comment.threadId, body: '<your reply>', provenance: { runId: recipient } };
  const payload = {
    kind: COMMENT_REQUEST_KIND,
    v: COMMENT_REQUEST_VERSION,
    tenant,
    artifactId,
    threadId: comment.threadId,
    commentId: comment.id,
    author: collaborationActor(owner),
    excerpt: excerptOf(comment.body),
    anchor,
    ...(comment.provenance ? { provenance: comment.provenance } : {}),
    recipient,
    reply: {
      readThread: { method: 'GET', url: `${base}/comments` },
      postReply: { method: 'POST', url: `${base}/comments`, contentType: 'application/json', body: replyBody },
      closeThread: { method: 'POST', url: `${threadUrl}/close`, contentType: 'application/json', body: {} },
      reopenThread: { method: 'POST', url: `${threadUrl}/reopen`, contentType: 'application/json', body: {} }
    }
  };
  const lead =
    `[h2a comment-request] The owner commented on artifact ${artifactId} (thread ${comment.threadId}): ` +
    `"${excerptOf(comment.body, 120)}"`;
  const text = [
    lead,
    '',
    JSON.stringify(payload, null, 2),
    '',
    'Read the thread before acting (the thread is the authority, not this message):',
    `  curl -sS ${shellQuote(`${base}/comments`)}`,
    'Reply in the same thread (stored under the owner id; provenance.runId marks your run):',
    `  curl -sS -X POST ${shellQuote(`${base}/comments`)} -H 'content-type: application/json' -d ${shellQuote(JSON.stringify(replyBody))}`,
    'When the point is handled, reply "Resolved in <version|commit>" first, then close the thread:',
    `  curl -sS -X POST ${shellQuote(`${threadUrl}/close`)} -H 'content-type: application/json' -d '{}'`
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
 * @param {{
 *   comment: import('./types').ReviewComment,
 *   anchor: Record<string, unknown> | null,
 *   owner: import('./types').ReviewOwner,
 *   origin: string,
 *   tenant: string,
 *   requested?: string,
 *   resolveTarget: (input: { requested?: string }) => import('./types').TargetResolutionLike | Promise<import('./types').TargetResolutionLike>,
 *   send: (input: { target: string, targetRoot?: string, text: string }) => Promise<import('./types').SendResult>
 * }} input
 * @returns {Promise<import('./types').DeliveryResult>}
 */
export async function deliverCommentToAgent(input) {
  const { comment } = input;
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
    origin: input.origin,
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
