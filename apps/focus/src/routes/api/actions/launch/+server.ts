// POST /api/actions/launch — the bulk-launch contract.
//
// The Suivi view lets a human tick the launchable "à-faire" actions and press "Lancer les actions
// sélectionnées". This endpoint is the CONTRACT for that gesture. For now it VALIDATES the request against
// the live track state and returns an acknowledgement — it does NOT yet spawn a sub-agent / open an h2a
// engagement (that wiring is the next lot). The contract is defined cleanly here so the real launcher can
// slot in behind it without the client changing.
//
// Request  body : { ids: string[] }                    — directive ids (e.g. "item:01K…") to launch
// Response 200  : {
//    ok: true,
//    launched: false,                                   — STUB: real dispatch not wired yet
//    acknowledgedAt: ISO-8601,
//    baselineCommit: string,
//    accepted: { id, subject, action, actor, mode }[],  — recognised & launchable
//    rejected: { id, reason }[],                         — unknown OR not sub-agent-launchable
//    note: string
// }
// Response 400  : { ok: false, error }                  — malformed body

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { loadReport } from '$lib/server/report-view';
import { isLaunchable, modeActor, stepAction, subjectOf } from '$lib/track-model';

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Corps de requête JSON invalide.' }, { status: 400 });
  }

  const ids = (body as { ids?: unknown })?.ids;
  if (!Array.isArray(ids) || !ids.every((v) => typeof v === 'string')) {
    return json(
      { ok: false, error: 'Champ `ids` requis : un tableau de chaînes (identifiants de directive).' },
      { status: 400 }
    );
  }

  const report = await loadReport();
  if (!report.ok) {
    return json({ ok: false, error: report.error }, { status: 503 });
  }

  const byId = new Map(report.view.directives.map((d) => [d.id, d]));
  const accepted: { id: string; subject: string; action: string; actor: string; mode: string }[] = [];
  const rejected: { id: string; reason: string }[] = [];

  for (const id of ids as string[]) {
    const d = byId.get(id);
    if (!d) {
      rejected.push({ id, reason: 'Action inconnue (absente de la file courante).' });
      continue;
    }
    if (!isLaunchable(d)) {
      rejected.push({
        id,
        reason: `Non lançable par un sous-agent — requiert ${modeActor(d.mode)}.`
      });
      continue;
    }
    accepted.push({
      id,
      subject: subjectOf(d),
      action: stepAction(d.step.code),
      actor: modeActor(d.mode),
      mode: d.mode
    });
  }

  return json({
    ok: true,
    launched: false,
    acknowledgedAt: new Date().toISOString(),
    baselineCommit: report.baselineCommit,
    accepted,
    rejected,
    note:
      'Lancement réel des sous-agents non encore câblé — cet accusé valide la sélection et fige le contrat. ' +
      'Le lot suivant branchera le dispatch (sous-agent / engagement h2a) derrière cet endpoint.'
  });
};
