// Observe real kernel-lock acquisitions, including the reentrancy fast path's
// absence of flock. This is test telemetry, never a replacement for the lock.
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { MUTATION_FLOCK_TOOLS } from '../../dist/runtime/handover/mutation.js';

let acquired = 0;
const spawnSync = cp.spawnSync;
cp.spawnSync = function (command, args, options) {
  const result = spawnSync.call(this, command, args, options);
  if (MUTATION_FLOCK_TOOLS.includes(command) && args?.[0] === '--exclusive' && result.status === 0) acquired++;
  return result;
};
syncBuiltinESMExports();
export const lockAcquisitions = () => acquired;
