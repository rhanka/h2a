import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve, sep } from 'node:path';

export const digest = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
export const jsonBytes = (value: unknown): string => JSON.stringify(value, null, 2) + '\n';
export interface Snapshot { bytes: Buffer; ino: number; mode: number; mtimeMs: number; }
// Reject symlinks throughout the path, including state and backup ancestors.
export function assertNativePath(path: string): void {
  const absolute = resolve(path);
  let part = parse(absolute).root;
  for (const segment of absolute.slice(part.length).split('/')) {
    part = join(part, segment);
    try { if (lstatSync(part).isSymbolicLink()) throw new Error(`symlink refused: ${part}`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
}
export function snapshot(path: string): Snapshot | undefined {
  assertNativePath(path);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile()) throw new Error(`not a regular file: ${path}`);
    return { bytes: readFileSync(path), ino: stat.ino, mode: stat.mode, mtimeMs: stat.mtimeMs };
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
}
function same(a: Snapshot | undefined, b: Snapshot | undefined): boolean {
  return !a && !b || !!a && !!b && a.ino === b.ino && a.mode === b.mode && a.mtimeMs === b.mtimeMs && a.bytes.equals(b.bytes);
}
export function atomicNativeWrite(path: string, bytes: string | Buffer | undefined, options: {
  state: string; expected?: Snapshot; dryRun?: boolean; beforeRename?: () => void;
}): boolean {
  const previous = 'expected' in options ? options.expected : snapshot(path);
  if (bytes === undefined && !previous || bytes !== undefined && previous?.bytes.equals(Buffer.from(bytes))) return false;
  if (options.dryRun) return true;
  assertNativePath(path); assertNativePath(options.state);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  mkdirSync(join(options.state, 'backups'), { recursive: true, mode: 0o700 });
  const temp = join(dirname(path), `.h2a-${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    if (bytes !== undefined) {
      fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
    }
    options.beforeRename?.();
    if (!same(previous, snapshot(path))) throw new Error(`concurrent modification: ${path}`);
    if (previous) {
      const backup = join(options.state, 'backups', `${digest(path)}-${randomUUID()}`);
      const backupFd = openSync(backup, 'wx', 0o600);
      try { writeFileSync(backupFd, previous.bytes); fsyncSync(backupFd); } finally { closeSync(backupFd); }
    }
    // A cooperative h2a lock cannot make this compare/rename a CAS against Vibe.
    if (bytes === undefined) unlinkSync(path); else renameSync(temp, path);
    const parent = openSync(dirname(path), 'r');
    try { fsyncSync(parent); } finally { closeSync(parent); }
    return true;
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temp); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
}
export interface NativeManifest {
  schema: 1; host: string; root: string; version: string;
  files: Record<string, { sha256: string; source: string; selected: boolean }>;
  hooks?: Record<string, string>;
  guard?: 'on' | 'off';
  guardBinding?: string;
  lifecycle?: { enabled: boolean; instance: string; root?: string; status?: string };
}
export function readNativeManifest(state: string, host: string, root: string, version: string, manifestName = 'manifest.json'): NativeManifest {
  const current = snapshot(join(state, manifestName));
  if (!current) return { schema: 1, host, root, version, files: {} };
  const value = JSON.parse(current.bytes.toString()) as NativeManifest;
  if (value.schema !== 1 || value.host !== host || value.root !== root || !value.files || Array.isArray(value.files))
    throw new Error('unknown or incompatible native manifest');
  for (const [path, entry] of Object.entries(value.files)) {
    if (!resolve(path).startsWith(resolve(root) + sep) || !/^[a-f0-9]{64}$/.test(entry.sha256) || typeof entry.source !== 'string' || typeof entry.selected !== 'boolean')
      throw new Error('invalid or out-of-root native manifest entry');
  }
  if (value.guard !== undefined && !['on', 'off'].includes(value.guard)) throw new Error('invalid guard selection');
  if (value.lifecycle && (typeof value.lifecycle.enabled !== 'boolean' || !value.lifecycle.instance || value.lifecycle.instance === 'auto')) throw new Error('invalid explicit lifecycle selection');
  return value;
}
