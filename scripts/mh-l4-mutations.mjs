import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const major=Number(process.versions.node.split('.')[0]);if(![22,24].includes(major))throw Error('Node 22/24 required');
const names=['epoch','readonly','gate','janitor','checkpoint','delivery','wake-intent','wake-replay','reservation','token','arguments','final-receipt','barrier-admission','presence-target','http-control','downstream-version','fsync-uncertainty','delegation-effect','reply-lifetime','delegation-recovery','presence-reread','wake-freshness','readiness-idle'];
const dir='docs/plan/mh-l4/evidence';fs.mkdirSync(dir,{recursive:true});
const logfile=dir+'/node'+major+'-mutation-campaign.log';fs.writeFileSync(logfile,'Node '+process.version+'\n');
for(const name of names){const command=[process.execPath,'scripts/mh-l4-mutate.mjs',name];const r=spawnSync(command[0],command.slice(1),{encoding:'utf8',maxBuffer:16*1024*1024});fs.appendFileSync(logfile,'command: '+command.join(' ')+'\n'+r.stdout+r.stderr+'\ncase exit: '+r.status+'\n');process.stdout.write(name+': '+r.status+' (red=1 then green=0 required)\n');if(r.status!==0){process.stdout.write(r.stdout+r.stderr);process.exit(r.status??1);}}
