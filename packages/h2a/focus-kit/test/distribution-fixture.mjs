import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, realpathSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
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
  const archives = [], packedPackages = [];
  for (const name of ['track','h2a-runtime','h2a']) {
    const [packed] = JSON.parse(run(npm, ['pack','--offline','--ignore-scripts','--json','--pack-destination',root,join(repo,'packages',name)]));
    archives.push(join(root, packed.filename));
    packedPackages.push(packed);
  }
  const install = join(root, 'consumer'); mkdirSync(install);
  // npm ci populated tarballs, not registry packuments. Seed the exact locked
  // closure, replacing workspace links with the freshly packed immutable bytes.
  const lock = JSON.parse(readFileSync(join(repo, 'package-lock.json'), 'utf8'));
  const dependencies = Object.fromEntries(packedPackages.map((p, i) => [p.name, `file:${archives[i]}`]));
  const metadata = { name: 'focus-consumer', version: '1.0.0', private: true, type: 'module', dependencies };
  lock.name = metadata.name; lock.version = metadata.version;
  const original = lock.packages;
  const hydrate = (path, entry) => {
    if (entry.resolved || entry.link) return entry;
    // Workspace lockfiles can abbreviate a repeated nested package. Resolve it
    // only to identical name+version bytes already pinned elsewhere in this lock.
    const name = path.split('node_modules/').at(-1);
    const match = Object.entries(original).find(([p, value]) => p.split('node_modules/').at(-1) === name
      && value.version === entry.version && value.resolved?.startsWith('https:') && value.integrity);
    assert.ok(match, `No locked artifact for ${path}@${entry.version}`);
    return { ...match[1], ...entry };
  };
  lock.packages = { '': { name: metadata.name, version: metadata.version, dependencies } };
  for (const [path, value] of Object.entries(original)) {
    if (value.dev) continue; // Consumer closure excludes workspace build/test tools.
    if (path.startsWith('node_modules/') && !value.link) lock.packages[path] = hydrate(path, value);
    for (const p of packedPackages) {
      const short = p.name.split('/').at(-1), prefix = `packages/${short}/node_modules/`;
      if (path.startsWith(prefix)) lock.packages[`node_modules/${p.name}/node_modules/${path.slice(prefix.length)}`] = hydrate(path, value);
    }
  }
  packedPackages.forEach((p, i) => {
    const short = p.name.split('/').at(-1), entry = { ...original[`packages/${short}`] };
    delete entry.devDependencies;
    lock.packages[`node_modules/${p.name}`] = { ...entry, resolved: `file:${archives[i]}`, integrity: p.integrity };
  });
  writeFileSync(join(install,'package.json'), JSON.stringify(metadata));
  writeFileSync(join(install,'package-lock.json'), JSON.stringify(lock));
  // Deliberately omit every registry metadata/index entry: a warm developer
  // cache must not conceal an unpinned package resolution on a fresh runner.
  const sourceCache = env.npm_config_cache, cache = join(root, 'tarball-only-cache');
  const matches = (values, host) => !values || ((!values.some(v => !v.startsWith('!')) || values.includes(host)) && !values.includes(`!${host}`));
  let tarballs = 0;
  for (const entry of Object.values(original)) {
    if (!entry.resolved?.startsWith('https:') || !entry.integrity?.startsWith('sha512-')
      || !matches(entry.os, process.platform) || !matches(entry.cpu, process.arch)) continue;
    const hex = Buffer.from(entry.integrity.slice(7), 'base64').toString('hex');
    const contentPath = join('_cacache', 'content-v2', 'sha512', hex.slice(0,2), hex.slice(2,4), hex.slice(4));
    const target = join(cache, contentPath); mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(sourceCache, contentPath), target); tarballs++;
  }
  assert.ok(tarballs > 0, 'Missing locked tarballs fails the witness');
  env.npm_config_cache = cache;
  run(npm, ['ci','--offline','--ignore-scripts','--legacy-peer-deps','--no-audit','--no-fund'], install);
  console.log(`Fresh consumer: ${tarballs} platform tarballs, zero registry metadata entries`);
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
