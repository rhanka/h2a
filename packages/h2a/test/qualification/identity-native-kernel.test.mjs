import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir,hostname} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {identitySelf} from '../../dist/runtime/local-files/identity-fence.js';
import {captureLegacyLock,collectLegacyEvidence} from '../../dist/runtime/local-files/legacy-identity-evidence.js';

test('B9 native: real initial namespace anchors and current-boot legacy admission',()=>{
 const dir=fs.mkdtempSync(join(tmpdir(),'kernel-legacy-')),path=join(dir,'.lock');
 const context=identitySelf(),holder={pid:process.pid,hostname:hostname(),startedAt:new Date().toISOString()};
 const bytes=Buffer.from(JSON.stringify(holder));fs.writeFileSync(path,bytes);
 let capture;
 try {
  capture=captureLegacyLock(path,bytes,holder,context);assert.equal(typeof capture.fd,'number');
  const result=collectLegacyEvidence(capture,performance.now()+1000,identitySelf);
  const initial=context.ns==='pid:[4026531836]'&&context.timeNs==='time:[4026531834]';
  assert.equal(result.dead,false);
  assert.equal(result.reasonCode,initial?'legacy-time-evidence-unavailable':'legacy-proc-view-unsupported');
  console.log(JSON.stringify({kernel:fs.readFileSync('/proc/sys/kernel/osrelease','utf8').trim(),pidNamespace:context.ns,timeNamespace:context.timeNs,procfsMagic:(fs.statfsSync('/proc').type>>>0).toString(16),initialNamespaces:initial,realCollector:result,globalProcessCensus:'NOT RUN: owner forbids observing unowned processes'}));
 }finally{if(typeof capture?.fd==='number')fs.closeSync(capture.fd);fs.rmSync(dir,{recursive:true,force:true});}
});

test('B9 native: private PID namespace availability is recorded without a skip',()=>{
 const probe=spawnSync('unshare',['--user','--map-root-user','--pid','--fork',process.execPath,'-e','process.stdout.write(String(process.pid))'],{encoding:'utf8',timeout:5000,env:{...process.env,LC_ALL:'C',LANG:'C'}});
 console.log(JSON.stringify({privatePidNamespace:probe.status===0?'available':'BLOCKED_ENVIRONMENT',exit:probe.status,stderr:probe.stderr.trim(),pid:probe.stdout.trim(),realPidReuseQualification:probe.status===0?'requires private procfs qualification':'NOT CLOSABLE HERE: namespace creation denied; no global PID allocator changes authorized'}));
 if(probe.status===0)assert.equal(probe.stdout,'1');else assert.match(probe.stderr,/not permitted|Operation not permitted/);
});
