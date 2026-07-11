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

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { loadReport } from '$lib/server/report-view';
import { subjectOf, stepAction } from '$lib/track-model';

function repoRoot(): string {
  return process.env.FOCUS_REPO_ROOT ?? path.resolve(process.cwd(), '..', '..');
}
function h2aBin(root: string): string {
  return path.join(root, 'packages', 'h2a', 'dist', 'bin.js');
}

/**
 * LIVE h2a sessions of the given project, freshest first. We use `h2a sessions` (not `h2a discover`):
 * `discover` lists every registered instance including long-dead ones, so it would hand us a stale inbox
 * nobody reads. `sessions` returns only sessions with a current presence (`state:"live"` + heartbeat), which
 * is exactly what we need — a decision must land where someone is actually working.
 */
function liveSessionsForProject(root: string, project: string): string[] {
  const bin = h2aBin(root);
  if (!existsSync(bin)) return [];
  try {
    const out = execFileSync('node', [bin, 'sessions'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
    const parsed = JSON.parse(out) as unknown;
    const arr = (Array.isArray(parsed) ? parsed : ((parsed as { sessions?: unknown[] }).sessions ?? [])) as {
      instance?: string;
      state?: string;
      heartbeatAt?: string;
    }[];
    return arr
      .filter((x) => x.state === 'live')
      .filter((x) => (x.instance ?? '').includes(`:${project}:`))
      // a real CLI host, not another agent/service
      .filter((x) => /^(claude|codex|gemini|agy|hermes|opencode):/.test(x.instance ?? ''))
      .sort((a, b) => (b.heartbeatAt ?? '').localeCompare(a.heartbeatAt ?? ''))
      .map((x) => x.instance as string);
  } catch {
    return [];
  }
}

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

  // The decision goes back to WHOEVER EMITTED THIS FOCUS: when h2a serves the app it passes its own instance
  // as FOCUS_EMITTER_INSTANCE, and that's the recipient — straightforward, no guessing. But we only honour the
  // emitter if it is STILL LIVE: a decision must land where someone is actually working, never in a dead inbox.
  // When the emitter is absent or has gone stale we target the freshest live session of the project instead.
  const live = liveSessionsForProject(root, project);
  const emitter = process.env.FOCUS_EMITTER_INSTANCE?.trim();
  const target = emitter && live.includes(emitter) ? emitter : live[0];

  if (!target) {
    return json({
      ok: true,
      delivered: false,
      note: `Aucune session h2a live sur « ${project} » : rien à qui remettre la décision. Ouvrez/relancez une CLI sur ce projet (ou servez le focus via h2a) puis réessayez.`
    });
  }
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
    const out = execFileSync(
      'node',
      [h2aBin(root), 'inbox', 'put', '--instance', target, '--json', JSON.stringify(envelope)],
      { cwd: root, encoding: 'utf8' }
    );
    // `inbox put` reports whether the recipient is live at deposit time — surface it so the human knows
    // whether the decision hit an active session (picked up now) or just sits in an inbox for later.
    try {
      recipientLive = Boolean((JSON.parse(out) as { recipientLive?: boolean }).recipientLive);
    } catch {
      /* older CLI without the field — leave recipientLive=false */
    }
  } catch (e) {
    return json({ ok: false, error: `Dépôt h2a échoué : ${e instanceof Error ? e.message : String(e)}` });
  }

  const note = recipientLive
    ? `Décision « ${question} » remise à la session live ${target} — elle la verra à sa prochaine relève d’inbox.`
    : `Décision « ${question} » déposée dans l’inbox de ${target}, mais la session ne répond plus (présence périmée). Elle sera lue si la session reprend.`;

  return json({ ok: true, delivered: true, target, recipientLive, note });
};
