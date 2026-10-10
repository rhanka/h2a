import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const repo=path.resolve(import.meta.dirname,'../..');
const red=process.argv.includes('--red');
const root=fs.mkdtempSync(repo+'/.qual-tmp/capacity-witness-');
for(const name of ['home','runtime','state','config'])fs.mkdirSync(root+'/'+name);
const module=red?repo+'/.qual-tmp/red/launch-capacity.mjs':repo+'/packages/h2a-runtime/dist/launch-capacity.js';
const env={...process.env,HOME:root+'/home',XDG_RUNTIME_DIR:root+'/runtime',XDG_STATE_HOME:root+'/state',XDG_CONFIG_HOME:root+'/config'};
try{
 const call=id=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`import {acquireLaunchSlot} from ${JSON.stringify(module)};console.log(JSON.stringify(acquireLaunchSlot(${JSON.stringify(id)},1)));`],{env,encoding:'utf8'}));
 const results=[call('one'),call('one'),call('two')];
 console.log(JSON.stringify({module,results}));
 assert.deepEqual(results.map(r=>r.acquired),[true,false,false]);
}finally{fs.rmSync(root,{recursive:true,force:true});}
