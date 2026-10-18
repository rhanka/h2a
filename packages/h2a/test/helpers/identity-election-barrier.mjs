// Scheduling only: both contenders still execute the real exclusive link.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const {H2A_TEST_ELECTION_DIR:dir,H2A_TEST_ELECTION_ROLE:role,H2A_TEST_ELECTION_PATH:path}=process.env;
if(!dir||!role||!path)throw Error('isolated election barrier required');
const link=fs.linkSync;
const mark=phase=>fs.writeFileSync(dir+'/'+role+'.'+phase,'ready');
function wait(phase) {
 const deadline=performance.now()+15_000;
 while(!fs.existsSync(dir+'/'+role+'.'+phase)) {
  if(performance.now()>=deadline)throw Error('election barrier deadline: '+role+' '+phase);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);
 }
}
let first=true;
fs.linkSync=(source,target,...args)=>{
 if(target!==path)return link(source,target,...args);
 if(first){mark('before');wait('go');first=false;}
 try {
  const result=link(source,target,...args);
  mark('elected');wait('retire');return result;
 }catch(error){if(error.code==='EEXIST')mark('lost');throw error;}
};
// Expose the actual create-before-write window of the recovery witness.
// The final name must stay absent until the complete JSON is published.
if(role==='recovery'){
 const write=fs.writeFileSync;
 fs.writeFileSync=(target,data,...options)=>{
  if(target===dir+'/recovery.held'||target===dir+'/recovery.held.tmp'){
   write(target,'',...options);mark('witness-open');wait('witness-finish');
  }
  return write(target,data,...options);
 };
}
syncBuiltinESMExports();
