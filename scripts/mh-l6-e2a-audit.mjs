import fs from 'node:fs';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { buildManagedLauncher } from './build-managed-launcher.mjs';
const source=fs.realpathSync(process.argv[2]);
if(!source.startsWith('/tmp/mh-l3-qualification-'))throw Error('private_source_required');
const hash=b=>createHash('sha256').update(b).digest('hex');
const paths=[...['image-policy','image-execution','image-preloader','managed-launcher','h4-store'].map(n=>`packages/h2a/src/runtime/upgrade/${n}.js`),
 ...['image-policy','launcher'].map(n=>`packages/h2a/test/mh-l6-${n}.test.js`),
 ...['mh-l6-installation.js','mh-l6-image-reader.mjs'].map(n=>'packages/h2a/test/helpers/'+n),
 ...['mh-l6-test.mjs','mh-l6-execution-mutate.mjs','build-managed-launcher.mjs','mh-l0-native-prototype.mjs'].map(n=>'scripts/'+n),
 'package-lock.json',...['authority','state','selection','image','formats','wire','schemas'].map(n=>`packages/h2a/src/runtime/handover/${n}.js`)];
const files=paths.map(path=>{const sha256=hash(fs.readFileSync(path));assert.equal(hash(fs.readFileSync(join(source,path))),sha256,path);return{path,sha256};});
const receipt=log=>{const out=fs.readFileSync(log,'utf8'),r=JSON.parse(out.split('\nreceipt: ').at(-1));assert.equal(r.invalid,false,log);assert.equal(r.signal,null,log);assert.deepEqual(r.leftovers,[],log);return{log,sha256:hash(out),...r};};
const profiles=[];
for(const major of [22,24]){
 const logs=['launcher','image-policy'].map(n=>receipt(`docs/plan/mh-l6/evidence/mh-l6-${n}.test.js-node${major}-final-E2a-25.log`));
 assert.deepEqual(logs.map(r=>r.tests),[25,12]);for(const r of logs)assert.equal(r.code,0,r.log);
 const regressions=['spawn','fork','worker','worker-memory'].map(n=>receipt(`docs/plan/mh-l6/evidence/mh-l6-launcher.test.js-node${major}-red-E2a-${n}.log`));
 for(const r of regressions){assert.equal(r.code,1);assert.equal(r.tests,1);assert.match(fs.readFileSync(r.log,'utf8'),/ERR_ASSERTION/);}
 const mutations=JSON.parse(fs.readFileSync(`docs/plan/mh-l6/mutations-execution-node${major}.json`,'utf8'));assert.equal(mutations.results.length,10);
 for(const f of mutations.files)assert.equal(f.sha256,hash(fs.readFileSync(join(source,f.path))),f.path);
 for(const m of mutations.results){assert.equal(m.restored,true);const red=receipt(m.red),green=receipt(m.green);assert.equal(red.code,1);assert.equal(green.code,0);assert.equal(red.tests,1);assert.equal(green.tests,1);assert.match(fs.readFileSync(m.red,'utf8'),/ERR_ASSERTION/);}
 profiles.push({major,tests:37,mutationPairs:10,regressions,logs});
}
let bundle;
try{bundle=await buildManagedLauncher();const other=await import(pathToFileURL(join(source,'scripts/build-managed-launcher.mjs')).href);const second=await other.buildManagedLauncher();assert.equal(second.digest,bundle.digest);assert.equal(second.loader.digest,bundle.loader.digest);assert.ok([...bundle.imports,...bundle.loader.imports].every(n=>n.startsWith('node:')));}
finally{createRequire(import.meta.url)('esbuild').stop();createRequire(join(source,'package.json'))('esbuild').stop();}
const artifact='docs/plan/mh-l6/artifacts/h2a-launcher-E2a.mjs',loaderArtifact='docs/plan/mh-l6/artifacts/'+bundle.loader.filename;
fs.writeFileSync(artifact,bundle.code);fs.writeFileSync(loaderArtifact,bundle.loader.code);
fs.writeFileSync('docs/plan/mh-l6/artifacts/launcher-E2a-manifest.json',JSON.stringify({schemaVersion:1,artifact,digest:bundle.digest,imports:bundle.imports,loader:{artifact:loaderArtifact,digest:bundle.loader.digest,imports:bundle.loader.imports},sourceFiles:files,standalone:true,releaseQualified:false,imagePolicyCoverage:'launcher-and-qualified-file-descendants; real-components-pending'},null,2)+'\n');
const compiled=['image-policy','image-execution','image-preloader','managed-launcher','h4-store'].map(n=>{const path=`packages/h2a/dist/runtime/upgrade/${n}.js`;return{path,sha256:hash(fs.readFileSync(join(source,path)))};});
fs.writeFileSync('docs/plan/mh-l6/proof-E2a.json',JSON.stringify({source,files,compiled,profiles,artifact,digest:bundle.digest,loaderArtifact,loaderDigest:bundle.loader.digest},null,2)+'\n');
process.stdout.write(`E2a: ${files.length} files, 5 compiled; 37 tests + 10 killed/restored pairs per Node 22/24; ${bundle.digest}; preload ${bundle.loader.digest}; zero skips/leftovers\n`);
