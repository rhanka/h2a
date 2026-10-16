import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { ensureManagedImageExecution } from './node_modules/@sentropic/h2a/dist/runtime/upgrade/image-entry.js';
await ensureManagedImageExecution(import.meta.url);
const mode=process.argv[2], root=process.env.H2A_ROOT;
const budget=(promise,ms=10000)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('fixture_budget_exceeded')),ms);})]).finally(()=>clearTimeout(timer));};
const birth=pid=>{const text=fs.readFileSync('/proc/'+pid+'/stat','utf8');return Number(text.slice(text.lastIndexOf(') ')+2).split(' ')[19]);};

if(mode==='boot-alter'){
 const {runMcpServe}=await import('./node_modules/@sentropic/h2a/dist/cli.js');
 const path=fileURLToPath(new URL('./node_modules/@sentropic/h2a/dist/runtime/upgrade/index.js',import.meta.url)), originalBytes=fs.readFileSync(path),marker=process.env.EXECUTION_MARKER;
 let complete,child;const done=new Promise(r=>complete=r),original=cp.spawn;
 cp.spawn=function(command,args,options){
  if(command!==process.execPath||!args.includes(root))return original.apply(this,arguments);
  fs.appendFileSync(path,`\nimport{writeFileSync as unverifiedWorkerEffect}from'node:fs';unverifiedWorkerEffect(${JSON.stringify(marker)},'loaded');\n`);
  try{child=original.call(this,command,args,{...options,detached:false,stdio:['ignore','ignore','pipe']});}
  catch(error){complete({code:-1,stderr:error.message,blockedBeforeSpawn:true});throw error;}
  let stderr='',identity;child.stderr.on('data',b=>stderr+=b);
  child.once('spawn',()=>{identity={pid:child.pid,birth:birth(child.pid)};});
  child.once('error',e=>complete({error:e.message}));child.once('close',code=>complete({code,stderr,identity}));return child;
 };syncBuiltinESMExports();
 const input=new PassThrough(),output=new PassThrough(),errors=new PassThrough(),abort=new AbortController();output.resume();errors.resume();
 let serving;
 try{
  serving=runMcpServe({root,backend:'local','upgrade-check':'true'},{stdin:input,stdout:output,stderr:errors,cwd:()=>root,signal:abort.signal});
  const result=await budget(done);abort.abort();input.end();const serverCode=await budget(serving);
  process.stdout.write(JSON.stringify({...result,serverCode,marker:fs.existsSync(marker)})+'\n');
 }finally{
  abort.abort();input.end();fs.writeFileSync(path,originalBytes);cp.spawn=original;syncBuiltinESMExports();
  if(child&&child.exitCode===null&&child.signalCode===null){const ended=new Promise(r=>child.once('exit',r));child.ref();child.kill('SIGTERM');await budget(ended);}
 }
}

if(mode==='journal'||mode==='journal-alter'){
 const journalUrl=new URL('./node_modules/@sentropic/h2a-runtime/dist/native-terminal/journal.js',import.meta.url),path=fileURLToPath(journalUrl),originalBytes=fs.readFileSync(path),marker=process.env.EXECUTION_MARKER;
 const journal=await import(journalUrl.href),original=cp.fork;let child,completeExit,completeMessage,identity,stderr='';
 const exited=new Promise(r=>completeExit=r),message=new Promise(r=>completeMessage=r);
 cp.fork=function(file,args,options){
  child=original.call(this,file,args,{...options,stdio:['ignore','ignore','pipe','ipc']});
  child.stderr.on('data',b=>stderr+=b);child.once('spawn',()=>{identity={pid:child.pid,birth:birth(child.pid)};});
  child.on('message',value=>completeMessage(value));child.once('exit',code=>completeExit(code));return child;
 };syncBuiltinESMExports();
 try{
  if(mode==='journal-alter')fs.appendFileSync(path,`\nimport{writeFileSync as unverifiedJournalEffect}from'node:fs';unverifiedJournalEffect(${JSON.stringify(marker)},'loaded');\n`);
  const log=process.env.JOURNAL_LOG,writer=journal.createHostJournalWriter(log);
  writer.write({event:'start',pid:process.pid,startTime:birth(process.pid),generation:'fixture-journal',version:'0.98.5',codePath:fileURLToPath(import.meta.url),socket:process.env.XDG_RUNTIME_DIR+'/unused-journal-fixture.sock'});
  await writer.flush();
  const observed=await budget(Promise.race([message.then(written=>({written})),exited.then(code=>({code}))]));
  if(child?.connected)child.disconnect();if(child)child.ref();const code=await budget(exited);
  process.stdout.write(JSON.stringify({observed,code,stderr,identity,marker:fs.existsSync(marker),rows:journal.readHostJournal(log),preload:child.spawnargs.some(arg=>arg.startsWith('--import=file:')&&arg.includes('image-loader-'))})+'\n');
 }finally{
  fs.writeFileSync(path,originalBytes);cp.fork=original;syncBuiltinESMExports();
  if(child&&child.exitCode===null&&child.signalCode===null){const ended=new Promise(r=>child.once('exit',r));child.ref();child.kill('SIGTERM');await budget(ended);}
 }
}

if(mode==='identity'||mode==='identity-alter'){
 const api=await import('./node_modules/@sentropic/h2a/dist/runtime/mcp/identity-state.js'),path=fileURLToPath(new URL('./node_modules/@sentropic/h2a/dist/runtime/identity/worker.js',import.meta.url)),originalBytes=fs.readFileSync(path),marker=process.env.EXECUTION_MARKER;
 const original=cp.fork;let child,completeExit,identity;const exited=new Promise(r=>completeExit=r);
 cp.fork=function(...args){child=original.apply(this,args);child.once('spawn',()=>{identity={pid:child.pid,birth:birth(child.pid)};});child.once('exit',code=>completeExit(code));return child;};syncBuiltinESMExports();
 try{
  if(mode==='identity-alter')fs.appendFileSync(path,`\nimport{writeFileSync as unverifiedIdentityEffect}from'node:fs';unverifiedIdentityEffect(${JSON.stringify(marker)},'loaded');\n`);
  const diagnostics=[],worker=api.forkIdentityWorker({root,host:'claude',cwd:root,explicitInstance:'claude:fixture-identity'},5000,line=>diagnostics.push(line));
  let complete;const done=new Promise(r=>complete=r);worker.onError((cause,message)=>complete({kind:'error',cause,message}));worker.onExitWithoutResult(()=>complete({kind:'exit'}));worker.onResolved(value=>complete({kind:'resolved',value}));
  const result=await budget(done),code=await budget(exited);
  process.stdout.write(JSON.stringify({result,code,identity,diagnostics,marker:fs.existsSync(marker),preload:child.spawnargs.some(arg=>arg.startsWith('--import=file:')&&arg.includes('image-loader-'))})+'\n');
 }finally{
  fs.writeFileSync(path,originalBytes);cp.fork=original;syncBuiltinESMExports();
  if(child&&child.exitCode===null&&child.signalCode===null){const ended=new Promise(r=>child.once('exit',r));child.ref();child.kill('SIGTERM');await budget(ended);}
 }
}

async function execute(method,file,args){
 if(method==='spawnSync'){
  const r=cp.spawnSync(process.execPath,[file,...args],{encoding:'utf8'});return{code:r.status,stdout:r.stdout,stderr:r.stderr};
 }
 if(method==='execFileSync'){
  try{return{code:0,stdout:cp.execFileSync(process.execPath,[file,...args],{encoding:'utf8'}),stderr:''};}
  catch(error){return{code:error.status,stdout:String(error.stdout??''),stderr:String(error.stderr??error.message)};}
 }
 if(method==='execFile')return new Promise(resolve=>cp.execFile(process.execPath,[file,...args],{encoding:'utf8'},(error,stdout,stderr)=>resolve({code:error?error.code:0,stdout,stderr})));
 const child=cp.spawn(process.execPath,[file,...args],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 return new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));});
}
if(mode.startsWith('external-')){
 const method=mode.slice('external-'.length),data=fileURLToPath(new URL('./manifest.json',import.meta.url));
 const result=await budget(execute(method,process.env.EXTERNAL_PROGRAM,[data]));process.stdout.write(JSON.stringify(result)+'\n');
}
if(mode.startsWith('internal-')){
 const method=mode.slice('internal-'.length),file=fileURLToPath(new URL('./unguarded-child.mjs',import.meta.url));
 const result=await budget(execute(method,file,[]));process.stdout.write(JSON.stringify({...result,marker:fs.existsSync(process.env.EXECUTION_MARKER)})+'\n');
}
if(mode==='boot-check'||mode==='boot-auto'){
 const entry=fileURLToPath(new URL('./node_modules/@sentropic/h2a/dist/runtime/upgrade/boot-worker.js',import.meta.url));
 const result=cp.spawnSync(process.execPath,[entry,root,'3600000',mode==='boot-auto'?'auto':'check'],{encoding:'utf8'});
 process.stdout.write(JSON.stringify({code:result.status,stderr:result.stderr,stdout:result.stdout,cache:JSON.parse(fs.readFileSync(root+'/upgrade-check.json','utf8'))})+'\n');
}

if(mode==='alias-fork'||mode==='alias-node'||mode==='alias-spawn'){
 const file=fileURLToPath(new URL('./unguarded-child.mjs',import.meta.url));let result;
 if(mode==='alias-node'){
  const alias=process.env.EXECUTION_MARKER+'-node';fs.symlinkSync(process.execPath,alias);
  const r=cp.spawnSync(alias,[file],{encoding:'utf8'});result={code:r.status,stdout:r.stdout,stderr:r.stderr};
 }else{
  const alias=process.env.EXECUTION_MARKER+'-'+mode+'-entry.mjs';fs.symlinkSync(file,alias);
  if(mode==='alias-spawn')result=await budget(execute('spawn',alias,[]));else{
  const c=cp.fork(alias,[],{silent:true,execArgv:[]});let stdout='',stderr='';c.stdout.on('data',b=>stdout+=b);c.stderr.on('data',b=>stderr+=b);
  result=await budget(new Promise((resolve,reject)=>{c.once('error',reject);c.once('close',code=>resolve({code,stdout,stderr}));}));
  }
 }
 process.stdout.write(JSON.stringify({...result,marker:fs.existsSync(process.env.EXECUTION_MARKER)})+'\n');
}

if(mode==='opaque-data'){
 const directory=process.env.EXECUTION_MARKER+'-data',file=directory+'/opaque';fs.mkdirSync(directory);fs.writeFileSync(file,'private fixture data');fs.chmodSync(directory,0);
 let result;try{result=await budget(execute('spawn',fileURLToPath(new URL('./unguarded-child.mjs',import.meta.url)),[file]));}
 catch(error){result={code:-1,stderr:error.message};}finally{fs.chmodSync(directory,0o700);}
 process.stdout.write(JSON.stringify(result)+'\n');
}

if(mode==='entry-uri'){
 const file=new URL('./unguarded-child.mjs',import.meta.url).href;let result;
 try{const r=cp.spawnSync(process.execPath,['--entry-url',file],{encoding:'utf8'});result={blockedBeforeSpawn:false,code:r.status,stderr:r.stderr};}
 catch(error){result={blockedBeforeSpawn:true,stderr:error.message};}
 process.stdout.write(JSON.stringify({...result,marker:fs.existsSync(process.env.EXECUTION_MARKER)})+'\n');
}
