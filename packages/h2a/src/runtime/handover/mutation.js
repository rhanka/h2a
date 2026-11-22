import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { privateDirectory, readState, publishState, replaceState } from './state.js';

const lockOwnership = new AsyncLocalStorage();
const execution = new AsyncLocalStorage();
const localQueues = new Map();

export class MutationLockUnavailableError extends Error {
  /** @param {{ status?: number | null, signal?: NodeJS.Signals | null, error?: unknown }} [result] */
  constructor(result = {}) {
    super('mutation_lock_unavailable', { cause: result?.error });
    this.name = 'MutationLockUnavailableError';
    this.code = 'mutation_lock_unavailable';
    this.status = result?.status ?? null;
    this.signal = result?.signal ?? null;
  }
}

export function withoutLockOwnership(fn) {
  return lockOwnership.run(undefined, fn);
}

// Linux OFD flock: inherited fd 3 shares the parent's open description. The
// kernel releases the exclusion on crash. No PID scan or stale-file deletion.
// The flock binary is resolved from a fixed allow-list of trusted absolute
// system paths, never from PATH. util-linux flock is a profile prerequisite;
// refusal has no PID-lock fallback.
export const MUTATION_FLOCK_TOOLS = Object.freeze(['/usr/bin/flock', '/bin/flock']);

function isQualifiedFlockTool(candidate) {
  let tool, parent;
  try {
    tool = fs.statSync(candidate);
    parent = fs.statSync(dirname(candidate));
  } catch {
    return false;
  }
  // System files can be UID-mapped to nobody inside the lab. Require that
  // this UID cannot replace the executable through its file or directory.
  return tool.uid !== process.getuid() && parent.uid !== process.getuid() &&
    !(tool.mode & 0o022) && !(parent.mode & 0o022);
}

export function resolveMutationFlock(candidates = MUTATION_FLOCK_TOOLS) {
  for (const candidate of candidates) {
    if (isQualifiedFlockTool(candidate)) return candidate;
  }
  throw new Error(`mutation_lock_unqualified: no qualified util-linux flock at ${[...candidates].join(', ') || 'no candidates'}; install util-linux and ensure the flock binary and its directory are owned by root and not writable by this UID, group, or others. flock is never resolved from PATH and there is no PID-file fallback by design.`);
}

function assertLockOrder(directory, lockFile) {
  if (lockFile !== '.mutation.lock') return;
  const store = lockOwnership.getStore();
  if (!store) return;
  const mutationPath = join(directory, '.mutation.lock');
  const presencePath = join(directory, '.presence.lock');
  if (store.has(presencePath) && !store.has(mutationPath)) {
    throw new Error('lock_order_violation');
  }
}

function openPrivateLockFd(lockPath) {
  const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600);
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600) {
      throw new Error('private_lock_required');
    }
    return fd;
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

export function mutationLock(directory, fn, options = {}) {
  const { timeoutMs = 5000, nonBlocking = false, lockFile = '.mutation.lock', bothLocks = false } = options;
  if (bothLocks) {
    return mutationLock(directory, () =>
      mutationLock(directory, fn, { timeoutMs, nonBlocking, lockFile: '.presence.lock' }),
      { timeoutMs, nonBlocking, lockFile: '.mutation.lock' });
  }
  privateDirectory(directory);
  assertLockOrder(directory, lockFile);
  const path = join(directory, lockFile);
  const store = lockOwnership.getStore();
  if (store?.has(path)) {
    const value = fn();
    if (value?.then) throw new Error('async_store_critical_section');
    return value;
  }
  const fd = openPrivateLockFd(path);
  try {
    const tool = resolveMutationFlock();
    const wait = nonBlocking ? ['--nonblock'] : ['--timeout', Math.max(0.05, timeoutMs / 1000).toFixed(3)];
    const result = spawnSync(tool, ['--exclusive', ...wait, '3'],
      { stdio: ['ignore', 'ignore', 'ignore', fd], env: {} });
    if (result.status !== 0) throw new MutationLockUnavailableError(result);
    const nextMap = new Map(store ?? undefined);
    nextMap.set(path, Symbol(lockFile));
    const value = lockOwnership.run(nextMap, fn);
    if (value?.then) throw new Error('async_store_critical_section');
    return value;
  } finally {
    fs.closeSync(fd);
  }
}

async function acquireFlockFdAsync(directory, lockFile, { timeoutMs = 5000, nonBlocking = false, deadline: explicitDeadline } = {}) {
  privateDirectory(directory);
  assertLockOrder(directory, lockFile);
  const path = join(directory, lockFile);
  const store = lockOwnership.getStore();
  if (store?.has(path)) {
    return { path, alreadyHeld: true, release() {} };
  }
  const deadline = explicitDeadline ?? (performance.now() + timeoutMs);
  const prev = localQueues.get(path);
  if (nonBlocking && prev) {
    throw new MutationLockUnavailableError({ status: 1, signal: null });
  }
  let releaseTurn;
  const turn = new Promise(resolveTurn => { releaseTurn = resolveTurn; });
  const queueTail = (prev ?? Promise.resolve()).then(() => turn);
  localQueues.set(path, queueTail);
  // Remove queueTail only once the entire chain up to queueTail (including prev)
  // has settled, so a timed-out waiter never clears an active predecessor's slot
  // and lets a subsequent nonBlocking caller bypass the FIFO queue.
  void queueTail.finally(() => {
    if (localQueues.get(path) === queueTail) localQueues.delete(path);
  });
  let turnReleased = false;
  const cleanupQueue = () => {
    if (turnReleased) return;
    turnReleased = true;
    releaseTurn();
  };
  let fd;
  try {
    if (prev) {
      const waitMs = Math.max(0, deadline - performance.now());
      let timer;
      const timedOut = await Promise.race([
        prev.then(() => false),
        new Promise(resolveWait => {
          timer = setTimeout(() => resolveWait(true), waitMs);
          timer.unref?.();
        })
      ]);
      clearTimeout(timer);
      if (timedOut) {
        throw new MutationLockUnavailableError({ status: 1, signal: null });
      }
    }
    const remainingMs = deadline - performance.now();
    if (!nonBlocking && remainingMs <= 0) {
      throw new MutationLockUnavailableError({ status: 1, signal: null });
    }
    const remainingSec = Math.max(0.05, remainingMs / 1000).toFixed(3);
    fd = openPrivateLockFd(path);
    const tool = resolveMutationFlock();
    const args = nonBlocking
      ? ['--exclusive', '--nonblock', '3']
      : ['--exclusive', '--timeout', remainingSec, '3'];
    const result = await new Promise(resolveFlock => {
      const child = spawn(tool, args, { stdio: ['ignore', 'ignore', 'ignore', fd], env: {} });
      let settled = false;
      const finish = res => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        resolveFlock(res);
      };
      const killBudget = nonBlocking ? 5000 : Math.ceil(Math.max(50, remainingMs)) + 250;
      const killTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        finish({ status: null, signal: 'SIGKILL', error: new Error('flock_watchdog_timeout') });
      }, killBudget);
      killTimer.unref?.();
      child.once('error', error => finish({ status: null, signal: null, error }));
      child.once('exit', (status, signal) => finish({ status, signal, error: undefined }));
    });
    if (result.status !== 0) {
      throw new MutationLockUnavailableError(result);
    }
    const acquiredFd = fd;
    fd = undefined;
    let closed = false;
    return {
      path,
      alreadyHeld: false,
      release() {
        if (closed) return;
        closed = true;
        try { fs.closeSync(acquiredFd); } finally { cleanupQueue(); }
      }
    };
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    cleanupQueue();
    throw error;
  }
}

export async function mutationLockAsync(directory, fn, options = {}) {
  const { timeoutMs = 5000, nonBlocking = false, lockFile = '.mutation.lock', bothLocks = false } = options;
  if (bothLocks) {
    const deadline = performance.now() + timeoutMs;
    const h1 = await acquireFlockFdAsync(directory, '.mutation.lock', { timeoutMs, nonBlocking, deadline });
    try {
      const h2 = await acquireFlockFdAsync(directory, '.presence.lock', { timeoutMs, nonBlocking, deadline });
      try {
        const nextMap = new Map(lockOwnership.getStore() ?? undefined);
        nextMap.set(h1.path, Symbol('.mutation.lock'));
        nextMap.set(h2.path, Symbol('.presence.lock'));
        const value = lockOwnership.run(nextMap, fn);
        if (value?.then) throw new Error('async_store_critical_section');
        return value;
      } finally {
        h2.release();
      }
    } finally {
      h1.release();
    }
  }
  const h = await acquireFlockFdAsync(directory, lockFile, { timeoutMs, nonBlocking });
  try {
    if (h.alreadyHeld) {
      const value = fn();
      if (value?.then) throw new Error('async_store_critical_section');
      return value;
    }
    const nextMap = new Map(lockOwnership.getStore() ?? undefined);
    nextMap.set(h.path, Symbol(lockFile));
    const value = lockOwnership.run(nextMap, fn);
    if (value?.then) throw new Error('async_store_critical_section');
    return value;
  } finally {
    h.release();
  }
}

export function withExecution(authority, fn) { return execution.run(authority, fn); }
export function currentExecution() { return execution.getStore(); }
export function writerDirectory(root) { return join(resolve(root), '.h2a-writer-control'); }
export function readWriterGate(directory) { return readState(join(directory, 'control.json'), 'writerControl')?.value.gate; }

function establishWriterControlBody(root, stateDirectory, directory) {
  const path = join(directory, 'control.json');
  const prior = readState(path, 'writerControl');
  if (prior) {
    if (prior.value.root !== resolve(root) || prior.value.stateDirectory !== resolve(stateDirectory)) throw new Error('store_authority_mismatch');
    return prior.value;
  }
  return publishState(path, { schemaVersion: 1, revision: 1, root: resolve(root), stateDirectory: resolve(stateDirectory),
    gate: 'OPEN', handoverId: null, restriction: 'store_writer_set_unknown', closureEvidenceDigest: null }, 'writerControl').value;
}

export function establishWriterControl(root, stateDirectory) {
  const directory = writerDirectory(root);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return mutationLock(directory, () => establishWriterControlBody(root, stateDirectory, directory));
}

export async function establishWriterControlAsync(root, stateDirectory, options = {}) {
  const directory = writerDirectory(root);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return mutationLockAsync(directory, () => establishWriterControlBody(root, stateDirectory, directory), options);
}

function updateWriterControlBody(directory, changes) {
  const path = join(directory, 'control.json'), old = readState(path, 'writerControl');
  if (!old) throw new Error('store_writer_set_unknown');
  return replaceState(path, { ...old.value, ...changes, revision: old.value.revision + 1 }, 'writerControl', old).value;
}

export function updateWriterControl(root, changes) {
  const directory = writerDirectory(root);
  return mutationLock(directory, () => updateWriterControlBody(directory, changes), { bothLocks: true });
}

export async function updateWriterControlAsync(root, changes, options = {}) {
  const directory = writerDirectory(root);
  return mutationLockAsync(directory, () => updateWriterControlBody(directory, changes), { ...options, bothLocks: true });
}

function assertWriterMutationAccess(root, directory, domain) {
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
  return control;
}

// The same lock guards gate changes and business writes. Operation rights are
// distinct from attachment rights; admitted work can finish under a barrier.
export function withWriterMutation(root, domain, fn, options = {}) {
  const directory = writerDirectory(root);
  if (!fs.existsSync(directory)) return fn(); // Legacy/unmanaged normal operation, never proof of continuity.
  return mutationLock(directory, () => {
    assertWriterMutationAccess(root, directory, domain);
    return fn();
  }, options);
}

export async function withWriterMutationAsync(root, domain, fn, options = {}) {
  const directory = writerDirectory(root);
  if (!fs.existsSync(directory)) {
    const value = fn();
    if (value?.then) throw new Error('async_store_critical_section');
    return value;
  }
  return mutationLockAsync(directory, () => {
    assertWriterMutationAccess(root, directory, domain);
    return fn();
  }, options);
}

function presenceNeedsDualLock(root, options = {}) {
  if (options.requireMutationLock) return true;
  const authority = execution.getStore();
  if (authority?.root === resolve(root)) {
    const owner = readState(authority.registry.ownerPath(authority.token.attachmentId), 'ownership')?.value;
    if (owner?.presenceSessionId?.startsWith('pending:')) return true;
  }
  return false;
}

const NEED_DUAL_RETRY = Symbol('presence_need_dual_retry');

function runPresenceCritical(root, directory, sessionId, instance, fn, holdsMutationLock) {
  assertWriterMutationAccess(root, directory, 'presence');
  // Existing-row identity must be read after taking the presence lock.
  const resolvedInstance = typeof instance === 'function' ? instance() : instance;
  const authority = execution.getStore();
  if (authority?.root === resolve(root)) {
    const owner = authority.registry.assertOwner(authority.token, authority.cleanup ? ['ACTIVE', 'FROZEN'] : ['ACTIVE']).value;
    if (owner.presenceSessionId.startsWith('pending:') && resolvedInstance) {
      if (!holdsMutationLock) return NEED_DUAL_RETRY;
      if (owner.expectedInstance !== 'identity_disabled' && owner.expectedInstance !== resolvedInstance) throw new Error('presence_ownership_mismatch');
      authority.registry.updateIdentity(authority.token, sessionId, resolvedInstance);
    } else if (owner.presenceSessionId !== sessionId || (resolvedInstance && owner.expectedInstance !== resolvedInstance)) {
      throw new Error('presence_ownership_mismatch');
    }
  }
  return fn();
}

/** Presence ownership is per target, not merely per process or store root. */
export function withPresenceMutation(root, sessionId, instance, fn, options = {}) {
  const directory = writerDirectory(root);
  if (!fs.existsSync(directory)) return fn();
  const dual = presenceNeedsDualLock(root, options);
  const lockOpts = dual
    ? { timeoutMs: options.timeoutMs, nonBlocking: options.nonBlocking, bothLocks: true }
    : { timeoutMs: options.timeoutMs, nonBlocking: options.nonBlocking, lockFile: '.presence.lock' };
  const result = mutationLock(directory, () => runPresenceCritical(root, directory, sessionId, instance, fn, dual), lockOpts);
  if (result === NEED_DUAL_RETRY) {
    return mutationLock(directory, () => runPresenceCritical(root, directory, sessionId, instance, fn, true), {
      timeoutMs: options.timeoutMs, nonBlocking: options.nonBlocking, bothLocks: true
    });
  }
  return result;
}

export async function withPresenceMutationAsync(root, sessionId, instance, fn, options = {}) {
  const directory = writerDirectory(root);
  if (!fs.existsSync(directory)) {
    const value = fn();
    if (value?.then) throw new Error('async_store_critical_section');
    return value;
  }
  const dual = presenceNeedsDualLock(root, options);
  const lockOpts = dual
    ? { timeoutMs: options.timeoutMs, nonBlocking: options.nonBlocking, bothLocks: true }
    : { timeoutMs: options.timeoutMs, nonBlocking: options.nonBlocking, lockFile: '.presence.lock' };
  const result = await mutationLockAsync(directory, () => runPresenceCritical(root, directory, sessionId, instance, fn, dual), lockOpts);
  if (result === NEED_DUAL_RETRY) {
    return mutationLockAsync(directory, () => runPresenceCritical(root, directory, sessionId, instance, fn, true), {
      timeoutMs: options.timeoutMs, nonBlocking: options.nonBlocking, bothLocks: true
    });
  }
  return result;
}
