// POST /api/dossiers/agent-memory/include — hand ONE dossier choice to the live CLI of this project.
//
// The dossier cards let the reader pick an option and write a free-text note. Those live in the browser's
// localStorage, which is where reasoning goes to die: "Copier ma synthèse" makes it portable, this route
// makes it ARRIVE — the choice lands in the inbox of a live h2a session working on the project, so the agent
// that will implement it reads the human's reasoning where the work happens.
//
// The NOTE is the payload's whole point. The selected option says what; the note says why, what is missing,
// what to verify. It is carried verbatim and never dropped.
//
// This deposits a plain `focus.dossier-include` envelope over the h2a bus — it is NOT a signed decision and
// NOT an attestation: nothing here commits the human to anything, it only puts their reasoning in the loop.
//
// Request  body : { decisionKey: string, optionKey?: string | null, note?: string }
// Response 200  : { ok:true, delivered:boolean, target?:string, recipientLive?:boolean, note:string }
// Response 400  : { ok:false, error }

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import {
  agentMemoryDossier,
  findAgentMemoryDecision,
  findAgentMemoryOption
} from '$lib/server/agent-memory-dossier';
import { projectName, putEnvelope, repoRoot, resolveLiveTarget } from '$lib/server/h2a-bus';

/** A note longer than this is not reasoning, it is a paste accident — refuse rather than flood an inbox. */
const NOTE_MAX = 8000;

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Corps de requête JSON invalide.' }, { status: 400 });
  }

  const raw = (body ?? {}) as { decisionKey?: unknown; optionKey?: unknown; note?: unknown };

  if (typeof raw.decisionKey !== 'string') {
    return json({ ok: false, error: 'Champ `decisionKey` requis (identifiant de décision).' }, { status: 400 });
  }
  const decision = findAgentMemoryDecision(raw.decisionKey);
  if (!decision) {
    return json({ ok: false, error: 'Décision inconnue dans ce dossier.' }, { status: 400 });
  }

  let option: { key: string; title: string } | undefined;
  if (typeof raw.optionKey === 'string' && raw.optionKey.length > 0) {
    const found = findAgentMemoryOption(decision, raw.optionKey);
    if (!found) {
      return json({ ok: false, error: 'Option inconnue pour cette décision.' }, { status: 400 });
    }
    option = { key: found.key, title: found.title };
  }

  if (raw.note !== undefined && typeof raw.note !== 'string') {
    return json({ ok: false, error: 'Champ `note` invalide (texte attendu).' }, { status: 400 });
  }
  const note = typeof raw.note === 'string' ? raw.note.trim() : '';
  if (note.length > NOTE_MAX) {
    return json({ ok: false, error: `Note trop longue (${note.length} caractères, maximum ${NOTE_MAX}).` }, { status: 400 });
  }

  // Nothing to include is a user error worth naming: an empty envelope would report "delivered" while
  // handing the agent no information at all.
  if (!option && note.length === 0) {
    return json(
      { ok: false, error: 'Rien à inclure : sélectionnez une option ou écrivez une note avant de transmettre.' },
      { status: 400 }
    );
  }

  const root = repoRoot();
  const project = projectName(root);
  const target = resolveLiveTarget(root, project);

  if (!target) {
    return json({
      ok: true,
      delivered: false,
      note: `Aucune session h2a live sur « ${project} » : rien à qui remettre ce choix. Ouvrez/relancez une CLI sur ce projet (ou servez le focus via h2a) puis réessayez. Votre note reste enregistrée dans ce navigateur.`
    });
  }

  const envelope = {
    protocol: 'sentropic.h2a',
    version: '0.1',
    id: `env:focus-dossier-agent-memory-${decision.key}-${Date.now()}`,
    createdAt: new Date().toISOString(),
    type: 'event',
    actor: { instance: 'focus:local-human', role: 'AGENTS', scope: 'scope:default' },
    to: [target],
    topic: 'focus.dossier-include',
    body: {
      kind: 'dossier-choice',
      dossier: 'agent-memory',
      dossierTitle: agentMemoryDossier.title,
      revision: agentMemoryDossier.revision,
      decisionKey: decision.key,
      question: decision.question,
      // `null` — not absent — so the reader can tell "no option chosen" from "field forgotten".
      selectedOption: option ?? null,
      // The reasoning. Verbatim, never summarised, never dropped.
      humanNote: note.length > 0 ? note : null,
      provenance:
        'Choix transmis depuis le dossier Focus par l’humain — ceci ne signe aucune décision, c’est son raisonnement remis dans la boucle de l’agent.'
    }
  };

  let recipientLive = false;
  try {
    recipientLive = putEnvelope(root, target, envelope).recipientLive;
  } catch (e) {
    return json({ ok: false, error: `Dépôt h2a échoué : ${e instanceof Error ? e.message : String(e)}` });
  }

  const what = option ? `« ${option.title} »` : 'votre note';
  const withNote = note.length > 0 ? ' (note incluse)' : '';
  const message = recipientLive
    ? `${decision.key} : ${what}${withNote} remis à la session live ${target} — elle le verra à sa prochaine relève d’inbox.`
    : `${decision.key} : ${what}${withNote} déposé dans l’inbox de ${target}, mais la session ne répond plus (présence périmée). Ce sera lu si elle reprend.`;

  return json({ ok: true, delivered: true, target, recipientLive, note: message });
};
