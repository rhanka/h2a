// GET /api/artifacts/:artifactId/stream — Server-Sent Events: comment.created, thread.closed, thread.reopened
// (agent replies arrive live). Behind FOCUS_ARTIFACT_REVIEW (default off).

import type { RequestHandler } from './$types';

import { artifactReviewRoute } from '$lib/server/artifact-review/runtime';

export const GET: RequestHandler = artifactReviewRoute('stream');
export const OPTIONS: RequestHandler = artifactReviewRoute('preflight');
