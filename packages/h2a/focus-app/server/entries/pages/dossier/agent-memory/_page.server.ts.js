import { i as resolveTarget, r as repoRoot } from "../../../../chunks/h2a-bus.js";
import { a as loadAgentMemoryMatrix, i as loadAgentMemoryDossier } from "../../../../chunks/agent-memory-dossier.js";
import { readFileSync } from "node:fs";
import path from "node:path";
// src/lib/server/agent-memory-answers.ts
var ANSWERS_PATH = path.join("docs", "decisions", "2026-07-25-agent-memory-owner-answers.json");
function asString(value) {
	return typeof value === "string" && value.length > 0 ? value : null;
}
/**
* Parse defensively: a malformed or hand-edited answer file must degrade to "replay unavailable",
* never to a half-applied replay that quietly loses part of the reasoning.
*/
function parseAnswerSet(raw, source) {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
	const record = parsed;
	const dossier = asString(record.dossier);
	const revision = asString(record.revision);
	if (!dossier || !revision) return null;
	const rawAnswers = record.answers;
	if (!rawAnswers || typeof rawAnswers !== "object" || Array.isArray(rawAnswers)) return null;
	const answers = {};
	for (const [key, value] of Object.entries(rawAnswers)) {
		if (!value || typeof value !== "object" || Array.isArray(value)) continue;
		const entry = value;
		answers[key] = {
			option: asString(entry.option),
			note: typeof entry.note === "string" ? entry.note : ""
		};
	}
	return {
		source,
		dossier,
		revision,
		capturedAt: asString(record.capturedAt),
		capturedFrom: asString(record.capturedFrom),
		status: asString(record.status),
		answers
	};
}
function loadAgentMemoryAnswerSet() {
	const file = path.join(repoRoot(), ANSWERS_PATH);
	let raw;
	try {
		raw = readFileSync(file, "utf8");
	} catch {
		return null;
	}
	return parseAnswerSet(raw, ANSWERS_PATH);
}
// src/routes/dossier/agent-memory/+page.server.ts
var load = () => {
	const resolution = resolveTarget(repoRoot());
	return {
		dossier: loadAgentMemoryDossier(),
		matrix: loadAgentMemoryMatrix(),
		answerSet: loadAgentMemoryAnswerSet(),
		h2a: {
			target: resolution.target ?? null,
			targetRoot: resolution.targetRoot ?? null,
			reason: resolution.reason,
			ambiguous: resolution.ambiguous,
			roots: resolution.roots,
			binMissing: resolution.binMissing,
			remedy: resolution.remedy ?? null,
			live: resolution.live.map((s) => ({
				instance: s.instance,
				name: s.name ?? null,
				workspace: s.workspace?.path ?? null,
				root: s.root ?? null,
				matchesRepo: resolution.candidates.some((c) => c.instance === s.instance)
			}))
		}
	};
};
export { load };

//# sourceMappingURL=_page.server.ts.js.map