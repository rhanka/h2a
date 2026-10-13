import {spawnSync} from 'node:child_process';
if(![22,24].includes(Number(process.versions.node.split('.')[0])))throw Error('Node 22/24 required');
const major=process.versions.node.split('.')[0];
for(const file of ['ownership','writers','checkpoint','wake','launch','integration','cuts','concurrency','central']){
 const r=spawnSync(process.execPath,['scripts/mh-l4-test.mjs','packages/h2a/test/mh-l4-'+file+'.test.js','node'+major+'-final'],{stdio:'inherit'});
 if(r.status!==0)process.exit(r.status??1);
}
