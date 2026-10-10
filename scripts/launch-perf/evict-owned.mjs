// Reclaim only completed fixture file pages; never follow links or drop global caches.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const repo=path.resolve(import.meta.dirname,'../..'),directories=[];
const ledger=repo+'/.qual-tmp/lab/reclaimed-fixtures.json';
const previous=fs.existsSync(ledger)?JSON.parse(fs.readFileSync(ledger,'utf8')):[];
for(const name of ['results','large']){
  const directory=repo+'/.qual-tmp/lab/'+name;
  if(!fs.existsSync(directory))continue;
  if(name==='results'){
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      const fixture=directory+'/'+entry.name;
      if(entry.isDirectory()&&!previous.includes(fixture))directories.push(fixture);
    }
  }else if(!previous.includes(directory))directories.push(directory);
}
if(directories.length){
  execFileSync(repo+'/.qual-tmp/lab/scripts/evict-owned',directories,{stdio:'inherit'});
  fs.writeFileSync(ledger,JSON.stringify([...previous,...directories]));
}
