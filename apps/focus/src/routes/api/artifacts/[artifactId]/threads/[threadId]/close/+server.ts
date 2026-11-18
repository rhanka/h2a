// POST /api/artifacts/:artifactId/threads/:threadId/close → { ok: true } (state 'closed', shown « Resolved »).
// Behind FOCUS_ARTIFACT_REVIEW (default off).

import type { RequestHandler } from './$types';

import { artifactReviewRoute } from '$lib/server/artifact-review/runtime';

export const POST: RequestHandler = artifactReviewRoute('thread.close');
export const OPTIONS: RequestHandler = artifactReviewRoute('preflight');
