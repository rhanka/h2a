import fs from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { acquirePrefixLock } from '../local-files/succession-lock.js';
import { readState } from '../handover/state.js';

// Explicit exit from management (§8.7): under the compatible lock, refuse
// while a transaction is engaged or the journal is unsafe, restore the
// recorded original npm link when its target exists, keep images and pins
// of live processes, and mark management disabled (opt-out until a manual
// adoption) without replacing any package or stopping any service.
const QUIESCENT = new Set(['SELECTED', 'COMPLETED', 'ABORTED']);
const TXNAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/;

function syncDirectory(path) {
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export function unmanageInstallation(envelope = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('unmanage_install_invalid');
  const { store, commandPath, originalTarget, managedDir } = envelope;
  if (!store || typeof store.begin !== 'function' || !store.installation || !store.transactions ||
    typeof commandPath !== 'string' || !isAbsolute(commandPath) ||
    typeof originalTarget !== 'string' || !isAbsolute(originalTarget) ||
    typeof managedDir !== 'string' || !isAbsolute(managedDir)) {
    throw new Error('unmanage_install_invalid');
  }
  let parent;
  try {
    parent = dirname(commandPath);
    if (!fs.lstatSync(parent).isDirectory() || !fs.lstatSync(managedDir).isDirectory()) throw new Error('unusable');
  } catch { throw new Error('unmanage_install_invalid'); }
  const lease = acquirePrefixLock(store.installation.canonicalPrefix);
  if (!lease.acquired) throw new Error(`unmanage_lock_unavailable:${lease.reason}`);
  try {
    for (const name of fs.readdirSync(store.transactions).sort()) {
      if (!TXNAME.test(name)) throw new Error('unmanage_journal_unsafe');
      let tx;
      try { tx = readState(join(store.transactions, name), 'upgradeTransaction')?.value; } catch { throw new Error('unmanage_journal_unsafe'); }
      if (!tx || typeof tx.installationState !== 'string') throw new Error('unmanage_journal_unsafe');
      if (!QUIESCENT.has(tx.installationState)) throw new Error(`unmanage_transaction_engaged:${tx.installationState}`);
    }
    try { fs.statSync(originalTarget); } catch { throw new Error('unmanage_link_unrestorable'); }
    const tmp = join(parent, `.h2a-command-${process.pid}.tmp`);
    try { fs.unlinkSync(tmp); } catch {}
    fs.symlinkSync(originalTarget, tmp);
    fs.renameSync(tmp, commandPath);
    syncDirectory(parent);
    if (fs.readlinkSync(commandPath) !== originalTarget) throw new Error('unmanage_link_unverified');
    const marker = { schemaVersion: 1, reason: 'operator_unmanage', restoredCommand: commandPath,
      originalTarget, unmanagedAt: Date.now() };
    const markerTmp = join(managedDir, '.unmanaged.json.tmp');
    try { fs.unlinkSync(markerTmp); } catch {}
    fs.writeFileSync(markerTmp, JSON.stringify(marker));
    const markerFd = fs.openSync(markerTmp, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(markerFd); } finally { fs.closeSync(markerFd); }
    fs.renameSync(markerTmp, join(managedDir, 'unmanaged.json'));
    syncDirectory(managedDir);
    return Object.freeze({ restored: true, commandPath, originalTarget });
  } finally { lease.release(); }
}
