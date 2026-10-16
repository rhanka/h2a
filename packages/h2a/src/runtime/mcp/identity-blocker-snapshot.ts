// Diagnostic change witness only: asynchronous bounded reads, no death proof
// and no process probe on the MCP event loop.
import { open, readlink, stat, statfs, opendir } from 'node:fs/promises';
import { createHmac, createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

async function boundedFile(path: string): Promise<{bytes:Buffer;stamp:string}|undefined> {
  let handle;
  try {
    handle=await open(path,'r');const before=await handle.stat();
    if(!before.isFile() || before.size>65536)return undefined;
    const bytes=Buffer.alloc(65537);const {bytesRead}=await handle.read(bytes,0,bytes.length,0);
    if(bytesRead>65536)return undefined;
    const after=await handle.stat();const current=await stat(path);
    if(before.ino!==after.ino || before.size!==after.size || before.ctimeMs!==after.ctimeMs || current.ino!==after.ino || current.dev!==after.dev)return undefined;
    return {bytes:bytes.subarray(0,bytesRead),stamp:`${after.dev}/${after.ino}/${after.size}/${after.ctimeMs}`};
  }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {bytes:Buffer.alloc(0),stamp:'absent'};return undefined;}
  finally{await handle?.close();}
}

export async function identityBlockerSnapshot(root: string, key: string, capacity=false): Promise<string|undefined> {
  const hash=createHmac('sha256',Buffer.from(key,'hex'));
  const lock=join(root,'identity','.lock');let path=lock;
  for(let depth=0;depth<=8;depth++) {
    const observed=await boundedFile(path);if(!observed)return undefined;
    hash.update(observed.bytes).update(observed.stamp);
    if(observed.stamp==='absent')break;
    let token:string|undefined;
    try{const rec=JSON.parse(observed.bytes.toString());token=typeof rec.token==='string'?rec.token:undefined;}catch{}
    if(!token) {
      // Historical election names use SHA-256 of exact bytes, not a diagnostic HMAC.
      token='legacy-'+createHash('sha256').update(observed.bytes).digest('hex');
    }
    if(!/^[A-Za-z0-9_-]{12,128}$/.test(token))break;
    path=lock+'.succ.'+token;
  }
  try {
    const fs=await statfs(dirname(lock));hash.update(String(fs.type>>>0));
    for(const path of ['/etc/machine-id','/var/lib/dbus/machine-id','/proc/sys/kernel/random/boot_id']) {
      const source=await boundedFile(path);if(source)hash.update(source.bytes);else hash.update('unknown');
    }
    hash.update(await readlink('/proc/self/ns/pid')).update(await readlink('/proc/self/ns/time'));
  }catch{hash.update('capability-unknown');}
  if(capacity) {
    try{const proc=await opendir('/proc');let count=0;
      try{for(;;){const entry=await proc.read();if(!entry)break;if(/^[0-9]+$/.test(entry.name))count++;if(count>8192)break;}}
      finally{await proc.close();}
      hash.update(count>8192?'process-capacity-exceeded':'process-capacity-available');
    }catch{return undefined;}
  }
  return hash.digest('hex');
}
