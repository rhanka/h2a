// Mutants exist only in the private qualification copy and are always restored.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
if(!fs.realpathSync('.').startsWith('/tmp/mh-l3-qualification-'))throw Error('private_qualification_copy_required');
const base='packages/h2a/',policy=base+'src/runtime/upgrade/image-execution.js',cli=base+'src/cli.ts',boot=base+'src/runtime/upgrade/boot-worker.js',file=base+'test/mh-l6-components.test.js';
const cases=[
 ['boot-file',cli,'fileURLToPath(new URL("./runtime/upgrade/boot-worker.js", import.meta.url)),','"--input-type=module", "--eval", MCP_UPGRADE_WORKER_SOURCE, "--", new URL("./runtime/upgrade/index.js", import.meta.url).href,','U12 should prevent the real MCP boot worker from executing code changed after its parent verified the image'],
 ...['spawn','spawnSync','execFile','execFileSync'].map(method=>['external-'+method,policy,'if (qualified && !options.shell) return { args: [...withoutOwnPreload(args.slice(0, first)), ...args.slice(first)], options };',"if (qualified && !options.shell) throw new Error('image_child_entry_unqualified');",'U12 should allow an external Node application to receive image data through '+method]),
 ['physical-entry',policy,"const prefix = join(managedRoot, 'images') + sep;","const prefix = join(managedRoot, 'images') + sep; if (!requested.startsWith(prefix)) return undefined;",'U12 should bind physical image execution through alias-fork before any external effect'],
 ['node-alias',policy,'if (!nodeCommand && isAbsolute(command)) {','if (false) {','U12 should bind physical image execution through alias-node before any external effect'],
 ['entry-alias',policy,'const target = imageAt(managedRoot, args[first], cwd);',"const target = inside(join(managedRoot, 'images'), resolve(cwd, args[first])) ? imageAt(managedRoot, args[first], cwd) : undefined;",'U12 should bind physical image execution through alias-spawn before any external effect'],
 ['entry-uri',policy,"file instanceof URL || (typeof file === 'string' && file.startsWith('file:'))",'file instanceof URL','U12 should refuse an unqualified Node URL entry before it can escape the image reader'],
 ...['journal','identity'].map(kind=>['real-fork-'+kind,policy,'cp.fork = function (file, args, options) {','cp.fork = function(file, args, options) { return original.fork.call(this,file,args,options);','U12 should prevent the real '+kind+' child from executing late altered code']),
 ...['spawn','execFile','execFileSync'].map(method=>['internal-'+method,policy,"for (const key of ['spawn', 'spawnSync', 'execFile', 'execFileSync'])",'for (const key of [])','U12 should refuse an external late import from the internal '+method+' entry']),
 ['direct-boot-gate',boot,'await ensureManagedImageExecution(import.meta.url);','','U12 should guard the real boot file on a direct Node entry outside its parent launcher'],
 ['opaque-data',policy,'const qualified = flags(prefixFlags), env = cleanEnv(options.env); qualifiedNode(command, env);','const qualified = flags(prefixFlags), env = cleanEnv(options.env); qualifiedNode(command, env); for (const value of args.slice(first + 1)) imageAt(managedRoot, value, cwd);','U12 should leave opaque data arguments untouched after identifying the image entry'],
];
const compiled=path=>path===cli?base+'dist/cli.js':path.replace('/src/','/dist/');
const paths=[policy,cli,boot].flatMap(p=>[p,compiled(p)]),originals=paths.map(path=>({path,bytes:fs.readFileSync(path)})),hash=b=>createHash('sha256').update(b).digest('hex'),major=process.versions.node.split('.')[0],results=[];
for(const[name,path,from,to,scenario]of cases){
 const run=color=>{const label=`component-${name}-${color}`,r=spawnSync(process.execPath,['scripts/mh-l6-test.mjs',file,label],{env:{...process.env,MH_L6_CASE:scenario},encoding:'utf8',maxBuffer:8*1024*1024});
  const log=`docs/plan/mh-l6/evidence/mh-l6-components.test.js-node${major}-${label}.log`,text=fs.readFileSync(log,'utf8'),receipt=JSON.parse(text.split('\nreceipt: ').at(-1));
  if(r.status!==(color==='red'?1:0)||receipt.invalid||receipt.signal||receipt.tests!==1||(color==='red'&&!text.includes('ERR_ASSERTION')))throw Error(`invalid_mutation:${name}:${color}:${log}`);return log;};
 let red;
 try{for(const target of[path,compiled(path)]){const bytes=originals.find(o=>o.path===target).bytes,re=new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s*'),'g');if([...bytes.toString().matchAll(re)].length!==1)throw Error('mutation_not_unique:'+name+':'+target);fs.writeFileSync(target,bytes.toString().replace(re,()=>to));}red=run('red');}
 finally{for(const o of originals)fs.writeFileSync(o.path,o.bytes);}
 const green=run('green');for(const o of originals)if(hash(fs.readFileSync(o.path))!==hash(o.bytes))throw Error('restore_failed');
 results.push({name,red,green,restored:true});fs.writeFileSync(`docs/plan/mh-l6/mutations-components-node${major}.json`,JSON.stringify({node:process.version,files:originals.map(o=>({path:o.path,sha256:hash(o.bytes)})),results},null,2)+'\n');process.stdout.write(name+': assertion red, restored green\n');
}
