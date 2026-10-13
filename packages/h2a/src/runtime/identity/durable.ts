import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

export function redactIdentityStorageError(error:unknown):unknown {
  const code=(error as NodeJS.ErrnoException|undefined)?.code;
  if(typeof code!=='string' || !/^E(?!RR_)[A-Z0-9_]+$/.test(code))return error;
  return Object.assign(new Error(`Identity storage operation failed (${code})`,{cause:'identity_storage_failed'}),{code});
}

export function syncDirectory(dir: string): void {
  if (process.platform === 'win32' || !['linux', 'darwin'].includes(process.platform)) return;
  const fd = openSync(dir, 'r');
  try { fsyncSync(fd); }
  catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (process.platform !== 'darwin' || !['EINVAL', 'ENOTSUP', 'EOPNOTSUPP'].includes(code ?? '')) throw e;
  } finally { closeSync(fd); }
}

export function ensureDurableDirectory(dir: string): void {
  if (existsSync(dir)) return;
  const parent = dirname(dir);
  if (parent !== dir) ensureDurableDirectory(parent);
  mkdirSync(dir, { mode: 0o700 });
  syncDirectory(dir);
  syncDirectory(parent);
}

export function syncFile(file: string): void {
  const fd = openSync(file, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  syncDirectory(dirname(file));
}

export function writeComplete(fd: number, bytes: Buffer | string): void {
  const data = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;
  let offset = 0;
  while (offset < data.length) {
    const n = writeSync(fd, data, offset, data.length - offset);
    if (n <= 0) throw Object.assign(new Error('identity durable short write'), { code: 'ENOSPC' });
    offset += n;
  }
}

export function appendDurable(file: string, line: string, held: () => boolean): void {
  if (!held()) throw new Error('identity fence ownership lost before append');
  const fd = openSync(file, 'a', 0o600);
  try { writeComplete(fd, line); fsyncSync(fd); } finally { closeSync(fd); }
  syncDirectory(dirname(file));
}
