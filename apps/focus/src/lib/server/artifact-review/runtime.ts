// Real wiring of the artifact review backend: which comment store, which h2a transport.
//
// Store selection, stated once and visible on every answer (`x-comments-store`, stream `ready` event):
//   - FOCUS_COMMENTS_URL set  → the cluster-mesh comments HTTP endpoint at that URL, and nothing else: when
//     it is unreachable or refuses, the request fails with that reason. There is no fallback, because a
//     silent switch would split one thread history across two stores.
//   - FOCUS_COMMENTS_URL unset → `InMemoryCommentStore` from `@sentropic/comments` (the reference adapter of
//     the CommentStore port the DS contract designates, shipped by sentropic next to cluster-mesh),
//     instantiated in this server process. It is NOT durable: threads are lost when Focus Web stops. It is
//     used because no runnable local cluster-mesh comments host exists yet (gap G2) and the published HTTP
//     router does not admit artifact targets (gap G1). h2a writes no comment anywhere itself.

import { randomUUID } from 'node:crypto';

import { InMemoryCommentStore } from '@sentropic/comments';

import { h2aBin, repoRoot, resolveTarget } from '$lib/server/h2a-bus';

import { deliverCommentToAgent } from './agent-delivery.js';
import { createClusterMeshHttpAdapter, createStorePortAdapter } from './comments-adapter.js';
import { readReviewConfig } from './config.js';
import { createH2aSender, defaultRelayInstance } from './h2a-relay.js';
import { handleArtifactReview, type ReviewRoute } from './http.js';
import { createReviewEvents } from './review-events.js';
import type { ReviewRequestEvent, ReviewRuntime } from './types';

const COMMENTS_PACKAGE = '@sentropic/comments 0.3.1';

let runtime: ReviewRuntime | undefined;

function buildRuntime(): ReviewRuntime {
  const config = readReviewConfig(process.env);
  const tenant = { tenantId: config.tenantId, workspaceId: config.workspaceId, userId: config.owner.id };
  const adapter = config.commentsUrl
    ? createClusterMeshHttpAdapter({ baseUrl: config.commentsUrl, token: config.commentsToken, tenant })
    : createStorePortAdapter({
        store: new InMemoryCommentStore({ generateId: () => `cmt_${randomUUID()}` }),
        tenant,
        // The published 0.3.1 port still names a closed thread 'resolved' (r3 §1.1 rename pending, C1).
        closedState: 'resolved',
        info: {
          kind: 'memory',
          durable: false,
          label: `in-process InMemoryCommentStore (${COMMENTS_PACKAGE}); threads are lost when Focus Web stops`
        }
      });
  const events = createReviewEvents({ adapter, pollMs: config.pollMs });
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
    deliverComment: (input) =>
      deliverCommentToAgent({
        ...input,
        owner: config.owner,
        tenant: config.workspaceId,
        resolveTarget: ({ requested }) => resolveTarget(root, { requested }),
        send: sender.send
      })
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
