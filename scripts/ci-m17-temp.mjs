// A private, bounded data volume on the disposable GitHub runner only.
// No product code, executable assets or host state is mounted here.
import fs from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

if(process.env.GITHUB_ACTIONS!=='true'||!process.env.RUNNER_TEMP||process.platform!=='linux')
  throw Error('m17_volume_requires_disposable_github_runner');
const base=fs.realpathSync(process.env.RUNNER_TEMP),receipt=join(base,'h2a-m17-volume.json');
const magic=0x01021994;
function privateDirectory(root){
  const info=fs.lstatSync(root);
  if(!root.startsWith(base+'/h2a-m17-')||fs.realpathSync(root)!==root||!info.isDirectory()||info.uid!==process.getuid()||(info.mode&0o777)!==0o700)
    throw Error('m17_volume_not_owned');
  return info;
}
if(process.argv[2]==='setup'){
  if(fs.existsSync(receipt))throw Error('m17_volume_already_recorded');
  if(!process.env.GITHUB_ENV)throw Error('m17_volume_missing_workflow_environment');
  const root=fs.mkdtempSync(join(base,'h2a-m17-'));
  let mounted=false;
  try{
    privateDirectory(root);
    execFileSync('sudo',['mount','-t','tmpfs','-o',`size=1G,mode=0700,uid=${process.getuid()},gid=${process.getgid()},nodev,nosuid,noexec`,'tmpfs',root],{stdio:'inherit'});
    mounted=true;
    const info=privateDirectory(root),volume=fs.statfsSync(root);
    if(volume.type!==magic||volume.bavail*volume.bsize<512*1024*1024)throw Error('m17_volume_not_qualified');
    const witness={root,dev:info.dev,ino:info.ino,uid:info.uid,type:volume.type,capacityBytes:volume.blocks*volume.bsize};
    fs.writeFileSync(receipt,JSON.stringify(witness)+'\n',{flag:'wx',mode:0o600});
    fs.appendFileSync(process.env.GITHUB_ENV,`H2A_TEST_M17_TMPDIR=${root}\n`);
    console.log('M17 private tmpfs ready: '+JSON.stringify(witness));
  }catch(error){
    if(mounted)execFileSync('sudo',['umount',root],{stdio:'inherit'});
    fs.rmSync(root,{recursive:true,force:true});fs.rmSync(receipt,{force:true});throw error;
  }
}else if(process.argv[2]==='cleanup'){
  const witness=JSON.parse(fs.readFileSync(receipt,'utf8')),info=privateDirectory(witness.root);
  if(process.env.H2A_TEST_M17_TMPDIR!==witness.root||info.dev!==witness.dev||info.ino!==witness.ino||fs.statfsSync(witness.root).type!==magic)
    throw Error('m17_volume_identity_changed');
  if(fs.readdirSync(witness.root).length)throw Error('m17_volume_has_unremoved_test_state');
  execFileSync('sudo',['umount',witness.root],{stdio:'inherit'});
  fs.rmdirSync(witness.root);fs.unlinkSync(receipt);
  console.log('M17 owned volume unmounted and removed: '+witness.root);
}else throw Error('usage: node scripts/ci-m17-temp.mjs setup|cleanup');
