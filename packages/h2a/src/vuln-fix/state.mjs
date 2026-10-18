import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

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

export function acquire(directory) {
  safeDirectory(directory);
  const path = join(directory, 'controller.lock');
  let fd;
  try { fd = openSync(path, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('controller locked; inspect prior report before explicitly removing a stale lock'); throw error; }
  writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  fsyncSync(fd);
  closeSync(fd);
  return () => unlinkSync(path);
}

export function readState(directory) {
  const path = join(directory, 'state.json');
  if (!existsSync(path)) return { version: 1, cursor: 0, attempts: {}, uses: {} };
  if (lstatSync(path).isSymbolicLink()) throw new Error('symlink state');
  const state = JSON.parse(readFileSync(path, 'utf8'));
  if (state.version !== 1 || !Number.isSafeInteger(state.cursor) || state.cursor < 0 ||
    !state.attempts || Array.isArray(state.attempts) || !state.uses || Array.isArray(state.uses)) throw new Error('invalid controller state; manual reconciliation required');
  return state;
}
