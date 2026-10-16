import { closeSync, existsSync, fsyncSync, linkSync, openSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BindingCommitIntegrityError, BindingCommitConflictError, BindingFenceStaleError, digestBytes, preparePossession, receiptMatches, withPossession, isPreparedPossession, type PossessionReceipt } from './possession.js';
import { appendDurable, ensureDurableDirectory, syncDirectory, syncFile, writeComplete } from './durable.js';

export interface BindingCommitSlot {
  version: 1; kh: string; pred: string; fenceEpoch: string;
  line: string; lineId: string; proof: PossessionReceipt;
}
export const bindingKeyHash = (host: string, providerSessionId: string): string => digestBytes(`${host}\0${providerSessionId}`).slice(0, 32);
export const bindingLineId = (line: string): string => digestBytes(line);
export interface PreparedBindingSlot { sha256:string; receipt?:PossessionReceipt; }
export type PreparedBindingSlots = Map<string,PreparedBindingSlot>;
const journal = (dir: string): string => join(dir, 'bindings.jsonl');

function lines(dir: string): string[] {
  if (!existsSync(journal(dir))) return [];
  const bytes = readFileSync(journal(dir), 'utf8');
  return [...new Set(bytes.slice(0, bytes.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(line => line + '\n'))];
}
function keyOf(line: string): string | undefined {
  try { const row = JSON.parse(line); return typeof row.host === 'string' && typeof row.providerSessionId === 'string' ? bindingKeyHash(row.host, row.providerSessionId) : undefined; }
  catch { return undefined; }
}
function latest(dir: string, host: string, providerSessionId:string): string {
  return lines(dir).filter(line => {try{const row=JSON.parse(line);return row.host===host && row.providerSessionId===providerSessionId;}catch{return false;}}).map(bindingLineId).at(-1) ?? 'genesis';
}
function requireHeld(held: () => boolean): void {
  if (!held()) throw new BindingCommitIntegrityError('fence changed during protected mutation');
}

/** A pending winner is prepared before acquiring the fence; it forbids remint. */
export function pendingBindingWinner(dir: string, kh: string): Record<string,string> | undefined {
  const commits=join(dir,'commits');if(!existsSync(commits))return undefined;
  const candidates=readdirSync(commits).filter(name=>name.startsWith(kh+'.') && name.endsWith('.json'));
  if(!candidates.length)return undefined;
  const complete=new Set(lines(dir).map(bindingLineId));
  const slots=candidates.map(name=>{
    try{const slot=JSON.parse(readFileSync(join(commits,name),'utf8')) as BindingCommitSlot;
      if(slot.kh!==kh || !slot.line.endsWith('\n') || bindingLineId(slot.line)!==slot.lineId)throw new Error();
      return slot;
    }catch{throw new BindingCommitIntegrityError('pending winner incomplete or incoherent');}
  }).filter(slot=>!complete.has(slot.lineId));
  if(!slots.length)return undefined;
  const tip=slots.find(slot=>!slots.some(next=>next.pred===slot.lineId));
  if(!tip)throw new BindingCommitIntegrityError('pending winner chain cyclic');
  return JSON.parse(tip.line);
}

/** Cold possession preparation happens before election/normal possession. */
export function prepareBindingSlots(dir:string):PreparedBindingSlots {
  const commits=join(dir,'commits');const prepared:PreparedBindingSlots=new Map();
  if(!existsSync(commits))return prepared;
  for(const name of readdirSync(commits)) {
    if(!name.endsWith('.json') || name.includes('.tmp.'))continue;
    const bytes=readFileSync(join(commits,name));let receipt:PossessionReceipt|undefined;
    try {
      const slot=JSON.parse(bytes.toString()) as BindingCommitSlot;const row=JSON.parse(slot.line);
      if(slot.proof?.instance===row.instance && receiptMatches(dirname(dir),slot.proof,true))receipt=preparePossession(dirname(dir),row.instance);
    }catch(e){if((e as NodeJS.ErrnoException).code)throw e;}
    prepared.set(name,{sha256:digestBytes(bytes),...(receipt?{receipt}:{})});
  }
  return prepared;
}

export function repairBindingSlots(dir: string, held: () => boolean, prepared:PreparedBindingSlots): void {
  const commits = join(dir, 'commits');
  if (!existsSync(commits)) return;
  const pending: BindingCommitSlot[] = [];
  for (const name of readdirSync(commits)) {
    if (name.includes('.tmp.')) continue;
    if (!/^[0-9a-f]{32}\.(genesis|[0-9a-f]{64})\.json$/.test(name)) throw new BindingCommitIntegrityError('unsupported slot name');
    let slot: BindingCommitSlot;
    const bytes=readFileSync(join(commits,name));
    const preparation=prepared.get(name);
    if(!preparation || preparation.sha256!==digestBytes(bytes))throw new BindingFenceStaleError();
    try { slot = JSON.parse(bytes.toString()); }
    catch { throw new BindingCommitIntegrityError('incomplete slot'); }
    if (!slot || slot.version !== 1 || typeof slot.line !== 'string' || !slot.line.endsWith('\n') || slot.line.slice(0, -1).includes('\n')
      || keyOf(slot.line) !== slot.kh || bindingLineId(slot.line) !== slot.lineId || name !== `${slot.kh}.${slot.pred}.json`
      || !/^[0-9a-f]{32}$/.test(slot.fenceEpoch)) throw new BindingCommitIntegrityError('incoherent slot content or predecessor');
    const row = JSON.parse(slot.line);
    if (!slot.proof || slot.proof.instance !== row.instance || !preparation.receipt || !isPreparedPossession(preparation.receipt))throw new BindingCommitIntegrityError('slot possession proof missing');
    if(!receiptMatches(dirname(dir),preparation.receipt))throw new BindingFenceStaleError();
    syncFile(join(commits, name));
    pending.push(slot);
  }
  const complete = new Set(lines(dir).map(bindingLineId));
  const byKey = new Map<string, Set<string>>();
  for (const line of lines(dir)) { const kh = keyOf(line); if (kh) { const ids = byKey.get(kh) ?? new Set(); ids.add(bindingLineId(line)); byKey.set(kh, ids); } }
  while (pending.length) {
    const i = pending.findIndex(slot => slot.pred === 'genesis' || byKey.get(slot.kh)?.has(slot.pred));
    if (i < 0) throw new BindingCommitIntegrityError('slot predecessor missing or cyclic');
    const [slot] = pending.splice(i, 1);
    if (!complete.has(slot.lineId)) { requireHeld(held); appendDurable(journal(dir), slot.line, held); complete.add(slot.lineId); }
    else syncFile(journal(dir));
    const ids = byKey.get(slot.kh) ?? new Set(); ids.add(slot.lineId); byKey.set(slot.kh, ids);
  }
}

export function commitBinding(dir: string, row: { host: string; providerSessionId: string; instance: string; agentUuid: string; workspaceId: string; at: string },
  fenceEpoch: string, proof: PossessionReceipt, held: () => boolean, beginMutation: () => void, endMutation: () => void): void {
  const kh = bindingKeyHash(row.host, row.providerSessionId);
  const pred = latest(dir, row.host, row.providerSessionId);
  const line = JSON.stringify(row) + '\n';
  const slot: BindingCommitSlot = { version: 1, kh, pred, fenceEpoch, line, lineId: bindingLineId(line), proof };
  const commits = join(dir, 'commits');
  withPossession(dirname(dir), proof, () => {
    requireHeld(held); beginMutation();
    ensureDurableDirectory(commits);
    const path = join(commits, `${kh}.${pred}.json`);
    if (existsSync(path)) throw new BindingCommitConflictError();
    const tmp = `${path}.tmp.${fenceEpoch}`;
    const fd = openSync(tmp, 'wx', 0o600);
    try { writeComplete(fd, JSON.stringify(slot)); fsyncSync(fd); } finally { closeSync(fd); }
    requireHeld(held);
    try { linkSync(tmp, path); }
    catch (e) {
      const code=(e as NodeJS.ErrnoException).code;
      if(code==='EEXIST')throw new BindingCommitConflictError();
      if(!['EPERM','ENOTSUP','EOPNOTSUPP','ENOSYS'].includes(code??''))throw e;
      // Nominal acquisition remains possible without hard links. A partial
      // fallback slot after a crash fails integrity under the retained barrier.
      requireHeld(held);const slotFd=openSync(path,'wx',0o600);
      try{writeComplete(slotFd,JSON.stringify(slot));fsyncSync(slotFd);}finally{closeSync(slotFd);}
    }
    syncDirectory(commits);
    requireHeld(held); unlinkSync(tmp); syncDirectory(commits);
    requireHeld(held); appendDurable(journal(dir), line, held);
    // Conditional cleanup is limited to this key's successfully materialized slot.
    const before = statSync(path);
    if (readFileSync(path, 'utf8') !== JSON.stringify(slot)) throw new BindingCommitIntegrityError('slot changed after append');
    requireHeld(held); const current = statSync(path);
    if (before.dev !== current.dev || before.ino !== current.ino) throw new BindingCommitIntegrityError('slot replaced after append');
    unlinkSync(path); syncDirectory(commits);
    endMutation();
  });
}
