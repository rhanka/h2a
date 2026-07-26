import { j as json } from '../../../../../../chunks/utils.js-C_3_iViC.js';
import { f as findAgentMemoryDecision, b as findAgentMemoryOption, c as agentMemoryDossier } from '../../../../../../chunks/agent-memory-dossier.js-BUU7sUNp.js';
import { r as repoRoot, b as projectName, a as resolveLiveTarget, p as putEnvelope } from '../../../../../../chunks/h2a-bus.js-WrEfPDF2.js';
import '../../../../../../chunks/utils2.js-BQzn9ikS.js';
import 'node:child_process';
import 'node:fs';
import 'node:path';

const NOTE_MAX = 8e3;
const POST = async ({ request }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Corps de requête JSON invalide." }, { status: 400 });
  }
  const raw = body ?? {};
  if (typeof raw.decisionKey !== "string") {
    return json({ ok: false, error: "Champ `decisionKey` requis (identifiant de décision)." }, { status: 400 });
  }
  const decision = findAgentMemoryDecision(raw.decisionKey);
  if (!decision) {
    return json({ ok: false, error: "Décision inconnue dans ce dossier." }, { status: 400 });
  }
  let option;
  if (typeof raw.optionKey === "string" && raw.optionKey.length > 0) {
    const found = findAgentMemoryOption(decision, raw.optionKey);
    if (!found) {
      return json({ ok: false, error: "Option inconnue pour cette décision." }, { status: 400 });
    }
    option = { key: found.key, title: found.title };
  }
  if (raw.note !== void 0 && typeof raw.note !== "string") {
    return json({ ok: false, error: "Champ `note` invalide (texte attendu)." }, { status: 400 });
  }
  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  if (note.length > NOTE_MAX) {
    return json({ ok: false, error: `Note trop longue (${note.length} caractères, maximum ${NOTE_MAX}).` }, { status: 400 });
  }
  if (!option && note.length === 0) {
    return json(
      { ok: false, error: "Rien à inclure : sélectionnez une option ou écrivez une note avant de transmettre." },
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
    protocol: "sentropic.h2a",
    version: "0.1",
    id: `env:focus-dossier-agent-memory-${decision.key}-${Date.now()}`,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    type: "event",
    actor: { instance: "focus:local-human", role: "AGENTS", scope: "scope:default" },
    to: [target],
    topic: "focus.dossier-include",
    body: {
      kind: "dossier-choice",
      dossier: "agent-memory",
      dossierTitle: agentMemoryDossier.title,
      revision: agentMemoryDossier.revision,
      decisionKey: decision.key,
      question: decision.question,
      // `null` — not absent — so the reader can tell "no option chosen" from "field forgotten".
      selectedOption: option ?? null,
      // The reasoning. Verbatim, never summarised, never dropped.
      humanNote: note.length > 0 ? note : null,
      provenance: "Choix transmis depuis le dossier Focus par l’humain — ceci ne signe aucune décision, c’est son raisonnement remis dans la boucle de l’agent."
    }
  };
  let recipientLive = false;
  try {
    recipientLive = putEnvelope(root, target, envelope).recipientLive;
  } catch (e) {
    return json({ ok: false, error: `Dépôt h2a échoué : ${e instanceof Error ? e.message : String(e)}` });
  }
  const what = option ? `« ${option.title} »` : "votre note";
  const withNote = note.length > 0 ? " (note incluse)" : "";
  const message = recipientLive ? `${decision.key} : ${what}${withNote} remis à la session live ${target} — elle le verra à sa prochaine relève d’inbox.` : `${decision.key} : ${what}${withNote} déposé dans l’inbox de ${target}, mais la session ne répond plus (présence périmée). Ce sera lu si elle reprend.`;
  return json({ ok: true, delivered: true, target, recipientLive, note: message });
};

export { POST };
//# sourceMappingURL=_server.ts.js-BdRYDxBV.js.map
