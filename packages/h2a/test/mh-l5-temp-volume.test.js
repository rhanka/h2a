import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCampaign} from './helpers/mh-l5-campaign.js';

function configured(t, make) {
  const root=fs.mkdtempSync(join(tmpdir(),'mh-l5-volume-'));
  const prior=process.env.H2A_TEST_M17_TMPDIR;
  t.after(()=>{
    if(prior===undefined)delete process.env.H2A_TEST_M17_TMPDIR;else process.env.H2A_TEST_M17_TMPDIR=prior;
    fs.rmSync(root,{recursive:true,force:true});
  });
  const path=make(root);process.env.H2A_TEST_M17_TMPDIR=path;
  return {root,path};
}

test('M17 refuses a missing configured volume instead of falling back to another filesystem',async t=>{
  const {root}=configured(t,root=>join(root,'missing'));
  await assert.rejects(runCampaign(2),/m17_temp_volume_invalid/);
  assert.deepEqual(fs.readdirSync(root),[]);
});
test('M17 refuses a symlink configured volume before creating backend state',async t=>{
  const {root}=configured(t,root=>{const path=join(root,'link');fs.symlinkSync(root,path);return path;});
  await assert.rejects(runCampaign(2),/m17_temp_volume_invalid/);
  assert.deepEqual(fs.readdirSync(root),['link']);
});
test('M17 refuses a configured volume writable by another user',async t=>{
  const {root}=configured(t,root=>{fs.chmodSync(root,0o777);return root;});
  await assert.rejects(runCampaign(2),/m17_temp_volume_invalid/);
  assert.deepEqual(fs.readdirSync(root),[]);
});
test('M17 refuses a regular file configured as its temporary volume',async t=>{
  const {root}=configured(t,root=>{const path=join(root,'file');fs.writeFileSync(path,'sentinel');return path;});
  await assert.rejects(runCampaign(2),/m17_temp_volume_invalid/);
  assert.equal(fs.readFileSync(join(root,'file'),'utf8'),'sentinel');
});
test('M17 executes every real actor on its configured private volume and removes its state',async t=>{
  const {root}=configured(t,root=>root);
  const result=await runCampaign(2);
  assert.equal(result.acknowledged,16);
  assert.equal(result.actors.length,8);
  assert.ok(result.minimumLockAcquisitionsPerIteration>=8);
  assert.deepEqual(result.storage,{type:fs.statfsSync(root).type,configured:true});
  assert.deepEqual(fs.readdirSync(root),[]);
});
