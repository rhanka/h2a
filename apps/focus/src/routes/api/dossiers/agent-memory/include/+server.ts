// POST /api/dossiers/agent-memory/include — hand dossier choices to a live CLI of this project.
//
// This is the DEFAULT way answers leave the dossier. The clipboard is the fallback: it makes a choice
// portable, this makes it ARRIVE — the answers land in the inbox of a live h2a session working on the
// project, so the agent that will implement them reads the human's reasoning where the work happens.
//
// The NOTE is the payload's whole point. The selected option says what; the note says why, what is missing,
// what to verify. It is carried verbatim and never dropped — an injection that delivers seven options and
// loses six notes has delivered the labels and thrown away the thinking.
//
// Two shapes, because thirteen clicks to export a dossier is why a human reaches for the clipboard:
//   { decisionKey, optionKey?, note? }   → one decision
//   { answers: [ {decisionKey, optionKey?, note?}, … ] } → the whole set, ONE envelope, one read
// Both accept an optional `target` (an instance id the human picked); without it the recipient is
// resolved against the live registry — see `$lib/server/h2a-target.js`.
//
// This deposits a plain `focus.dossier-include` envelope over the h2a bus — it is NOT a signed decision and
// NOT an attestation: nothing here commits the human to anything, it only puts their reasoning in the loop.
//
// Response 200 : { ok:true, delivered:boolean, target?, recipientLive?, note, reason, live[], remedy? }
// Response 400 : { ok:false, error }

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import {
  agentMemoryDossier,
  findAgentMemoryDecision,
  findAgentMemoryOption
} from '$lib/server/agent-memory-dossier';
import { putEnvelope, repoRoot, resolveTarget } from '$lib/server/h2a-bus';

/** A note longer than this is not reasoning, it is a paste accident — refuse rather than flood an inbox. */
const NOTE_MAX = 8000;

interface PreparedAnswer {
  decisionKey: string;
  question: string;
  selectedOption: { key: string; title: string } | null;
  humanNote: string | null;
}

/** Validate one answer against the dossier. Returns a message instead of throwing: the caller reports it. */
function prepare(raw: { decisionKey?: unknown; optionKey?: unknown; note?: unknown }): PreparedAnswer | string {
  if (typeof raw.decisionKey !== 'string') {
    return 'Champ `decisionKey` requis (identifiant de décision).';
  }
  const decision = findAgentMemoryDecision(raw.decisionKey);
  if (!decision) return `Décision inconnue dans ce dossier : ${raw.decisionKey}.`;

  let option: { key: string; title: string } | null = null;
  if (typeof raw.optionKey === 'string' && raw.optionKey.length > 0) {
    const found = findAgentMemoryOption(decision, raw.optionKey);
    if (!found) return `Option inconnue pour ${decision.key} : ${raw.optionKey}.`;
    option = { key: found.key, title: found.title };
  }

  if (raw.note !== undefined && raw.note !== null && typeof raw.note !== 'string') {
    return `Champ \`note\` invalide pour ${decision.key} (texte attendu).`;
  }
  const note = typeof raw.note === 'string' ? raw.note.trim() : '';
  if (note.length > NOTE_MAX) {
    return `Note trop longue pour ${decision.key} (${note.length} caractères, maximum ${NOTE_MAX}).`;
  }

  return {
    decisionKey: decision.key,
    question: decision.question,
    // `null` — not absent — so the reader can tell "no option chosen" from "field forgotten".
    selectedOption: option,
    humanNote: note.length > 0 ? note : null
  };
}

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Corps de requête JSON invalide.' }, { status: 400 });
  }

  const raw = (body ?? {}) as { answers?: unknown; target?: unknown; decisionKey?: unknown };
  const batch = Array.isArray(raw.answers);
  const entries = batch
    ? (raw.answers as { decisionKey?: unknown; optionKey?: unknown; note?: unknown }[])
    : [raw as { decisionKey?: unknown; optionKey?: unknown; note?: unknown }];

  if (batch && entries.length === 0) {
    return json({ ok: false, error: 'Aucune réponse à transmettre.' }, { status: 400 });
  }

  const prepared: PreparedAnswer[] = [];
  for (const entry of entries) {
    const result = prepare(entry ?? {});
    if (typeof result === 'string') return json({ ok: false, error: result }, { status: 400 });
    prepared.push(result);
  }

  // Nothing to include is a user error worth naming: an empty envelope would report "delivered" while
  // handing the agent no information at all.
  const carrying = prepared.filter((a) => a.selectedOption || a.humanNote);
  if (carrying.length === 0) {
    return json(
      { ok: false, error: 'Rien à inclure : sélectionnez une option ou écrivez une note avant de transmettre.' },
      { status: 400 }
    );
  }

  const root = repoRoot();
  const requested = typeof raw.target === 'string' ? raw.target : undefined;
  const resolution = resolveTarget(root, { requested });

  if (!resolution.target) {
    // Not just "no": WHY, and what would change it. A button that fails without a next move is a dead end.
    return json({
      ok: true,
      delivered: false,
      reason: resolution.reason,
      roots: resolution.roots,
      live: resolution.live.map((s) => ({
        instance: s.instance,
        name: s.name ?? null,
        workspace: s.workspace?.path ?? null,
        root: s.root ?? null
      })),
      remedy: resolution.remedy,
      note: `${resolution.remedy} Vos réponses restent affichées ici et le jeu commité, lui, n'a pas bougé.`
    });
  }

  const target = resolution.target;
  const notesCarried = carrying.filter((a) => a.humanNote).length;

  const envelope = {
    protocol: 'sentropic.h2a',
    version: '0.1',
    id: `env:focus-dossier-agent-memory-${batch ? 'set' : carrying[0].decisionKey}-${Date.now()}`,
    createdAt: new Date().toISOString(),
    type: 'event',
    actor: { instance: 'focus:local-human', role: 'AGENTS', scope: 'scope:default' },
    to: [target],
    topic: 'focus.dossier-include',
    body: {
      kind: batch ? 'dossier-answer-set' : 'dossier-choice',
      dossier: 'agent-memory',
      dossierTitle: agentMemoryDossier.title,
      revision: agentMemoryDossier.revision,
      // Single-answer envelopes keep their historical top-level shape so an existing reader still works;
      // `answers` is always present, so a new reader needs exactly one code path.
      ...(batch
        ? {}
        : {
            decisionKey: carrying[0].decisionKey,
            question: carrying[0].question,
            selectedOption: carrying[0].selectedOption,
            humanNote: carrying[0].humanNote
          }),
      answers: carrying,
      answerCount: carrying.length,
      noteCount: notesCarried,
      provenance:
        'Choix transmis depuis le dossier Focus par l’humain — ceci ne signe aucune décision, c’est son raisonnement remis dans la boucle de l’agent.'
    }
  };

  let recipientLive = false;
  try {
    // The root is passed explicitly: on a multi-root host, depositing into the default root would report
    // success while writing where the recipient never looks.
    recipientLive = putEnvelope(root, target, envelope, resolution.targetRoot).recipientLive;
  } catch (e) {
    return json({ ok: false, error: `Dépôt h2a échoué : ${e instanceof Error ? e.message : String(e)}` });
  }

  const what = batch
    ? `${carrying.length} réponse(s) (${notesCarried} note(s))`
    : `${carrying[0].decisionKey} : ${carrying[0].selectedOption ? `« ${carrying[0].selectedOption.title} »` : 'votre note'}${carrying[0].humanNote ? ' (note incluse)' : ''}`;
  const where = resolution.targetRoot ? ` (racine h2a ${resolution.targetRoot})` : '';
  // Several live sessions answer for this repo: say which one received, and that there were others.
  const alsoLive = resolution.ambiguous
    ? ` ${resolution.candidates.length} sessions live répondent pour ce dépôt (${resolution.candidates
        .map((c) => c.instance)
        .join(', ')}) — si ce n'est pas la bonne, changez de destinataire et renvoyez.`
    : '';
  const message = recipientLive
    ? `${what} remis à la session live ${target}${where} — elle le verra à sa prochaine relève d’inbox.${alsoLive}`
    : `${what} déposé dans l’inbox de ${target}${where}, mais la session ne répond plus (présence périmée). Ce sera lu si elle reprend.${alsoLive}`;

  return json({
    ok: true,
    delivered: true,
    target,
    targetRoot: resolution.targetRoot ?? null,
    reason: resolution.reason,
    ambiguous: resolution.ambiguous,
    recipientLive,
    answerCount: carrying.length,
    noteCount: notesCarried,
    note: message
  });
};
