import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { installationFixture } from './helpers/mh-l6-installation.js';
import { UpgradeStore } from '../dist/runtime/upgrade/h4-store.js';
import { readState, replaceState } from '../src/runtime/handover/state.js';
const { buildManagedLauncher } = await import('../../../scripts/build-managed-launcher.mjs').catch(e => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; return {};
});
const test = (name, fn) => { if (!process.env.MH_L6_CASE || name === process.env.MH_L6_CASE) nodeTest(name, fn); };
// Deliver the Worker's real queued messages immediately before its real exit,
// in the same turn. This preserves Node's message-before-exit contract while
// exposing a listener registered too late, without fabricating either event.
function flushWorkerMessagesAtExit(worker) {
  const original = worker.emit, remove = worker.removeAllListeners, messages = [];
  worker.emit = function (event, ...args) {
    if (event === 'message') { messages.push(args); return true; }
    return Reflect.apply(original, this, [event, ...args]);
  };
  worker.removeAllListeners = function (...args) {
    // Node drains its public port immediately before removing these listeners,
    // then emits exit in the same stack. Keep delivery before that teardown.
    if (args[0] === 'message') for (const message of messages.splice(0))
      Reflect.apply(original, this, ['message', ...message]);
    return Reflect.apply(remove, this, args);
  };
}
async function fixture(t, entrySource) {
  assert.equal(typeof buildManagedLauncher, 'function', 'standalone same-process launcher required');
  const f = installationFixture(); t.after(() => f.close());
  const target = f.image('launcher-selected', 1, entrySource ?? `process.stdout.write(JSON.stringify({selected:true,pid:process.pid,entry:process.argv[1],nodePath:process.env.NODE_PATH??null})+'\\n');\n`);
  const store = new UpgradeStore(f.layout); store.begin({ upgradeId: 'one', target }); store.prepare('one'); store.select('one');
  const directory = join(f.layout.managedRoot, 'launcher'); fs.mkdirSync(directory, { mode: 0o700 });
  const launcher = join(directory, 'h2a.mjs'), bundle = await buildManagedLauncher();
  fs.writeFileSync(launcher, bundle.code, { mode: 0o700 });
  fs.mkdirSync(join(f.layout.managedRoot, 'bootstrap'), { mode: 0o700 });
  fs.writeFileSync(join(f.layout.managedRoot, 'bootstrap', bundle.loader.filename), bundle.loader.code, { mode: 0o700 });
  fs.mkdirSync(join(f.layout.canonicalPrefix, 'bin'), { mode: 0o700 });
  fs.symlinkSync(launcher, join(f.layout.canonicalPrefix, 'bin/h2a'));
  const run = (args = ['--json'], extra = {}, execArgs = []) => {
    const env = { ...process.env, PATH: join(f.layout.canonicalPrefix, 'bin') + ':/usr/bin', ...extra };
    delete env.NODE_OPTIONS; if (extra.NODE_OPTIONS) env.NODE_OPTIONS = extra.NODE_OPTIONS;
    const result = spawnSync(process.execPath, [...execArgs, launcher, ...args], { env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.signal, null, result.stderr); assert.equal(result.error, undefined, result.stderr);
    return { ...result, json: result.stdout.trim() ? JSON.parse(result.stdout) : undefined };
  };
  return { ...f, target, store, launcher, bundle, run };
}

test('U04 should import the verified absolute image in the launcher PID without npm imports', async t => {
  const f = await fixture(t), result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.selected, true);
  assert.equal(result.json.pid, result.pid);
  assert.equal(result.json.entry, join(f.target.root, f.target.entrypoint));
  assert.ok(f.bundle.imports.length > 0);
  assert.equal(f.bundle.imports.every(i => i.startsWith('node:')), true);
  const second = await buildManagedLauncher(); assert.equal(second.digest, f.bundle.digest);
});

test('U12 should remove NODE_PATH and refuse external loading flags from env or node argv', async t => {
  const f = await fixture(t);
  assert.equal(f.run([], { NODE_PATH: join(f.layout.canonicalPrefix, 'decoy') }).json.nodePath, null);
  const decoy = join(f.layout.canonicalPrefix, 'loader.mjs'); fs.writeFileSync(decoy, 'export {};');
  for (const result of [f.run(['--json'], { NODE_OPTIONS: `--import=${decoy}` }), f.run(['--json'], {}, ['--import', decoy])]) {
    assert.equal(result.status, 1);
    assert.equal(result.json.reason, 'external_loader_unqualified');
    assert.equal(result.json.selected, undefined);
  }
});

test('U06 should keep status read-only and use verified history only for diagnostics when selection is corrupt', async t => {
  const f = await fixture(t), path = join(f.state, 'selected-build.json'); fs.writeFileSync(path, '{');
  const before = fs.readFileSync(path), tx = fs.readFileSync(join(f.state, 'upgrade/transactions/one.json'));
  const status = f.run(['upgrade', 'status', '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.json.selectionState, 'unreadable');
  assert.equal(status.json.recoveryCandidate.manifestDigest, f.target.manifestDigest);
  assert.equal(status.json.mutationsAllowed, false);
  assert.deepEqual(fs.readFileSync(path), before);
  assert.deepEqual(fs.readFileSync(join(f.state, 'upgrade/transactions/one.json')), tx);
  const serve = f.run(['mcp-serve', '--json']);
  assert.equal(serve.status, 1);
  assert.equal(serve.json.reason, 'selection_unreadable');
  assert.equal(serve.json.selected, undefined);
});

test('U06 should reject altered payload and foreign selection before importing code', async t => {
  const f = await fixture(t); fs.appendFileSync(join(f.target.root, f.target.entrypoint), '\n// changed');
  const tampered = f.run(); assert.equal(tampered.status, 1); assert.equal(tampered.json.reason, 'payload_mismatch');
  const path = join(f.state, 'selected-build.json'), record = readState(path, 'selection');
  replaceState(path, { ...record.value, prefixId: 'sha256:' + 'f'.repeat(64) }, 'selection', record);
  const foreign = f.run(); assert.equal(foreign.status, 1); assert.equal(foreign.json.reason, 'foreign_installation_authority');
});

test('U09 should diagnose PATH shadowing and a changed command link without rewriting either', async t => {
  const f = await fixture(t), rogue = join(f.layout.canonicalPrefix, 'rogue'); fs.mkdirSync(rogue, { mode: 0o700 });
  fs.writeFileSync(join(rogue, 'h2a'), '#!/bin/sh\nexit 97\n', { mode: 0o700 });
  const shadow = f.run(['--json'], { PATH: rogue + ':' + join(f.layout.canonicalPrefix, 'bin') });
  assert.equal(shadow.status, 1); assert.equal(shadow.json.reason, 'path_shadowing');
  const link = join(f.layout.canonicalPrefix, 'bin/h2a'); fs.unlinkSync(link); fs.symlinkSync(join(rogue, 'h2a'), link);
  const changed = f.run(['upgrade', 'status', '--json']);
  assert.equal(changed.status, 0); assert.equal(changed.json.externalInstallDetected, true);
  assert.equal(fs.readlinkSync(link), join(rogue, 'h2a'));
  const empty = join(f.layout.canonicalPrefix, 'empty'); fs.mkdirSync(empty, { mode: 0o700 });
  const launch = f.run(['--json'], { PATH: empty });
  assert.equal(launch.status, 1); assert.equal(launch.json.reason, 'external_install_detected');
});

test('U06 should never import an older fallback during an engaged selection transaction', async t => {
  const f = await fixture(t), path = join(f.state, 'selected-build.json'); fs.writeFileSync(path, 'null\n');
  const result = f.run(['upgrade', 'resume', 'one', '--json']);
  assert.equal(result.status, 1);
  assert.equal(result.json.reason, 'selection_unreadable');
  assert.equal(result.json.selected, undefined);
  assert.equal(f.store.status('one').installationState, 'SELECTED');
});

test('U06 should reject a corrupt history payload as a diagnostic recovery candidate', async t => {
  const f = await fixture(t); fs.writeFileSync(join(f.state, 'selected-build.json'), '{');
  fs.appendFileSync(join(f.target.root, f.target.entrypoint), '\n// history payload changed');
  const status = f.run(['upgrade', 'status', '--json']);
  assert.equal(status.status, 0);
  assert.equal(status.json.recoveryCandidate, null);
  assert.equal(status.json.mutationsAllowed, false);
});

test('U06 should keep an in-progress selection available only for diagnosis until reconciled', async t => {
  const f = await fixture(t), path = join(f.state, 'upgrade/transactions/one.json'), record = readState(path, 'upgradeTransaction');
  replaceState(path, { ...record.value, revision: record.value.revision + 1, installationState: 'SELECTING' }, 'upgradeTransaction', record);
  const result = f.run(); assert.equal(result.status, 1); assert.equal(result.json.reason, 'selection_recovery_required');
  const status = f.run(['upgrade', 'status', '--json']);
  assert.equal(status.status, 0); assert.equal(status.json.transactions[0].phase, 'SELECTING');
  assert.equal(readState(path, 'upgradeTransaction').value.installationState, 'SELECTING');
});

test('U06 should refuse to claim a reliable status for an unknown journal without repairing it', async t => {
  const f = await fixture(t), path = join(f.state, 'upgrade/transactions/one.json');
  const bytes = JSON.stringify({ ...readState(path, 'upgradeTransaction').value, schemaVersion: 999 }) + '\n'; fs.writeFileSync(path, bytes);
  const status = f.run(['upgrade', 'status', '--json']);
  assert.equal(status.status, 1); assert.equal(status.json.ok, false);
  assert.match(status.json.reason, /invalid_format/);
  assert.equal(fs.readFileSync(path, 'utf8'), bytes);
});

test('U10 should refuse a runtime outside the qualified glibc profile before importing any image', async t => {
  const f = await fixture(t), { launchManaged } = await import('../src/runtime/upgrade/managed-launcher.js');
  const argv = [...process.argv], path = process.env.PATH, options = process.env.NODE_OPTIONS;
  t.after(() => { process.argv = argv; process.env.PATH = path;
    if (options === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = options; });
  process.env.PATH = join(f.layout.canonicalPrefix, 'bin'); delete process.env.NODE_OPTIONS;
  t.mock.method(process.report, 'getReport', () => ({ header: {} }));
  await assert.rejects(launchManaged(pathToFileURL(f.launcher).href), /authority_profile_unqualified/);
});

test('U12 should install the closed reader before the selected entry can import outside its image', async t => {
  const f = await fixture(t, "await import(process.env.IMAGE_POLICY_DECOY);process.stdout.write(JSON.stringify({selected:true})+'\\n');");
  const decoy = join(f.layout.canonicalPrefix, 'outside.mjs'), marker = join(f.layout.canonicalPrefix, 'decoy-loaded');
  fs.writeFileSync(decoy, `import fs from'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'loaded');`);
  const result = f.run(['--json'], { IMAGE_POLICY_DECOY: pathToFileURL(decoy).href });
  assert.equal(result.status, 1); assert.equal(result.json.reason, 'image_external_module');
  assert.equal(fs.existsSync(marker), false);
});

for (const method of ["spawn", "fork", "worker"]) test("U12 should guard the selected image " + method + " before its late external import", async t => {
  const source = `import {spawnSync,fork} from "node:child_process";
import {Worker,isMainThread,parentPort} from "node:worker_threads";
if (process.argv.includes("--image-child") || !isMainThread) { await import(process.env.IMAGE_POLICY_DECOY); process.exitCode=0; }
else {
 const method=process.argv[2]; let code,reason;
 if(method==="spawn"){const r=spawnSync(process.execPath,[process.argv[1],"--image-child"],{encoding:"utf8"});code=r.status;reason=r.stderr;}
 if(method==="fork"){const child=fork(process.argv[1],["--image-child"],{silent:true});let errors="";child.stderr.on("data",b=>errors+=b);code=await new Promise((r,j)=>{child.on("error",j);child.on("close",r);});reason=errors;}
 if(method==="worker"){const child=new Worker(new URL(import.meta.url));reason=await new Promise(r=>{child.once("error",e=>r(e.message));child.once("exit",c=>r(c===0?"loaded":"failed"));});code=reason==="loaded"?0:1;}
 process.stdout.write(JSON.stringify({code,reason})+"\\n");
}`;
  const f=await fixture(t,source), decoy=join(f.layout.canonicalPrefix,"descendant-decoy.mjs"),marker=join(f.layout.canonicalPrefix,"descendant-loaded");
  fs.writeFileSync(decoy, `import fs from "node:fs";fs.writeFileSync(${JSON.stringify(marker)},"loaded");`);
  const result=f.run([method],{IMAGE_POLICY_DECOY:pathToFileURL(decoy).href});
  assert.equal(result.status,0,result.stderr); assert.equal(result.json.code,1,JSON.stringify(result.json));
  assert.match(result.json.reason,/image_external_module/); assert.equal(fs.existsSync(marker),false);
});

for (const method of ['spawn', 'fork', 'worker']) test('U12 should preserve verified internal execution through ' + method + ' with explicit child options', async t => {
  const source = `${flushWorkerMessagesAtExit}\nimport {spawnSync,fork} from 'node:child_process';import {Worker,isMainThread,parentPort} from 'node:worker_threads';
if(process.argv.includes('--image-child')||!isMainThread){const c=globalThis[Symbol.for('sentropic.h2a.image-context/v1')];const result={verified:Boolean(c),root:c?.root,nodePath:process.env.NODE_PATH??null,pid:process.pid};if(!isMainThread)parentPort.postMessage(result);else process.stdout.write(JSON.stringify(result)+'\\n');}
else{const method=process.argv[2];let result;
if(method==='spawn'){const r=spawnSync(process.execPath,['--max-old-space-size=128','--',process.argv[1],'--image-child'],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);result=JSON.parse(r.stdout);}
if(method==='fork'){const c=fork(process.argv[1],['--image-child'],{silent:true,execArgv:[]});let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);const code=await new Promise((r,j)=>{c.on('error',j);c.on('close',r);});if(code!==0)throw Error(err);result=JSON.parse(out);}
if(method==='worker'){const c=new Worker(new URL(import.meta.url),{execArgv:[]});flushWorkerMessagesAtExit(c);const exited=new Promise(r=>c.once('exit',r));result=await new Promise((r,j)=>{c.once('message',r);c.once('error',j);});if(await exited!==0)throw Error('worker_exit_failed');}
process.stdout.write(JSON.stringify({result,parent:process.pid})+'\\n');}`;
  const f=await fixture(t,source), r=f.run([method]);
  assert.equal(r.status,0,r.stderr);assert.equal(r.json.result.verified,true);assert.equal(r.json.result.root,f.target.root);
  assert.equal(r.json.result.nodePath,null);if(method!=='worker')assert.notEqual(r.json.result.pid,r.json.parent);
});

test('U12 should reverify the immutable preload before starting any selected image child', async t => {
  const source=`import fs from 'node:fs';import{spawnSync}from'node:child_process';const c=globalThis[Symbol.for('sentropic.h2a.image-context/v1')];fs.appendFileSync(c.loader,'\\n// changed');let reason;try{spawnSync(process.execPath,[process.argv[1],'--image-child']);}catch(e){reason=e.message;}process.stdout.write(JSON.stringify({reason})+'\\n');`;
  const f=await fixture(t,source),r=f.run();assert.equal(r.status,0,r.stderr);assert.equal(r.json.reason,'image_loader_integrity');
});

test('U12 should require the pinned standalone preload while keeping status available without it', async t => {
  const f=await fixture(t), path=join(f.layout.managedRoot,'bootstrap',f.bundle.loader.filename);
  fs.appendFileSync(path,'\n// changed');let r=f.run();assert.equal(r.status,1);assert.equal(r.json.reason,'image_loader_integrity');
  fs.unlinkSync(path);r=f.run(['upgrade','status','--json']);assert.equal(r.status,0,r.stderr);assert.equal(r.json.selectionState,'verified');
  r=f.run();assert.equal(r.status,1);assert.match(r.json.reason,/ENOENT/);
});

test('U12 should keep external Node applications outside the image without hard-wiring an MCP allowlist', async t => {
  const source=`import{spawnSync,fork}from'node:child_process';import{readFileSync}from'node:fs';let external;
if(process.argv.includes('--image-child')){const c=fork(process.env.EXTERNAL_NODE,[],{silent:true});let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);const code=await new Promise((r,j)=>{c.on('error',j);c.on('close',r);});if(code!==0)throw Error(err);external=JSON.parse(out);}else{const c=spawnSync(process.execPath,[process.argv[1],'--image-child'],{encoding:'utf8'});if(c.status!==0)throw Error(c.stderr);external=JSON.parse(c.stdout).external;}
process.stdout.write(JSON.stringify({external})+'\\n');`;
  const f=await fixture(t,source),external=join(f.layout.canonicalPrefix,'external-app.mjs');
  fs.writeFileSync(external,"process.stdout.write(JSON.stringify({external:true,restricted:Boolean(globalThis[Symbol.for('sentropic.h2a.image-context/v1')])})+'\\n');");
  const r=f.run([],{EXTERNAL_NODE:external});assert.equal(r.status,0,r.stderr);assert.deepEqual(r.json.external,{external:true,restricted:false});
});

test('U12 should bind a candidate process to its own image without importing it into the source process', async t => {
  const source=`import{spawnSync}from'node:child_process';const c=spawnSync(process.execPath,[process.env.IMAGE_CANDIDATE],{encoding:'utf8'});if(c.status!==0)throw Error(c.stderr);process.stdout.write(JSON.stringify({source:globalThis[Symbol.for('sentropic.h2a.image-context/v1')].root,target:JSON.parse(c.stdout)})+'\\n');`;
  const f=await fixture(t,source),candidate=f.image('future-compatible-candidate',1,"process.stdout.write(JSON.stringify({root:globalThis[Symbol.for('sentropic.h2a.image-context/v1')].root})+'\\n');");
  const r=f.run([],{IMAGE_CANDIDATE:join(candidate.root,candidate.entrypoint)});assert.equal(r.status,0,r.stderr);
  assert.equal(r.json.source,f.target.root);assert.equal(r.json.target.root,candidate.root);
});

for(const method of ['fork','worker']) test('U12 should refuse external loader options before creating an image '+method,async t=>{
  const source=`import{fork}from'node:child_process';import{Worker,isMainThread}from'node:worker_threads';let rejectedBeforeSpawn=false,reason;
if(!isMainThread){}else if(process.argv.includes('--image-child')){process.stdout.write(JSON.stringify({executed:true})+'\\n');}else{
try{const opts={execArgv:['--import='+process.env.CHILD_LOADER]};const c=process.argv[2]==='fork'?fork(process.argv[1],['--image-child'],{...opts,silent:true}):new Worker(new URL(import.meta.url),opts);if(process.argv[2]==='fork'){c.stderr.resume();c.stdout.resume();await new Promise(r=>c.once('close',r));}else{c.on('error',()=>{});await new Promise(r=>c.once('exit',r));}}
catch(e){rejectedBeforeSpawn=true;reason=e.message;}process.stdout.write(JSON.stringify({rejectedBeforeSpawn,reason})+'\\n');}`;
  const f=await fixture(t,source),decoy=join(f.layout.canonicalPrefix,'child-loader.mjs'),marker=join(f.layout.canonicalPrefix,'loader-effect');
  fs.writeFileSync(decoy,`import fs from'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'loaded');`);
  const r=f.run([method],{CHILD_LOADER:pathToFileURL(decoy).href});assert.equal(r.status,0,r.stderr);
  assert.equal(r.json.rejectedBeforeSpawn,true);assert.equal(r.json.reason,'external_loader_unqualified');assert.equal(fs.existsSync(marker),false);
});

test('U12 should revalidate physical installation authority in an image child before its entry executes',async t=>{
  const source=`import fs from'node:fs';import{dirname,join}from'node:path';import{spawnSync}from'node:child_process';
if(process.argv.includes('--image-child'))process.stdout.write(JSON.stringify({executed:true})+'\\n');else{const c=globalThis[Symbol.for('sentropic.h2a.image-context/v1')],path=join(dirname(dirname(c.root)),'installation.json');const value=JSON.parse(fs.readFileSync(path,'utf8'));value.prefixId='sha256:'+'f'.repeat(64);fs.writeFileSync(path,JSON.stringify(value)+'\\n');const result=spawnSync(process.execPath,[process.argv[1],'--image-child'],{encoding:'utf8'});process.stdout.write(JSON.stringify({code:result.status,error:result.stderr,output:result.stdout})+'\\n');}`;
  const f=await fixture(t,source),r=f.run();assert.equal(r.status,0,r.stderr);assert.equal(r.json.code,1);
  assert.match(r.json.error,/foreign_installation_authority/);assert.equal(r.json.output,'');
});

test('U12 should preserve a guarded Worker when the launcher has a qualified memory option',async t=>{
  const source=`${flushWorkerMessagesAtExit}\nimport{Worker,isMainThread,parentPort,resourceLimits}from'node:worker_threads';if(isMainThread){const c=new Worker(new URL(import.meta.url));flushWorkerMessagesAtExit(c);const exited=new Promise(r=>c.once('exit',r));const result=await new Promise((r,j)=>{c.once('message',r);c.once('error',j);});if(await exited!==0)throw Error('worker_exit_failed');process.stdout.write(JSON.stringify(result)+'\\n');}else parentPort.postMessage({verified:Boolean(globalThis[Symbol.for('sentropic.h2a.image-context/v1')]),limit:resourceLimits.maxOldGenerationSizeMb});`;
  const f=await fixture(t,source),r=f.run([],{},['--max-old-space-size=128']);assert.equal(r.status,0,r.stderr);assert.equal(r.json.verified,true);assert.equal(r.json.limit,128);
});
