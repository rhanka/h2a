// GET /api/h2a/targets — who is live right now, and who would receive an injection by default.
//
// Exists so the injection path can offer a RESOLVABLE choice instead of a guess. The old failure mode was
// a button that inferred its recipient from the served directory's basename and, when that inference
// missed, reported "no live session" — indistinguishable, from the outside, from an empty bus. Listing
// what the registry actually holds turns that dead end into a decision the human can make.
//
// Read-only: it resolves and reports, it never deposits anything.
//
// Response 200 : { ok:true, target?, reason, binMissing, remedy?, live: [{instance,name,workspace,default}] }

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { repoIdentity, repoRoot, resolveTarget } from '$lib/server/h2a-bus';

export const GET: RequestHandler = async () => {
  const root = repoRoot();
  const resolution = resolveTarget(root);
  const identity = repoIdentity(root);

  return json({
    ok: true,
    target: resolution.target ?? null,
    targetRoot: resolution.targetRoot ?? null,
    reason: resolution.reason,
    ambiguous: resolution.ambiguous,
    // The roots searched: a machine can run several h2a buses that do not see each other, and a recipient
    // is only addressable together with the root it reads.
    roots: resolution.roots,
    binMissing: resolution.binMissing,
    remedy: resolution.remedy ?? null,
    // The repo's own identity, so a human debugging "why does it not find my session" can see what we
    // matched ON rather than having to read the source.
    repo: { paths: identity.paths, names: identity.names },
    live: resolution.live.map((s) => ({
      instance: s.instance,
      name: s.name ?? null,
      workspace: s.workspace?.path ?? null,
      root: s.root ?? null,
      heartbeatAt: s.heartbeatAt ?? null,
      // Whether this session matched THIS repo, as opposed to merely being alive somewhere else.
      matchesRepo: resolution.candidates.some((c) => c.instance === s.instance),
      default: s.instance === resolution.target
    }))
  });
};
