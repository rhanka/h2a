import { r as json } from "../../../../../../chunks/exports.js";
import { n as findAgentMemoryDecision, r as findAgentMemoryOption, t as agentMemoryDossier } from "../../../../../../chunks/agent-memory-dossier.js";
import { i as resolveTarget, r as repoRoot, t as putEnvelope } from "../../../../../../chunks/h2a-bus.js";
// src/routes/api/dossiers/agent-memory/include/+server.ts
/** A note longer than this is not reasoning, it is a paste accident — refuse rather than flood an inbox. */
var NOTE_MAX = 8e3;
/** Validate one answer against the dossier. Returns a message instead of throwing: the caller reports it. */
function prepare(raw) {
	if (typeof raw.decisionKey !== "string") return "Champ `decisionKey` requis (identifiant de décision).";
	const decision = findAgentMemoryDecision(raw.decisionKey);
	if (!decision) return `Décision inconnue dans ce dossier : ${raw.decisionKey}.`;
	let option = null;
	if (typeof raw.optionKey === "string" && raw.optionKey.length > 0) {
		const found = findAgentMemoryOption(decision, raw.optionKey);
		if (!found) return `Option inconnue pour ${decision.key} : ${raw.optionKey}.`;
		option = {
			key: found.key,
			title: found.title
		};
	}
	if (raw.note !== void 0 && raw.note !== null && typeof raw.note !== "string") return `Champ \`note\` invalide pour ${decision.key} (texte attendu).`;
	const note = typeof raw.note === "string" ? raw.note.trim() : "";
	if (note.length > NOTE_MAX) return `Note trop longue pour ${decision.key} (${note.length} caractères, maximum ${NOTE_MAX}).`;
	return {
		decisionKey: decision.key,
		question: decision.question,
		selectedOption: option,
		humanNote: note.length > 0 ? note : null
	};
}
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
	const raw = body ?? {};
	const batch = Array.isArray(raw.answers);
	const entries = batch ? raw.answers : [raw];
	if (batch && entries.length === 0) return json({
		ok: false,
		error: "Aucune réponse à transmettre."
	}, { status: 400 });
	const prepared = [];
	for (const entry of entries) {
		const result = prepare(entry ?? {});
		if (typeof result === "string") return json({
			ok: false,
			error: result
		}, { status: 400 });
		prepared.push(result);
	}
	const carrying = prepared.filter((a) => a.selectedOption || a.humanNote);
	if (carrying.length === 0) return json({
		ok: false,
		error: "Rien à inclure : sélectionnez une option ou écrivez une note avant de transmettre."
	}, { status: 400 });
	const root = repoRoot();
	const requested = typeof raw.target === "string" ? raw.target : void 0;
	const resolution = resolveTarget(root, { requested });
	if (!resolution.target) return json({
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
	const target = resolution.target;
	const notesCarried = carrying.filter((a) => a.humanNote).length;
	const envelope = {
		protocol: "sentropic.h2a",
		version: "0.1",
		id: `env:focus-dossier-agent-memory-${batch ? "set" : carrying[0].decisionKey}-${Date.now()}`,
		createdAt: (/* @__PURE__ */ new Date()).toISOString(),
		type: "event",
		actor: {
			instance: "focus:local-human",
			role: "AGENTS",
			scope: "scope:default"
		},
		to: [target],
		topic: "focus.dossier-include",
		body: {
			kind: batch ? "dossier-answer-set" : "dossier-choice",
			dossier: "agent-memory",
			dossierTitle: agentMemoryDossier.title,
			revision: agentMemoryDossier.revision,
			...batch ? {} : {
				decisionKey: carrying[0].decisionKey,
				question: carrying[0].question,
				selectedOption: carrying[0].selectedOption,
				humanNote: carrying[0].humanNote
			},
			answers: carrying,
			answerCount: carrying.length,
			noteCount: notesCarried,
			provenance: "Choix transmis depuis le dossier Focus par l’humain — ceci ne signe aucune décision, c’est son raisonnement remis dans la boucle de l’agent."
		}
	};
	let recipientLive = false;
	try {
		recipientLive = putEnvelope(root, target, envelope, resolution.targetRoot).recipientLive;
	} catch (e) {
		return json({
			ok: false,
			error: `Dépôt h2a échoué : ${e instanceof Error ? e.message : String(e)}`
		});
	}
	const what = batch ? `${carrying.length} réponse(s) (${notesCarried} note(s))` : `${carrying[0].decisionKey} : ${carrying[0].selectedOption ? `« ${carrying[0].selectedOption.title} »` : "votre note"}${carrying[0].humanNote ? " (note incluse)" : ""}`;
	const where = resolution.targetRoot ? ` (racine h2a ${resolution.targetRoot})` : "";
	const alsoLive = resolution.ambiguous ? ` ${resolution.candidates.length} sessions live répondent pour ce dépôt (${resolution.candidates.map((c) => c.instance).join(", ")}) — si ce n'est pas la bonne, changez de destinataire et renvoyez.` : "";
	const message = recipientLive ? `${what} remis à la session live ${target}${where} — elle le verra à sa prochaine relève d’inbox.${alsoLive}` : `${what} déposé dans l’inbox de ${target}${where}, mais la session ne répond plus (présence périmée). Ce sera lu si elle reprend.${alsoLive}`;
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
export { POST };

//# sourceMappingURL=_server.ts.js.map