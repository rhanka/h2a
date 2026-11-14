import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
// src/lib/server/report-view.ts
/**
* Read the append-only track log and record, per item, the date of its most recent `realization.transition`
* to `done`. That is the item's "réalisé le" date — used to show WHEN a fact happened and to order the FAIT
* list by recency (the report itself carries no timestamp).
*/
function doneDates(eventsPath) {
	const out = {};
	let raw;
	try {
		raw = readFileSync(eventsPath, "utf8");
	} catch {
		return out;
	}
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try {
			const e = JSON.parse(line);
			if (e.type === "realization.transition" && e.payload?.to === "done" && e.aggregateId && e.at) {
				if (!out[e.aggregateId] || e.at > out[e.aggregateId]) out[e.aggregateId] = e.at;
			}
		} catch {}
	}
	return out;
}
/**
* The repo whose track log we read. Defaults to two levels up from the app cwd (apps/focus → repo root),
* overridable via FOCUS_REPO_ROOT (e.g. when this app is served by h2a against another checkout).
*/
function repoRoot() {
	return process.env.FOCUS_REPO_ROOT ?? path.resolve(process.cwd(), "..", "..");
}
var cached;
var INSTALLED_TRACK_PACKAGE = "@sentropic/track";
function compatibleTrack(mod, source) {
	const candidate = mod;
	if (typeof candidate.TrackReader !== "function" || typeof candidate.formatWpConductor !== "function") throw new Error(`track runtime incompatible (${source}): TrackReader or formatWpConductor is missing.`);
	return candidate;
}
async function loadTrack(root) {
	if (cached) return cached;
	const dist = path.join(root, "packages", "track", "dist", "index.js");
	if (existsSync(dist)) {
		cached = compatibleTrack(await import(
			/* @vite-ignore */
			pathToFileURL(dist).href
), dist);
		return cached;
	}
	try {
		cached = compatibleTrack(await import(
			/* @vite-ignore */
			INSTALLED_TRACK_PACKAGE
), INSTALLED_TRACK_PACKAGE);
		return cached;
	} catch (err) {
		throw new Error(`track runtime introuvable: ni build monorepo (${dist}) ni package @sentropic/track installé (${err instanceof Error ? err.message : String(err)}).`);
	}
}
function baselineCommit(root) {
	try {
		return execSync("git rev-parse HEAD", {
			cwd: root,
			stdio: [
				"ignore",
				"pipe",
				"ignore"
			]
		}).toString().trim();
	} catch {
		return "HEAD";
	}
}
/**
* ISO date of the LAST release, for the "dernière période de dev" filter (what was delivered since we last
* cut a version). Releases are tagged as `release: vX.Y.Z` commits — we read the committer date of the most
* recent one. Undefined if the repo has no such commit (e.g. a fresh checkout).
*/
function lastReleaseAt(root) {
	try {
		return execSync("git log -1 --format=%cI --grep='^release: v'", {
			cwd: root,
			stdio: [
				"ignore",
				"pipe",
				"ignore"
			]
		}).toString().trim() || void 0;
	} catch {
		return;
	}
}
/** Build the full report payload from the live track log, or a structured error the UI can render. */
async function loadReport() {
	try {
		const root = repoRoot();
		const eventsPath = process.env.FOCUS_TRACK_EVENTS ?? path.join(root, ".track", "events.jsonl");
		if (!existsSync(eventsPath)) return {
			ok: false,
			error: `Journal track introuvable (${eventsPath}).`
		};
		const track = await loadTrack(root);
		const commit = baselineCommit(root);
		const report = new track.TrackReader(eventsPath).report({
			baselineCommit: commit,
			decisions: true,
			wpTree: true
		});
		const viewJson = track.formatWpConductor(report.wpTree ?? [], "json", report.decisions ?? []);
		const view = JSON.parse(viewJson);
		return {
			ok: true,
			repo: path.basename(root),
			baselineCommit: commit,
			generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			buckets: report.buckets,
			view,
			dates: doneDates(eventsPath),
			lastReleaseAt: lastReleaseAt(root)
		};
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}
// ../../packages/track/dist/report/friendly.js
/**
* Whitespace-normalize a free-text string (collapse control/space runs to one space, trim). PURE.
* This is normalization, NOT format-escaping — each renderer still owns its escaping (§6).
*/
function cleanText(s) {
	return s.replace(/\s+/g, " ").trim();
}
var RANK_BADGE = {
	P1_GATE: {
		label: "Prioritaire",
		tone: "critical"
	},
	P2_ACCEPTANCE: {
		label: "À revérifier",
		tone: "warning"
	},
	P3_IN_PROGRESS: {
		label: "En cours",
		tone: "info"
	},
	P4_TODO_WSJF: {
		label: "À planifier",
		tone: "neutral"
	},
	P5_FALLBACK: {
		label: "À examiner",
		tone: "neutral"
	}
};
/** A machine `rank` → a friendly human badge (label + semantic tone). Unknown ⇒ neutral "À examiner". */
function rankBadgeFr(rank) {
	return RANK_BADGE[rank] ?? {
		label: "À examiner",
		tone: "neutral"
	};
}
var GATE_PHRASE = {
	"decision-pending": "En attente d’une décision",
	"engagement-pending": "En attente d’un partenaire (h2a)",
	"external-dependency": "Bloqué par une dépendance externe",
	"linked-dependency": "Bloqué par une autre tâche",
	"manual-blocker": "Bloqué manuellement",
	"spec-not-ready": "À spécifier avant de démarrer",
	"acceptance-failed": "Vérification en échec",
	"acceptance-stale": "Vérification à refaire",
	"priority-missing": "Priorité à définir"
};
/**
* A machine `gate` → a clear French sentence. When the gate NAMES what blocks it (`blockedByTitle`), that
* human detail is appended (`… : « <title> »`). Unknown gate code ⇒ "À examiner". Absent gate ⇒ undefined.
*/
function gatePhraseFr(gate) {
	if (!gate) return void 0;
	const phrase = GATE_PHRASE[gate.code] ?? "À examiner";
	if (gate.blockedByTitle && gate.blockedByTitle.trim() !== "") return `${phrase} : « ${cleanText(gate.blockedByTitle)} »`;
	return phrase;
}
var STEP_ACTION = {
	"focus-decision": "Instruire le dossier puis trancher",
	"settle-decision": "Trancher la décision",
	"resume-engagement": "Relancer le partenaire puis intégrer le retour",
	"resolve-external-blocker": "Lever le blocage puis reprendre",
	"amend-spec": "Rédiger la spécification",
	"fix-acceptance": "Corriger puis relancer la vérification",
	"rerun-acceptance": "Relancer la vérification sur le commit courant",
	"finish-increment": "Terminer l’incrément en cours",
	"start-increment": "Démarrer l’incrément (preuve + vérification)",
	"prioritize-backlog": "Prioriser le backlog",
	"inspect-fallback": "Inspecter l’état puis décider la suite"
};
/**
* A machine `step.code` → the concrete next action, phrased for a human. An UNKNOWN step.code (a future
* governed vocabulary entry this build predates) degrades to the `inspect-fallback` phrasing — forward-compat.
*/
function stepActionFr(step) {
	return STEP_ACTION[step] ?? "Inspecter l’état puis décider la suite";
}
/** A machine `mode` (the ROUTAGE / executor) → who should act, in plain French. */
function modeActorFr(mode) {
	switch (mode) {
		case "human-decision": return "Vous (décision)";
		case "h2a-engagement": return "Partenaire h2a";
		case "subagent": return "Sous-agent";
		case "local": return "Local";
		default: return "À affecter";
	}
}
/** `adviceKind` → the nature of the item, in one friendly word. */
function adviceNatureFr(kind) {
	return kind === "judgment-required" ? "Décision" : "Action";
}
var KIND_FR = {
	feature: "Fonctionnalité",
	bug: "Correctif",
	chore: "Tâche"
};
/** A machine item `kind` → a friendly French label (unknown kinds pass through verbatim). */
function kindFr(k) {
	return KIND_FR[k] ?? k;
}
var SUBJECT_MAX = 90;
/** A short subject: the item title, whitespace-normalized, capped with an ellipsis (never a silent cut). */
function subjectOf(d) {
	const t = cleanText(d.target.title ?? d.target.id);
	return t.length > SUBJECT_MAX ? t.slice(0, 88) + "…" : t;
}
/**
* Is this directive LAUNCHABLE by a sub-agent? Only `subagent`/`local` directives can be dispatched; a
* `human-decision` needs a human and an `h2a-engagement` needs a peer, so those are shown but not checkable.
*/
function isLaunchable(d) {
	return d.mode === "subagent" || d.mode === "local";
}
function todoRowFr(d) {
	const gate = gatePhraseFr(d.gate);
	return {
		id: d.id,
		subject: subjectOf(d),
		action: stepActionFr(d.step.code),
		actor: modeActorFr(d.mode),
		nature: adviceNatureFr(d.adviceKind),
		badge: rankBadgeFr(d.rank),
		...gate !== void 0 ? { gate } : {},
		launchable: isLaunchable(d),
		...d.scope.wpLabel !== void 0 ? { wp: d.scope.wpLabel } : {},
		...d.facts.fanIn !== void 0 ? { fanIn: d.facts.fanIn } : {},
		...d.facts.wsjf !== void 0 ? { wsjf: d.facts.wsjf } : {}
	};
}
function precoRowFr(d) {
	const gate = gatePhraseFr(d.gate);
	const lever = d.facts.fanIn !== void 0 && d.facts.fanIn > 0 ? `Débloque ${d.facts.fanIn} autre(s) tâche(s)` : gate ?? (d.mode === "human-decision" ? "Décision en attente" : "Fait avancer le WP concerné");
	return {
		id: d.id,
		title: subjectOf(d),
		why: lever,
		action: stepActionFr(d.step.code),
		actor: modeActorFr(d.mode),
		badge: rankBadgeFr(d.rank),
		launchable: isLaunchable(d)
	};
}
/** A workspace id (`ws:89c4…`) → a short, human-glanceable form. PURE. */
function shortWorkspace(ws) {
	if (!ws) return void 0;
	const body = ws.startsWith("ws:") ? ws.slice(3) : ws;
	return body.length > 10 ? `ws:${body.slice(0, 8)}…` : ws;
}
function decisionRowFr(d, repo) {
	const concerns = subjectOf(d);
	const wp = d.scope.wpLabel;
	const why = gatePhraseFr(d.gate) ?? "Décision d’orientation à trancher";
	const ws = shortWorkspace(d.target.workspace);
	return {
		id: d.id,
		question: d.gate?.blockedByTitle ? cleanText(d.gate.blockedByTitle) : concerns,
		concerns,
		action: stepActionFr(d.step.code),
		actor: modeActorFr(d.mode),
		project: repo,
		...ws !== void 0 ? { workspace: ws } : {},
		...wp !== void 0 ? { wp } : {},
		summary: `Concerne « ${concerns} »${wp ? ` · ${wp}` : ""} — ${why}.`
	};
}
export { modeActorFr as a, subjectOf as c, kindFr as i, todoRowFr as l, decisionRowFr as n, precoRowFr as o, isLaunchable as r, stepActionFr as s, cleanText as t, loadReport as u };

//# sourceMappingURL=friendly.js.map