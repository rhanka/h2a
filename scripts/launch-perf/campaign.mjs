import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
const repo=path.resolve(import.meta.dirname,'../..');
const prefix=process.argv[2]||'g1';
if(!/^[a-z0-9-]+$/.test(prefix))throw new Error('invalid campaign prefix');
if(!fs.existsSync(repo+'/.qual-tmp/baseline/packages/track/dist/index.js'))throw new Error('baseline Track bundle must be built before qualification');
const baseline=execFileSync('git',['rev-parse','origin/main'],{cwd:repo,encoding:'utf8'}).trim();
const candidate=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const scenarios=[];
for(const n of [1,4,9])for(const cold of [false,true])for(const pressure of [false,true])for(let sample=1;sample<=3;sample++) {
  const scenario=`n${n}-${cold?'cold':'warm'}-${pressure?'io':'idle'}`;
  for(const version of sample%2?['baseline','candidate']:['candidate','baseline']){
    const label=`${prefix}-${version}-${scenario}-r${sample}`;
    scenarios.push({label,n,pressure,evict:cold,cache:cold?label:'warm',timeoutMs:65000,
      admission:`${prefix}-${version}-n4-${cold?'cold':'warm'}-${pressure?'io':'idle'}-r1`,
      worktree:version==='baseline'?repo+'/.qual-tmp/baseline':repo,sourceSha:version==='baseline'?baseline:candidate});
  }
}
const input={label:prefix,reclaimOwnedFixtures:true,scenarios};
fs.writeFileSync(repo+'/.qual-tmp/evidence/'+prefix+'-plan.json',JSON.stringify({baseline,candidate,prefix,input},null,2));
const child=spawn(process.execPath,[repo+'/scripts/launch-perf/qualify.mjs',JSON.stringify(input)],{cwd:repo,env:process.env,stdio:'inherit'});
process.exitCode=await new Promise((resolve,reject)=>{child.once('close',resolve);child.once('error',reject)});
