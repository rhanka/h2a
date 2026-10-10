// Reclaim only completed fixture file pages; never follow links or drop global caches.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const repo=path.resolve(import.meta.dirname,'../..'),directories=[];
for(const name of ['results','large']){
  const directory=repo+'/.qual-tmp/lab/'+name;
  if(fs.existsSync(directory))directories.push(directory);
}
execFileSync(repo+'/.qual-tmp/lab/scripts/evict-owned',directories,{stdio:'inherit'});
