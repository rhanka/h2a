import fs from 'node:fs';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { buildManagedLauncher } from './build-managed-launcher.mjs';
const source=fs.realpathSync(process.argv[2]);if(!source.startsWith('/tmp/mh-l3-qualification-'))throw Error('private_source_required');
const hash=b=>createHash('sha256').update(b).digest('hex');
const tests=[['mh-l6-components',23],['mh-l6-launcher',25],['mh-l6-entry',8],['upgrade-boot-worker',3],['mcp-stdio',16]];
const paths=['packages/h2a/src/cli.ts','packages/h2a/src/bin.ts',...['boot-worker','image-entry','image-execution','image-policy','managed-launcher'].map(n=>`packages/h2a/src/runtime/upgrade/${n}.js`),
 ...['selection','image','wire','state','authority','schemas','formats'].map(n=>`packages/h2a/src/runtime/handover/${n}.js`),
 'packages/h2a/src/runtime/mcp/identity-state.ts','packages/h2a/src/runtime/identity/worker.ts',...tests.map(([n])=>`packages/h2a/test/${n}.test.js`),
 ...['mh-l5-image.js','mh-l6-installation.js','mh-l6-execution-harness.mjs'].map(n=>'packages/h2a/test/helpers/'+n),
 ...['mh-l6-test.mjs','mh-l6-components-mutate.mjs','mh-l6-e2b2-audit.mjs','mh-l1-package-prototype.mjs','mh-l0-native-prototype.mjs','build-managed-launcher.mjs'].map(n=>'scripts/'+n),'package-lock.json'];
const files=paths.map(path=>{const sha256=hash(fs.readFileSync(path));assert.equal(hash(fs.readFileSync(join(source,path))),sha256,path);return{path,sha256};});
const receipt=log=>{const out=fs.readFileSync(log,'utf8'),r=JSON.parse(out.split('\nreceipt: ').at(-1));assert.equal(r.invalid,false,log);assert.equal(r.signal,null,log);assert.deepEqual(r.leftovers,[],log);return{log,sha256:hash(out),...r};};
const profiles=[];
for(const major of[22,24]){
 const logs=tests.map(([n,count])=>{const r=receipt(`docs/plan/mh-l6/evidence/${n}.test.js-node${major}-final-E2b2.log`);assert.equal(r.code,0,r.log);assert.equal(r.tests,count,r.log);return r;});assert.equal(logs.reduce((n,r)=>n+r.tests,0),75);
 const regressions=['boot','external-spawn','external-spawnSync','external-execFile','external-execFileSync','alias-fork','alias-node','entry-uri','opaque-data'].map(name=>{
  const r=receipt(`docs/plan/mh-l6/evidence/mh-l6-components.test.js-node${major}-red-E2b2-${name}.log`);assert.equal(r.code,1);assert.equal(r.tests,1);assert.match(fs.readFileSync(r.log,'utf8'),/ERR_ASSERTION/);return r;
 });
 const mutations=JSON.parse(fs.readFileSync(`docs/plan/mh-l6/mutations-components-node${major}.json`,'utf8'));assert.equal(mutations.results.length,16);
 for(const f of mutations.files)assert.equal(hash(fs.readFileSync(join(source,f.path))),f.sha256,f.path);
 for(const m of mutations.results){assert.equal(m.restored,true);const red=receipt(m.red),green=receipt(m.green);assert.equal(red.code,1);assert.equal(green.code,0);assert.equal(red.tests,1);assert.equal(green.tests,1);assert.match(fs.readFileSync(m.red,'utf8'),/ERR_ASSERTION/);}
 profiles.push({major,tests:75,mutationPairs:16,uniqueFaultPoints:10,regressions,logs});
}
const nativeSourceBaseline='84492d9a7b8657c4988986e138fa2d94bf867ddd',nativeSources=['launch-guard','native-host','native-terminal/op','native-terminal/process','native-terminal/supervisor','native-terminal/journal'].map(n=>{
 const path=`packages/h2a-runtime/src/${n}.ts`,r=spawnSync('git',['show',`${nativeSourceBaseline}:${path}`]);assert.equal(r.status,0);const sha256=hash(fs.readFileSync(path));assert.equal(sha256,hash(r.stdout));assert.equal(sha256,hash(fs.readFileSync(join(source,path))));return{path,sha256};
});
let bundle;try{bundle=await buildManagedLauncher();const other=await import(pathToFileURL(join(source,'scripts/build-managed-launcher.mjs')).href),second=await other.buildManagedLauncher();assert.equal(bundle.digest,second.digest);assert.equal(bundle.loader.digest,second.loader.digest);assert.ok([...bundle.imports,...bundle.loader.imports].every(n=>n.startsWith('node:')));}finally{createRequire(import.meta.url)('esbuild').stop();createRequire(join(source,'package.json'))('esbuild').stop();}
const artifact='docs/plan/mh-l6/artifacts/h2a-launcher-E2b2.mjs',loaderArtifact='docs/plan/mh-l6/artifacts/'+bundle.loader.filename;fs.writeFileSync(artifact,bundle.code);fs.writeFileSync(loaderArtifact,bundle.loader.code);
const compiled=['packages/h2a/dist/cli.js','packages/h2a/dist/bin.js',...['boot-worker','image-entry','image-execution'].map(n=>`packages/h2a/dist/runtime/upgrade/${n}.js`),
 'packages/h2a/dist/runtime/mcp/identity-state.js','packages/h2a/dist/runtime/identity/worker.js','packages/h2a-runtime/dist/native-terminal/journal.js'].map(path=>({path,sha256:hash(fs.readFileSync(join(source,path)))}));
fs.writeFileSync('docs/plan/mh-l6/proof-E2b2.json',JSON.stringify({source,files,compiled,profiles,nativeSourceBaseline,nativeSources,nativeReleaseFreezeQualified:false,artifact,digest:bundle.digest,loaderArtifact,loaderDigest:bundle.loader.digest,releaseQualified:false},null,2)+'\n');
process.stdout.write(`E2b2: ${files.length} files, 8 compiled, 6 native sources unchanged; 75 targeted tests + 16 killed/restored pairs per Node 22/24; launcher ${bundle.digest}; loader ${bundle.loader.digest}; zero skips/leftovers; release remains unqualified\n`);
