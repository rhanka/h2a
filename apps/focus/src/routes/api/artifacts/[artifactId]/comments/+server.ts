// GET  /api/artifacts/:artifactId/comments → { threads: Comment[][] }
// POST /api/artifacts/:artifactId/comments { sectionKey, body, threadId?, sendToAgent? } → Comment
// Behind FOCUS_ARTIFACT_REVIEW (default off). See $lib/server/artifact-review/http.js for the contract.

import type { RequestHandler } from './$types';

import { artifactReviewRoute } from '$lib/server/artifact-review/runtime';

export const GET: RequestHandler = artifactReviewRoute('comments.list');
export const POST: RequestHandler = artifactReviewRoute('comments.create');
export const OPTIONS: RequestHandler = artifactReviewRoute('preflight');
