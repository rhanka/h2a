/** Independent, bounded legacy proof. Dates only restrict admission; absence
 * from every NSpid component is the death proof. No PID probe or signal. */
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, statfsSync, type Stats } from 'node:fs';
import { hostname } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import type { LegacyLockHolder, SelfIdent } from './succession-lock.js';

export interface LegacyEvidenceResult { dead: boolean; reasonCode: string; reason: string; structural?: boolean; limit?: 'processes'; }
export interface LegacyCapture {
  fd: number; path: string; bytes: Buffer; stat: Stats; holder: LegacyLockHolder;
  context: SelfIdent; result?: LegacyEvidenceResult;
}
const failure = (reasonCode: string, reason: string, structural = false): LegacyEvidenceResult => ({dead:false,reasonCode,reason,structural});
const sameMetadata = (a: Stats, b: Stats): boolean => a.dev===b.dev && a.ino===b.ino && a.size===b.size && a.mode===b.mode
  && a.uid===b.uid && a.gid===b.gid && a.nlink===b.nlink && a.mtimeMs===b.mtimeMs && a.ctimeMs===b.ctimeMs;
const sameContext = (a: SelfIdent,b: SelfIdent): boolean => a.host===b.host && a.hostKind===b.hostKind && a.boot===b.boot && a.ns===b.ns && a.timeNs===b.timeNs;
function validContext(c: SelfIdent): boolean {
  return process.platform==='linux' && c.hostKind==='machine-id' && /^[0-9a-f]{32}$/.test(c.host) && !/^0+$/.test(c.host)
    && typeof c.boot==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(c.boot)
    && c.ns==='pid:[4026531836]' && c.timeNs==='time:[4026531834]';
}

export function captureLegacyLock(path: string, bytes: Buffer, holder: LegacyLockHolder, context: SelfIdent): LegacyCapture | LegacyEvidenceResult {
  let fd: number | undefined;
  try {
    fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    const before=fstatSync(fd);
    if(!before.isFile() || before.nlink!==1) return failure('legacy-generation-unsupported','legacy file must be regular with one link',true);
    if(before.uid!==process.geteuid?.())return failure('legacy-file-owner-unsupported','legacy file owner differs from the effective UID',true);
    const observed=readFileSync(fd);
    if(!sameMetadata(before,fstatSync(fd)) || !sameMetadata(before,lstatSync(path)) || !observed.equals(bytes)) return failure('legacy-observation-changed','legacy file changed during capture');
    const capture={fd,path,bytes,stat:before,holder,context};fd=undefined;return capture;
  }catch{return failure('legacy-observation-changed','legacy file cannot be captured safely');}
  finally{if(fd!==undefined)closeSync(fd);}
}

export function legacyCaptureHeld(capture: LegacyCapture, current: SelfIdent): boolean {
  try {
    if(!sameContext(capture.context,current) || !sameMetadata(capture.stat,fstatSync(capture.fd)) || !sameMetadata(capture.stat,lstatSync(capture.path)))return false;
    const bytes=Buffer.alloc(capture.bytes.length);let offset=0;
    while(offset<bytes.length){const n=readSync(capture.fd,bytes,offset,bytes.length-offset,offset);if(!n)return false;offset+=n;}
    return bytes.equals(capture.bytes) && sameMetadata(capture.stat,fstatSync(capture.fd));
  }catch{return false;}
}

// Reading one extra byte detects the 64 KiB boundary. A proc status reports
// size=0, so fstat size is not used as a completeness test.
function boundedRead(path: string, limit: number): string {
  const fd=openSync(path,'r');
  try {
    const chunks:Buffer[]=[];let total=0;
    for(;;){const buf=Buffer.alloc(Math.min(4096,limit+1-total));const n=readSync(fd,buf,0,buf.length,null);if(!n)break;
      total+=n;if(total>limit)throw Object.assign(new Error('status byte limit'),{code:'LIMIT'});chunks.push(buf.subarray(0,n));}
    return Buffer.concat(chunks).toString('utf8');
  }finally{closeSync(fd);}
}

function statusIds(text: string, entry: number): number[] | undefined {
  const field=(name:string):string|undefined=>{const matches=text.split('\n').filter(line=>line.startsWith(name+':'));return matches.length===1?matches[0].slice(name.length+1).trim():undefined;};
  const pid=field('Pid');const tgid=field('Tgid');const nspid=field('NSpid');
  if(!pid || !tgid || !nspid || !/^[1-9][0-9]*$/.test(pid) || !/^[1-9][0-9]*$/.test(tgid) || Number(pid)!==entry || Number(tgid)!==entry)return undefined;
  const parts=nspid.split(/\s+/);
  if(parts.some(p=>!/^[1-9][0-9]*$/.test(p) || !Number.isSafeInteger(Number(p)) || Number(p)>4194304))return undefined;
  const ids=parts.map(Number);return ids[0]===entry ? ids:undefined;
}

function procQualification(current: SelfIdent): string | undefined {
  if(!validContext(current) || readlinkSync('/proc/self')!==String(process.pid) || (statfsSync('/proc').type>>>0)!==0x9fa0)return undefined;
  if(readlinkSync('/proc/self/ns/pid')!=='pid:[4026531836]' || readlinkSync('/proc/self/ns/time')!=='time:[4026531834]')return undefined;
  const release=boundedRead('/proc/sys/kernel/osrelease',4096).trim();
  if(!release || /[\r\n]/.test(release) || /microsoft/i.test(release))return undefined;
  const self=boundedRead('/proc/self/status',65536);
  const ids=statusIds(self,process.pid);if(!ids || ids.length!==1)return undefined;
  const raw=boundedRead('/proc/self/mountinfo',1024*1024);
  const mounts=raw.trim().split('\n').map(line=>{
    const [left,right,...extra]=line.split(' - ');if(!right || extra.length)throw new Error('invalid mountinfo');
    const fields=left.split(' ');const tail=right.split(' ');if(fields.length<6 || tail.length<3)throw new Error('invalid mountinfo');
    const unescape=(s:string)=>s.replace(/\\([0-7]{3})/g,(_m,n)=>String.fromCharCode(parseInt(n,8)));
    return {root:unescape(fields[3]),point:unescape(fields[4]),options:fields[5]+','+tail[2],type:tail[0]};
  });
  const proc=mounts.filter(m=>m.point==='/proc');if(proc.length!==1 || proc[0].type!=='proc' || proc[0].root!=='/')return undefined;
  const options=proc[0].options.split(',');
  if(options.some(o=>o.startsWith('subset') || o.startsWith('hidepid') && o!=='hidepid=0' && o!=='hidepid=off'))return undefined;
  for(const m of mounts) {
    if(m.point==='/proc' || !m.point.startsWith('/proc/'))continue;
    const protectedPath=/^\/proc\/(?:[0-9]+|self|thread-self)(?:\/|$)/.test(m.point)
      || ['/proc/stat','/proc/uptime','/proc/sys/kernel/random/boot_id','/proc/sys/kernel/osrelease'].some(p=>p===m.point || p.startsWith(m.point+'/'));
    if(protectedPath)return undefined;
  }
  return createHash('sha256').update(raw).update(JSON.stringify(ids)).digest('hex');
}

export function collectLegacyEvidence(capture: LegacyCapture, deadline: number, current: () => SelfIdent): LegacyEvidenceResult {
  const end=Math.min(deadline,performance.now()+250);
  if(capture.holder.hostname!==hostname())return failure('legacy-hostname-mismatch','historical hostname differs from the current hostname',true);
  let view: string | undefined;
  try{view=procQualification(current());}catch{view=undefined;}
  if(!view)return failure('legacy-proc-view-unsupported','initial PID/time namespaces and complete procfs cannot be established',true);
  if(!legacyCaptureHeld(capture,current()))return failure('legacy-observation-changed','legacy generation or current frame changed');
  try {
    const stat=boundedRead('/proc/stat',1024*1024);
    const bt=stat.split('\n').filter(line=>line.startsWith('btime '));
    if(bt.length!==1 || !/^btime [0-9]+$/.test(bt[0]))return failure('legacy-time-evidence-unavailable','boot time source missing or invalid');
    const before=Date.now();const up=boundedRead('/proc/uptime',4096);const after=Date.now();
    const match=/^([0-9]+(?:\.[0-9]+)?)\s+[0-9]+(?:\.[0-9]+)?\s*$/.exec(up);
    if(!match || after<before || after-before>2000)return failure('legacy-time-evidence-unavailable','uptime or civil observation incoherent');
    const uptime=Number(match[1])*1000;const boot=Number(bt[0].slice(6))*1000;const low=before-uptime;const high=after-uptime;
    if(!Number.isFinite(boot) || !Number.isFinite(uptime) || Math.max(low-boot,boot-high,0)>2000)return failure('legacy-time-evidence-unavailable','boot time sources disagree');
    const dates=[Date.parse(capture.holder.startedAt),capture.stat.mtimeMs,capture.stat.ctimeMs];
    if(dates.some(d=>!Number.isFinite(d)) || Math.max(...dates)>=Math.min(boot,low)-2000)return failure('legacy-time-evidence-unavailable','legacy dates are outside the conservative inter-boot filter',true);
  }catch{return failure('legacy-time-evidence-unavailable','required time sources unavailable');}
  let bytes=0;let count=0;
  try {
    const entries=readdirSync('/proc').filter(name=>/^[0-9]+$/.test(name));
    if(entries.length>8192)return {...failure('legacy-inventory-incomplete','process count limit (8192) exceeded'),limit:'processes'};
    for(const entry of entries){
      if(performance.now()>=end)return failure('legacy-inventory-incomplete',performance.now()>=deadline?'remaining attempt budget exhausted':'inventory time limit (250 ms) exceeded');
      const pid=Number(entry);if(!Number.isSafeInteger(pid) || pid<1 || pid>4194304)return failure('legacy-inventory-incomplete','invalid process entry');
      let text:string;
      try{text=boundedRead(`/proc/${entry}/status`,65536);}
      catch(e){if(['ENOENT','ESRCH'].includes((e as NodeJS.ErrnoException).code??''))continue;return failure('legacy-inventory-incomplete','status unreadable or status byte limit exceeded');}
      bytes+=Buffer.byteLength(text);count++;
      if(bytes>16*1024*1024 || count>8192)return failure('legacy-inventory-incomplete','cumulative inventory limit exceeded');
      const ids=statusIds(text,pid);if(!ids)return failure('legacy-inventory-incomplete','status fields absent, duplicated or incoherent');
      if(ids.includes(capture.holder.pid))return failure('legacy-pid-present','PID present; historical holder cannot be distinguished');
    }
    if(performance.now()>=end)return failure('legacy-inventory-incomplete','inventory time or attempt budget exhausted');
    if(view!==procQualification(current()))return failure('legacy-proc-view-unsupported','procfs visibility changed during inventory');
    if(!legacyCaptureHeld(capture,current()))return failure('legacy-observation-changed','legacy generation changed during inventory');
    return {dead:true,reasonCode:'legacy-global-pid-absent',reason:'complete qualified NSpid inventory contains no historical PID'};
  }catch{return failure('legacy-inventory-incomplete','process enumeration or procfs revalidation failed');}
}

/** Lightweight capacity witness; never reads status or produces a death proof. */
export function legacyCapacityExceeded(capture:LegacyCapture,deadline:number,current:()=>SelfIdent):boolean|undefined {
  const end=Math.min(deadline,performance.now()+250);
  try {
    if(!legacyCaptureHeld(capture,current()))return undefined;
    const view=procQualification(current());if(!view)return undefined;
    const count=readdirSync('/proc').filter(name=>/^[0-9]+$/.test(name)).length;
    if(performance.now()>=end || view!==procQualification(current()) || !legacyCaptureHeld(capture,current()))return undefined;
    return count>8192;
  }catch{return undefined;}
}
