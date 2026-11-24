import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, statfsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LockTimeoutError } from '../local-files/locks.js';
import {
  classifyLiveness,
  procStartInfo,
  readBootId,
  readHostId,
  readPidNs,
  readTimeNs,
  type HostKind,
  type LockRec,
  type SelfIdent
} from '../local-files/succession-lock.js';
import { BindingCommitIntegrityError, BindingCommitConflictError, BindingFenceStaleError, digestBytes, preparePossession, receiptMatches, withPossession, isPreparedPossession, type PossessionReceipt } from './possession.js';
import { appendDurable, ensureDurableDirectory, syncDirectory, syncFile, writeComplete } from './durable.js';

const QUALIFIED_FS_TYPES: ReadonlySet<number> = new Set([0xef53, 0x58465342, 0x9123683e, 0xf2f52010]);

function identitySelf(): SelfIdent {
  const host = readHostId({ machineIdPaths: ['/etc/machine-id', '/var/lib/dbus/machine-id'] });
  return {
    host: host.host,
    hostKind: host.hostKind,
    boot: readBootId(),
    ns: readPidNs(),
    timeNs: readTimeNs(),
    pid: process.pid,
    start: procStartInfo(process.pid)?.start ?? null
  };
}

function isRecoveryQualifiedFs(dir: string): boolean {
  if (process.platform !== 'linux') return false;
  try {
    return QUALIFIED_FS_TYPES.has(statfsSync(dir).type >>> 0);
  } catch {
    return false;
  }
}

export interface BindingSlotHolder {
  readonly host: string;
  readonly hostKind?: HostKind;
  readonly boot?: string | null;
  readonly ns?: string | null;
  readonly timeNs?: string | null;
  readonly pid: number;
  readonly start?: string | null;
}

export interface BindingCommitSlot {
  version: 1; kh: string; pred: string; fenceEpoch: string;
  line: string; lineId: string; proof: PossessionReceipt;
  holder?: BindingSlotHolder;
}

export interface RepairBindingSlotsContext {
  readonly activeEpoch?: string;
  readonly deadHolder?: LockRec;
  readonly self?: SelfIdent;
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

function readKernelBootTimeMs(): number | undefined {
  try {
    const stat = readFileSync('/proc/stat', 'utf8');
    const m = /^btime\s+(\d+)/m.exec(stat);
    if (!m) return undefined;
    const sec = Number(m[1]);
    return Number.isFinite(sec) && sec > 0 ? sec * 1000 : undefined;
  } catch {
    return undefined;
  }
}

function readFenceRecords(dir: string): LockRec[] {
  if (!existsSync(dir)) return [];
  const out: LockRec[] = [];
  for (const name of readdirSync(dir)) {
    if (name !== '.lock' && !name.startsWith('.lock.succ.')) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (parsed && typeof parsed === 'object' && typeof parsed.pid === 'number' && typeof parsed.host === 'string') {
        const token = typeof parsed.token === 'string' ? parsed.token : typeof parsed.fenceEpoch === 'string' ? parsed.fenceEpoch : '';
        out.push({
          host: parsed.host,
          ...(parsed.hostKind === 'machine-id' || parsed.hostKind === 'weak' ? { hostKind: parsed.hostKind } : {}),
          boot: typeof parsed.boot === 'string' ? parsed.boot : null,
          ns: typeof parsed.ns === 'string' ? parsed.ns : null,
          timeNs: typeof parsed.timeNs === 'string' ? parsed.timeNs : null,
          pid: parsed.pid,
          start: typeof parsed.start === 'string' ? parsed.start : null,
          token,
          at: typeof parsed.at === 'number' ? parsed.at : 0
        });
      }
    } catch {
      // ignore unreadable or disappearing lock files
    }
  }
  return out;
}

interface SlotAbandonmentClassification {
  readonly abandoned: boolean;
  readonly reason: string;
  readonly pid: number | 'unknown';
  readonly machineClass: 'local' | 'other' | 'unknown';
  readonly bootClass: 'current' | 'other' | 'unknown';
  readonly ns: string;
  readonly start: string;
}

function holderToLockRecord(holder: BindingSlotHolder, fenceEpoch: string): LockRec {
  return {
    host: holder.host,
    ...(holder.hostKind ? { hostKind: holder.hostKind } : {}),
    boot: holder.boot ?? null,
    ns: holder.ns ?? null,
    timeNs: holder.timeNs ?? null,
    pid: holder.pid,
    start: holder.start ?? null,
    token: fenceEpoch,
    at: 0
  };
}

function classifyRecordMetadata(rec: LockRec | undefined, self: SelfIdent): {
  pid: number | 'unknown';
  machineClass: 'local' | 'other' | 'unknown';
  bootClass: 'current' | 'other' | 'unknown';
  ns: string;
  start: string;
} {
  if (!rec) {
    return { pid: 'unknown', machineClass: 'unknown', bootClass: 'unknown', ns: 'unknown', start: 'unknown' };
  }
  const machineClass = rec.host === self.host ? 'local' : 'other';
  const bootClass = !rec.boot || !self.boot ? 'unknown' : rec.boot === self.boot ? 'current' : 'other';
  return {
    pid: typeof rec.pid === 'number' ? rec.pid : 'unknown',
    machineClass,
    bootClass,
    ns: rec.ns ?? 'unknown',
    start: rec.start ?? 'unknown'
  };
}

function classifySlotAbandonment(
  dir: string,
  slotPath: string,
  slot: BindingCommitSlot,
  context: RepairBindingSlotsContext = {}
): SlotAbandonmentClassification {
  const self = context.self ?? identitySelf();
  if (!isRecoveryQualifiedFs(dir)) {
    const meta = classifyRecordMetadata(slot.holder ? holderToLockRecord(slot.holder, slot.fenceEpoch) : context.deadHolder, self);
    return { abandoned: false, reason: 'unqualified-filesystem', ...meta };
  }
  if (context.activeEpoch && slot.fenceEpoch === context.activeEpoch) {
    const meta = classifyRecordMetadata(slot.holder ? holderToLockRecord(slot.holder, slot.fenceEpoch) : undefined, self);
    return { abandoned: false, reason: 'active-fence-epoch', ...meta };
  }

  // Check if any lock / succ record on disk matching slot.fenceEpoch is live or undecidable.
  const fenceRecords = readFenceRecords(dir);
  let matchingDeadRecord: LockRec | undefined;
  for (const rec of fenceRecords) {
    if (rec.token === slot.fenceEpoch) {
      const liveness = classifyLiveness(rec, self, { protocol: 'identity' });
      if (liveness.verdict !== 'dead') {
        const meta = classifyRecordMetadata(rec, self);
        return { abandoned: false, reason: `fence-holder-${liveness.verdict}`, ...meta };
      }
      matchingDeadRecord = rec;
    }
  }

  if (slot.holder && typeof slot.holder === 'object' && typeof slot.holder.pid === 'number' && typeof slot.holder.host === 'string') {
    const rec = holderToLockRecord(slot.holder, slot.fenceEpoch);
    const liveness = classifyLiveness(rec, self, { protocol: 'identity' });
    const meta = classifyRecordMetadata(rec, self);
    if (liveness.verdict === 'dead') {
      const deadReason = rec.boot && self.boot && rec.boot !== self.boot ? 'previous-boot' : 'dead-pid';
      return { abandoned: true, reason: deadReason, ...meta };
    }
    return { abandoned: false, reason: `slot-holder-${liveness.verdict}`, ...meta };
  }

  if (matchingDeadRecord) {
    const meta = classifyRecordMetadata(matchingDeadRecord, self);
    const deadReason = matchingDeadRecord.boot && self.boot && matchingDeadRecord.boot !== self.boot ? 'previous-boot' : 'dead-pid';
    return { abandoned: true, reason: deadReason, ...meta };
  }

  if (context.deadHolder) {
    const liveness = classifyLiveness(context.deadHolder, self, { protocol: 'identity' });
    if (liveness.verdict === 'dead') {
      const meta = classifyRecordMetadata(context.deadHolder, self);
      const deadReason = context.deadHolder.boot && self.boot && context.deadHolder.boot !== self.boot ? 'previous-boot' : 'dead-pid';
      return { abandoned: true, reason: deadReason, ...meta };
    }
  }

  try {
    const st = statSync(slotPath);
    const btimeMs = readKernelBootTimeMs();
    if (btimeMs !== undefined && st.mtimeMs < btimeMs - 1000) {
      return {
        abandoned: true,
        reason: 'previous-boot-mtime',
        pid: 'unknown',
        machineClass: 'local',
        bootClass: 'other',
        ns: 'unknown',
        start: 'unknown'
      };
    }
  } catch {
    // ignore stat race
  }

  // A v1 slot written by commitBinding carries a proof object and a fenceEpoch that is only valid
  // while its writer holds identity/.lock. Since we hold the fence (or retirement link) and no
  // lock record for slot.fenceEpoch is live, the writer of this v1 slot is no longer holding the fence.
  if (slot.proof && typeof slot.proof === 'object') {
    return {
      abandoned: true,
      reason: 'orphaned-fence-epoch',
      pid: 'unknown',
      machineClass: 'local',
      bootClass: 'unknown',
      ns: 'unknown',
      start: 'unknown'
    };
  }

  return {
    abandoned: false,
    reason: 'holder-unproven',
    pid: 'unknown',
    machineClass: 'unknown',
    bootClass: 'unknown',
    ns: 'unknown',
    start: 'unknown'
  };
}

interface QuarantineCandidate {
  readonly name: string;
  readonly slot: BindingCommitSlot;
  readonly sha256: string;
  readonly reason: string;
}

function quarantineAbandonedSlots(
  dir: string,
  commits: string,
  candidates: readonly QuarantineCandidate[],
  held: () => boolean
): { backupDir: string; moved: string[] } {
  requireHeld(held);
  const backupName = `.stale-slot-aside-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const backupDir = join(dir, backupName);
  mkdirSync(backupDir, { mode: 0o700 });
  const moved: string[] = [];
  const receiptSlots: Array<{ file: string; instance: string; fenceEpoch: string; lineId: string; sha256: string; abandonmentReason: string }> = [];
  try {
    for (const item of candidates) {
      requireHeld(held);
      const srcPath = join(commits, item.name);
      const before = statSync(srcPath);
      const currentBytes = readFileSync(srcPath);
      if (digestBytes(currentBytes) !== item.sha256) {
        throw new BindingFenceStaleError();
      }
      const after = statSync(srcPath);
      if (before.dev !== after.dev || before.ino !== after.ino) {
        throw new BindingFenceStaleError();
      }
      const dstPath = join(backupDir, item.name);
      renameSync(srcPath, dstPath);
      moved.push(item.name);
      syncFile(dstPath);
      let instance = 'unknown';
      try {
        const parsedRow = JSON.parse(item.slot.line);
        if (typeof parsedRow?.instance === 'string') instance = parsedRow.instance;
      } catch {
        // best-effort
      }
      receiptSlots.push({
        file: item.name,
        instance,
        fenceEpoch: item.slot.fenceEpoch,
        lineId: item.slot.lineId,
        sha256: item.sha256,
        abandonmentReason: item.reason
      });
    }
    const receiptPath = join(backupDir, 'receipt.json');
    const fd = openSync(receiptPath, 'wx', 0o600);
    try {
      writeComplete(
        fd,
        JSON.stringify(
          {
            version: 1,
            reason: 'abandoned-slot-possession-proof-missing',
            at: new Date().toISOString(),
            quarantinedBy: identitySelf(),
            slots: receiptSlots
          },
          null,
          2
        ) + '\n'
      );
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    syncDirectory(backupDir);
    syncDirectory(commits);
    syncDirectory(dir);
    return { backupDir, moved };
  } catch (e) {
    if (moved.length === 0) {
      try { rmSync(backupDir, { recursive: true, force: true }); } catch {}
    }
    throw e;
  }
}

/** A pending winner is prepared before acquiring the fence; it forbids remint. */
export function pendingBindingWinner(dir: string, kh: string): Record<string,string> | undefined {
  const commits=join(dir,'commits');if(!existsSync(commits))return undefined;
  const candidates=readdirSync(commits).filter(name=>name.startsWith(kh+'.') && name.endsWith('.json'));
  if(!candidates.length)return undefined;
  const complete=new Set(lines(dir).map(bindingLineId));
  const slots: BindingCommitSlot[] = [];
  for (const name of candidates) {
    let raw: string;
    try {
      raw = readFileSync(join(commits, name), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw e;
    }
    try {
      const slot = JSON.parse(raw) as BindingCommitSlot;
      if (slot.kh !== kh || !slot.line.endsWith('\n') || bindingLineId(slot.line) !== slot.lineId) throw new Error();
      if (!complete.has(slot.lineId)) slots.push(slot);
    } catch {
      throw new BindingCommitIntegrityError('pending winner incomplete or incoherent');
    }
  }
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
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(commits, name));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw e;
    }
    let receipt:PossessionReceipt|undefined;
    try {
      const slot=JSON.parse(bytes.toString()) as BindingCommitSlot;const row=JSON.parse(slot.line);
      if (slot.proof?.instance === row.instance) {
        if (receiptMatches(dirname(dir), slot.proof, true)) {
          receipt = preparePossession(dirname(dir), row.instance);
        } else {
          const candidate = preparePossession(dirname(dir), row.instance);
          if (candidate && (!slot.proof.publicKeySha256 || candidate.publicKeySha256 === slot.proof.publicKeySha256)) {
            receipt = candidate;
          }
        }
      }
    }catch(e){if(e instanceof LockTimeoutError || (e as NodeJS.ErrnoException).code)throw e;}
    prepared.set(name,{sha256:digestBytes(bytes),...(receipt?{receipt}:{})});
  }
  return prepared;
}

export function repairBindingSlots(
  dir: string,
  held: () => boolean,
  prepared: PreparedBindingSlots,
  context: RepairBindingSlotsContext = {}
): void {
  const commits = join(dir, 'commits');
  if (!existsSync(commits)) return;
  const complete = new Set(lines(dir).map(bindingLineId));
  const pending: Array<{ name: string; slot: BindingCommitSlot; sha256: string }> = [];
  const toQuarantine: QuarantineCandidate[] = [];

  for (const name of readdirSync(commits)) {
    if (name.includes('.tmp.')) continue;
    if (!/^[0-9a-f]{32}\.(genesis|[0-9a-f]{64})\.json$/.test(name)) throw new BindingCommitIntegrityError('unsupported slot name');
    const slotPath = join(commits, name);
    let bytes: Buffer;
    try {
      bytes = readFileSync(slotPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw e;
    }
    const sha256 = digestBytes(bytes);
    const preparation = prepared.get(name);
    if (!preparation || preparation.sha256 !== sha256) throw new BindingFenceStaleError();
    let slot: BindingCommitSlot;
    try { slot = JSON.parse(bytes.toString()); }
    catch { throw new BindingCommitIntegrityError('incomplete slot'); }
    if (!slot || slot.version !== 1 || typeof slot.line !== 'string' || !slot.line.endsWith('\n') || slot.line.slice(0, -1).includes('\n')
      || keyOf(slot.line) !== slot.kh || bindingLineId(slot.line) !== slot.lineId || name !== `${slot.kh}.${slot.pred}.json`
      || !/^[0-9a-f]{32}$/.test(slot.fenceEpoch)) throw new BindingCommitIntegrityError('incoherent slot content or predecessor');
    const row = JSON.parse(slot.line);
    const hasValidReceipt = Boolean(
      slot.proof && slot.proof.instance === row.instance && preparation.receipt && isPreparedPossession(preparation.receipt)
    );
    if (!hasValidReceipt) {
      if (complete.has(slot.lineId)) {
        syncFile(journal(dir));
        toQuarantine.push({ name, slot, sha256, reason: 'already-committed-in-journal' });
        continue;
      }
      const classification = classifySlotAbandonment(dir, slotPath, slot, context);
      if (classification.abandoned) {
        toQuarantine.push({ name, slot, sha256, reason: classification.reason });
        continue;
      }
      throw new BindingCommitIntegrityError('slot possession proof missing', {
        retryable: true,
        diagnostic: {
          phase: 'worker',
          reasonCode: 'slot-possession-proof-missing',
          reason: `binding slot ${name} is missing possession proof and cannot be proven abandoned (${classification.reason})`,
          lock: `identity/commits/${name}`,
          blockerType: 'SLOT',
          pid: classification.pid,
          machineClass: classification.machineClass,
          bootClass: classification.bootClass,
          ns: classification.ns,
          start: classification.start,
          generation: slot.fenceEpoch,
          target: slot.fenceEpoch,
          retryCondition: 'blocker-change'
        }
      });
    }
    if (!receiptMatches(dirname(dir), preparation.receipt!)) throw new BindingFenceStaleError();
    syncFile(slotPath);
    pending.push({ name, slot, sha256 });
  }

  if (toQuarantine.length > 0) {
    quarantineAbandonedSlots(dir, commits, toQuarantine, held);
  }

  const byKey = new Map<string, Set<string>>();
  for (const line of lines(dir)) { const kh = keyOf(line); if (kh) { const ids = byKey.get(kh) ?? new Set(); ids.add(bindingLineId(line)); byKey.set(kh, ids); } }
  while (pending.length) {
    const i = pending.findIndex(({ slot }) => slot.pred === 'genesis' || byKey.get(slot.kh)?.has(slot.pred));
    if (i < 0) throw new BindingCommitIntegrityError('slot predecessor missing or cyclic');
    const [{ name, slot, sha256 }] = pending.splice(i, 1);
    if (!complete.has(slot.lineId)) { requireHeld(held); appendDurable(journal(dir), slot.line, held); complete.add(slot.lineId); }
    else syncFile(journal(dir));
    const slotPath = join(commits, name);
    if (existsSync(slotPath)) {
      const before = statSync(slotPath);
      if (digestBytes(readFileSync(slotPath)) !== sha256) throw new BindingCommitIntegrityError('slot changed after append');
      requireHeld(held);
      const current = statSync(slotPath);
      if (before.dev !== current.dev || before.ino !== current.ino) throw new BindingCommitIntegrityError('slot replaced after append');
      unlinkSync(slotPath);
      syncDirectory(commits);
    }
    const ids = byKey.get(slot.kh) ?? new Set(); ids.add(slot.lineId); byKey.set(slot.kh, ids);
  }
}

export function commitBinding(dir: string, row: { host: string; providerSessionId: string; instance: string; agentUuid: string; workspaceId: string; at: string },
  fenceEpoch: string, proof: PossessionReceipt, held: () => boolean, beginMutation: () => void, endMutation: () => void): void {
  const kh = bindingKeyHash(row.host, row.providerSessionId);
  const pred = latest(dir, row.host, row.providerSessionId);
  const line = JSON.stringify(row) + '\n';
  const self = identitySelf();
  const holder: BindingSlotHolder = {
    host: self.host,
    hostKind: self.hostKind,
    ...(self.boot !== undefined ? { boot: self.boot } : {}),
    ...(self.ns !== undefined ? { ns: self.ns } : {}),
    ...(self.timeNs !== undefined ? { timeNs: self.timeNs } : {}),
    pid: self.pid,
    ...(self.start !== undefined ? { start: self.start } : {})
  };
  const slot: BindingCommitSlot = { version: 1, kh, pred, fenceEpoch, line, lineId: bindingLineId(line), proof, holder };
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

export interface InspectedBindingSlot {
  readonly file: string;
  readonly instance: string;
  readonly fenceEpoch: string;
  readonly status: 'abandoned' | 'unprovable-live-or-undecidable' | 'malformed';
  readonly reason: string;
  readonly pid: number | 'unknown';
}

export interface IdentityBindingSlotsInspection {
  readonly ok: boolean;
  readonly count: number;
  readonly abandoned: InspectedBindingSlot[];
  readonly blocked: InspectedBindingSlot[];
}

export function inspectIdentityBindingSlotsForRoot(root: string): IdentityBindingSlotsInspection {
  const dir = join(root, 'identity');
  const commits = join(dir, 'commits');
  if (!existsSync(commits)) {
    return { ok: true, count: 0, abandoned: [], blocked: [] };
  }
  const complete = new Set(lines(dir).map(bindingLineId));
  const abandoned: InspectedBindingSlot[] = [];
  const blocked: InspectedBindingSlot[] = [];
  const self = identitySelf();

  for (const name of readdirSync(commits).sort()) {
    if (name.includes('.tmp.') || !name.endsWith('.json')) continue;
    const slotPath = join(commits, name);
    if (!/^[0-9a-f]{32}\.(genesis|[0-9a-f]{64})\.json$/.test(name)) {
      blocked.push({ file: name, instance: 'unknown', fenceEpoch: 'unknown', status: 'malformed', reason: 'unsupported-slot-name', pid: 'unknown' });
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(slotPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw e;
    }
    let slot: BindingCommitSlot;
    let row: Record<string, unknown>;
    try {
      slot = JSON.parse(bytes.toString()) as BindingCommitSlot;
      row = JSON.parse(slot.line) as Record<string, unknown>;
    } catch {
      blocked.push({ file: name, instance: 'unknown', fenceEpoch: 'unknown', status: 'malformed', reason: 'incomplete-slot', pid: 'unknown' });
      continue;
    }
    if (
      !slot ||
      slot.version !== 1 ||
      typeof slot.line !== 'string' ||
      !slot.line.endsWith('\n') ||
      slot.line.slice(0, -1).includes('\n') ||
      keyOf(slot.line) !== slot.kh ||
      bindingLineId(slot.line) !== slot.lineId ||
      name !== `${slot.kh}.${slot.pred}.json` ||
      !/^[0-9a-f]{32}$/.test(slot.fenceEpoch)
    ) {
      blocked.push({
        file: name,
        instance: typeof row?.instance === 'string' ? row.instance : 'unknown',
        fenceEpoch: typeof slot?.fenceEpoch === 'string' ? slot.fenceEpoch : 'unknown',
        status: 'malformed',
        reason: 'incoherent-slot-content',
        pid: 'unknown'
      });
      continue;
    }
    const instance = typeof row.instance === 'string' ? row.instance : 'unknown';
    let hasValidReceipt = false;
    try {
      if (slot.proof?.instance === instance) {
        const candidate = preparePossession(root, instance);
        if (candidate && (!slot.proof.publicKeySha256 || candidate.publicKeySha256 === slot.proof.publicKeySha256)) {
          hasValidReceipt = true;
        }
      }
    } catch {
      hasValidReceipt = false;
    }
    if (hasValidReceipt) continue;
    if (complete.has(slot.lineId)) {
      abandoned.push({ file: name, instance, fenceEpoch: slot.fenceEpoch, status: 'abandoned', reason: 'already-committed-in-journal', pid: 'unknown' });
      continue;
    }
    const classification = classifySlotAbandonment(dir, slotPath, slot, { self });
    if (classification.abandoned) {
      abandoned.push({ file: name, instance, fenceEpoch: slot.fenceEpoch, status: 'abandoned', reason: classification.reason, pid: classification.pid });
    } else {
      blocked.push({
        file: name,
        instance,
        fenceEpoch: slot.fenceEpoch,
        status: 'unprovable-live-or-undecidable',
        reason: classification.reason,
        pid: classification.pid
      });
    }
  }

  return {
    ok: abandoned.length === 0 && blocked.length === 0,
    count: abandoned.length + blocked.length,
    abandoned,
    blocked
  };
}

export interface IdentityBindingSlotsRepairResult extends IdentityBindingSlotsInspection {
  readonly recovered: boolean;
  readonly reason: string;
  readonly backupDir?: string;
  readonly moved?: string[];
}

export function repairIdentityBindingSlotsForRoot(root: string): IdentityBindingSlotsRepairResult {
  const dir = join(root, 'identity');
  const commits = join(dir, 'commits');
  const initial = inspectIdentityBindingSlotsForRoot(root);
  if (initial.abandoned.length === 0) {
    return {
      ...initial,
      recovered: false,
      reason: initial.blocked.length > 0 ? 'slot-not-proven-abandoned' : 'no-abandoned-binding-slots'
    };
  }
  if (!isRecoveryQualifiedFs(dir)) {
    return {
      ...initial,
      ok: false,
      recovered: false,
      reason: 'unqualified-filesystem'
    };
  }
  const self = identitySelf();
  for (const rec of readFenceRecords(dir)) {
    const liveness = classifyLiveness(rec, self, { protocol: 'identity' });
    if (liveness.verdict !== 'dead') {
      return {
        ...initial,
        ok: false,
        recovered: false,
        reason: `active-fence-holder:${liveness.verdict}`
      };
    }
  }
  const complete = new Set(lines(dir).map(bindingLineId));
  const candidates: QuarantineCandidate[] = [];
  for (const item of initial.abandoned) {
    const slotPath = join(commits, item.file);
    let bytes: Buffer;
    try {
      bytes = readFileSync(slotPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw e;
    }
    const sha256 = digestBytes(bytes);
    const slot = JSON.parse(bytes.toString()) as BindingCommitSlot;
    if (!complete.has(slot.lineId)) {
      const classification = classifySlotAbandonment(dir, slotPath, slot, { self });
      if (!classification.abandoned) continue;
    }
    candidates.push({ name: item.file, slot, sha256, reason: item.reason });
  }
  if (candidates.length === 0) {
    const after = inspectIdentityBindingSlotsForRoot(root);
    return {
      ...after,
      recovered: false,
      reason: 'no-abandoned-binding-slots'
    };
  }
  const { backupDir, moved } = quarantineAbandonedSlots(dir, commits, candidates, () => true);
  const after = inspectIdentityBindingSlotsForRoot(root);
  return {
    ...after,
    recovered: moved.length > 0,
    reason: 'quarantined-abandoned-binding-slots',
    backupDir,
    moved
  };
}
