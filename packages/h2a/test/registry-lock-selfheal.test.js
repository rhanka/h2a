import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomBytes, sign, verify } from 'node:crypto';
import { withLockSync, withLock } from '../dist/runtime/local-files/locks.js';
import { createIdentityController } from '../dist/runtime/mcp/identity-state.js';
import { resolveLiveIdentityAsync } from '../dist/runtime/identity/live.js';
import { simulatedReboot } from './helpers/legacy-proc-fixture.mjs';

// This replay changes boot-time evidence only; advisory owner provenance must
// retain the test process's actual PID namespace, including its cached frame.
const actualPidNs=fs.readlinkSync('/proc/self/ns/pid');
const reboot=(root,options={})=>simulatedReboot(root,{pidNs:actualPidNs,...options});

function lab(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'registry-selfheal-'));
  fs.mkdirSync(join(root, 'registry'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, lock: join(root, 'registry', '.lock') };
}
const options = { timeoutMs: 60, pollMs: 5 };
const backups = lock => fs.readdirSync(join(lock, '..')).filter(n => n.startsWith('.lock.quarantine-'));

for (const bytes of ['', '{"pid":']) for (const mode of ['sync', 'async']) {
  test(`should quarantine a previous-boot ${bytes ? 'malformed' : 'empty'} lock (${mode})`, async t => {
    const { root, lock } = lab(t);
    fs.writeFileSync(lock, bytes);
    // Charge clock observations rather than variable fsync latency. The real
    // worker replay below separately exercises the wall-clock deadline.
    const civil=Date.now()+86_400_000;
    const restore = reboot(root,{now:civil});
    let ticks=0;
    Date.now=()=>civil+ticks++;
    try {
      const result = mode === 'sync' ? withLockSync(lock, () => 42, options) : await withLock(lock, () => 42, options);
      assert.equal(result, 42);
      assert.equal(fs.existsSync(lock), false);
      assert.equal(backups(lock).length, 1);
      const backup = join(lock, '..', backups(lock)[0]);
      assert.equal(fs.readFileSync(backup, 'utf8'), bytes);
      assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
    } finally { restore(); }
  });
}

test('should leave no published lock when a child crashes between exclusive create and owner write', t => {
  const { lock } = lab(t);
  const module = new URL('../dist/runtime/local-files/locks.js', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    const original=fs.openSync;
    fs.openSync=(path,flags,...args)=>{const fd=original(path,flags,...args);
      if(String(path).startsWith(process.argv[1]) && flags==='wx')process.exit(77);return fd;};
    syncBuiltinESMExports();
    const {withLockSync}=await import(${JSON.stringify(module)});
    withLockSync(process.argv[1],()=>{throw new Error('crash injection missed');});
  `, lock], { encoding: 'utf8' });
  assert.equal(child.status, 77, child.stderr);
  assert.equal(fs.existsSync(lock), false, 'an incomplete owner must stay private');
  assert.equal(withLockSync(lock, () => 'acquired', options), 'acquired');
});

test('should recover a dead holder that crashed after link publication before staging cleanup', t => {
  const { lock } = lab(t);
  const module = new URL('../dist/runtime/local-files/locks.js', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    const original=fs.linkSync;
    fs.linkSync=(from,to)=>{original(from,to);if(to===process.argv[1])process.exit(78);};
    syncBuiltinESMExports();const {withLockSync}=await import(${JSON.stringify(module)});
    withLockSync(process.argv[1],()=>{});
  `, lock], {encoding:'utf8'});
  assert.equal(child.status,78,child.stderr);
  assert.equal(fs.statSync(lock).nlink,2);
  assert.equal(withLockSync(lock,()=>42,{timeoutMs:1000,pollMs:5}),42);
  assert.equal(backups(lock).length,1);
});

test('should retain a live atomic owner and preserve malformed bytes exactly in quarantine', async t => {
  const {root,lock}=lab(t);
  await withLock(lock,async()=>{
    await assert.rejects(withLock(lock,()=>assert.fail('live atomic holder'),options),{name:'LockTimeoutError'});
    assert.equal(fs.existsSync(lock),true);
  });
  const bytes=Buffer.from([0xff,0xfe,0x00,0x7b]);fs.writeFileSync(lock,bytes);
  const civil=Date.now()+86_400_000,restore=reboot(root,{now:civil});let ticks=0;Date.now=()=>civil+ticks++;
  try{withLockSync(lock,()=>{},options);assert.deepEqual(fs.readFileSync(join(lock,'..',backups(lock)[0])),bytes);}
  finally{restore();}
});

test('should retain recent opaque locks and live holders even with an old declared date', t => {
  const { lock } = lab(t);
  for (const bytes of ['', '{', JSON.stringify({pid:process.pid,hostname:hostname(),startedAt:'2000-01-01T00:00:00.000Z'})]) {
    fs.writeFileSync(lock, bytes);
    assert.throws(() => withLockSync(lock, () => assert.fail('live or ambiguous holder'), options), {name:'LockTimeoutError'});
    assert.equal(fs.readFileSync(lock, 'utf8'), bytes);
    assert.deepEqual(backups(lock), []);
  }
});

test('should fail closed on an unqualified filesystem and incoherent boot clock', t => {
  const { root, lock } = lab(t);
  fs.writeFileSync(lock, '');
  for (const scenario of ['filesystem', 'clock']) {
    const restore = reboot(root, scenario === 'clock' ? {btime:'btime 1\n'} : {});
    const original = fs.statfsSync;
    if (scenario === 'filesystem') { fs.statfsSync = () => ({type:0x6969}); syncBuiltinESMExports(); }
    try {
      assert.throws(() => withLockSync(lock, () => assert.fail('unqualified recovery'), options), {name:'LockTimeoutError'});
      assert.equal(fs.readFileSync(lock, 'utf8'), '');
    } finally { fs.statfsSync=original; syncBuiltinESMExports(); restore(); }
  }
});

test('should durably back up before unlink and keep the original if backup sync fails', t => {
  const { root, lock } = lab(t);
  fs.writeFileSync(lock, '{broken');
  const restore = reboot(root);
  const original = {openSync:fs.openSync, fsyncSync:fs.fsyncSync, unlinkSync:fs.unlinkSync};
  const backupFds = new Set(); let synced = false;
  fs.openSync = (path,...args) => {const fd=original.openSync(path,...args);if(String(path).includes('.quarantine-'))backupFds.add(fd);return fd;};
  fs.fsyncSync = fd => {if(backupFds.has(fd)){synced=true;throw Object.assign(new Error('injected backup failure'),{code:'EIO'});}return original.fsyncSync(fd);};
  fs.unlinkSync = path => {if(path===lock)assert.equal(synced,true,'backup must precede unlink');return original.unlinkSync(path);};
  syncBuiltinESMExports();
  try {
    assert.throws(() => withLockSync(lock, () => assert.fail('backup failure must block'), options));
    assert.equal(synced,true,'the recovery must attempt a durable backup');
    assert.equal(fs.readFileSync(lock,'utf8'),'{broken');
  } finally {Object.assign(fs,original);syncBuiltinESMExports();restore();}
});

test('should release only its own generation after a path is replaced', t => {
  const { lock } = lab(t);
  const replacement = JSON.stringify({pid:process.pid,hostname:hostname(),startedAt:new Date().toISOString(),fenceEpoch:'replacement'});
  withLockSync(lock, () => {fs.unlinkSync(lock);fs.writeFileSync(lock,replacement);},options);
  assert.equal(fs.readFileSync(lock,'utf8'),replacement);
});

test('should retain a live replacement arriving while a stale lock is backed up',t=>{
  const {root,lock}=lab(t);fs.writeFileSync(lock,'');
  const restore=reboot(root),original={openSync:fs.openSync,fsyncSync:fs.fsyncSync};
  let backupFd,swapped=false;
  const replacement=JSON.stringify({pid:process.pid,hostname:hostname(),startedAt:new Date().toISOString()});
  fs.openSync=(path,...args)=>{const fd=original.openSync(path,...args);if(String(path).includes('.quarantine-'))backupFd=fd;return fd;};
  fs.fsyncSync=fd=>{const result=original.fsyncSync(fd);if(fd===backupFd && !swapped){swapped=true;fs.unlinkSync(lock);fs.writeFileSync(lock,replacement);}return result;};
  syncBuiltinESMExports();
  try{assert.throws(()=>withLockSync(lock,()=>assert.fail('live replacement'),options),{name:'LockTimeoutError'});
    assert.equal(swapped,true);assert.equal(fs.readFileSync(lock,'utf8'),replacement);
  }finally{Object.assign(fs,original);syncBuiltinESMExports();restore();}
});

function request(root) {
  return {root,cwd:root,host:'claude',name:'selfheal',readers:{
    env:name=>name==='CLAUDE_CODE_SESSION_ID'?'registry-outage':undefined,
    codexThreadForCwd:()=>undefined,geminiSessionForCwd:()=>undefined,agyConversationForCwd:()=>undefined}};
}
async function terminal(controller) {
  while (controller.status().state==='identity_pending') await new Promise(r=>setTimeout(r,10));
  return controller.status();
}
test('should reach identity_ready with signing and the same identity after a previous-boot empty registry lock', {timeout:10000}, async t => {
  const {root,lock}=lab(t);
  const first=await resolveLiveIdentityAsync(request(root));
  fs.writeFileSync(lock,'');
  const preload=join(root,'reboot.mjs');
  const helper=new URL('./helpers/legacy-proc-fixture.mjs',import.meta.url).href;
  fs.writeFileSync(preload,`import {simulatedReboot} from ${JSON.stringify(helper)};simulatedReboot(${JSON.stringify(root)});`);
  const controller=createIdentityController({request:{root,cwd:root,host:'claude',name:'selfheal',providerEnv:{
    HOME:root,XDG_CONFIG_HOME:root,XDG_STATE_HOME:root,XDG_RUNTIME_DIR:root,CLAUDE_CODE_SESSION_ID:'registry-outage',
    NODE_OPTIONS:`--import=${pathToFileURL(preload).href}`}},timeoutMs:3000,
    activate:identity=>{
      const privateKeyPem=fs.readFileSync(identity.privateKeyPath,'utf8');
      const nonce=randomBytes(32);
      assert.equal(verify(null,nonce,fs.readFileSync(identity.publicKeyPath),sign(null,nonce,privateKeyPem)),true);
      return {ok:true,sessionId:'selfheal',signer:{instance:identity.instance,privateKeyPem}};
    }});
  t.after(()=>controller.cancel('transport_closed'));
  controller.start();
  const status=await terminal(controller);
  assert.equal(status.state,'identity_ready',JSON.stringify(status));
  assert.equal(status.instance,first.instance);
  assert.equal(status.signingAvailable,true);
  assert.equal(backups(lock).length,1);
});

test('should report registry_lock_wait from a real worker blocked by a live registry holder', {timeout:10000}, async t => {
  const {root,lock}=lab(t);
  await resolveLiveIdentityAsync(request(root));
  fs.writeFileSync(lock,JSON.stringify({pid:process.pid,hostname:hostname(),startedAt:new Date().toISOString()}));
  const controller=createIdentityController({request:{root,cwd:root,host:'claude',name:'selfheal',providerEnv:{
    HOME:root,XDG_CONFIG_HOME:root,XDG_STATE_HOME:root,XDG_RUNTIME_DIR:root,CLAUDE_CODE_SESSION_ID:'registry-outage'}},timeoutMs:2000,
    activate:()=>assert.fail('a live registry holder must block readiness')});
  t.after(()=>controller.cancel('transport_closed'));
  controller.start();
  const status=await terminal(controller);
  assert.equal(status.state,'identity_failed');
  assert.equal(status.cause,'identity_timeout');
  assert.equal(status.diagnostic?.reasonCode,'registry_lock_wait',JSON.stringify(status));
  assert.equal(fs.existsSync(lock),true);
});

for(const phase of ['worker','fence_wait','registry_lock_wait'])test(`should report ${phase} at the parent deadline`,t=>{
  let clock=0n,phaseCb,resolved;
  const controller=createIdentityController({request:{root:tmpdir(),cwd:tmpdir(),host:'claude'},timeoutMs:1000,nowNs:()=>clock,
    spawnWorker:()=>({onPhase:cb=>{phaseCb=cb;},onResolved:cb=>{resolved=cb;},onError:()=>{},onExitWithoutResult:()=>{},cancel:()=>{}}),
    activate:()=>assert.fail('late result')});
  t.after(()=>controller.cancel('transport_closed'));
  controller.start();
  if(phase!=='worker'){assert.equal(typeof phaseCb,'function');phaseCb(phase);}
  clock=1000_000_000n;
  resolved({instance:'late',host:'claude',action:'override',privateKeyPath:'',publicKeyPath:''});
  assert.equal(controller.status().diagnostic?.reasonCode,phase);
});

test('should reset phases on retry, ignore superseded callbacks and clear a prior fence blocker',t=>{
  let clock=0n;const attempts=[];
  const controller=createIdentityController({request:{root:tmpdir(),cwd:tmpdir(),host:'claude'},timeoutMs:1000,retryMinIntervalMs:0,nowNs:()=>clock,
    spawnWorker:(_request,_budget,context)=>{const a={context};attempts.push(a);return {onPhase:cb=>a.phase=cb,onObservation:cb=>a.observation=cb,
      onResolved:cb=>a.resolved=cb,onError:()=>{},onExitWithoutResult:()=>{},cancel:()=>{}};},activate:()=>assert.fail('late result')});
  t.after(()=>controller.cancel('transport_closed'));controller.start();
  const late={instance:'late',host:'claude',action:'override',privateKeyPath:'',publicKeyPath:''};
  attempts[0].phase('registry_lock_wait');clock=1000_000_000n;attempts[0].resolved(late);
  assert.equal(controller.status().diagnostic.reasonCode,'registry_lock_wait');assert.equal(controller.retry(),true);
  attempts[0].phase('registry_lock_wait');clock=2000_000_000n;attempts[1].resolved(late);
  assert.equal(controller.status().diagnostic.reasonCode,'worker');assert.equal(controller.retry(),true);
  attempts[2].phase('fence_wait');attempts[2].observation({attemptId:attempts[2].context.attemptId,sequence:1,stabilityKey:'fence',
    diagnostic:{reasonCode:'holder-live',reason:'live fence',retryCondition:'interval'}});
  attempts[2].phase('registry_lock_wait');clock=3000_000_000n;attempts[2].resolved(late);
  assert.equal(controller.status().diagnostic.reasonCode,'registry_lock_wait');
  assert.equal(controller.status().diagnostic.lock,'registry/.lock');
});
