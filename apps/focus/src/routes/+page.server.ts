import type { PageServerLoad } from './$types';
import { loadReport } from '$lib/server/report-view';
import { buildFocusData } from '$lib/track-model';

export const load: PageServerLoad = async () => {
  // The FRIENDLY payload is built server-side: the browser only ever receives French, jargon-free shapes —
  // no raw machine enum (P1_GATE / adviceKind / acceptance-stale / …) ships over the wire.
  const focus = buildFocusData(await loadReport());
  return { focus };
};
