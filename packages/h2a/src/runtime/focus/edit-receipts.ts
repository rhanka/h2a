import { closeSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { EditingSnapshot, EditReceipt, FocusReturn, Production, ReturnLineage } from '@sentropic/focus/editing';

export interface RetainedEditingState {
  schemaVersion: 1; source: string; production: Production; baseline: EditingSnapshot; current: EditingSnapshot;
  lineage?: ReturnLineage; returns: FocusReturn[]; receipts: EditReceipt[];
  pending?: { expectedBytes: string; candidate: RetainedEditingState };
}
/** Same-directory rename; file and containing directory are fsynced before acknowledgement. */
export function atomicWrite(path: string, bytes: string): void {
  const staging = mkdtempSync(join(dirname(path), '.focus-edit-'));
  try {
    const temporary = join(staging, 'value'), fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, bytes, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
    const directory = openSync(dirname(path), 'r'); try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { rmSync(staging, { recursive: true, force: true }); }
}
export const readEditingState = (dir: string): RetainedEditingState => {
  const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as RetainedEditingState;
  if (state.schemaVersion !== 1) throw new Error('Unsupported editing state'); return state;
};
export const writeEditingState = (dir: string, state: RetainedEditingState): void => atomicWrite(join(dir, 'state.json'), JSON.stringify(state) + '\n');
/** All cooperating offline producers must share this lock. A stale lock fails closed. */
export function withEditingLock<T>(dir: string, work: () => T): T {
  const lock = join(dir, 'writer.lock'); mkdirSync(lock, { mode: 0o700 });
  try { return work(); } finally { rmSync(lock, { recursive: true }); }
}
