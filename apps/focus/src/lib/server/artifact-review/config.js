// Environment of the artifact review backend. Read per request for the flag (cheap, and lets a test or an
// operator flip it without a rebuild); the rest is read once when the runtime is first built.
//
//   FOCUS_ARTIFACT_REVIEW=1             enable the /api/artifacts/* routes (default: off, routes answer 404)
//   FOCUS_COMMENTS_URL=<url>            dedicated cluster-mesh artifact-comments HTTP endpoint (C2b/C2c);
//                                       when unset, fails closed if FOCUS_COMMENTS_REQUIRE_CLUSTER_MESH=1,
//                                       otherwise uses the non-durable L0 InMemoryCommentStore stub (never
//                                       valid for H5 persistence)
//   FOCUS_COMMENTS_REQUIRE_CLUSTER_MESH=1  fail closed (503 comments_unavailable) if FOCUS_COMMENTS_URL is unset
//   FOCUS_COMMENTS_TOKEN=<token>        bearer token for that endpoint (never logged, never returned)
//   FOCUS_COMMENTS_TENANT / FOCUS_COMMENTS_WORKSPACE   tenant scope of every store call (default: local)
//   FOCUS_REVIEW_OWNER_ID / FOCUS_REVIEW_OWNER_LABEL   local owner principal (default: local-owner)
//   FOCUS_REVIEW_MEMBERS=<id1,id2,...>  optional comma-separated workspace members allowed in assign()
//   FOCUS_REVIEW_RELAY=<instance>       pre-provisioned h2a identity that signs the sends (default: an
//                                       auto-provisioned focus:artifact-review:<hash> identity per h2a root)
//   FOCUS_COMMENTS_POLL_MS=<ms>         polling period of the stream for the HTTP endpoint (default 2000)

const TRUE = new Set(['1', 'true', 'yes', 'on']);

/**
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
function text(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * @param {string | undefined} value
 * @returns {string[] | undefined}
 */
function csvList(value) {
  const raw = text(value);
  if (!raw) return undefined;
  const items = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return items.length > 0 ? [...new Set(items)] : undefined;
}

/**
 * @param {string | undefined} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 */
function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * @param {string | undefined} value
 * @returns {boolean}
 */
export function isArtifactReviewEnabled(value) {
  return TRUE.has(String(value ?? '').trim().toLowerCase());
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {import('./types').ReviewConfig}
 */
export function readReviewConfig(env) {
  const ownerId = text(env.FOCUS_REVIEW_OWNER_ID) ?? 'local-owner';
  const configuredMembers = csvList(env.FOCUS_REVIEW_MEMBERS);
  const workspaceMembers = configuredMembers
    ? [...new Set([ownerId, ...configuredMembers])]
    : undefined;
  return {
    enabled: isArtifactReviewEnabled(env.FOCUS_ARTIFACT_REVIEW),
    commentsUrl: text(env.FOCUS_COMMENTS_URL),
    commentsToken: text(env.FOCUS_COMMENTS_TOKEN),
    requireClusterMesh: isArtifactReviewEnabled(env.FOCUS_COMMENTS_REQUIRE_CLUSTER_MESH),
    tenantId: text(env.FOCUS_COMMENTS_TENANT) ?? 'local',
    workspaceId: text(env.FOCUS_COMMENTS_WORKSPACE) ?? 'local',
    owner: {
      id: ownerId,
      displayLabel: text(env.FOCUS_REVIEW_OWNER_LABEL) ?? 'Owner'
    },
    ...(workspaceMembers ? { workspaceMembers } : {}),
    relayInstance: text(env.FOCUS_REVIEW_RELAY),
    pollMs: boundedInt(env.FOCUS_COMMENTS_POLL_MS, 2000, 250, 60000)
  };
}
