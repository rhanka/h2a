import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';

const repo=fileURLToPath(new URL('../../../',import.meta.url));
test('closed release refuses a stale portable Focus renderer before constructing any payload',async t=>{
  const root=fs.mkdtempSync(join(tmpdir(),'closed-focus-preflight-')),copy=join(root,'repo');
  let bundler;
  t.after(()=>{bundler?.stop();fs.rmSync(root,{recursive:true,force:true});});
  fs.mkdirSync(copy);
  // Real source, compiled workspaces and dependencies, all physically private.
  // Relative workspace links keep their meaning inside this copy.
  for(const name of ['scripts','packages','apps/focus','node_modules','package.json','package-lock.json']){
    fs.mkdirSync(join(copy,name,'..'),{recursive:true});
    fs.cpSync(join(repo,name),join(copy,name),{recursive:true,verbatimSymlinks:true,
      mode:fs.constants.COPYFILE_FICLONE,filter:path=>! /\.(?:py|pyc|pyo)$/.test(path)});
  }
  const renderer=join(copy,'packages/h2a/focus-kit/renderer.html');
  fs.appendFileSync(renderer,'\n<!-- stale packaged renderer -->\n');
  bundler=await import(pathToFileURL(join(copy,'node_modules/esbuild/lib/main.js')).href);
  const {buildReleasePayload}=await import(pathToFileURL(join(copy,'scripts/mh-l1-package-prototype.mjs')).href);
  const {verifyPublishablePayload}=await import(pathToFileURL(join(copy,'scripts/check-publish-payload.mjs')).href);
  const output=join(root,'payload');
  let accepted,error;
  try{accepted=await buildReleasePayload(output,{buildId:'stale-focus-preflight'});}catch(cause){error=cause;}
  if(accepted){
    const verified=verifyPublishablePayload(accepted.root);
    t.diagnostic('stale Focus accepted as a verified closed payload: '+verified.publishedDigest);
  }
  assert.ok(error,'the inherited portable Focus prepack guard must also protect the closed producer');
  assert.match(error.message,/Focus dossier renderer is stale/);
  assert.equal(fs.existsSync(output),false,'the guard must run before creating the payload tree');
});
