import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
const repo=resolve(import.meta.dirname,'../../../..');
const lane=process.argv[2] ?? fs.readFileSync(join(repo,'tmp/idlock-build2-lane.txt'),'utf8');
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
