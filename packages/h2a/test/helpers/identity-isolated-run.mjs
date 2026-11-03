// Build only repository sources. Never resolve h2a through the installed dist.
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ensureHistoricalGitRef, IDENTITY_BASE_REF } from '../../../../scripts/historical-test-ref.mjs';
const repo = resolve(import.meta.dirname, '../../../..');
const require = createRequire(join(repo, 'package.json'));
const ts = require('typescript');
const lane = fs.mkdtempSync(join(tmpdir(), 'h2a-idlock-build2-'));
fs.mkdirSync(join(repo, 'tmp'), { recursive: true });
fs.writeFileSync(join(repo, 'tmp', 'idlock-build2-lane.txt'), lane);
for (const name of ['runtime', 'config', 'state', 'cache', 'home', 'tmp']) fs.mkdirSync(join(lane, name));
function compile(root) {
  for (const pkg of ['h2a', 'h2a-runtime', 'track', 'remote-protocol']) {
    const base = join(root, 'packages', pkg);
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, ent.name);
        if (ent.isDirectory()) walk(path);
        else {
          const dest = path.replace('/src/', '/dist/').replace(/\.ts$/, '.js');
          fs.mkdirSync(resolve(dest, '..'), { recursive: true });
          if (ent.name.endsWith('.d.ts')) continue;
          const src = fs.readFileSync(path);
          fs.writeFileSync(dest, ent.name.endsWith('.ts') ? ts.transpileModule(src.toString(), {
            compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
          }).outputText : src);
        }
      }
    };
    walk(join(base, 'src'));
  }
  const modules = join(root, 'node_modules');
  fs.mkdirSync(join(modules, '@sentropic'), { recursive: true });
  for (const name of fs.readdirSync(join(repo, 'node_modules'))) {
    if (name === '@sentropic') continue;
    fs.symlinkSync(join(repo, 'node_modules', name), join(modules, name));
  }
  for (const name of fs.readdirSync(join(repo, 'node_modules', '@sentropic'))) {
    const own = ['h2a', 'h2a-runtime', 'track'].includes(name);
    fs.symlinkSync(own ? join(root, 'packages', name) : join(repo, 'node_modules', '@sentropic', name), join(modules, '@sentropic', name));
  }
  for(const pkg of ['h2a','h2a-runtime','track','remote-protocol']) {
    const nested=join(repo,'packages',pkg,'node_modules');if(!fs.existsSync(nested))continue;
    const target=join(root,'packages',pkg,'node_modules');fs.mkdirSync(target,{recursive:true});
    for(const name of fs.readdirSync(nested)) {
      if(name.startsWith('@')) {
        fs.mkdirSync(join(target,name),{recursive:true});
        for(const sub of fs.readdirSync(join(nested,name))) {
          if(['h2a','h2a-runtime','track'].includes(sub))continue;
          fs.symlinkSync(join(nested,name,sub),join(target,name,sub));
        }
      } else fs.symlinkSync(join(nested,name),join(target,name));
    }
  }
}
for (const label of (process.env.IDLOCK_BUILD_ONLY==='1' ? ['candidate'] : ['candidate', 'base'])) {
  const dest = join(lane, label);
  fs.mkdirSync(dest);
  if (label === 'base' || process.env.IDLOCK_CANDIDATE_REF) {
    const ref = label==='base'?IDENTITY_BASE_REF:process.env.IDLOCK_CANDIDATE_REF;
    ensureHistoricalGitRef(repo, ref);
    const archive = spawnSync('git', ['archive', ref], { cwd: repo, maxBuffer: 100 * 1024 * 1024 });
    if (archive.status !== 0) throw new Error(archive.stderr.toString());
    const extract = spawnSync('tar', ['-x', '-C', dest], { input: archive.stdout });
    if (extract.status !== 0) throw new Error(extract.stderr.toString());
  } else {
    for (const pkg of ['h2a', 'h2a-runtime', 'track', 'remote-protocol']) {
      fs.cpSync(join(repo, 'packages', pkg, 'src'), join(dest, 'packages', pkg, 'src'), { recursive: true });
      fs.cpSync(join(repo, 'packages', pkg, 'package.json'), join(dest, 'packages', pkg, 'package.json'));
      const assets = pkg === 'h2a' ? ['fixtures', 'schema', 'registry'] : pkg === 'track' ? ['registry'] : [];
      for (const name of assets) fs.cpSync(join(repo, 'packages', pkg, name), join(dest, 'packages', pkg, name), { recursive: true });
    }
  }
  fs.cpSync(join(repo, 'packages/h2a/test'), join(dest, 'packages/h2a/test'), { recursive: true });
  for(const name of ['tsconfig.base.json','tsconfig.json'])fs.copyFileSync(join(repo,name),join(dest,name));
  for(const pkg of ['h2a','h2a-runtime','track','remote-protocol'])fs.copyFileSync(join(repo,'packages',pkg,'tsconfig.json'),join(dest,'packages',pkg,'tsconfig.json'));
  compile(dest);
}
const env = { ...process.env, HOME: join(lane, 'home'), TMPDIR: join(lane, 'tmp'), XDG_CACHE_HOME: join(lane, 'cache'),
  XDG_RUNTIME_DIR: join(lane, 'runtime'), XDG_CONFIG_HOME: join(lane, 'config'), XDG_STATE_HOME: join(lane, 'state'),
  H2A_ROOT: join(lane, 'state', 'store'), IDLOCK_LANE: lane, NODE_OPTIONS: '--import '+join(repo,'packages/h2a/test/helpers/identity-isolation-guard.mjs') };
fs.writeFileSync(join(lane, 'environment.json'), JSON.stringify(Object.fromEntries(['HOME','TMPDIR','XDG_CACHE_HOME','XDG_RUNTIME_DIR','XDG_CONFIG_HOME','XDG_STATE_HOME','H2A_ROOT','IDLOCK_LANE'].map(k=>[k,env[k]])), null, 2));
const files = process.argv.slice(2);
if(process.env.IDLOCK_BUILD_ONLY==='1') {
  process.stdout.write(`LANE=${lane}\n`);
  process.exit(0);
}
if(files.length===0)throw new Error('named test files required; use IDLOCK_BUILD_ONLY=1 for a source-only build');
const output = spawnSync(process.execPath, ['--import', join(repo, 'packages/h2a/test/helpers/identity-isolation-guard.mjs'), '--test', ...files], {
  cwd: join(lane, 'candidate'), env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024
});
fs.writeFileSync(join(lane, 'tests.tap'), output.stdout + output.stderr);
const shown=process.env.IDLOCK_SUMMARY==='1' ? output.stdout.split('\n').filter(line=>/^(not ok|# (tests|pass|fail|skipped|duration)|\s+error:)/.test(line)).join('\n')+'\n' : output.stdout;
process.stdout.write(`LANE=${lane}\n` + shown + output.stderr);
process.exitCode = output.status ?? 1;
