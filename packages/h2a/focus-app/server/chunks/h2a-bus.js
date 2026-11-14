import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
// src/lib/server/h2a-target.js
/** A real CLI host we can hand a decision to — not another agent/service posing as one. */
var CLI_HOST_PREFIX = /^(claude|codex|gemini|agy|hermes|opencode):/;
/**
* Presence states that can still receive. `h2a sessions` has ALREADY applied the 90s heartbeat TTL, so
* anything it returns is fresh; re-filtering on `state === 'live'` (as the previous code did) additionally
* discarded `opening` and `draining` sessions, which are legitimately reachable. Narrowing a protocol in a
* consumer is how a live agent becomes invisible to one caller and not another.
*/
var RECEIVING_STATES = /* @__PURE__ */ new Set([
	"live",
	"opening",
	"draining"
]);
/**
* @typedef {object} LiveSession
* @property {string} instance
* @property {string} [name]
* @property {string} [state]
* @property {string} [heartbeatAt]
* @property {{ path?: string, label?: string }} [workspace]
* @property {string} [root] The h2a root this presence was read from — see below. Carried, never assumed.
*/
/**
* @typedef {object} ResolveContext
* @property {string[]} repoPaths       Absolute paths this repo answers to (this checkout + its main worktree).
* @property {string[]} nameCandidates  Project names this repo answers to (basenames of the above).
* @property {string} [requested]       Instance explicitly chosen by the human in the UI.
* @property {string} [configured]      FOCUS_H2A_TARGET.
* @property {string} [emitter]         FOCUS_EMITTER_INSTANCE.
*/
/**
* The middle segment of `host:label:hash`.
*
* Be honest about what this is: it is the session's DISPLAY LABEL frozen at mint (the `--name`, else the
* host-native session title, else `basename(cwd)`) — NOT a project key. Four sessions in the same checkout
* are `claude:architect:…`, `claude:canevas:…`, `claude:llm-mesh:…`, `claude:sentropic:…`. Matching on it
* is therefore a last-resort heuristic for legacy presence records with no `workspace` block, never the
* primary key. Treating it as the project is what made the button undeliverable in the first place.
*/
function labelOfInstance(instance) {
	const parts = String(instance ?? "").split(":");
	return parts.length >= 2 ? parts[1] : "";
}
/** Receiving CLI sessions, freshest heartbeat first. Non-CLI and closed/expired rows never reach a caller. */
function liveCliSessions(sessions) {
	return (Array.isArray(sessions) ? sessions : []).filter((s) => s && RECEIVING_STATES.has(String(s.state))).filter((s) => CLI_HOST_PREFIX.test(s.instance ?? "")).sort((a, b) => String(b.heartbeatAt ?? "").localeCompare(String(a.heartbeatAt ?? "")));
}
/**
* @typedef {'requested'|'configured'|'emitter'|'workspace'|'name'|'sole'|'requested-not-live'|'configured-not-live'|'none'} ResolveReason
*/
/**
* @param {LiveSession[]} sessions
* @param {ResolveContext} ctx
* @returns {{
*   target: string | undefined,
*   targetSession: LiveSession | undefined,
*   targetRoot: string | undefined,
*   reason: ResolveReason,
*   live: LiveSession[],
*   candidates: LiveSession[],
*   ambiguous: boolean
* }}
*/
function chooseLiveTarget(sessions, ctx) {
	const live = liveCliSessions(sessions);
	const find = (id) => live.find((s) => s.instance === id);
	/**
	* @param {LiveSession[]} candidates
	* @param {ResolveReason} reason
	*/
	const pick = (candidates, reason) => ({
		target: candidates[0].instance,
		targetSession: candidates[0],
		targetRoot: candidates[0].root,
		reason,
		live,
		candidates,
		ambiguous: candidates.length > 1
	});
	/** @param {ResolveReason} reason */
	const none = (reason) => ({
		target: void 0,
		targetSession: void 0,
		targetRoot: void 0,
		reason,
		live,
		candidates: live,
		ambiguous: false
	});
	if (ctx.requested) {
		const found = find(ctx.requested);
		return found ? pick([found], "requested") : none("requested-not-live");
	}
	if (ctx.configured) {
		const found = find(ctx.configured);
		return found ? pick([found], "configured") : none("configured-not-live");
	}
	if (ctx.emitter) {
		const found = find(ctx.emitter);
		if (found) return pick([found], "emitter");
	}
	const repoPaths = new Set((ctx.repoPaths ?? []).filter(Boolean));
	const byWorkspace = live.filter((s) => s.workspace?.path && repoPaths.has(s.workspace.path));
	if (byWorkspace.length > 0) return pick(byWorkspace, "workspace");
	const names = new Set((ctx.nameCandidates ?? []).filter(Boolean));
	const byName = live.filter((s) => names.has(labelOfInstance(s.instance)) || s.name && names.has(s.name));
	if (byName.length > 0) return pick(byName, "name");
	if (live.length === 1) return pick([live[0]], "sole");
	return none("none");
}
/**
* What would make delivery work — because "no live session" tells the human nothing they can act on.
* Each branch names the concrete next move, and lists the sessions that ARE live so an operator can pin
* one instead of guessing why the button is dead.
*
* @param {ReturnType<typeof chooseLiveTarget>} resolution
* @param {{ binMissing?: boolean, binPath?: string, repoPaths: string[], nameCandidates: string[], requested?: string, configured?: string, roots?: string[] }} ctx
*/
function explainNoTarget(resolution, ctx) {
	if (ctx.binMissing) return `Le binaire h2a est introuvable (${ctx.binPath ?? "aucun chemin candidat"}) : le focus ne peut interroger aucun registre, donc aucune remise n'est possible — ce n'est pas « aucune session live ». Pour que ça marche : construisez le CLI (npm run build:h2a à la racine du dépôt) ou pointez FOCUS_H2A_BIN sur un binaire h2a déjà construit.`;
	const roots = ctx.roots?.length ? ` Racines h2a interrogées : ${ctx.roots.join(", ")}.` : "";
	const liveList = resolution.live.map((s) => `${s.instance}${s.workspace?.path ? ` (${s.workspace.path})` : ""}${s.root ? ` [racine ${s.root}]` : ""}`);
	const liveSummary = liveList.length ? `Sessions live actuellement visibles (${liveList.length}) : ${liveList.join(", ")}.${roots}` : `Aucune session h2a live n'est visible dans le registre, pour aucun projet.${roots}`;
	if (resolution.reason === "requested-not-live") return `La session choisie (${ctx.requested}) n'est plus live : rien n'a été remis, et surtout rien n'a été redirigé ailleurs sans vous le dire. ${liveSummary} Choisissez une session dans la liste, ou relancez celle-ci.`;
	if (resolution.reason === "configured-not-live") return `FOCUS_H2A_TARGET pointe sur ${ctx.configured}, qui n'est pas live : la cible épinglée par l'opérateur est respectée, jamais contournée en silence. ${liveSummary} Corrigez FOCUS_H2A_TARGET ou relancez cette session.`;
	return `Aucune session h2a live ne correspond à ce dépôt. ${liveSummary} La résolution se fait sur le CHEMIN du checkout (${ctx.repoPaths.join(", ")}) puis sur le nom de projet (${ctx.nameCandidates.join(", ")}) — jamais sur le nom du dossier servi, précisément pour qu'un worktree fonctionne. Pour que ça marche, au choix : ouvrez une CLI h2a sur ce dépôt ; servez le focus depuis h2a (il transmet alors FOCUS_EMITTER_INSTANCE) ; épinglez une session avec FOCUS_H2A_TARGET ; ou sélectionnez une session live dans la liste ci-dessus.`;
}
// src/lib/server/h2a-bus.ts
function repoRoot() {
	return process.env.FOCUS_REPO_ROOT ?? path.resolve(process.cwd(), "..", "..");
}
/**
* The MAIN checkout behind this directory. A git worktree's `--git-common-dir` points at the primary
* repository, so a Focus served from `…/scratchpad/dossier-fix-wt` still knows it belongs to
* `/workspace/repo` — which is exactly the `workspace.path` an h2a session registers.
* This is the link that makes delivery independent of what the served directory is called.
*/
function mainWorktreePath(root) {
	try {
		const out = execFileSync("git", [
			"rev-parse",
			"--path-format=absolute",
			"--git-common-dir"
		], {
			cwd: root,
			encoding: "utf8",
			stdio: [
				"ignore",
				"pipe",
				"ignore"
			]
		}).trim();
		if (!out) return void 0;
		return path.basename(out) === ".git" ? path.dirname(out) : void 0;
	} catch {
		return;
	}
}
/**
* Every path and name this repository legitimately answers to, deduplicated and order-stable.
*
* Paths are resolved through `realpath` because that is what a presence record stores
* (`workspace.path = realpathSync(cwd)`): comparing a symlinked path to a resolved one silently never
* matches, which is the same class of bug as comparing basenames, only harder to see.
*/
function repoIdentity(root) {
	const resolved = [root, mainWorktreePath(root)].filter((p) => Boolean(p)).flatMap((p) => {
		try {
			return [p, realpathSync(p)];
		} catch {
			return [p];
		}
	});
	const paths = [...new Set(resolved)];
	return {
		paths,
		names: [...new Set(paths.map((p) => path.basename(p)))]
	};
}
/**
* A usable h2a entrypoint, or `undefined`.
*
* Several layouts are legitimate (installed CLI, monorepo build, runtime package), and "no binary" is a
* DIFFERENT failure from "no live session": one means we could not ask the question, the other means we
* asked and the answer was nobody. Conflating them is how an unbuilt checkout gets reported as an empty
* bus. Callers therefore get `undefined` and say which one it was.
*/
function h2aBin(root) {
	const configured = process.env.FOCUS_H2A_BIN?.trim();
	if (configured) return existsSync(configured) ? configured : void 0;
	const candidates = [path.join(root, "packages", "h2a", "dist", "bin.js"), path.join(root, "node_modules", "@sentropic", "h2a", "dist", "bin.js")];
	const main = mainWorktreePath(root);
	if (main && main !== root) candidates.push(path.join(main, "packages", "h2a", "dist", "bin.js"));
	return candidates.find((c) => existsSync(c));
}
/** The candidate paths we looked at, for an error message that lets someone actually fix it. */
function h2aBinCandidates(root) {
	const configured = process.env.FOCUS_H2A_BIN?.trim();
	if (configured) return `FOCUS_H2A_BIN=${configured}`;
	const main = mainWorktreePath(root);
	return [path.join(root, "packages", "h2a", "dist", "bin.js"), main && main !== root ? path.join(main, "packages", "h2a", "dist", "bin.js") : null].filter(Boolean).join(", ");
}
/**
* The h2a roots to interrogate, in priority order.
*
* There is not one bus on a machine, there are as many as there are `--root` choices, and they do not see
* each other. This host runs two at once: the default `~/h2a-workspace/.h2a`, and the repo directory
* itself, used as a root by a session launched with `--root /workspace/repo`. A live
* `claude:a2a-cli:…` exists in EACH, both working in the same checkout.
*
* Querying only one of them is how an injection reports success while landing in a store the recipient
* never reads — the write happens, `recipientLive` is true, a wake even fires, and the human still sees
* nothing. `FOCUS_H2A_ROOT` pins a single root when an operator wants exactly one.
*/
function h2aRoots(root) {
	const pinned = process.env.FOCUS_H2A_ROOT?.trim();
	if (pinned) return existsSync(pinned) ? [pinned] : [];
	const identity = repoIdentity(root);
	const candidates = [
		process.env.H2A_ROOT?.trim(),
		path.join(homedir(), "h2a-workspace", ".h2a"),
		...identity.paths,
		...identity.paths.map((p) => path.join(p, ".h2a"))
	].filter((p) => Boolean(p));
	return [...new Set(candidates)].filter((p) => existsSync(path.join(p, "presence")) || existsSync(path.join(p, "registry")));
}
/**
* Every session the registries currently report, each TAGGED WITH THE ROOT it was found in.
*
* We use `h2a sessions` (not `h2a discover`): `discover` lists every registered instance including
* long-dead ones, so it would hand us a stale inbox nobody reads. `sessions` returns only sessions with a
* current presence (heartbeat within the TTL) AND the `workspace` block we resolve on.
*/
function liveSessions(root) {
	const bin = h2aBin(root);
	if (!bin) return [];
	const out = [];
	for (const h2aRoot of h2aRoots(root)) try {
		const stdout = execFileSync("node", [
			bin,
			"sessions",
			"--root",
			h2aRoot
		], {
			cwd: root,
			encoding: "utf8",
			maxBuffer: 67108864
		});
		const parsed = JSON.parse(stdout);
		const arr = Array.isArray(parsed) ? parsed : parsed.sessions ?? [];
		if (!Array.isArray(arr)) continue;
		for (const session of arr) out.push({
			...session,
			root: h2aRoot
		});
	} catch {
		continue;
	}
	return out;
}
/**
* The session that should receive what the human just decided. See `./h2a-target.js` for the ladder.
* When nothing resolves, `remedy` states what would make it work — reporting only the failure leaves the
* human with a button that does not work and no idea why.
*/
function resolveTarget(root, opts = {}) {
	const bin = h2aBin(root);
	const identity = repoIdentity(root);
	const sessions = bin ? liveSessions(root) : [];
	const requested = opts.requested?.trim() || void 0;
	const configured = process.env.FOCUS_H2A_TARGET?.trim() || void 0;
	const emitter = process.env.FOCUS_EMITTER_INSTANCE?.trim() || void 0;
	const resolution = chooseLiveTarget(sessions, {
		repoPaths: identity.paths,
		nameCandidates: identity.names,
		requested,
		configured,
		emitter
	});
	const roots = h2aRoots(root);
	const base = {
		target: resolution.target,
		targetRoot: resolution.targetRoot,
		reason: resolution.reason,
		live: resolution.live,
		candidates: resolution.candidates,
		ambiguous: resolution.ambiguous,
		roots,
		binMissing: !bin
	};
	if (resolution.target) return base;
	return {
		...base,
		remedy: explainNoTarget(resolution, {
			binMissing: !bin,
			binPath: h2aBinCandidates(root),
			repoPaths: identity.paths,
			nameCandidates: identity.names,
			requested,
			configured,
			roots
		})
	};
}
/**
* Deposit a plain envelope in a session's inbox via `h2a inbox put`, IN THE ROOT THAT SESSION READS.
*
* `targetRoot` is not optional decoration: without it the deposit goes to whatever root the CLI defaults
* to, which on a multi-root host is a store the recipient may never open. The delivery would still report
* success. Passing the root the presence was discovered in is what makes "delivered" mean "readable".
*/
function putEnvelope(root, target, envelope, targetRoot) {
	const bin = h2aBin(root);
	if (!bin) throw new Error(`h2a introuvable (${h2aBinCandidates(root)})`);
	const out = execFileSync("node", [
		bin,
		"inbox",
		"put",
		"--instance",
		target,
		...targetRoot ? ["--root", targetRoot] : [],
		"--json",
		JSON.stringify(envelope)
	], {
		cwd: root,
		encoding: "utf8"
	});
	try {
		return { recipientLive: Boolean(JSON.parse(out).recipientLive) };
	} catch {
		return { recipientLive: false };
	}
}
export { resolveTarget as i, repoIdentity as n, repoRoot as r, putEnvelope as t };

//# sourceMappingURL=h2a-bus.js.map