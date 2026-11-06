import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { sourceBuild } from './xcli-lab.mjs';

test('matching system Node headers avoid an unnecessary archive download', () => {
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import cp from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const read = fs.readFileSync;
    fs.readFileSync = (path, ...args) => path === '/usr/include/node/node_version.h'
      ? process.versions.node.split('.').map((value, i) => '#define NODE_' + ['MAJOR', 'MINOR', 'PATCH'][i] + '_VERSION ' + value).join('\\n')
      : read(path, ...args);
    let downloads = 0;
    cp.spawnSync = () => { downloads++; return { status: 1 }; };
    syncBuiltinESMExports();
    delete process.env.XCLI_NODE_HEADERS;
    const { resolveNodeHeaders } = await import(${JSON.stringify(new URL('./xcli-lab.mjs', import.meta.url).href)});
    console.log(JSON.stringify({ headers: resolveNodeHeaders(), downloads }));
  `], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout.trim()), { headers: '/usr/include/node', downloads: 0 });
});

test('source build loads its compiled PTY without copying foreign prebuilds', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-source-build-'));
  try {
    const built = sourceBuild(root);
    const pty = join(built.path, 'node_modules/node-pty');
    assert.equal(fs.existsSync(join(pty, 'prebuilds')), false,
      'foreign prebuilds exceed the live campaign disk budget');
    assert.equal(fs.existsSync(join(pty, 'build/Release/pty.node')), true);
    assert.equal(typeof createRequire(import.meta.url)(pty).spawn, 'function');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
