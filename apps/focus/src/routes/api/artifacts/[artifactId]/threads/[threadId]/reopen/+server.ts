// POST /api/artifacts/:artifactId/threads/:threadId/reopen → { ok: true } (state 'open').
// Behind FOCUS_ARTIFACT_REVIEW (default off).

import type { RequestHandler } from './$types';

import { artifactReviewRoute } from '$lib/server/artifact-review/runtime';

export const POST: RequestHandler = artifactReviewRoute('thread.reopen');
export const OPTIONS: RequestHandler = artifactReviewRoute('preflight');
