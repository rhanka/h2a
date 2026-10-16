import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalStore } from '../../dist/index.js';
export function fixtureIdentity(root, instance, agentUuid) {
  const key=instance.replace(/[:/]/g,'-');const keys=join(root,'keys');mkdirSync(keys,{recursive:true});
  if(!existsSync(join(keys,key+'.key.pem'))){const pair=generateKeyPairSync('ed25519');
    writeFileSync(join(keys,key+'.key.pem'),pair.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
    const publicKey=pair.publicKey.export({type:'spki',format:'pem'});writeFileSync(join(keys,key+'.pub.pem'),publicKey);
    createLocalStore({root}).registerInstance({id:instance,instance,agentUuid,roles:['AGENTS'],scopes:[],capabilities:[],endpoints:[],publicKeys:[publicKey],acceptedPolicies:[],createdAt:new Date().toISOString()});
  }
  return {instance,agentUuid};
}
export function proofDeps(root,deps){return {...deps,mint:()=>{const r=deps.mint();return fixtureIdentity(root,r.instance,r.agentUuid);}};}
