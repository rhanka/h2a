// Preparation parses sources outside identity possession. Admission reads only
// the receipt's fixed ranges and file metadata, under the registry lock.
import { createHash, createPublicKey, randomBytes, sign, verify } from 'node:crypto';
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { withLockSync, LockTimeoutError } from '../local-files/locks.js';
import { syncDirectory, syncFile } from './durable.js';

export const digestBytes = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
export class BindingCommitIntegrityError extends Error {
  readonly reasonCode = 'binding-commit-integrity';
  readonly retryable = false;
  constructor(detail: string) { super(`Identity binding commit integrity: ${detail}`, { cause: 'identity_storage_failed' }); }
}
export class BindingFenceStaleError extends LockTimeoutError {
  constructor() { super('identity/.lock', undefined, 0); this.message = 'Identity possession receipt changed; prepare again outside the fence'; }
}
export class BindingCommitConflictError extends LockTimeoutError {
  constructor() {super('identity/.lock',undefined,0);this.message='Identity binding CAS conflict; the existing winner is retained';}
}
export interface ProofSource {
  file: string; dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number;
  offset: number; length: number; sha256: string;
}
export interface PossessionReceipt { instance: string; sources: ProofSource[]; publicKeySha256: string; }
const verifiedReceipts=new WeakSet<PossessionReceipt>();
export const isPreparedPossession=(receipt:PossessionReceipt):boolean=>verifiedReceipts.has(receipt);
const stamp = (file: string, offset: number, bytes: Buffer): ProofSource => {
  const st = statSync(file);
  return { file, dev: st.dev, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs,
    offset, length: bytes.length, sha256: digestBytes(bytes) };
};
function rows(file: string): Array<{ row: Record<string, unknown>; offset: number; bytes: Buffer }> {
  if (!existsSync(file)) return [];
  const bytes = readFileSync(file);
  if (bytes.length && bytes.at(-1) !== 10) throw new BindingCommitIntegrityError('unterminated registry source');
  const out = []; let offset = 0;
  for (let end = bytes.indexOf(10); end !== -1; end = bytes.indexOf(10, offset)) {
    const line = bytes.subarray(offset, end + 1);
    if (line.toString().trim()) {
      let row;
      try { row = JSON.parse(line.toString()); } catch { throw new BindingCommitIntegrityError('invalid registry source'); }
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new BindingCommitIntegrityError('invalid registry record');
      out.push({ row, offset, bytes: line });
    }
    offset = end + 1;
  }
  return out;
}

export function preparePossession(root: string, instance: string): PossessionReceipt | undefined {
  const keyName = instance.replace(/[:/]/g, '-');
  const privateFile = join(root, 'keys', `${keyName}.key.pem`);
  const publicFile = join(root, 'keys', `${keyName}.pub.pem`);
  if (!existsSync(privateFile) || !existsSync(publicFile)) return undefined;
  return withLockSync(join(root, 'registry', '.lock'), () => {
    const privateBytes = readFileSync(privateFile); const publicBytes = readFileSync(publicFile);
    const instancesFile = join(root, 'registry', 'instances.jsonl');
    const keysFile = join(root, 'registry', 'keys.jsonl');
    const registrations = rows(instancesFile);
    const registration = registrations.find(({ row }) => row.id === instance);
    const events = rows(keysFile);
    if (!registration || !Array.isArray(registration.row.publicKeys)) return undefined;
    const active = new Set(registration.row.publicKeys as string[]);
    for (const { row } of events) if (row.instance === instance && row.type === 'added') active.add(row.publicKey as string);
    for (const { row } of events) if (row.instance === instance && row.type === 'revoked') active.delete(row.publicKey as string);
    try {
      const expected = createPublicKey(privateBytes).export({ type: 'spki', format: 'der' });
      if (!expected.equals(createPublicKey(publicBytes).export({ type: 'spki', format: 'der' }))) return undefined;
      const nonce = randomBytes(32); const signature = sign(null, nonce, privateBytes);
      if (![...active].some(pem => verify(null, nonce, pem, signature))) return undefined;
    } catch { return undefined; }
    for (const file of [privateFile, publicFile, instancesFile, ...(existsSync(keysFile) ? [keysFile] : [])]) syncFile(file);
    syncDirectory(root);
    const sources = [stamp(privateFile, 0, privateBytes), stamp(publicFile, 0, publicBytes),
      stamp(instancesFile, registration.offset, registration.bytes),
      ...(existsSync(keysFile) ? [stamp(keysFile, 0, Buffer.alloc(0))] : [])];
    const publicPem=publicBytes.toString();
    if (!(registration.row.publicKeys as string[]).includes(publicPem)) {
      const added=events.find(({row})=>row.instance===instance && row.type==='added' && row.publicKey===publicPem);
      if(!added)return undefined;
      sources.push(stamp(keysFile,added.offset,added.bytes));
    }
    // An absent key-event source is observed again at admission.
    if (!existsSync(keysFile)) sources.push({ file: keysFile, dev: 0, ino: 0, size: 0, mtimeMs: 0, ctimeMs: 0, offset: 0, length: 0, sha256: digestBytes('') });
    const receipt={ instance, sources: sources.map(s => ({ ...s, file: s.file.slice(root.length + 1) })), publicKeySha256: digestBytes(publicBytes) };
    verifiedReceipts.add(receipt);return receipt;
  }, { timeoutMs: 250 });
}

export function receiptMatches(root: string, receipt: PossessionReceipt, cold = false): boolean {
  if (!receipt || typeof receipt.instance !== 'string' || !Array.isArray(receipt.sources) || receipt.sources.length < 3) return false;
  for (const source of receipt.sources) {
    if (!/^(keys\/[A-Za-z0-9._-]+\.(key|pub)\.pem|registry\/(instances|keys)\.jsonl)$/.test(source.file)) return false;
    const file = join(root, source.file);
    if (source.ino === 0) { if (!cold && existsSync(file)) return false; continue; }
    let fd: number | undefined;
    try {
      fd = openSync(file, 'r'); const st = fstatSync(fd);
      if (st.dev !== source.dev || st.ino !== source.ino || st.size < source.size) return false;
      if (!cold && (st.size !== source.size || st.mtimeMs !== source.mtimeMs || st.ctimeMs !== source.ctimeMs)) return false;
      if (!Number.isSafeInteger(source.offset) || !Number.isSafeInteger(source.length) || source.offset < 0 || source.length < 0 || source.offset + source.length > st.size) return false;
      const bytes = Buffer.alloc(source.length); let offset = 0;
      while (offset < bytes.length) { const n = readSync(fd, bytes, offset, bytes.length - offset, source.offset + offset); if (!n) return false; offset += n; }
      if (digestBytes(bytes) !== source.sha256) return false;
      const current = statSync(file);
      if (current.ino !== st.ino || current.dev !== st.dev || current.size !== st.size || current.ctimeMs !== st.ctimeMs) return false;
    } catch { return false; } finally { if (fd !== undefined) closeSync(fd); }
  }
  return true;
}

export function withPossession<T>(root: string, receipt: PossessionReceipt, fn: () => T): T {
  return withLockSync(join(root, 'registry', '.lock'), () => {
    if (!isPreparedPossession(receipt) || !receiptMatches(root, receipt)) throw new BindingFenceStaleError();
    return fn();
  }, { timeoutMs: 250 });
}
