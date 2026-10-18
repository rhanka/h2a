import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
export function installedEvidence(root) {
  const env = { ...process.env, HOME: root, TMPDIR: root, XDG_RUNTIME_DIR: root, XDG_CONFIG_HOME: root,
    XDG_STATE_HOME: root, XDG_CACHE_HOME: root, H2A_ROOT: join(root, 'h2a'),
    npm_config_cache: process.env.npm_config_cache ?? join(process.env.HOME, '.npm') };
  const run = (command, args, cwd = root) => {
    const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', shell: process.platform === 'win32' && command === 'npm.cmd', maxBuffer: 16 * 1024 * 1024 });
    assert.equal(r.status, 0, `${command} ${args.join(' ')}\n${r.stderr}\n${r.stdout}`); return r.stdout;
  };
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const archives = [];
  for (const name of ['track','h2a-runtime','h2a']) {
    const [packed] = JSON.parse(run(npm, ['pack','--offline','--ignore-scripts','--json','--pack-destination',root,join(repo,'packages',name)]));
    archives.push(join(root, packed.filename));
  }
  const install = join(root, 'consumer'); mkdirSync(install);
  writeFileSync(join(install,'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run(npm, ['install','--offline','--ignore-scripts','--legacy-peer-deps','--no-audit','--no-fund',...archives], install);
  const packageRoot = join(install,'node_modules/@sentropic/h2a');
  assert.ok(realpathSync(packageRoot).startsWith(install), 'Package is installed, not a workspace alias');
  const guard = join(install,'guard.mjs');
  writeFileSync(guard, `import{registerHooks}from'node:module';import{fileURLToPath}from'node:url';import{relative,isAbsolute}from'node:path';
    const root=${JSON.stringify(install)};registerHooks({resolve(specifier,context,next){const result=next(specifier,context);if(result.url.startsWith('file:')){const p=relative(root,fileURLToPath(result.url));if(p.startsWith('..')||isAbsolute(p))throw new Error('Consumer escaped install: '+result.url);}return result;}});`);
  const bin = join(packageRoot,'dist/bin.js'), input = join(install,'dossier.json'), output = join(install,'dossier.html');
  run(process.execPath,['--import',guard,bin,'focus','template','--evidence','-o',input],install);
  const document = JSON.parse(readFileSync(input,'utf8')); assert.equal(document.schemaVersion,2);
  run(process.execPath,['--import',guard,bin,'focus','build',input,'-o',output],install);
  const html = readFileSync(output,'utf8');
  const payload = JSON.parse(html.match(/<script type="application\/json" data-focus-document>([\s\S]*?)<\/script>/)[1]);
  assert.equal(payload.build.increment,'H1'); assert.deepEqual(payload.build.formats,[1,2]);
  assert.deepEqual(payload.document.sources,document.sources);
  assert.ok(payload.build.capabilities.includes('evidence-search'));
  assert.equal(payload.build.capabilities.some(c=>/cdn|explorer|ds-layout/.test(c)),false);
  const manifest = JSON.parse(readFileSync(join(packageRoot,'focus-kit/renderer-manifest.json'),'utf8'));
  assert.equal(payload.build.rendererSha256,manifest.html); assert.equal(payload.build.validatorSha256,manifest.validator);
  assert.deepEqual(JSON.parse(readFileSync(join(packageRoot,'focus-kit/dossier.v2.schema.json'),'utf8')).properties.schemaVersion,{const:2});
  return { document, output, url: pathToFileURL(output).href, packageRoot, install };
}
