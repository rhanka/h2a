import type { PageServerLoad } from "./$types";
import { loadSessionSafetyDossier } from "$lib/server/session-safety-dossier";
import { repoIdentity, repoRoot, resolveTarget } from "$lib/server/h2a-bus";

export const load: PageServerLoad = () => {
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
          (candidate) => candidate.instance === session.instance,
        ),
        default: session.instance === resolution.target,
      })),
    },
  };
};
