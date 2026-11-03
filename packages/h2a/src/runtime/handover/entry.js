import { lstatSync, readlinkSync, realpathSync, statSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { digest } from './wire.js';

// Conservative BX primitive. MH-L6 decides acceptable router chains after QF.
export function observeEntry(link, expectedLauncher) {
  const info = lstatSync(link);
  if (!info.isSymbolicLink()) throw new Error('external_install_detected');
  const target = realpathSync(resolve(dirname(link), readlinkSync(link)));
  if (target !== realpathSync(expectedLauncher)) throw new Error('external_install_detected');
  const loaded = statSync(target);
  if (!loaded.isFile()) throw new Error('external_install_detected');
  return { dev: info.dev, ino: info.ino, target, targetDev: loaded.dev, targetIno: loaded.ino };
}

export function captureManagedEntry(installation) {
  const link = join(installation.canonicalPrefix, 'bin', 'h2a');
  const target = realpathSync(link);
  const allowed = [join(installation.managedRoot, 'launcher', 'h2a.mjs'),
    join(installation.canonicalPrefix, 'lib', 'node_modules', '@sentropic', 'h2a', 'dist', 'bin.js')];
  if (!allowed.includes(target)) throw new Error('external_install_detected');
  return { ...observeEntry(link, target), contentDigest: createHash('sha256').update(readFileSync(target)).digest('hex') };
}
export function checkManagedEntry(installation, expected, phase) {
  if (!['prepare', 'barrier', 'commit-stop'].includes(phase)) throw new Error('unknown_entry_check_phase');
  if (digest(captureManagedEntry(installation)) !== digest(expected)) throw new Error('external_install_detected');
}
export function checkEntry(link, expected, phase) {
  if (!['prepare', 'barrier', 'commit-stop'].includes(phase)) throw new Error('unknown_entry_check_phase');
  try {
    const current = observeEntry(link, expected.target);
    if (digest(current) !== digest(expected)) throw new Error('external_install_detected');
    return { allowed: true, phase, reason: null };
  } catch {
    return { allowed: false, phase, reason: 'external_install_detected' };
  }
}
