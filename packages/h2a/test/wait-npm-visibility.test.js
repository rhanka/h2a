import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

function execAsync(file, args, options) {
  return new Promise((resolve) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      resolve({ status: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr });
    });
  });
}

import {
  DEFAULT_BACKOFF_SECONDS,
  packumentUrl,
  parsePackageSpec,
  probeNpmView,
  probePackument,
  waitForRegistryVisibility,
} from '../../../scripts/wait-npm-visibility.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('../../../scripts/wait-npm-visibility.mjs', import.meta.url));

test('parsePackageSpec parses scoped and unscoped specs and rejects malformed inputs', () => {
  assert.deepEqual(parsePackageSpec('@sentropic/h2a@0.98.11-rc.5'), {
    name: '@sentropic/h2a',
    version: '0.98.11-rc.5',
    spec: '@sentropic/h2a@0.98.11-rc.5',
  });
  assert.deepEqual(parsePackageSpec('h2a@1.2.3'), {
    name: 'h2a',
    version: '1.2.3',
    spec: 'h2a@1.2.3',
  });
  for (const bad of ['', '@sentropic/h2a', '@sentropic/h2a@', '@1.0.0', 'a b@1.0.0', '@/@1.0.0']) {
    assert.throws(() => parsePackageSpec(bad), /Invalid package/);
  }
});

test('packumentUrl encodes scoped and unscoped package names', () => {
  assert.equal(packumentUrl('https://registry.npmjs.org/', '@sentropic/h2a'), 'https://registry.npmjs.org/@sentropic%2Fh2a');
  assert.equal(packumentUrl('http://127.0.0.1:4873', 'plain-pkg'), 'http://127.0.0.1:4873/plain-pkg');
});

test('probeNpmView requires exact version match and rejects empty or wrong versions', async () => {
  const spec = parsePackageSpec('@sentropic/h2a@0.98.11-rc.5');
  const exact = await probeNpmView(spec, {
    execFileImpl: async () => ({ stdout: '0.98.11-rc.5\n' }),
  });
  assert.equal(exact.ok, true);

  const empty = await probeNpmView(spec, {
    execFileImpl: async () => ({ stdout: '\n' }),
  });
  assert.equal(empty.ok, false);
  assert.match(empty.detail, /<empty>/);

  const wrong = await probeNpmView(spec, {
    execFileImpl: async () => ({ stdout: '0.98.11-rc.4\n' }),
  });
  assert.equal(wrong.ok, false);
  assert.match(wrong.detail, /0\.98\.11-rc\.4/);

  const errored = await probeNpmView(spec, {
    execFileImpl: async () => {
      const e = new Error('E404');
      e.stderr = 'npm ERR! 404 Not found\n';
      throw e;
    },
  });
  assert.equal(errored.ok, false);
  assert.match(errored.detail, /404/);
});

test('probePackument verifies exact version, dist.tarball, and optional dist-tag', async () => {
  const spec = parsePackageSpec('@sentropic/h2a@0.98.11-rc.5');
  const fakeFetch = (status, body) => async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  const ok = await probePackument(spec, {
    requireDistTag: 'next',
    fetchImpl: fakeFetch(200, {
      'dist-tags': { next: '0.98.11-rc.5' },
      versions: {
        '0.98.11-rc.5': {
          version: '0.98.11-rc.5',
          dist: { tarball: 'https://registry.npmjs.org/@sentropic/h2a/-/h2a-0.98.11-rc.5.tgz' },
        },
      },
    }),
  });
  assert.equal(ok.ok, true);

  const missingVersion = await probePackument(spec, {
    fetchImpl: fakeFetch(200, { 'dist-tags': { latest: '0.98.10' }, versions: {} }),
  });
  assert.equal(missingVersion.ok, false);
  assert.match(missingVersion.detail, /missing versions/);

  const missingTarball = await probePackument(spec, {
    fetchImpl: fakeFetch(200, {
      'dist-tags': { next: '0.98.11-rc.5' },
      versions: { '0.98.11-rc.5': { version: '0.98.11-rc.5', dist: {} } },
    }),
  });
  assert.equal(missingTarball.ok, false);
  assert.match(missingTarball.detail, /dist\.tarball/);

  const staleTag = await probePackument(spec, {
    requireDistTag: 'next',
    fetchImpl: fakeFetch(200, {
      'dist-tags': { next: '0.98.11-rc.4' },
      versions: {
        '0.98.11-rc.5': {
          version: '0.98.11-rc.5',
          dist: { tarball: 'https://registry.npmjs.org/@sentropic/h2a/-/h2a-0.98.11-rc.5.tgz' },
        },
      },
    }),
  });
  assert.equal(staleTag.ok, false);
  assert.match(staleTag.detail, /dist-tags\.next/);

  const http503 = await probePackument(spec, { fetchImpl: fakeFetch(503, {}) });
  assert.equal(http503.ok, false);
  assert.match(http503.detail, /HTTP 503/);
});

test('waitForRegistryVisibility uses stepped backoff, waits for both npm view and packument, and handles 14-min lag within 1800s budget', async () => {
  let clockMs = 0;
  const sleeps = [];
  const logs = [];
  const errs = [];

  // Reproduces v0.98.11-rc.4 (~13m22s = 802s lag) and checks packument lag too:
  // npm view becomes visible at 780s, packument becomes visible at 840s (14m).
  const result = await waitForRegistryVisibility({
    packages: ['@sentropic/h2a@0.98.11-rc.4', '@sentropic/h2a-runtime@0.98.11-rc.4'],
    budgetSeconds: 1800,
    checkPackument: true,
    requireDistTag: 'next',
    backoffSeconds: DEFAULT_BACKOFF_SECONDS,
    now: () => clockMs,
    sleep: async (ms) => {
      sleeps.push(ms / 1000);
      clockMs += ms;
    },
    probeView: async (spec) => {
      const readyAt = spec.name === '@sentropic/h2a-runtime' ? 624_000 : 780_000;
      return clockMs >= readyAt ? { ok: true, detail: 'ok' } : { ok: false, detail: 'E404' };
    },
    probePackumentFn: async (spec) => {
      const readyAt = spec.name === '@sentropic/h2a-runtime' ? 624_000 : 840_000;
      return clockMs >= readyAt ? { ok: true, detail: 'ok' } : { ok: false, detail: 'packument lagging' };
    },
    log: (line) => logs.push(line),
    err: (line) => errs.push(line),
  });

  assert.equal(result.ok, true);
  assert.equal(result.warned, false);
  assert.deepEqual(result.pending, []);
  assert.deepEqual(sleeps.slice(0, 7), [10, 15, 20, 30, 45, 60, 60]);
  assert.ok(result.elapsedSeconds >= 840 && result.elapsedSeconds <= 900);
  assert.ok(logs.some((line) => line.includes('@sentropic/h2a@0.98.11-rc.4 is visible')));
  assert.ok(errs.some((line) => line.includes('packument lagging')));
});

test('waitForRegistryVisibility fails closed at deadline without overshooting budget, and supports warnOnly', async () => {
  for (const warnOnly of [false, true]) {
    let clockMs = 0;
    const sleeps = [];
    const errs = [];
    const result = await waitForRegistryVisibility({
      packages: ['@sentropic/h2a@0.98.11-rc.6'],
      budgetSeconds: 100,
      checkPackument: true,
      backoffSeconds: [10, 15, 20, 30, 45, 60],
      warnOnly,
      now: () => clockMs,
      sleep: async (ms) => {
        sleeps.push(ms / 1000);
        clockMs += ms;
      },
      probeView: async () => ({ ok: false, detail: 'E404' }),
      probePackumentFn: async () => ({ ok: false, detail: 'missing' }),
      log: () => {},
      err: (line) => errs.push(line),
    });

    assert.equal(result.ok, false);
    assert.equal(result.warned, warnOnly);
    assert.deepEqual(result.pending, ['@sentropic/h2a@0.98.11-rc.6']);
    // 10 + 15 + 20 + 30 + 25 (clamped to remaining budget) = 100s exact!
    assert.deepEqual(sleeps, [10, 15, 20, 30, 25]);
    assert.equal(clockMs, 100_000);
    assert.match(errs.at(-1), warnOnly ? /^::warning::/ : /^::error::/);
  }
});

test('wait-npm-visibility CLI polls local mock npm + packument server end-to-end without network', async (t) => {
  const lab = mkdtempSync(join(tmpdir(), 'wait-npm-vis-cli-'));
  t.after(() => rmSync(lab, { recursive: true, force: true }));
  writeFileSync(join(lab, 'package.json'), '{"type":"commonjs"}\n');
  const bin = join(lab, 'bin');
  mkdirSync(bin);
  const viewCounter = join(lab, 'view-count');
  writeFileSync(viewCounter, '0');
  writeFileSync(
    join(bin, 'npm'),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'view' && args[2] === 'version') {
  const count = Number(fs.readFileSync(${JSON.stringify(viewCounter)}, 'utf8')) + 1;
  fs.writeFileSync(${JSON.stringify(viewCounter)}, String(count));
  if (count < 2) { console.error('npm ERR! 404'); process.exit(1); }
  console.log(args[1].slice(args[1].lastIndexOf('@') + 1));
  process.exit(0);
}
process.exit(99);
`,
    { mode: 0o755 },
  );

  let packumentHits = 0;
  const server = http.createServer((req, res) => {
    packumentHits += 1;
    assert.equal(req.headers.accept, 'application/vnd.npm.install-v1+json');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (packumentHits < 2) {
      // First packument hit lags behind npm view.
      res.end(JSON.stringify({ 'dist-tags': { next: '0.98.11-rc.4' }, versions: {} }));
      return;
    }
    res.end(JSON.stringify({
      'dist-tags': { next: '0.98.11-rc.5' },
      versions: {
        '0.98.11-rc.5': {
          version: '0.98.11-rc.5',
          dist: { tarball: 'http://127.0.0.1/h2a-0.98.11-rc.5.tgz' },
        },
      },
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const registryUrl = `http://127.0.0.1:${server.address().port}`;

  const okRun = await execAsync(
    process.execPath,
    [
      SCRIPT_PATH,
      '--package', '@sentropic/h2a@0.98.11-rc.5',
      '--budget-seconds', '10',
      '--backoff-seconds', '0.05',
      '--check-packument',
      '--require-dist-tag', 'next',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NPM_REGISTRY_URL: registryUrl },
      timeout: 15_000,
    },
  );
  assert.equal(okRun.status, 0, okRun.stdout + okRun.stderr);
  assert.match(okRun.stdout, /@sentropic\/h2a@0\.98\.11-rc\.5 is visible on registry \(npm view \+ packument\)/);
  assert.ok(packumentHits >= 2, 'must wait until packument stops lagging behind npm view');

  // Fail-closed when version never appears.
  const failRun = await execAsync(
    process.execPath,
    [
      SCRIPT_PATH,
      '--package', '@sentropic/h2a@9.9.9-never',
      '--budget-seconds', '0.3',
      '--backoff-seconds', '0.05',
      '--check-packument',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NPM_REGISTRY_URL: registryUrl },
      timeout: 15_000,
    },
  );
  assert.equal(failRun.status, 1, failRun.stdout + failRun.stderr);
  assert.match(failRun.stderr, /::error::@sentropic\/h2a@9\.9\.9-never did not become visible/);
});
