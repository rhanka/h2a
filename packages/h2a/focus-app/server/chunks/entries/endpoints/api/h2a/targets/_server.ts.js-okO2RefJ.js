import { j as json } from '../../../../../chunks/utils.js-C_3_iViC.js';
import { a as repoRoot, r as resolveTarget, b as repoIdentity } from '../../../../../chunks/h2a-bus.js-4eIbfmJH.js';
import '../../../../../chunks/utils2.js-BQzn9ikS.js';
import 'node:child_process';
import 'node:fs';
import 'node:os';
import 'node:path';

const GET = async () => {
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

export { GET };
//# sourceMappingURL=_server.ts.js-okO2RefJ.js.map
