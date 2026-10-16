// Private qualification copy only. Mutants never enter a published payload.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
if (!fs.realpathSync('.').startsWith('/tmp/mh-l3-qualification-')) throw new Error('private_qualification_copy_required');
const path='packages/h2a/src/runtime/upgrade/image-execution.js',file='packages/h2a/test/mh-l6-launcher.test.js';
const cases=[
 ['child-spawn',"for (const key of ['spawn', 'spawnSync', 'execFile', 'execFileSync'])",'for (const key of [])','U12 should guard the selected image spawn before its late external import'],
 ['child-fork','cp.fork = function(file, args, options) {','cp.fork = function(file, args, options) { return original.fork.call(this,file,args,options);','U12 should guard the selected image fork before its late external import'],
 ['child-worker','constructor(file, options = {}) {','constructor(file, options = {}) { if(true) return new OriginalWorker(file,options);','U12 should guard the selected image worker before its late external import'],
 ['loader-integrity',"if (actual !== 'sha256:' + match[1] || (expectedDigest && actual !== expectedDigest)) throw new Error('image_loader_integrity');",'','U12 should require the pinned standalone preload while keeping status available without it'],
 ['child-preflight','const preload = target => {\n    verifyImageLoader(loader, managedRoot);','const preload = target => {','U12 should reverify the immutable preload before starting any selected image child'],
 ['child-loader-flags',"if (result.some(arg => !memory.test(arg))) throw new Error('external_loader_unqualified');",'','U12 should refuse external loader options before creating an image fork'],
 ['worker-loader-flags',"if (result.some(arg => !memory.test(arg))) throw new Error('external_loader_unqualified');",'','U12 should refuse external loader options before creating an image worker'],
 ['candidate-binding',"url.searchParams.set('image', target.root)","url.searchParams.set('image', root)",'U12 should bind a candidate process to its own image without importing it into the source process'],
 ['child-installation',"if (!installation || ['prefixId', 'canonicalPrefix', 'uid', 'managedRoot'].some(key => installation[key] !== physical[key])) throw new Error('foreign_installation_authority');",'','U12 should revalidate physical installation authority in an image child before its entry executes'],
 ['worker-memory','execArgv: [preload(target)]','execArgv: [...workerFlags, preload(target)]','U12 should preserve a guarded Worker when the launcher has a qualified memory option'],
];
const bytes=fs.readFileSync(path),hash=b=>createHash('sha256').update(b).digest('hex'),major=process.versions.node.split('.')[0],results=[];
for(const [name,from,to,scenario]of cases){
 const run=color=>{
  const label=`execution-${name}-${color}`,r=spawnSync(process.execPath,['scripts/mh-l6-test.mjs',file,label],{env:{...process.env,MH_L6_CASE:scenario},encoding:'utf8',maxBuffer:8*1024*1024});
  const log=`docs/plan/mh-l6/evidence/mh-l6-launcher.test.js-node${major}-${label}.log`,text=fs.readFileSync(log,'utf8'),receipt=JSON.parse(text.split('\nreceipt: ').at(-1));
  if(r.status!==(color==='red'?1:0)||receipt.invalid||receipt.signal||receipt.tests!==1||(color==='red'&&!text.includes('ERR_ASSERTION')))throw Error(`invalid_mutation:${name}:${color}:${log}`);
  return log;
 };
 let red;
 try{if(bytes.toString().split(from).length!==2)throw Error('mutation_not_unique:'+name);fs.writeFileSync(path,bytes.toString().replace(from,to));red=run('red');}
 finally{fs.writeFileSync(path,bytes);}
 const green=run('green');if(hash(fs.readFileSync(path))!==hash(bytes))throw Error('restore_failed');
 results.push({name,red,green,restored:true});fs.writeFileSync(`docs/plan/mh-l6/mutations-execution-node${major}.json`,JSON.stringify({node:process.version,files:[{path,sha256:hash(bytes)}],results},null,2)+'\n');
 process.stdout.write(name+': assertion red, restored green\n');
}
