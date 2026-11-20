// Server-side page configuration for Focus Web artifact review (lot H1, DS review kit r6).
//
// Reads FOCUS_ARTIFACT_REVIEW and the cluster-mesh binding env via PR #469's `readReviewConfig`,
// builds the local human owner CollaborationActor host-side (never trusting browser-supplied author
// identities, H2 acceptance 1), and never leaks FOCUS_COMMENTS_URL or FOCUS_COMMENTS_TOKEN to the client.

import { buildCollaborationActor } from './comments-adapter.js';
import { readReviewConfig } from './config.js';

/**
 * @typedef {'cluster-mesh' | 'c2b-stub' | 'missing-binding'} ReviewStoreMode
 */

/**
 * @typedef {{
 *   enabled: boolean,
 *   endpointConfigured: boolean,
 *   missingBinding: boolean,
 *   storeMode: ReviewStoreMode,
 *   tenant: string,
 *   currentUser: import('./types').CollaborationActor,
 *   initialMode: 'view' | 'review',
 *   pollMs: number
 * }} ArtifactReviewPageConfig
 */

/**
 * Build the safe, browser-facing H1 review configuration for a Focus Web page load.
 *
 * @param {Record<string, string | undefined>} env
 * @param {URL} url
 * @returns {ArtifactReviewPageConfig}
 */
export function readArtifactReviewPageConfig(env, url) {
  const config = readReviewConfig(env);
  const endpointConfigured = Boolean(config.commentsUrl);
  const missingBinding = !endpointConfigured && config.requireClusterMesh;
  /** @type {ReviewStoreMode} */
  const storeMode = endpointConfigured
    ? 'cluster-mesh'
    : missingBinding
      ? 'missing-binding'
      : 'c2b-stub';
  const requestedReview = url.searchParams.get('review') === '1';

  return {
    enabled: config.enabled,
    endpointConfigured,
    missingBinding,
    storeMode,
    tenant: config.workspaceId,
    currentUser: buildCollaborationActor({
      actorId: config.owner.id,
      kind: 'human',
      displayLabel: config.owner.displayLabel
    }),
    initialMode: config.enabled && requestedReview ? 'review' : 'view',
    pollMs: config.pollMs
  };
}
