// Pack warm-up: produce the shared release candidates ahead of the suites
// that qualify the packed tree.
//
// WHY. The packed-tree suites (registry-packed-layout,
// registry-plugin-declarations, candidate-artifacts) run in the rest bucket,
// but the candidate pack (~250 s wall on a contended CI runner) fits inside
// the earlier native-bucket window doing nothing. run-tests.mjs spawns this
// script fire-and-forget before the Node buckets; consumers observe the
// result through helpers/shared-pack-candidates.mjs and wait on its lock
// only if the pack is still in flight. A warmer failure never fails the run:
// every consumer falls back to a private pack, exactly as before sharing.
import { sharedPackCandidates } from '../packages/h2a/test/helpers/shared-pack-candidates.mjs';

try {
  const dir = await sharedPackCandidates();
  if (dir === null) process.stderr.write('warm-pack-candidates: sharing unavailable; suites pack privately\n');
  else process.stderr.write(`warm-pack-candidates: candidates ready at ${dir}\n`);
} catch (error) {
  process.stderr.write(`warm-pack-candidates: ${(error && error.stack) || error}\n`);
  process.exitCode = 1;
}
