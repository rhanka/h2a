import { r as json } from "../../../../../chunks/exports.js";
import { i as resolveTarget, n as repoIdentity, r as repoRoot } from "../../../../../chunks/h2a-bus.js";
// src/routes/api/h2a/targets/+server.ts
var GET = async () => {
	const root = repoRoot();
	const resolution = resolveTarget(root);
	const identity = repoIdentity(root);
	return json({
		ok: true,
		target: resolution.target ?? null,
		targetRoot: resolution.targetRoot ?? null,
		reason: resolution.reason,
		ambiguous: resolution.ambiguous,
		roots: resolution.roots,
		binMissing: resolution.binMissing,
		remedy: resolution.remedy ?? null,
		repo: {
			paths: identity.paths,
			names: identity.names
		},
		live: resolution.live.map((s) => ({
			instance: s.instance,
			name: s.name ?? null,
			workspace: s.workspace?.path ?? null,
			root: s.root ?? null,
			heartbeatAt: s.heartbeatAt ?? null,
			matchesRepo: resolution.candidates.some((c) => c.instance === s.instance),
			default: s.instance === resolution.target
		}))
	});
};
export { GET };

//# sourceMappingURL=_server.ts.js.map