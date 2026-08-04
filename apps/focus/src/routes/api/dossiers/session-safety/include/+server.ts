// POST /api/dossiers/session-safety/include — remettre un choix du dossier à
// une CLI h2a réellement live. Cette remise est un événement d'inbox, jamais
// un règlement permanent dans Track.

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import {
  findSessionSafetyDecision,
  findSessionSafetyOption,
  sessionSafetyDossier,
} from "$lib/server/session-safety-dossier";
import {
  projectName,
  putEnvelope,
  repoRoot,
  resolveTarget,
} from "$lib/server/h2a-bus";

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      { ok: false, error: "Corps de requête JSON invalide." },
      { status: 400 },
    );
  }

  const raw = (body ?? {}) as {
    decisionKey?: unknown;
    optionKey?: unknown;
    target?: unknown;
  };
  if (
    typeof raw.decisionKey !== "string" ||
    typeof raw.optionKey !== "string"
  ) {
    return json(
      {
        ok: false,
        error: "Les champs `decisionKey` et `optionKey` sont requis.",
      },
      { status: 400 },
    );
  }

  // Le client ne fournit que des clés : le contenu remis est reconstruit depuis
  // le dossier serveur local, pour ne jamais faire transiter une conséquence
  // arbitraire dans une inbox de CLI.
  const decision = findSessionSafetyDecision(raw.decisionKey);
  if (!decision)
    return json(
      { ok: false, error: "Décision de dossier inconnue." },
      { status: 400 },
    );
  const selected = findSessionSafetyOption(decision, raw.optionKey);
  if (!selected)
    return json(
      { ok: false, error: "Option inconnue pour cette décision." },
      { status: 400 },
    );

  const root = repoRoot();
  const requested = typeof raw.target === "string" ? raw.target : undefined;
  const resolution = resolveTarget(root, { requested });

  if (!resolution.target) {
    return json({
      ok: true,
      delivered: false,
      reason: resolution.reason,
      roots: resolution.roots,
      live: resolution.live.map((session) => ({
        instance: session.instance,
        name: session.name ?? null,
        workspace: session.workspace?.path ?? null,
        root: session.root ?? null,
      })),
      remedy: resolution.remedy,
      note: `${resolution.remedy} Le choix reste affiché ici et n'a pas été redirigé vers une autre session.`,
    });
  }

  const target = resolution.target;
  const project = projectName(root);
  const envelope = {
    protocol: "sentropic.h2a",
    version: "0.1",
    id: `env:focus-session-safety-${decision.key}-${selected.key}-${Date.now()}`,
    createdAt: new Date().toISOString(),
    type: "event",
    actor: {
      instance: "focus:local-human",
      role: "AGENTS",
      scope: "scope:default",
    },
    to: [target],
    topic: "focus.dossier-session-safety.include",
    body: {
      kind: "session-safety-dossier-choice",
      project,
      targetSession: target,
      dossier: {
        revision: sessionSafetyDossier.revision,
        title: sessionSafetyDossier.title,
        context: sessionSafetyDossier.context,
      },
      decision: {
        key: decision.key,
        question: decision.question,
        whyNow: decision.whyNow,
        recommendation: decision.recommendation,
        nextWork: decision.nextWork,
        options: decision.options.map((option) => ({
          key: option.key,
          title: option.title,
          behavior: option.behavior,
          consequence: option.consequence,
          recommended: Boolean(option.recommended),
        })),
        selected: {
          key: selected.key,
          title: selected.title,
          behavior: selected.behavior,
          consequence: selected.consequence,
          recommended: Boolean(selected.recommended),
        },
      },
      note: "Choix inclus depuis le dossier Focus à instruire dans la CLI. Cette remise ne règle ni ne signe une décision Track permanente.",
    },
  };

  let recipientLive = false;
  try {
    recipientLive = putEnvelope(
      root,
      target,
      envelope,
      resolution.targetRoot,
    ).recipientLive;
  } catch (error) {
    return json({
      ok: false,
      error: `Dépôt h2a échoué : ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  const where = resolution.targetRoot
    ? ` (racine h2a ${resolution.targetRoot})`
    : "";
  const alsoLive = resolution.ambiguous
    ? ` ${resolution.candidates.length} sessions live répondent pour ce dépôt (${resolution.candidates
        .map((candidate) => candidate.instance)
        .join(
          ", ",
        )}) — si ce n'est pas la bonne, changez de destinataire et renvoyez.`
    : "";

  return json({
    ok: true,
    delivered: true,
    project,
    target,
    targetRoot: resolution.targetRoot ?? null,
    reason: resolution.reason,
    ambiguous: resolution.ambiguous,
    recipientLive,
    note: recipientLive
      ? `Choix « ${selected.title} » remis à la CLI live ${target}${where}.${alsoLive}`
      : `Choix « ${selected.title} » déposé dans l’inbox de ${target}${where}, mais sa présence vient d’expirer.${alsoLive}`,
  });
};
