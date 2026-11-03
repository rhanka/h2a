import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const major=Number(process.versions.node.split('.')[0]);if(![22,24].includes(major))throw Error('Node 22/24 required');
const files=['mh-l0-state','mh-l2-cold','mh-l2-integration','mh-l2-image','mcp-run','mcp-run-async','mcp-notifications','mcp-sessions','local-store','local-store-locking','identity-bindings','identity-migration','evo1-inbox-wake-handler','mcp-payload-store','blockage-notifications'];
for(const file of files)if(!existsSync('packages/h2a/test/'+file+'.test.js'))throw Error('missing explicit test '+file);
for(const file of files){const r=spawnSync(process.execPath,['scripts/mh-l4-test.mjs','packages/h2a/test/'+file+'.test.js','node'+major+'-regression'],{stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);}
