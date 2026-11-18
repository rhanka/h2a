import type { PageServerLoad } from './$types';

// Feature flag (default off): PUBLIC_FOCUS_ARTIFACT_REVIEW=1 enables the review UI.
// The backend comments routes (API-CONTRACT.md) are implemented by a parallel lane;
// until they land the client runs on the in-page fake (see lib/review/adapter.ts).
export const load: PageServerLoad = ({ params }) => {
  const enabled =
    process.env.PUBLIC_FOCUS_ARTIFACT_REVIEW === '1' ||
    process.env.PUBLIC_FOCUS_ARTIFACT_REVIEW === 'true' ||
    process.env.FOCUS_ARTIFACT_REVIEW === '1' ||
    process.env.FOCUS_ARTIFACT_REVIEW === 'true';
  return {
    artifactId: params.id,
    artifactVersion: 'v1',
    reviewEnabled: enabled
  };
};
