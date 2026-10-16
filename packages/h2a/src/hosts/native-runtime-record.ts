import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { digest, snapshot } from './native-files.js';
// Wheel RECORD is CSV. Never execute an interpreter to inspect a distribution.
function recordRows(recordPath: string): string[][] {
  const source = snapshot(recordPath)?.bytes.toString(); if (!source) return [];
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') { if (quoted && source[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n')) {
      row.push(cell.replace(/\r$/, '')); cell = '';
      if (c === '\n') { rows.push(row); row = []; }
    } else cell += c;
  }
  if (quoted) return [];
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
export function captureRuntimeGeneratedFiles(recordPath: string): Record<string, string> {
  return Object.fromEntries(recordRows(recordPath).filter(([path, hash, size]) => /^(?:vibe|mistralai_vibe_local_harness)\/(?:[^/]+\/)*__pycache__\/[^/]+\.pyc$/.test(path) && hash === '' && size === '')
    .map(([path]) => [path, digest(snapshot(resolve(dirname(dirname(recordPath)), path))?.bytes ?? 'missing')]));
}
export function verifyRuntimeRecord(recordPath: string, generated: Record<string, string> = {}): boolean {
  const rows = recordRows(recordPath), base = dirname(dirname(recordPath));
  const relevant = rows.filter(([path]) => /^(?:vibe|mistralai_vibe_local_harness)\//.test(path));
  if (!relevant.length) return false;
  return relevant.every(([path, hash, size]) => {
    if (isAbsolute(path) || path.split('/').includes('..')) return false;
    if (hash === '' && size === '' && /\/__pycache__\/[^/]+\.pyc$/.test(path)) return generated[path] === digest(snapshot(resolve(base, path))?.bytes ?? 'missing');
    if (!hash?.startsWith('sha256=')) return false;
    const bytes = snapshot(resolve(base, path))?.bytes;
    return !!bytes && String(bytes.length) === size && createHash('sha256').update(bytes).digest('base64url') === hash.slice(7);
  });
}
