import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { privateDirectory, readState, publishState, replaceState } from './state.js';

const held = new Set();
const execution = new AsyncLocalStorage();

// Linux OFD flock: inherited fd 3 shares the parent's open description. The
// kernel releases the exclusion on crash. No PID scan or stale-file deletion.
// util-linux flock is a profile prerequisite; refusal has no PID-lock fallback.
export function mutationLock(directory, fn) {
  privateDirectory(directory);
  const path = join(directory, '.mutation.lock');
  if (held.has(path)) return fn();
  const fd = fs.openSync(path, fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600);
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600) throw new Error('private_lock_required');
    const tool = fs.statSync('/usr/bin/flock');
    // System files can be UID-mapped to nobody inside the lab. Require that
    // this UID cannot replace the executable through its file or directory.
    const parent = fs.statSync('/usr/bin');
    if (tool.uid === process.getuid() || parent.uid === process.getuid() ||
        (tool.mode & 0o022) || (parent.mode & 0o022)) throw new Error('mutation_lock_unqualified');
    const result = spawnSync('/usr/bin/flock', ['--exclusive', '--timeout', '5', '3'],
      { stdio: ['ignore', 'pipe', 'pipe', fd], env: {} });
    if (result.status !== 0) throw new Error('mutation_lock_unavailable', { cause: result.error });
    held.add(path);
    const value = fn();
    if (value?.then) throw new Error('async_store_critical_section');
    return value;
  } finally { held.delete(path); fs.closeSync(fd); }
}

export function withExecution(authority, fn) { return execution.run(authority, fn); }
export function currentExecution() { return execution.getStore(); }
export function writerDirectory(root) { return join(resolve(root), '.h2a-writer-control'); }
export function readWriterGate(directory) { return readState(join(directory, 'control.json'), 'writerControl')?.value.gate; }

export function establishWriterControl(root, stateDirectory) {
  const directory = writerDirectory(root);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return mutationLock(directory, () => {
    const path = join(directory, 'control.json');
    const prior = readState(path, 'writerControl');
    if (prior) {
      if (prior.value.root !== resolve(root) || prior.value.stateDirectory !== resolve(stateDirectory)) throw new Error('store_authority_mismatch');
      return prior.value;
    }
    return publishState(path, { schemaVersion: 1, revision: 1, root: resolve(root), stateDirectory: resolve(stateDirectory),
      gate: 'OPEN', handoverId: null, restriction: 'store_writer_set_unknown', closureEvidenceDigest: null }, 'writerControl').value;
  });
}

export function updateWriterControl(root, changes) {
  const directory = writerDirectory(root);
  return mutationLock(directory, () => {
    const path = join(directory, 'control.json'), old = readState(path, 'writerControl');
    if (!old) throw new Error('store_writer_set_unknown');
    return replaceState(path, { ...old.value, ...changes, revision: old.value.revision + 1 }, 'writerControl', old).value;
  });
}

// The same lock guards gate changes and business writes. Operation rights are
// distinct from attachment rights; admitted work can finish under a barrier.
export function withWriterMutation(root, domain, fn) {
  const directory = writerDirectory(root);
  if (!fs.existsSync(directory)) return fn(); // Legacy/unmanaged normal operation, never proof of continuity.
  return mutationLock(directory, () => {
    const control = readState(join(directory, 'control.json'), 'writerControl')?.value;
    if (!control || control.root !== resolve(root)) throw new Error('store_writer_set_unknown');
    const authority = execution.getStore();
    if (authority?.root === resolve(root)) {
      if (domain !== 'presence' && authority.operation) authority.ledger.assertOperation(authority.operation);
      else {
        authority.registry.assertOwner(authority.token, authority.cleanup ? ['ACTIVE', 'FROZEN'] : ['ACTIVE']);
        if (control.gate !== 'OPEN' && !authority.cleanup) throw new Error('store_admission_closed');
      }
    } else if (control.gate !== 'OPEN') throw new Error('store_admission_closed');
    return fn();
  });
}

/** Presence ownership is per target, not merely per process or store root. */
export function withPresenceMutation(root, sessionId, instance, fn) {
  return withWriterMutation(root, 'presence', () => {
    // Existing-row identity must be read after taking the writer lock.
    if (typeof instance === 'function') instance = instance();
    const authority = execution.getStore();
    if (authority?.root === resolve(root)) {
      const owner = authority.registry.assertOwner(authority.token, authority.cleanup ? ['ACTIVE', 'FROZEN'] : ['ACTIVE']).value;
      if (owner.presenceSessionId.startsWith('pending:') && instance) {
        if (owner.expectedInstance !== 'identity_disabled' && owner.expectedInstance !== instance) throw new Error('presence_ownership_mismatch');
        authority.registry.updateIdentity(authority.token, sessionId, instance);
      } else if (owner.presenceSessionId !== sessionId || (instance && owner.expectedInstance !== instance)) throw new Error('presence_ownership_mismatch');
    }
    return fn();
  });
}
