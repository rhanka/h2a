import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
const repo=resolve(import.meta.dirname,'../../../..');
// A clean checkout has no lane pointer. Build fresh sources with the exact
// workspace dependency layout produced by npm ci; never grade a stale lane.
let lane=process.argv[2];
if(lane===undefined) {
 const build=spawnSync(process.execPath,[join(repo,'packages/h2a/test/helpers/identity-isolated-run.mjs')],{
  cwd:repo,env:{...process.env,IDLOCK_BUILD_ONLY:'1'},encoding:'utf8',maxBuffer:4*1024*1024
 });
 process.stdout.write(build.stdout);process.stderr.write(build.stderr);
 if(build.status!==0)process.exit(build.status??1);
 const match=/^LANE=(.+)$/m.exec(build.stdout);
 if(!match)throw new Error('isolated source build returned no lane');
 lane=match[1];
}
const cwd=join(lane,'candidate');
fs.copyFileSync(join(repo,'packages/track/tsconfig.build.json'),join(cwd,'packages/track/tsconfig.build.json'));
const tsc=resolve(repo,'node_modules/typescript/bin/tsc');let failed=false;
for(const stage of ['bootstrap','typecheck'])for(const pkg of ['track','remote-protocol','h2a','h2a-runtime']) {
 const config=`packages/${pkg}/${pkg==='track'?'tsconfig.build.json':'tsconfig.json'}`;
 const args=[tsc,'-p',config,'--pretty','false',...(stage==='bootstrap'?['--noEmitOnError','false']:[])];
 const result=spawnSync(process.execPath,args,{cwd,encoding:'utf8',maxBuffer:10*1024*1024});
 fs.writeFileSync(join(lane,`${stage}-${pkg}.log`),result.stdout+result.stderr);
 if(stage==='typecheck'){process.stdout.write(`node tsc -p ${config}: exit ${result.status}\n`+result.stdout+result.stderr);if(result.status!==0)failed=true;}
}
process.exitCode=failed?1:0;
