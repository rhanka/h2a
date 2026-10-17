import { readFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const source=new URL('../packages/h2a-runtime/src/fixtures/session-content/v2/',import.meta.url);
const destination=new URL('../packages/h2a-runtime/dist/fixtures/session-content/v2/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',source),'utf8'));
const names=manifest.files.map(f=>f.path);
if(manifest.capsule!=='h2a.session-content'||manifest.version!==2||JSON.stringify(names)!==JSON.stringify(readdirSync(source).filter(n=>n!=='manifest.json').sort())) throw new Error('capsule inventory mismatch');
mkdirSync(destination,{recursive:true});
for(const file of [...manifest.files,{path:'manifest.json'}]) {
  if(!/^[a-z][a-z0-9.-]*\.json$/.test(file.path)) throw new Error('unsafe capsule path');
  const bytes=readFileSync(new URL(file.path,source));
  if(file.sha256&&(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)) throw new Error('capsule digest mismatch');
  copyFileSync(new URL(file.path,source),new URL(file.path,destination));
}
console.log('session-content capsule verified and copied: '+fileURLToPath(destination));
