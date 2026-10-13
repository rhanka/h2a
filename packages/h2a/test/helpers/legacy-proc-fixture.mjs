// All fabricated kernel observations stay in tests, never in the shipped package.
import fs from 'node:fs';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
export function simulatedReboot(dir, options={}) {
  const delta=86_400_000;const capturedNow=Date.now();const now=capturedNow+delta;const uptime=options.uptime??100;const boot=Math.floor((now-uptime*1000)/1000);
  const originals={readFileSync:fs.readFileSync,readlinkSync:fs.readlinkSync,readdirSync:fs.readdirSync,openSync:fs.openSync};const dateNow=Date.now;
  const status=pid=>`Name:\tfixture\nState:\tR (running)\nPid:\t${pid}\nTgid:\t${pid}\nNSpid:\t${pid}${options.innerPid ? '\t'+options.innerPid : ''}\nThreads:\t1\n`;
  const sources=new Map([
    ['/proc/stat',options.btime??`btime ${boot}\n`],['/proc/uptime',`${uptime}.00 0.00\n`],
    ['/proc/self/mountinfo',`1 0 0:1 / /proc rw - proc proc rw${options.hidepid?',hidepid='+options.hidepid:''}\n`+(options.mount ?? '')],
    ['/proc/self/status',`Name:\tfixture\nState:\tR (running)\nPid:\t${process.pid}\nTgid:\t${process.pid}\nNSpid:\t${process.pid}\nThreads:\t1\n`],['/proc/sys/kernel/osrelease','6.8.0-native\n'],
    [`/proc/${process.pid}/status`,options.invalidStatus ? 'invalid' : `Name:\tfixture\nState:\tR (running)\nPid:\t${process.pid}\nTgid:\t${process.pid}\nNSpid:\t${process.pid}\nThreads:\t1\n`],
    ...(options.innerPid ? [['/proc/4194000/status',status(4194000)]] : [])
  ]);
  const files=new Map();let index=0;for(const [path,data] of sources){const file=join(dir,`proc-source-${index++}`);originals.openSync;fs.writeFileSync(file,data);files.set(path,file);}
  fs.readFileSync=(p,...args)=>{if(files.has(p))return originals.readFileSync(files.get(p),...args);return originals.readFileSync(p,...args);};
  fs.openSync=(p,...args)=>{
    // btime is a boot constant; uptime must advance with the fixture's clock.
    // Worker startup under load can take longer than the 2 s evidence tolerance.
    if(p==='/proc/uptime')fs.writeFileSync(files.get(p),`${(uptime+(dateNow()-capturedNow)/1000).toFixed(3)} 0.00\n`);
    if(/^\/proc\/[0-9]+\/status$/.test(String(p)) && !files.has(p)) {
    if(options.statusError)throw Object.assign(new Error('synthetic status failure'),{code:options.statusError});
    return originals.openSync(join(dir,'vanished-proc-entry'),...args);
  }return originals.openSync(files.get(p)??p,...args);};
  fs.readlinkSync=(p,...args)=>p==='/proc/self/ns/pid' ? (options.pidNs??'pid:[4026531836]') : p==='/proc/self/ns/time' ? (options.timeNs??'time:[4026531834]') : originals.readlinkSync(p,...args);
  fs.readdirSync=(p,...args)=>p==='/proc' ? (options.entries??[String(process.pid),...(options.innerPid ? ['4194000'] : [])]) : originals.readdirSync(p,...args);
  Date.now=()=>dateNow()+delta;
  syncBuiltinESMExports();
  return ()=>{Object.assign(fs,originals);Date.now=dateNow;syncBuiltinESMExports();};
}
