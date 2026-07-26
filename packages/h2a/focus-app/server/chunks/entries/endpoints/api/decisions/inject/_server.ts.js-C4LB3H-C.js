import { j as json } from '../../../../../chunks/utils.js-C_3_iViC.js';
import { r as repoRoot, a as resolveLiveTarget, p as putEnvelope } from '../../../../../chunks/h2a-bus.js-WrEfPDF2.js';
import { l as loadReport, a as subjectOf, s as stepActionFr } from '../../../../../chunks/friendly.js-D4fjovnZ.js';
import '../../../../../chunks/utils2.js-BQzn9ikS.js';
import 'node:child_process';
import 'node:fs';
import 'node:path';
import 'node:url';

const POST = async ({ request }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Corps de requête JSON invalide." }, { status: 400 });
  }
  const id = body?.id;
  if (typeof id !== "string") {
    return json({ ok: false, error: "Champ `id` requis (identifiant de décision)." }, { status: 400 });
  }
  const report = await loadReport();
  if (!report.ok) return json({ ok: false, error: report.error }, { status: 503 });
  const d = report.view.directives.find((x) => x.id === id);
  if (!d) return json({ ok: false, error: "Décision inconnue." }, { status: 400 });
  const root = repoRoot();
  const project = report.repo;
  const question = d.gate?.blockedByTitle?.trim() || subjectOf(d);
  const action = stepActionFr(d.step.code);
  const target = resolveLiveTarget(root, project);
  if (!target) {
    return json({
      ok: true,
      delivered: false,
      note: `Aucune session h2a live sur « ${project} » : rien à qui remettre la décision. Ouvrez/relancez une CLI sur ce projet (ou servez le focus via h2a) puis réessayez.`
    });
  }
  const envelope = {
    protocol: "sentropic.h2a",
    version: "0.1",
    id: `env:focus-decision-${id}-${Date.now()}`,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    type: "event",
    actor: { instance: "focus:local-human", role: "AGENTS", scope: "scope:default" },
    to: [target],
    topic: "focus.decision-inject",
    body: {
      kind: "decision-mandate",
      decisionId: id,
      subject: subjectOf(d),
      question,
      action,
      workspace: d.target.workspace,
      note: "Décision poussée depuis Focus par l’humain — à instruire/trancher dans track (cette injection ne signe rien)."
    }
  };
  let recipientLive = false;
  try {
    recipientLive = putEnvelope(root, target, envelope).recipientLive;
  } catch (e) {
    return json({ ok: false, error: `Dépôt h2a échoué : ${e instanceof Error ? e.message : String(e)}` });
  }
  const note = recipientLive ? `Décision « ${question} » remise à la session live ${target} — elle la verra à sa prochaine relève d’inbox.` : `Décision « ${question} » déposée dans l’inbox de ${target}, mais la session ne répond plus (présence périmée). Elle sera lue si la session reprend.`;
  return json({ ok: true, delivered: true, target, recipientLive, note });
};

export { POST };
//# sourceMappingURL=_server.ts.js-C4LB3H-C.js.map
