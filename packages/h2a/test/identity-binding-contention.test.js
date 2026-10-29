import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {reclaimOrMint, reclaimOrMintAsync} from '../dist/runtime/identity/bindings.js';
import {listBindings} from '../dist/index.js';
import {fixtureIdentity} from './helpers/identity-proof-fixture.mjs';

for (const mode of ['sync', 'async']) test(mode + ' binding preparation retries registry contention within the original deadline', {timeout:4000}, async t => {
  const root = mkdtempSync(join(tmpdir(), 'binding-registry-'));
  const identity = fixtureIdentity(root, 'claude:contention:id', 'contention');
  mkdirSync(join(root, 'identity'), {recursive: true});
  const lock = join(root, 'registry', '.lock');
  const marker = join(root, 'released');
  const releaseRequest = join(root, 'release-request');
  const code = `import fs from 'node:fs'; import {hostname} from 'node:os';
    const lock=process.argv[1], marker=process.argv[2], fence=process.argv[3], request=process.argv[4];
    fs.writeFileSync(lock, JSON.stringify({pid:process.pid,hostname:hostname(),startedAt:new Date().toISOString()}),{flag:'wx'});
    process.stdout.write('HELD\\n');
    const poll=setInterval(()=>{if(!fs.existsSync(request))return;clearInterval(poll);if(fs.existsSync(fence))process.exitCode=2;fs.unlinkSync(lock);fs.writeFileSync(marker,'released');},1);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, lock, marker, join(root,'identity','.lock'), releaseRequest], {stdio:['ignore','pipe','pipe']});
  const ended = once(child, 'exit');
  t.after(async () => {if(child.exitCode===null && child.signalCode===null){child.kill('SIGKILL');await ended;}rmSync(root,{recursive:true,force:true});});
  await once(child.stdout,'data');
  let mints=0, preparations=0;
  const deps = {verifyProof:()=>false,mint:()=>{mints++;return identity;},now:Date.now};
  const key = {host:'claude',providerSessionId:'contention',workspaceId:'fixture'};
  const options = {deadlineMs:1500, beforePublish:()=>{
    // Keep the real registry holder until a preparation attempt has timed out.
    // Release at the observed retry, rather than an unrelated 500 ms timer.
    if (++preparations === 2) writeFileSync(releaseRequest, 'release');
  }};
  const started = performance.now();
  const result = mode==='sync' ? reclaimOrMint(root,key,deps,options) : await reclaimOrMintAsync(root,key,deps,options);
  assert.equal(result.action,'mint');
  assert.equal(result.instance,identity.instance);
  assert.ok(preparations >= 2, 'at least one real preparation failure must be retried');
  assert.equal(mints,1,'a preparation retry must retain its mint candidate');
  assert.equal(listBindings(root).length,1);
  assert.ok(performance.now()-started < 1500,'the original deadline bounds every preparation attempt');
  assert.equal(existsSync(marker),true);
  assert.deepEqual(await ended,[0,null],'preparation must not hold the identity fence while waiting for registry');
});
