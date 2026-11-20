// PATCH  /api/artifacts/:artifactId/comments/:commentId  { body } → ReviewComment (author-or-admin)
// DELETE /api/artifacts/:artifactId/comments/:commentId  → { ok: true } (hard delete, author-or-admin)
// Behind FOCUS_ARTIFACT_REVIEW (default off). See $lib/server/artifact-review/http.js for the contract.

import type { RequestHandler } from './$types';

import { artifactReviewRoute } from '$lib/server/artifact-review/runtime';

export const PATCH: RequestHandler = artifactReviewRoute('comment.edit');
export const DELETE: RequestHandler = artifactReviewRoute('comment.remove');
export const OPTIONS: RequestHandler = artifactReviewRoute('preflight');
