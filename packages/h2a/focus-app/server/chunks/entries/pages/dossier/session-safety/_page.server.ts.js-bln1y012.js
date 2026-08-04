import { l as loadSessionSafetyDossier } from '../../../../chunks/session-safety-dossier.js-6ZQVWsPu.js';
import { a as repoRoot, r as resolveTarget, b as repoIdentity } from '../../../../chunks/h2a-bus.js-4eIbfmJH.js';

const load = () => {
  const root = repoRoot();
  const resolution = resolveTarget(root);
  const identity = repoIdentity(root);
  return {
    dossier: loadSessionSafetyDossier(),
    h2a: {
      target: resolution.target ?? null,
      targetRoot: resolution.targetRoot ?? null,
      reason: resolution.reason,
      ambiguous: resolution.ambiguous,
      roots: resolution.roots,
      remedy: resolution.remedy ?? null,
      repo: { paths: identity.paths, names: identity.names },
      live: resolution.live.map((session) => ({
        instance: session.instance,
        name: session.name ?? null,
        workspace: session.workspace?.path ?? null,
        root: session.root ?? null,
        heartbeatAt: session.heartbeatAt ?? null,
        matchesRepo: resolution.candidates.some(
          (candidate) => candidate.instance === session.instance
        ),
        default: session.instance === resolution.target
      }))
    }
  };
};

var _page_server_ts = /*#__PURE__*/Object.freeze({
  __proto__: null,
  load: load
});

export { _page_server_ts as _ };
//# sourceMappingURL=_page.server.ts.js-bln1y012.js.map
