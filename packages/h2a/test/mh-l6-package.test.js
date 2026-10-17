import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import cp from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { exerciseTypedIdReuse } from './helpers/mh-l1-transport.js';
import { promisify } from 'node:util';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { verifyImage } from '../src/runtime/handover/image.js';

const test = (name, body) => { if (!process.env.MH_L6_CASE || process.env.MH_L6_CASE === name) nodeTest(name, body); };
const exec = promisify(cp.execFile), json = path => JSON.parse(fs.readFileSync(path));
async function packageScenario(t, packageName, { graphOnly = false, diagnosticsOnly = false } = {}) {
  const targetVersion = graphOnly ? '0.98.7-qualification' : '0.98.7';
  const root = fs.mkdtempSync(join(tmpdir(), 'mh-l6-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'no-compilers'), marker = join(root, 'compiler-executed'); fs.mkdirSync(bin);
  for (const name of ['c++', 'cc', 'zig', 'node-gyp']) fs.writeFileSync(join(bin, name), `#!/bin/sh\nprintf unexpected > '${marker}'\nexit 71\n`, { mode: 0o755 });
  const originalPath = process.env.PATH; process.env.PATH = bin + ':' + originalPath;
  t.after(() => { process.env.PATH = originalPath; });
  const children = [], originalSpawn = cp.spawn;
  cp.spawn = function(...args) { const child = originalSpawn.apply(this, args); children.push({ child, closed: new Promise(resolve => child.once('close', resolve)) }); return child; };
  syncBuiltinESMExports();
  t.after(async () => {
    for (const { child } of children) {
      if (child.exitCode === null && child.signalCode === null) child.ref();
      for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.ref?.();
    }
    (await import('esbuild')).stop(); await Promise.all(children.map(row => row.closed));
    cp.spawn = originalSpawn; syncBuiltinESMExports();
  });
  const { buildReleasePayload } = await import('../../../scripts/mh-l1-package-prototype.mjs');
  const { packRelease } = await import('../../../scripts/package-release.mjs');
  const { verifyPublishablePayload } = await import('../../../scripts/check-publish-payload.mjs');
  assert.equal(typeof buildReleasePayload, 'function', 'a release must not publish the MH-L1 wrapper or use its local compiler');
  let a, b, packed, buildError;
  try {
    if (graphOnly) a = await buildReleasePayload(join(root, 'a'), { version: targetVersion, buildId: 'mh-l6-release-cohort', packageName });
    else {
      packed = await packRelease(join(root, 'a'), { version: targetVersion, buildId: 'mh-l6-release-cohort', packageName });
      a = packed.payload;
    }
    b = await buildReleasePayload(join(root, 'b'), { version: targetVersion, buildId: 'mh-l6-release-cohort', packageName });
  } catch (cause) { buildError = cause; }
  assert.equal(fs.existsSync(marker), false, 'release packaging must not execute a local compiler');
  assert.ifError(buildError, 'the actual packed dependency graph must remain closed');
  assert.deepEqual(a.manifest, b.manifest); assert.equal(a.native.binaryDigest, b.native.binaryDigest);
  assert.equal(a.native.qualification, 'release-pinned-prebuild');
  assert.equal(json(join(a.root, 'manifest.json')).kind, 'h2a-published-payload', 'one published tarball must describe both qualified Node profiles');
  const pkg = json(join(a.root, 'package.json')), lock = json(join(a.root, 'npm-shrinkwrap.json'));
  assert.equal(pkg.name, packageName); assert.equal(pkg.version, targetVersion);
  assert.equal(pkg.private, undefined); assert.equal(pkg.peerDependencies, undefined); assert.equal(pkg.scripts, undefined);
  const dependency = packageName === '@sentropic/h2a' ? '@sentropic/h2a-runtime' : '@sentropic/h2a';
  assert.equal(pkg.dependencies[dependency], targetVersion);
  if (!diagnosticsOnly) for (const path of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    assert.equal(json(join(a.root, dirname(dirname(a.manifest.entrypoints.core)), path)).version, pkg.version,
      'the actual copied plugin metadata must follow the published core version');
  }
  assert.equal(json(join(a.root, 'node_modules', dependency, 'package.json')).version, targetVersion);
  assert.equal(lock.packages[''].version, targetVersion);
  assert.equal(lock.packages['node_modules/' + dependency].version, targetVersion);
  assert.equal(lock.packages['node_modules/' + packageName], undefined, 'the published package belongs at the root');
  assert.equal(verifyImage(a.root, a.manifest, a.manifestDigest).verified, true);
  let verified; assert.doesNotThrow(() => { verified = verifyPublishablePayload(a.root); });
  assert.equal(verified.packageName, packageName);
  if (graphOnly) return;
  const artifacts = join(root, 'tarballs'); fs.mkdirSync(artifacts);
  const config = join(root, 'npmrc'), globalConfig = join(root, 'global-npmrc'); fs.writeFileSync(config, ''); fs.writeFileSync(globalConfig, '');
  const env = { ...process.env, npm_config_userconfig: config,
    npm_config_globalconfig: globalConfig, npm_config_cache: join(root, 'npm-cache'), npm_config_offline: 'true',
    npm_config_umask: '022', npm_config_update_notifier: 'false' };
  delete env.npm_config_ignore_scripts;
  const checkedExec = async (command, args, options) => {
    let result, error;
    try { result = await exec(command, args, options); } catch (cause) { error = cause; }
    assert.equal(fs.existsSync(marker), false, 'an npm install must not execute a local compiler');
    assert.ifError(error); // null exit code / signals / timeouts are failures too.
    return result;
  };
  const scriptProbe = join(root, 'script-probe'), scriptMarker = join(root, 'script-enabled');
  fs.mkdirSync(scriptProbe);
  fs.writeFileSync(join(scriptProbe, 'package.json'), JSON.stringify({ name: '@fixture/script-probe', version: '1.0.0', scripts: { postinstall: 'node probe.cjs' } }));
  fs.writeFileSync(join(scriptProbe, 'probe.cjs'), `require('node:fs').writeFileSync(process.env.MH_SCRIPT_MARKER,'enabled');`);
  const probePack = JSON.parse((await checkedExec('npm', ['pack', '--offline', '--json', '--pack-destination', artifacts], { cwd: scriptProbe, env, timeout: 30000 })).stdout)[0];
  await checkedExec('npm', ['install', '-g', '--prefix', join(root, 'probe-prefix'), '--offline', '--no-audit', '--no-fund', join(artifacts, probePack.filename)], { cwd: root, env: { ...env, MH_SCRIPT_MARKER: scriptMarker }, timeout: 30000 });
  assert.equal(fs.readFileSync(scriptMarker, 'utf8'), 'enabled');
  t.diagnostic('npm scripts-enabled positive control: postinstall actually executed in a separate private fixture');
  const receipt = JSON.parse(packed.stdout)[0], files = receipt.files.map(row => row.path);
  for (const path of ['npm-shrinkwrap.json', 'manifest.json', a.manifest.entrypoints.shim, 'node_modules/node-pty/build/Release/pty.node']) assert.ok(files.includes(path), path);
  assert.equal(files.some(path => /\.py$|(^|\/)node-gyp\//.test(path)), false);
  t.diagnostic(JSON.stringify({ npm: 'pack --offline --json', filename: receipt.filename, integrity: receipt.integrity, files: files.length }));
  if (diagnosticsOnly) {
    assert.ok(process.env.MH_L5_ARTIFACTS, 'official npm fixture mandatory; never skip');
    const assets = fs.realpathSync(process.env.MH_L5_ARTIFACTS), node = json(join(assets, 'receipt.json')).node24;
    const npm = fs.realpathSync(join(dirname(node), 'npm')); assert.ok(npm.startsWith(assets + '/'));
    const observed = await checkedExec(process.execPath, [npm, '--version'], { env, timeout: 15000 });
    assert.equal(observed.stdout.trim(), '11.19.0');
    // npm 11's --os/--cpu flags affect optional packages only. Supply the
    // required-package eligibility reader with a foreign profile in this own
    // child; keep Node/filesystem/process.platform genuinely Linux throughout.
    const platformInput = join(root, 'npm-platform-input.mjs');
    const currentEnv = join(dirname(npm), '../node_modules/npm-install-checks/lib/current-env.js');
    fs.writeFileSync(platformInput, `import{createRequire}from'node:module';const current=createRequire(import.meta.url)(${JSON.stringify(currentEnv)});if(typeof current.os!=='function'||typeof current.cpu!=='function')throw Error('npm_profile_fixture_missing');current.os=()=>process.env.MH_NPM_OS;current.cpu=()=>process.env.MH_NPM_CPU;`);
    const platformProbe = join(root, 'platform-probe'); fs.mkdirSync(platformProbe);
    fs.writeFileSync(join(platformProbe, 'package.json'), JSON.stringify({name:'@fixture/platform-probe',version:'1.0.0',os:['linux'],cpu:['x64']}));
    const probe = JSON.parse((await checkedExec(process.execPath, [npm,'pack','--offline','--json','--pack-destination',artifacts], {cwd:platformProbe,env,timeout:30000})).stdout)[0];
    let refused; try { await exec(process.execPath, ['--import='+platformInput,npm,'install','--prefix',join(root,'platform-probe-prefix'),'--offline','--no-audit','--no-fund',join(artifacts,probe.filename)], {cwd:root,env:{...env,MH_NPM_OS:'darwin',MH_NPM_CPU:'arm64'},timeout:30000}); } catch (cause) {refused=cause;}
    assert.equal(refused?.code,1,'the real npm target override must reject an incompatible control package'); assert.match(refused.stderr,/EBADPLATFORM/);
    t.diagnostic('npm required-profile fixture control: incompatible linux/x64 package rejected with EBADPLATFORM');
    for (const [os, cpu] of [['darwin', 'arm64'], ['win32', 'x64']]) {
      const prefix = join(root, 'diagnostics-' + os), args = ['--import='+platformInput, npm, 'install', '--prefix', prefix, '--offline', '--umask=022', '--no-audit', '--no-fund', packed.filename];
      const result = await checkedExec(process.execPath, args, { cwd: root, env: {...env,MH_NPM_OS:os,MH_NPM_CPU:cpu}, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
      const payload = join(prefix, 'node_modules', packageName);
      assert.equal(json(join(payload, 'package.json')).version, pkg.version);
      const { preparePublishedImage } = await import(pathToFileURL(join(payload, dirname(dirname(a.manifest.entrypoints.core)), 'dist/runtime/upgrade/published-payload.js')));
      const original = Object.getOwnPropertyDescriptor(process, 'platform'), image = join(root, os + '-must-not-select');
      try {
        Object.defineProperty(process, 'platform', { value: os, configurable: true });
        assert.throws(() => preparePublishedImage(payload, image), /image_loader_unqualified/);
        assert.equal(fs.existsSync(image), false);
      } finally { Object.defineProperty(process, 'platform', original); }
      t.diagnostic('npm 11.19.0 required-profile fixture ' + os + '/' + cpu + ': ' + result.stdout.trim() + '; actual installed reader rejects H4 before preparation; no foreign runtime executed');
    }
    return;
  }
  if (packageName === '@sentropic/h2a') {
    assert.ok(process.env.MH_L5_ARTIFACTS, 'real published legacy fixtures are mandatory');
    const legacyRoot = fs.realpathSync(process.env.MH_L5_ARTIFACTS), registry = json(join(legacyRoot, 'receipt.json'));
    for (const version of ['0.98.5', '0.98.6']) {
      const archive = join(legacyRoot, version, 'h2a.tgz'), record = registry.profiles.find(row => row.version === version).packages.find(row => row.name === '@sentropic/h2a');
      assert.equal(createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), record.sha256);
      const modulePath = join(legacyRoot, version, 'node_modules/@sentropic/h2a/dist/runtime/upgrade/index.js');
      const original = cp.execFileSync('/usr/bin/tar', ['-xOf', archive, 'package/dist/runtime/upgrade/index.js']);
      assert.deepEqual(fs.readFileSync(modulePath), original, 'execute the actual published upgrade module');
      const { defaultUpgradeRuntime: legacy } = await import(pathToFileURL(modulePath));
      const prefix = join(root, 'legacy-staging-' + version), saved = new Map(Object.keys(env).map(key => [key, process.env[key]]));
      try {
        Object.assign(process.env, env);
        const installed = legacy.stageInstall(packed.filename, prefix); assert.equal(fs.existsSync(marker), false); assert.equal(installed.ok, true, installed.error);
        assert.equal(legacy.probeStagedVersion(prefix), targetVersion);
        const directory = join(prefix, 'lib/node_modules/@sentropic/h2a');
        assert.equal(verifyImage(directory, a.manifest, a.manifestDigest).verified, true);
        const native = legacy.verifyStagedNative(directory); assert.equal(native.ok, true, native.error);
        // The legacy require probe does not hash ELF bytes; make it unloadable.
        fs.writeFileSync(join(directory, 'node_modules/node-pty/build/Release/pty.node'), 'unloadable ELF');
        assert.equal(legacy.verifyStagedNative(directory).ok, false);
        t.diagnostic('actual published ' + version + ': stageInstall(local .7 tar), probeStagedVersion=.7, verifyStagedNative=true; corrupt ELF=false; only temporary prefixes');
      } finally { for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
    }
  }
  for (const name of ['one', 'two']) {
    const prefix = join(root, name);
    const installed = await checkedExec('npm', ['install', '-g', '--prefix', prefix, '--offline', '--umask=022', '--no-audit', '--no-fund', packed.filename], { cwd: root, env, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    t.diagnostic(`npm install -g --prefix <${name}> --offline (scripts enabled) => ${installed.stdout.trim()}`);
    const payload = join(prefix, 'lib/node_modules', packageName);
    assert.equal(verifyImage(payload, a.manifest, a.manifestDigest).verified, true);
    const version = await checkedExec(process.execPath, [join(payload, a.manifest.entrypoints.shim), '--version'], { cwd: prefix, env, timeout: 15000 });
    assert.equal(version.stdout.trim(), targetVersion);
    if (name === 'one') {
      const transport = json(join(payload, 'payload-build.json')).transport;
      const { StreamableHTTPTransport } = await import(pathToFileURL(join(payload, transport)));
      await exerciseTypedIdReuse(StreamableHTTPTransport);
      t.diagnostic('actual installed corrected MCP transport: reused numeric/string IDs and delayed batch replies passed');
    }
    const candidates = [process.execPath];
    if (process.versions.node.startsWith('22.')) {
      assert.ok(process.env.MH_L5_ARTIFACTS, 'official Node 24 fixture is required, never silently skipped');
      const other = json(join(process.env.MH_L5_ARTIFACTS, 'receipt.json')).node24;
      assert.ok(fs.realpathSync(other).startsWith(fs.realpathSync(process.env.MH_L5_ARTIFACTS) + '/'));
      candidates.push(other);
    }
    if (name === 'one') for (const node of candidates) {
      const core = dirname(dirname(a.manifest.entrypoints.core));
      const image = join(root, name + '-image-' + (await checkedExec(node, ['-p', 'process.versions.modules'], { env, timeout: 10000 })).stdout.trim());
      const prepare = `import {preparePublishedImage}from${JSON.stringify(pathToFileURL(join(payload, core, 'dist/runtime/upgrade/published-payload.js')).href)};
        const began=Date.now(),image=await preparePublishedImage(process.argv[1],process.argv[2]);
        process.stdout.write(JSON.stringify({root:image.root,manifest:image.manifestDigest,prepareMs:Date.now()-began}));`;
      // Installation/preparation stays within the existing 900 s file budget.
      // The manifest's startup budget begins only after that durable image exists.
      const prepared = JSON.parse((await checkedExec(node, ['--input-type=module', '-e', prepare, payload, image], { env, maxBuffer: 8 * 1024 * 1024 })).stdout);
      assert.equal(prepared.root, image);
      const manifest = json(join(image, 'manifest.json'));
      assert.equal(verifyImage(image, manifest, prepared.manifest).verified, true);
      const code = String.raw`import fs from 'node:fs'; import {createRequire}from'node:module';import {join}from'node:path';import {pathToFileURL}from'node:url';
        import {verifyImage}from${JSON.stringify(new URL('../src/runtime/handover/image.js', import.meta.url).href)};
        const began=Date.now(),image={root:process.argv[1],manifest:JSON.parse(fs.readFileSync(join(process.argv[1],'manifest.json'))),manifestDigest:process.argv[2]};
        verifyImage(image.root,image.manifest,image.manifestDigest);
        const {installImagePolicy}=await import(pathToFileURL(join(image.root,${JSON.stringify(core)},'dist/runtime/upgrade/image-policy.js')));
        const policy=installImagePolicy(image.root,image.manifest,image.manifestDigest);
        const sdk=await import(pathToFileURL(join(image.root,image.manifest.entrypoints.core)).href);
        const loaded=Date.now();
        if(!Object.keys(sdk).length)throw Error('actual_sdk_empty');
        const require=createRequire(pathToFileURL(join(image.root,'package.json'))), pty=require(join(image.root,'node_modules/node-pty'));
        const child=pty.spawn(process.execPath,['-e',"process.stdout.write('same-tar-image-native')"],{cwd:image.root,name:'xterm',cols:80,rows:24,env:process.env});
        let output='';child.onData(bytes=>output+=bytes);const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
        const result=await new Promise(resolve=>child.onExit(resolve));clearTimeout(timer);
        if(result.exitCode!==0||!output.includes('same-tar-image-native'))throw Error('image_pty_failed');
        policy.deregister();process.stdout.write(JSON.stringify({node:process.version,abi:process.versions.modules,profile:image.manifest.profile.nodeMajor,manifest:image.manifestDigest,sdk:Object.keys(sdk).length,native:true,prepareMs:Number(process.argv[3]),sdkMs:loaded-began}));`;
      const observed = JSON.parse((await checkedExec(node, ['--input-type=module', '-e', code, image, prepared.manifest, String(prepared.prepareMs)], { env, timeout: manifest.startupWaitBudgetMs, maxBuffer: 8 * 1024 * 1024 })).stdout);
      assert.ok(observed.sdkMs < manifest.startupWaitBudgetMs);
      assert.equal(observed.profile, Number(observed.node.slice(1).split('.')[0]));assert.equal(observed.native,true);
      assert.deepEqual(fs.readFileSync(join(payload,'manifest.json')),fs.readFileSync(join(a.root,'manifest.json')));
      t.diagnostic('same actual npm tar => managed SDK and PTY ' + JSON.stringify(observed));
    }
    const require = createRequire(import.meta.url), pty = require(join(payload, 'node_modules/node-pty'));
    const child = pty.spawn(process.execPath, ['-e', "process.stdout.write('installed-release-native')"], {
      cwd: prefix, name: 'xterm', cols: 80, rows: 24, env: { ...env, HOME: prefix, XDG_RUNTIME_DIR: prefix }
    });
    let output = ''; child.onData(bytes => { output += bytes; });
    const deadline = setTimeout(() => child.kill('SIGKILL'), 10000), result = await new Promise(resolve => child.onExit(resolve));
    clearTimeout(deadline); assert.equal(result.exitCode, 0); assert.match(output, /installed-release-native/);
  }
  assert.equal(fs.existsSync(marker), false);
}
for (const packageName of ['@sentropic/h2a', '@sentropic/h2a-runtime']) {
  test(`U10 U12 should publish ${packageName} with exact lockstep and install twice offline without a compiler`, t => packageScenario(t, packageName));
}

test('U10 should build the actual closed dependency graph from pinned prebuilds before invoking npm', t => packageScenario(t, '@sentropic/h2a', { graphOnly: true }));

for (const packageName of ['@sentropic/h2a', '@sentropic/h2a-runtime']) {
  test(`U10 should install ${packageName} for off-profile diagnostics while refusing H4 preparation`, t => packageScenario(t, packageName, { diagnosticsOnly: true }));
}
