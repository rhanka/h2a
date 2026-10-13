import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const repo=resolve(import.meta.dirname,'../../../..');
const lane=process.argv[2]??fs.readFileSync(join(repo,'tmp/idlock-build2-lane.txt'),'utf8');
const root=join(lane,'candidate');
const env={...process.env,...JSON.parse(fs.readFileSync(join(lane,'environment.json'),'utf8')),
 NODE_OPTIONS:'--import '+join(repo,'packages/h2a/test/helpers/identity-isolation-guard.mjs')};
const variants=[
 {name:'stale-boot',file:'succession-lock.js',anchor:'if (r.boot !== self.boot)\n        return { verdict: "dead", datable: false };',replacement:'if (r.boot !== self.boot) return { verdict: "undecidable", datable: false };'},
 {name:'automatic-recovery',file:'identity-fence.js',anchor:'identityVerdict(read, self) === "dead" && recoveryAuthorized(read, dir)',replacement:'false && recoveryAuthorized(read, dir)'}
];
for(const variant of variants) {
 const path=join(root,'packages/h2a/dist/runtime/local-files',variant.file);const bytes=fs.readFileSync(path);const hash=createHash('sha256').update(bytes).digest('hex');const source=bytes.toString();
 if(source.split(variant.anchor).length!==2)throw new Error('mutant anchor must be unique: '+variant.name);
 try {
   fs.writeFileSync(path,source.replace(variant.anchor,variant.replacement));
   const result=spawnSync(process.execPath,['--test','packages/h2a/test/identity-lock-recovery.test.js','packages/h2a/test/identity-lock-v6.test.js'],{cwd:root,env,encoding:'utf8',maxBuffer:10*1024*1024});
   fs.writeFileSync(join(lane,`mutant-${variant.name}.tap`),result.stdout+result.stderr);
   process.stdout.write(`MUTANT=${variant.name} exit=${result.status}\n`+result.stdout.split('\n').filter(line=>/^(not ok|# (tests|pass|fail|skipped))/.test(line)).join('\n')+'\n');
   if(result.status===0)throw new Error('surviving mutant: '+variant.name);
 }finally{fs.writeFileSync(path,bytes);if(createHash('sha256').update(fs.readFileSync(path)).digest('hex')!==hash)throw new Error('mutant restoration failed');}
}
process.stdout.write('RESTORED: original SHA-256 verified for both production modules\n');
