import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function provision(fault, failures) {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-headers-test-'));
  try {
    const headers = join(root, `node-${process.version}`, 'include/node');
    fs.mkdirSync(headers, { recursive: true });
    fs.writeFileSync(join(headers, 'node_api.h'), 'fixture headers');
    const archive = join(root, 'fixture.tar.gz');
    assert.equal(spawnSync('/usr/bin/tar', ['-czf', archive, '-C', root, `node-${process.version}`]).status, 0);
    const preload = join(root, 'fetch.mjs'), calls = join(root, 'calls');
    fs.writeFileSync(preload, `import fs from 'node:fs';
let calls = 0;
globalThis.fetch = async url => {
  if (url !== 'https://nodejs.org/download/release/${process.version}/node-${process.version}-headers.tar.gz') throw Error('wrong Node version');
  fs.writeFileSync(${JSON.stringify(calls)}, String(++calls));
  if (calls <= ${failures} && ${JSON.stringify(fault)} === 'connect') throw TypeError('fetch failed');
  return { status: calls <= ${failures} && ${JSON.stringify(fault)} === 'http' ? 503 : 200,
    arrayBuffer: async () => {
      if (calls <= ${failures} && ${JSON.stringify(fault)} === 'body') throw TypeError('terminated', {cause: {code:'UND_ERR_SOCKET'}});
      return fs.readFileSync(${JSON.stringify(archive)});
    } };
};
`);
    const result = spawnSync(process.execPath, ['--import', preload, join(import.meta.dirname, 'xcli-node-headers.mjs')], {
      env: { ...process.env, TMPDIR: root, GITHUB_ENV: join(root, 'github-env') }, encoding: 'utf8',
    });
    const published = fs.existsSync(join(root, 'github-env')) ? fs.readFileSync(join(root, 'github-env'), 'utf8') : '';
    return { ...result, calls: Number(fs.readFileSync(calls, 'utf8')), published,
      ready: published ? fs.readFileSync(join(published.trim().split('=')[1], 'node_api.h'), 'utf8') : null,
      leftovers: fs.readdirSync(root).filter(name => name.startsWith('xcli-headers-')) };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

for (const fault of ['body', 'connect', 'http']) {
  test(`Node headers recover from a transient ${fault} failure before publication`, () => {
    const result = provision(fault, 1);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.calls, 2);
    assert.equal(result.ready, 'fixture headers');
    assert.equal(result.published.trim().split('\n').length, 1);
  });
}

test('Node headers refuse persistent truncation after three attempts without publishing or leaving scratch', () => {
  const result = provision('body', 10);
  assert.notEqual(result.status, 0);
  assert.equal(result.calls, 3);
  assert.equal(result.published, '');
  assert.deepEqual(result.leftovers, []);
});
