import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
if(!fs.realpathSync('.').startsWith('/tmp/mh-l3-qualification-'))throw Error('private_qualification_copy_required');
const selection='packages/h2a/src/runtime/handover/selection.js',entry='packages/h2a/src/runtime/upgrade/image-entry.js',file='packages/h2a/test/mh-l6-entry.test.js';
const cases=[
 ['direct-binding',selection,'await ensureManagedImageExecution(pathToFileURL(current.entrypoint));','','U12 should reject an external loading profile on the real direct image CLI before reporting its version'],
 ['preimport-integrity',entry,'verifyImageLoader(loader, managedRoot, descriptor.loaderDigest);','','U12 should verify the loader before even its first instruction executes on a direct image path'],
 ['descriptor-protocol',entry,"Object.keys(descriptor).sort().join(',') !== 'loaderDigest,schemaVersion'",'false','U12 should refuse an unknown execution descriptor even when its payload hash is valid'],
 ['selected-argv',selection,'process.argv[1] = current.entrypoint;','','U04 should preserve the exact selected argv entry and PID when the real npm router imports it'],
 ['preload-loading',entry,'await import(url.href);','','U12 should execute the real image CLI with qualified memory options and its exact version'],
];
const paths=[selection,entry,selection.replace('/src/','/dist/'),entry.replace('/src/','/dist/')],originals=paths.map(path=>({path,bytes:fs.readFileSync(path)})),hash=b=>createHash('sha256').update(b).digest('hex'),major=process.versions.node.split('.')[0],results=[];
for(const[name,path,from,to,scenario]of cases){
 const run=color=>{const label=`entry-${name}-${color}`,r=spawnSync(process.execPath,['scripts/mh-l6-test.mjs',file,label],{env:{...process.env,MH_L6_CASE:scenario},encoding:'utf8',maxBuffer:8*1024*1024});
  const log=`docs/plan/mh-l6/evidence/mh-l6-entry.test.js-node${major}-${label}.log`,text=fs.readFileSync(log,'utf8'),receipt=JSON.parse(text.split('\nreceipt: ').at(-1));
  if(r.status!==(color==='red'?1:0)||receipt.invalid||receipt.signal||receipt.tests!==1||(color==='red'&&!text.includes('ERR_ASSERTION')))throw Error(`invalid_mutation:${name}:${color}:${log}`);return log;};
 let red;
 try{for(const target of[path,path.replace('/src/','/dist/')]){const bytes=originals.find(o=>o.path===target).bytes;const re=new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s*'),'g');if([...bytes.toString().matchAll(re)].length!==1)throw Error('mutation_not_unique:'+name);fs.writeFileSync(target,bytes.toString().replace(re,()=>to));}red=run('red');}
 finally{for(const o of originals)fs.writeFileSync(o.path,o.bytes);}
 const green=run('green');for(const o of originals)if(hash(fs.readFileSync(o.path))!==hash(o.bytes))throw Error('restore_failed');
 results.push({name,red,green,restored:true});fs.writeFileSync(`docs/plan/mh-l6/mutations-entry-node${major}.json`,JSON.stringify({node:process.version,files:originals.map(o=>({path:o.path,sha256:hash(o.bytes)})),results},null,2)+'\n');process.stdout.write(name+': assertion red, restored green\n');
}
