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
const tests=[['mh-l6-entry',8],['mh-l6-launcher',25],['mh-l1-package',1],['mh-l2-image',1],['mh-l2-live-central',1],['mh-l3-transfer',1],['mh-l4-central',1],['mh-l5-cold-network',3],['mh-l5-compensation',1]];
const paths=['packages/h2a/src/bin.ts',...['image-entry','image-execution','image-policy','managed-launcher'].map(n=>`packages/h2a/src/runtime/upgrade/${n}.js`),
 ...['selection','image','wire','state','authority','schemas','formats'].map(n=>`packages/h2a/src/runtime/handover/${n}.js`),...tests.map(([n])=>`packages/h2a/test/${n}.test.js`),
 'packages/h2a/test/helpers/mh-l5-image.js','packages/h2a/test/helpers/mh-l6-installation.js',
 ...['mh-l6-test.mjs','mh-l6-entry-mutate.mjs','mh-l6-e2b1-audit.mjs','mh-l1-package-prototype.mjs','mh-l0-native-prototype.mjs','build-managed-launcher.mjs'].map(n=>'scripts/'+n),'package-lock.json'];
const files=paths.map(path=>{const sha256=hash(fs.readFileSync(path));assert.equal(hash(fs.readFileSync(join(source,path))),sha256,path);return{path,sha256};});
const receipt=log=>{const out=fs.readFileSync(log,'utf8'),r=JSON.parse(out.split('\nreceipt: ').at(-1));assert.equal(r.invalid,false,log);assert.equal(r.signal,null,log);assert.deepEqual(r.leftovers,[],log);return{log,sha256:hash(out),...r};};
const profiles=[];
for(const major of[22,24]){
 const logs=tests.map(([n,count])=>{const r=receipt(`docs/plan/mh-l6/evidence/${n}.test.js-node${major}-final-E2b1.log`);assert.equal(r.code,0,r.log);assert.equal(r.tests,count,r.log);return r;});
 assert.equal(logs.reduce((n,r)=>n+r.tests,0),42);
 const regression=receipt(`docs/plan/mh-l6/evidence/mh-l6-entry.test.js-node${major}-red-E2b-entry.log`);assert.equal(regression.code,1);assert.equal(regression.tests,1);assert.match(fs.readFileSync(regression.log,'utf8'),/ERR_ASSERTION/);
 const mutations=JSON.parse(fs.readFileSync(`docs/plan/mh-l6/mutations-entry-node${major}.json`,'utf8'));assert.equal(mutations.results.length,5);
 for(const f of mutations.files)assert.equal(hash(fs.readFileSync(join(source,f.path))),f.sha256,f.path);
 for(const m of mutations.results){assert.equal(m.restored,true);const red=receipt(m.red),green=receipt(m.green);assert.equal(red.code,1);assert.equal(green.code,0);assert.equal(red.tests,1);assert.equal(green.tests,1);assert.match(fs.readFileSync(m.red,'utf8'),/ERR_ASSERTION/);}
 profiles.push({major,tests:42,mutationPairs:5,regression,logs});
}
const nativeSourceBaseline='6e8f81c4c1b6b926f48f0924f795f8a6a4c0ef96',nativeSources=['launch-guard','native-host','native-terminal/op','native-terminal/process','native-terminal/supervisor','native-terminal/journal'].map(n=>{
 const path=`packages/h2a-runtime/src/${n}.ts`,r=spawnSync('git',['show',`${nativeSourceBaseline}:${path}`]);assert.equal(r.status,0);const sha256=hash(fs.readFileSync(path));assert.equal(sha256,hash(r.stdout));assert.equal(sha256,hash(fs.readFileSync(join(source,path))));return{path,sha256};
});
let bundle;try{bundle=await buildManagedLauncher();const other=await import(pathToFileURL(join(source,'scripts/build-managed-launcher.mjs')).href),second=await other.buildManagedLauncher();assert.equal(bundle.digest,second.digest);assert.equal(bundle.loader.digest,second.loader.digest);assert.ok([...bundle.imports,...bundle.loader.imports].every(n=>n.startsWith('node:')));}finally{createRequire(import.meta.url)('esbuild').stop();createRequire(join(source,'package.json'))('esbuild').stop();}
const artifact='docs/plan/mh-l6/artifacts/h2a-launcher-E2b1.mjs';fs.writeFileSync(artifact,bundle.code);
const loaderArtifact='docs/plan/mh-l6/artifacts/'+bundle.loader.filename;fs.writeFileSync(loaderArtifact,bundle.loader.code);
const compiled=['packages/h2a/dist/bin.js','packages/h2a/dist/runtime/handover/selection.js','packages/h2a/dist/runtime/upgrade/image-entry.js'].map(path=>({path,sha256:hash(fs.readFileSync(join(source,path)))}));
fs.writeFileSync('docs/plan/mh-l6/proof-E2b1.json',JSON.stringify({source,files,compiled,profiles,nativeSourceBaseline,nativeSources,nativeReleaseFreezeQualified:false,artifact,digest:bundle.digest,loaderArtifact,loaderDigest:bundle.loader.digest,releaseQualified:false},null,2)+'\n');
process.stdout.write(`E2b1: ${files.length} files, 3 compiled, 6 native sources unchanged since E2a; 42 targeted tests and 5 killed/restored pairs per Node 22/24; ${bundle.digest}; zero skips/leftovers; release remains unqualified\n`);
