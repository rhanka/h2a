import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

export function safeDirectory(directory) {
  const absolute = resolve(directory);
  let parent = absolute;
  while (parent !== parse(parent).root) {
    if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) throw new Error(`symlink directory: ${parent}`);
    parent = dirname(parent);
  }
  mkdirSync(absolute, { recursive: true, mode: 0o700 });
  if (realpathSync(absolute) !== absolute) throw new Error('noncanonical directory');
  return absolute;
}

export function writeJson(path, data) {
  safeDirectory(dirname(path));
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(data, null, 2) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temporary, path);
  const directory = openSync(dirname(path), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

export async function acquire(directory) {
  safeDirectory(directory);
  const path = join(directory, 'controller.lock');
  const fd = openSync(path, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  closeSync(fd);
  // Linux/systemd target: OS-owned advisory lock, released even after SIGKILL
  // or reboot. The holder exits on stdin EOF when the controller disappears.
  // Never inspect or signal an unrelated PID, never unlink the locked inode.
  const child = spawn('flock', ['--nonblock', '--conflict-exit-code', '75', path, process.execPath,
    '-e', "process.stdout.write('locked');process.stdin.resume();"], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
  const completion = new Promise(resolve => { child.on('close', resolve); });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout.once('data', resolve);
    child.once('close', code => { if (code === 75) reject(new Error('controller locked')); else reject(new Error(`flock failed (${code})`)); });
  });
  writeFileSync(path, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }) + '\n', { mode: 0o600 });
  return async () => { child.stdin.end(); await completion; };
}

export function readState(directory) {
  const path = join(directory, 'state.json');
  if (!existsSync(path)) return { version: 1, cursor: 0, attempts: {}, uses: {} };
  if (lstatSync(path).isSymbolicLink()) throw new Error('symlink state');
  const state = JSON.parse(readFileSync(path, 'utf8'));
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  if (state.version !== 1 || !Number.isSafeInteger(state.cursor) || state.cursor < 0 ||
    !object(state.attempts) || !object(state.uses) || Object.values(state.uses).some(x => !Number.isSafeInteger(x) || x < 0) ||
    Object.values(state.attempts).some(x => !object(x) || typeof x.status !== 'string') ||
    (state.quarantines !== undefined && !object(state.quarantines))) throw new Error('invalid controller state; manual reconciliation required');
  if (state.candidates !== undefined) {
    if (!object(state.candidates)) throw new Error('invalid durable candidates; reconciliation required');
    for (const [key, candidate] of Object.entries(state.candidates)) {
      validateCandidate(candidate);
      if (key !== candidate.pr) throw new Error('durable candidate key mismatch');
    }
  }
  return state;
}

export function validateCandidate(candidate) {
  const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
  const statuses = ['ready', 'waiting-checks', 'waiting-age', 'waiting-admission', 'needs-revalidation',
    'blocked-review', 'quarantine', 'merge-pending', 'merged'];
  if (candidate?.version !== 1 || !/^rhanka\/[A-Za-z0-9_.-]+$/.test(candidate.repository ?? '') ||
    !new RegExp(`^https://github\\.com/${candidate.repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/pull/[1-9][0-9]*$`).test(candidate.pr ?? '') ||
    !/^security\/daily-vuln-[A-Za-z0-9._-]+$/.test(candidate.branch ?? '') ||
    !sha(candidate.base) || !sha(candidate.sha) || candidate.base === candidate.sha || !statuses.includes(candidate.status) ||
    !candidate.author || !Array.isArray(candidate.reviewers) || candidate.reviewers.length !== 2 ||
    !Array.isArray(candidate.targets) || !candidate.targets.length ||
    !Array.isArray(candidate.tests) || !candidate.tests.length ||
    !Array.isArray(candidate.requiredChecks) || !candidate.requiredChecks.length ||
    candidate.requiredChecks.some(x => typeof x !== 'string' || !x.trim()) ||
    new Set(candidate.requiredChecks).size !== candidate.requiredChecks.length ||
    !['guard', 'tests', 'verification'].every(key => /^[a-f0-9]{64}$/.test(candidate.proofDigests?.[key] ?? ''))) {
    throw new Error('invalid durable candidate; explicit ownership and proof metadata required');
  }
  if (candidate.mergeIntent && (typeof candidate.mergeIntent.id !== 'string' || !candidate.mergeIntent.id ||
    candidate.mergeIntent.expectedHead !== candidate.sha || candidate.mergeIntent.expectedBase !== candidate.base ||
    candidate.mergeIntent.method !== 'merge' || !Number.isFinite(Date.parse(candidate.mergeIntent.createdAt)))) {
    throw new Error('invalid durable merge intent');
  }
  if (candidate.status === 'merge-pending' && !candidate.mergeIntent) throw new Error('merge intent missing');
  if (candidate.status === 'merged' && !sha(candidate.mergeSha)) throw new Error('merge result missing');
  return candidate;
}
