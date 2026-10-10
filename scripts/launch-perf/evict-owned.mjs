// Reclaim only completed fixture file pages; never follow links or drop global caches.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const repo=path.resolve(import.meta.dirname,'../..'),files=[];
function visit(directory){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);
    if(entry.isDirectory())visit(file);
    else if(entry.isFile())files.push(file);
  }
}
for(const name of ['results','large']){
  const directory=repo+'/.qual-tmp/lab/'+name;
  if(fs.existsSync(directory))visit(directory);
}
for(let i=0;i<files.length;i+=100)execFileSync(repo+'/.qual-tmp/lab/scripts/evict',files.slice(i,i+100),{stdio:'inherit'});
console.log(JSON.stringify({operation:'fsync-and-fadvise-owned-inactive-fixtures',files:files.length}));
