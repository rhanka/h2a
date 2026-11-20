// POST /api/artifacts/:artifactId/threads/:threadId/assign { assignedTo: string | null } → { ok: true }
// Behind FOCUS_ARTIFACT_REVIEW (default off). See $lib/server/artifact-review/http.js for the contract.

import type { RequestHandler } from './$types';

import { artifactReviewRoute } from '$lib/server/artifact-review/runtime';

export const POST: RequestHandler = artifactReviewRoute('thread.assign');
export const OPTIONS: RequestHandler = artifactReviewRoute('preflight');
