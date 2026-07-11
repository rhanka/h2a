import type { PageServerLoad } from './$types';
import { loadReport } from '$lib/server/report-view';
import { buildFocusData } from '$lib/track-model';
import { harmonizeFocus } from '$lib/server/harmonize';

export const load: PageServerLoad = async () => {
  // The FRIENDLY payload is built server-side: the browser only ever receives French, jargon-free shapes —
  // no raw machine enum (P1_GATE / adviceKind / acceptance-stale / …) ships over the wire.
  const focus = buildFocusData(await loadReport());

  // AI harmonization: translate the free-text item titles into the reader's language (default `fr`) BEFORE
  // sending to the client. Machine labels are already French (track-model). `FOCUS_LANG=off` disables it.
  // The layer degrades gracefully — on any failure the original titles are kept, the page never breaks.
  const lang = process.env.FOCUS_LANG?.trim() || 'fr';
  const payload = focus.ok && lang !== 'off' ? await harmonizeFocus(focus, lang) : focus;

  return { focus: payload };
};
