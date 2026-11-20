import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loadFocusArtifactFixture } from '$lib/review/focus-fixture.js';
import { readArtifactReviewPageConfig } from '$lib/server/artifact-review/page-config.js';

export const load: PageServerLoad = ({ params, url }) => {
  const artifactReview = readArtifactReviewPageConfig(process.env, url);
  if (!artifactReview.enabled) {
    throw error(404, 'Artifact review is disabled; start Focus Web with FOCUS_ARTIFACT_REVIEW=1.');
  }
  const revision = url.searchParams.get('revision') ?? 'v1';
  const artifact = loadFocusArtifactFixture(params.id, revision);
  return {
    artifact,
    artifactReview
  };
};
