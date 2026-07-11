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

/** Live h2a instances on the bus whose id belongs to the given project label (e.g. "…:a2a-cli:…"). */
function liveAgentsForProject(root: string, project: string): string[] {
  const bin = h2aBin(root);
  if (!existsSync(bin)) return [];
  try {
    // discover can return thousands of registered instances → lift the 1 MB default so it isn't truncated.
    const out = execFileSync('node', [bin, 'discover'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
    const list = JSON.parse(out) as { id?: string; instance?: string }[];
    return list
      .map((x) => x.instance ?? x.id ?? '')
      .filter((id) => id.includes(`:${project}:`))
      // a real CLI host, not another agent/service
      .filter((id) => /^(claude|codex|gemini|agy|hermes|opencode):/.test(id));
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
  const targets = liveAgentsForProject(root, project);

  const question = d.gate?.blockedByTitle?.trim() || subjectOf(d);
  const action = stepAction(d.step.code);

  if (targets.length === 0) {
    return json({
      ok: true,
      delivered: false,
      note: `Aucune CLI live détectée sur « ${project} » — la décision reste en attente dans track. Ouvre une session h2a sur ce projet puis réessaie.`
    });
  }

  const target = targets[0];
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

  try {
    execFileSync('node', [h2aBin(root), 'inbox', 'put', '--instance', target, '--json', JSON.stringify(envelope)], {
      cwd: root,
      encoding: 'utf8'
    });
  } catch (e) {
    return json({ ok: false, error: `Dépôt h2a échoué : ${e instanceof Error ? e.message : String(e)}` });
  }

  return json({
    ok: true,
    delivered: true,
    target,
    note: `Décision « ${question} » déposée dans l’inbox de ${target}. L’agent la verra à sa prochaine relève.`
  });
};
