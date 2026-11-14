import { r as json } from "../../../../../chunks/exports.js";
import { a as modeActorFr, c as subjectOf, r as isLaunchable, s as stepActionFr, u as loadReport } from "../../../../../chunks/friendly.js";
// src/routes/api/actions/launch/+server.ts
var POST = async ({ request }) => {
	let body;
	try {
		body = await request.json();
	} catch {
		return json({
			ok: false,
			error: "Corps de requête JSON invalide."
		}, { status: 400 });
	}
	const ids = body?.ids;
	if (!Array.isArray(ids) || !ids.every((v) => typeof v === "string")) return json({
		ok: false,
		error: "Champ `ids` requis : un tableau de chaînes (identifiants de directive)."
	}, { status: 400 });
	const report = await loadReport();
	if (!report.ok) return json({
		ok: false,
		error: report.error
	}, { status: 503 });
	const byId = new Map(report.view.directives.map((d) => [d.id, d]));
	const accepted = [];
	const rejected = [];
	for (const id of ids) {
		const d = byId.get(id);
		if (!d) {
			rejected.push({
				id,
				reason: "Action inconnue (absente de la file courante)."
			});
			continue;
		}
		if (!isLaunchable(d)) {
			rejected.push({
				id,
				reason: `Non lançable par un sous-agent — requiert ${modeActorFr(d.mode)}.`
			});
			continue;
		}
		accepted.push({
			id,
			subject: subjectOf(d),
			action: stepActionFr(d.step.code),
			actor: modeActorFr(d.mode),
			mode: d.mode
		});
	}
	return json({
		ok: true,
		launched: false,
		acknowledgedAt: (/* @__PURE__ */ new Date()).toISOString(),
		baselineCommit: report.baselineCommit,
		accepted,
		rejected,
		note: "Lancement réel des sous-agents non encore câblé — cet accusé valide la sélection et fige le contrat. Le lot suivant branchera le dispatch (sous-agent / engagement h2a) derrière cet endpoint."
	});
};
export { POST };

//# sourceMappingURL=_server.ts.js.map