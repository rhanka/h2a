import type { PageServerLoad } from './$types';
import { loadAgentMemoryAnswerSet } from '$lib/server/agent-memory-answers';
import { loadAgentMemoryDossier, loadAgentMemoryMatrix } from '$lib/server/agent-memory-dossier';
import { resolveTarget, repoRoot } from '$lib/server/h2a-bus';

export const load: PageServerLoad = () => {
  // Resolved at load so the injection path can render with a real recipient instead of discovering at
  // click time that it has none. Cheap (one registry read) and it is what makes h2a the DEFAULT export
  // path rather than a button one tries and abandons.
  const resolution = resolveTarget(repoRoot());

  return {
    dossier: loadAgentMemoryDossier(),
    matrix: loadAgentMemoryMatrix(),
    // The committed answer set: the DEFAULT source of truth for this page, not an opt-in replay. `null`
    // when the file is unreachable — the page then says so rather than showing an empty dossier as if the
    // owner had never answered.
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
