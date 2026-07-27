// POST /api/decisions/inject — push a pending decision INTO the CLI working on its project.
//
// The Focus decision cards are clickable: clicking "Injecter dans la CLI" hands the decision to a live h2a
// agent of the concerned project (repo/workspace), so it surfaces where the work happens — the human puts
// the decision back in the loop of the agent that raised it. This is done over the h2a bus (NOT a forged
// attestation): we deposit a plain `focus.decision-inject` envelope into that agent's inbox via the local
// `h2a inbox put` verb. If no live agent of the project is found, we say so honestly (nothing is faked).
//
// Request  body : { id: string }                         — the decision (directive) id
// Response 200  : { ok:true, delivered:boolean, target?:string, note:string }
// Response 400/503: { ok:false, error }

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { putEnvelope, repoRoot, resolveTarget } from '$lib/server/h2a-bus';
import { loadReport } from '$lib/server/report-view';
import { subjectOf, stepAction } from '$lib/track-model';

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Corps de requête JSON invalide.' }, { status: 400 });
  }
  const id = (body as { id?: unknown })?.id;
  if (typeof id !== 'string') {
    return json({ ok: false, error: 'Champ `id` requis (identifiant de décision).' }, { status: 400 });
  }

  const report = await loadReport();
  if (!report.ok) return json({ ok: false, error: report.error }, { status: 503 });

  const d = report.view.directives.find((x) => x.id === id);
  if (!d) return json({ ok: false, error: 'Décision inconnue.' }, { status: 400 });

  const root = repoRoot();
  const project = report.repo;

  const question = d.gate?.blockedByTitle?.trim() || subjectOf(d);
  const action = stepAction(d.step.code);

  // The decision goes back to WHOEVER EMITTED THIS FOCUS when it is still live, else a session resolved
  // against the live registry — see `resolveTarget`, shared with the dossier include route. Resolution is
  // on the checkout PATH before any name, so serving this app from a worktree still delivers.
  const resolution = resolveTarget(root);

  if (!resolution.target) {
    return json({
      ok: true,
      delivered: false,
      reason: resolution.reason,
      remedy: resolution.remedy,
      note: resolution.remedy ?? `Aucune session h2a live sur « ${project} » : rien à qui remettre la décision.`
    });
  }
  const target = resolution.target;
  const envelope = {
    protocol: 'sentropic.h2a',
    version: '0.1',
    id: `env:focus-decision-${id}-${Date.now()}`,
    createdAt: new Date().toISOString(),
    type: 'event',
    actor: { instance: 'focus:local-human', role: 'AGENTS', scope: 'scope:default' },
    to: [target],
    topic: 'focus.decision-inject',
    body: {
      kind: 'decision-mandate',
      decisionId: id,
      subject: subjectOf(d),
      question,
      action,
      workspace: d.target.workspace,
      note: 'Décision poussée depuis Focus par l’humain — à instruire/trancher dans track (cette injection ne signe rien).'
    }
  };

  let recipientLive = false;
  try {
    // `inbox put` reports whether the recipient is live at deposit time — surface it so the human knows
    // whether the decision hit an active session (picked up now) or just sits in an inbox for later.
    recipientLive = putEnvelope(root, target, envelope).recipientLive;
  } catch (e) {
    return json({ ok: false, error: `Dépôt h2a échoué : ${e instanceof Error ? e.message : String(e)}` });
  }

  const note = recipientLive
    ? `Décision « ${question} » remise à la session live ${target} — elle la verra à sa prochaine relève d’inbox.`
    : `Décision « ${question} » déposée dans l’inbox de ${target}, mais la session ne répond plus (présence périmée). Elle sera lue si la session reprend.`;

  return json({ ok: true, delivered: true, target, recipientLive, note });
};
