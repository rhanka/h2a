import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { digest } from '../src/runtime/handover/wire.js';
import { verifyImage } from '../src/runtime/handover/image.js';
import { exerciseTypedIdReuse } from './helpers/mh-l1-transport.js';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
test('MH-L1 prototype should pack/install twice offline with exact runtime, integrated transport and a real legacy node-pty probe', async t => {
  const { buildPackagingPrototype } = await import('../../../scripts/mh-l1-package-prototype.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'mh-l1-package-'));
  const previousUmask = process.umask(0o022);
  try {
    const a = await buildPackagingPrototype(join(dir, 'a'), { buildId: 'fixture-build' });
    console.log(`prototype a built: ${a.manifest.files.length} manifest entries`);
    const b = await buildPackagingPrototype(join(dir, 'b'), { buildId: 'fixture-build' });
    console.log(`prototype b built: ${b.manifest.files.length} manifest entries`);
    assert.deepEqual(a.manifest, b.manifest);
    assert.equal(a.native.binaryDigest, b.native.binaryDigest);
    assert.equal(verifyImage(a.root, a.manifest, digest(a.manifest)).verified, true);
    const pkg = JSON.parse(readFileSync(join(a.root, 'package.json')));
    const lock = JSON.parse(readFileSync(join(a.root, 'npm-shrinkwrap.json')));
    assert.equal(pkg.engines.node, '>=22');
    assert.equal(lock.lockfileVersion, 3);
    assert.equal(pkg.dependencies['@sentropic/h2a-runtime'], a.runtimeVersion);
    assert.equal(pkg.peerDependencies, undefined);
    assert.equal(pkg.scripts, undefined);
    assert.ok(lock.packages['node_modules/@sentropic/h2a-runtime']);
    const transportPath = 'node_modules/@sentropic/h2a/dist/runtime/mcp/transport/streamable-http.js';
    assert.ok(a.manifest.files.some(file => file.path === transportPath));
    assert.match(readFileSync(join(a.root, 'node_modules/@sentropic/h2a/dist/runtime/mcp-central.js'), 'utf8'), /\.\/mcp\/transport\/streamable-http\.js/);
    const descriptor = JSON.parse(readFileSync(join(a.root, 'prototype.json')));
    assert.equal(descriptor.releaseQualified, false);
    const artifacts = join(dir, 'artifacts'); mkdirSync(artifacts);
    const env = { ...process.env, npm_config_cache: join(dir, 'npm-cache'), npm_config_offline: 'true', npm_config_umask: '022' };
    const pack = await exec('npm', ['pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', artifacts], { cwd: a.root, env, maxBuffer: 16 * 1024 * 1024 });
    const receipt = JSON.parse(pack.stdout)[0];
    const paths = receipt.files.map(file => file.path);
    assert.ok(paths.includes('npm-shrinkwrap.json'));
    assert.ok(paths.includes(transportPath));
    assert.ok(paths.includes('node_modules/node-pty/build/Release/pty.node'));
    assert.ok(!paths.some(path => /\.py$|(^|\/)node-gyp(\/|$)/.test(path)));
    assert.deepEqual(paths.filter(path => /(^|\/)\.track(\/|$)|\.test\.[cm]?js$/.test(path)), []);
    t.diagnostic(`npm pack --offline --ignore-scripts --json => ${JSON.stringify({ filename: receipt.filename, files: paths.length, integrity: receipt.integrity })}`);
    const installedManifests = [];
    for (const name of ['install-a', 'install-b']) {
      const destination = join(dir, name); mkdirSync(destination);
      const result = await exec('npm', ['install', '--prefix', destination, '--offline', '--umask=022', '--ignore-scripts', '--no-audit', '--no-fund', join(artifacts, receipt.filename)], { cwd: dir, env });
      t.diagnostic(`npm install --prefix <${name}> --offline --umask=022 --ignore-scripts => ${result.stdout.trim()}`);
      const root = join(destination, 'node_modules', pkg.name);
      assert.ok(existsSync(join(root, 'npm-shrinkwrap.json')));
      const { createManifest } = await import('../src/runtime/handover/image.js');
      const { files, ...metadata } = a.manifest;
      const installed = createManifest(root, metadata);
      installedManifests.push(installed);
      const expected = new Map(a.manifest.files.map(file => [file.path, file]));
      const actualPaths = new Set(installed.files.map(file => file.path));
      const missing = a.manifest.files.filter(file => !actualPaths.has(file.path));
      const differences = installed.files.filter(file => JSON.stringify(file) !== JSON.stringify(expected.get(file.path)));
      if (differences.length || missing.length) t.diagnostic(JSON.stringify({ missing: missing.slice(0, 12), missingCount: missing.length, payloadDifferences: differences.length, examples: differences.slice(0, 8).map(actual => ({ expected: expected.get(actual.path), actual })) }));
      assert.equal(verifyImage(root, a.manifest, a.manifestDigest).verified, true);
      const require = createRequire(join(root, 'package.json'));
      const pty = require(join(root, 'node_modules/node-pty'));
      const term = pty.spawn(process.execPath, ['-e', "process.stdout.write('legacy-real-pty-ok')"], {
        cwd: destination, name: 'xterm', cols: 80, rows: 24, env: { PATH: process.env.PATH, HOME: destination, XDG_RUNTIME_DIR: destination }
      });
      let output = ''; term.onData(bytes => { output += bytes; });
      const code = await new Promise(resolve => term.onExit(({ exitCode }) => resolve(exitCode)));
      assert.equal(code, 0); assert.match(output, /legacy-real-pty-ok/);
      const version = await exec(process.execPath, [join(root, 'dist/bin.js'), '--version'], { cwd: destination, env });
      assert.equal(version.stdout.trim(), a.coreVersion);
      // Exercise the installed corrected transport, not a checkout import.
      const source = `import assert from 'node:assert/strict';
import { once } from 'node:events'; import { createServer } from 'node:http';
import { Hono } from 'hono'; import { getRequestListener } from '@hono/node-server';
import { StreamableHTTPTransport } from ${JSON.stringify(pathToFileURL(join(root, transportPath)).href)};
await (${exerciseTypedIdReuse.toString()})(StreamableHTTPTransport);
console.log('installed-integrated-transport-batch-ok');`;
      const loaded = await exec(process.execPath, ['--input-type=module', '-e', source], { cwd: root, env });
      assert.match(loaded.stdout, /installed-integrated-transport-batch-ok/);
    }
    assert.deepEqual(installedManifests[0], installedManifests[1]);
    t.diagnostic(`payload manifests equal; files=${a.manifest.files.length}; native=${a.native.binaryDigest}; installed legacy probes=2; closure remains prototype-only`);
  } finally { process.umask(previousUmask); rmSync(dir, { recursive: true, force: true }); }
});
