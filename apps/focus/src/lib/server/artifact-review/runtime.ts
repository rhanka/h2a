// Real wiring of the artifact review backend (DS review kit contract r6): which comment store, which h2a transport.
//
// Store selection, stated once and visible on every answer (`x-comments-store`, stream `ready` event):
//   - FOCUS_COMMENTS_URL set  → dedicated cluster-mesh artifact-comments HTTP router (C2b/C2c) at that URL,
//     and nothing else: when unreachable or refusing, the request fails with that reason. No silent fallback.
//   - FOCUS_COMMENTS_URL unset + FOCUS_COMMENTS_REQUIRE_CLUSTER_MESH=1 → fails closed (`503 comments_unavailable`,
//     missing binding, AR-3) and writes nothing anywhere.
//   - FOCUS_COMMENTS_URL unset (L0 demo interim only, never valid for H5 persistence) → `InMemoryCommentStore`
//     from `@sentropic/comments`, instantiated in-process. Not durable; h2a writes no comment anywhere itself.

import { randomUUID } from 'node:crypto';

import { InMemoryCommentStore } from '@sentropic/comments';

import { h2aBin, repoRoot, resolveTarget } from '$lib/server/h2a-bus';

import { deliverCommentToAgent } from './agent-delivery.js';
import {
  createClusterMeshHttpAdapter,
  createMissingBindingAdapter,
  createStorePortAdapter
} from './comments-adapter.js';
import { readReviewConfig } from './config.js';
import { createH2aSender, defaultRelayInstance } from './h2a-relay.js';
import { handleArtifactReview, type ReviewRoute } from './http.js';
import { createReviewEvents } from './review-events.js';
import type { CommentStorePort, ResolveAgentFn, ReviewRequestEvent, ReviewRuntime } from './types';

const COMMENTS_PACKAGE = '@sentropic/comments 0.3.1';

let runtime: ReviewRuntime | undefined;

/**
 * Host-side agent enrichment (DS r6 §1.3): `PgCommentStore.add` drops `runId` on INSERT, so we match
 * `agent:<sessionId>:<seq>` or explicit `runId` against sessions that received a comment request in this
 * process (ephemeral, display-only — never a comment store).
 */
function createLiveAgentResolver(liveSessions: Map<string, { actorId: string; displayLabel: string; runId: string }>): ResolveAgentFn {
  return ({ toolCallId, runId }) => {
    if (runId && liveSessions.has(runId)) {
      return { kind: 'agent', ...liveSessions.get(runId)! };
    }
    const match = /^agent:(.+):[^:]+$/.exec(toolCallId);
    if (match && liveSessions.has(match[1])) {
      return { kind: 'agent', ...liveSessions.get(match[1])! };
    }
    return undefined;
  };
}

function buildRuntime(): ReviewRuntime {
  const config = readReviewConfig(process.env);
  const tenant = { tenantId: config.tenantId, workspaceId: config.workspaceId, userId: config.owner.id };
  const liveSessions = new Map<string, { actorId: string; displayLabel: string; runId: string }>();
  const resolveAgent = createLiveAgentResolver(liveSessions);

  const adapter = config.commentsUrl
    ? createClusterMeshHttpAdapter({
        baseUrl: config.commentsUrl,
        token: config.commentsToken,
        tenant,
        owner: config.owner,
        resolveAgent
      })
    : config.requireClusterMesh
      ? createMissingBindingAdapter()
      : createStorePortAdapter({
          // `@sentropic/comments` 0.3.1's `.d.ts` still types `setState` as `'open' | 'resolved'` before C1a;
          // at runtime `InMemoryCommentStore.setState` stores `'closed'` verbatim without any state mapping.
          store: new InMemoryCommentStore({ generateId: () => `cmt_${randomUUID()}` }) as unknown as CommentStorePort,
          tenant,
          owner: config.owner,
          resolveAgent,
          info: {
            kind: 'memory',
            durable: false,
            label: `in-process InMemoryCommentStore (${COMMENTS_PACKAGE}, L0 interim stub — not valid for H5 persistence)`
          }
        });

  const events = createReviewEvents({ adapter, tenant: config.workspaceId, pollMs: config.pollMs });
  const root = repoRoot();
  const sender = createH2aSender({
    getBin: () => h2aBin(root),
    cwd: root,
    relay: config.relayInstance ?? defaultRelayInstance(root),
    autoProvision: !config.relayInstance
  });

  return {
    adapter,
    events,
    deliverComment: async (input) => {
      const result = await deliverCommentToAgent({
        ...input,
        owner: config.owner,
        tenant: config.workspaceId,
        resolveTarget: ({ requested }) => resolveTarget(root, { requested }),
        send: sender.send
      });
      if (result.target) {
        liveSessions.set(result.target, {
          actorId: result.target,
          displayLabel: result.target.split(':')[0] || 'Agent',
          runId: result.target
        });
      }
      return result;
    }
  };
}

function getRuntime(): ReviewRuntime {
  runtime ??= buildRuntime();
  return runtime;
}

/** A SvelteKit request handler for one artifact review route. The flag is read on every request. */
export function artifactReviewRoute(route: ReviewRoute) {
  return (event: ReviewRequestEvent): Promise<Response> =>
    handleArtifactReview(route, event, { config: readReviewConfig(process.env), getRuntime });
}
