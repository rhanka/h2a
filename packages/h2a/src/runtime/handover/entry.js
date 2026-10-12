import { lstatSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
