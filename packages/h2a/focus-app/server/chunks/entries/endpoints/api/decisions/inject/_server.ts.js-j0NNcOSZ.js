import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { j as json } from '../../../../../chunks/utils.js-C_3_iViC.js';
import { l as loadReport, a as subjectOf, s as stepActionFr } from '../../../../../chunks/friendly.js-D4fjovnZ.js';
import '../../../../../chunks/utils2.js-BQzn9ikS.js';
import 'node:url';

function repoRoot() {
  return process.env.FOCUS_REPO_ROOT ?? path.resolve(process.cwd(), "..", "..");
}
function h2aBin(root) {
  const installed = process.env.FOCUS_H2A_BIN?.trim();
  if (installed) return installed;
  return path.join(root, "packages", "h2a", "dist", "bin.js");
}
function liveSessionsForProject(root, project) {
  const bin = h2aBin(root);
  if (!existsSync(bin)) return [];
  try {
    const out = execFileSync("node", [bin, "sessions"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
    const parsed = JSON.parse(out);
    const arr = Array.isArray(parsed) ? parsed : parsed.sessions ?? [];
    return arr.filter((x) => x.state === "live").filter((x) => (x.instance ?? "").includes(`:${project}:`)).filter((x) => /^(claude|codex|gemini|agy|hermes|opencode):/.test(x.instance ?? "")).sort((a, b) => (b.heartbeatAt ?? "").localeCompare(a.heartbeatAt ?? "")).map((x) => x.instance);
  } catch {
    return [];
  }
}
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
    const out = execFileSync(
      "node",
      [h2aBin(root), "inbox", "put", "--instance", target, "--json", JSON.stringify(envelope)],
      { cwd: root, encoding: "utf8" }
    );
    try {
      recipientLive = Boolean(JSON.parse(out).recipientLive);
    } catch {
    }
  } catch (e) {
    return json({ ok: false, error: `Dépôt h2a échoué : ${e instanceof Error ? e.message : String(e)}` });
  }
  const note = recipientLive ? `Décision « ${question} » remise à la session live ${target} — elle la verra à sa prochaine relève d’inbox.` : `Décision « ${question} » déposée dans l’inbox de ${target}, mais la session ne répond plus (présence périmée). Elle sera lue si la session reprend.`;
  return json({ ok: true, delivered: true, target, recipientLive, note });
};

export { POST };
//# sourceMappingURL=_server.ts.js-j0NNcOSZ.js.map
