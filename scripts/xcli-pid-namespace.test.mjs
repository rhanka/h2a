import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { environment, repo } from './xcli-lab.mjs';
import { assertPrivatePidNamespace } from '../packages/h2a/test/helpers/private-pid-namespace.mjs';

test('namespace launchers keep PID isolation and run tests as the invoking user', () => {
  const root = mkdtempSync('/tmp/xcli-pid-user-test-');
  try {
    const capture = join(root, 'command.json');
    const preload = join(root, 'capture.mjs');
    writeFileSync(preload, `
      import cp from 'node:child_process';
      import { EventEmitter } from 'node:events';
      import { writeFileSync } from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      cp.spawn = (command, args) => {
        writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ command, args }));
        const child = new EventEmitter();
        setImmediate(() => child.emit('close', 0));
        return child;
      };
      syncBuiltinESMExports();
    `);
    for (const args of [
      ['--gate', 'packages/h2a-runtime/vitest.config.ts', 'packages/h2a-runtime/src/gateway-host/daemon.test.ts'],
      ['scripts/xcli-source-tests.mjs', 'packages/h2a/test/native-isolation.test.js'],
    ]) {
      const out = spawnSync(process.execPath, ['--import', preload, join(repo, 'scripts/xcli-in-pid-namespace.mjs'), ...args], {
        env: { ...environment(join(root, 'env')), XCLI_NODE_HEADERS: root }, encoding: 'utf8', timeout: 30000,
      });
      assert.equal(out.status, 0, out.stderr);
      const launch = JSON.parse(readFileSync(capture, 'utf8'));
      assert.equal(launch.command, '/usr/bin/sudo');
      const unshare = launch.args.indexOf('/usr/bin/unshare');
      assert.ok(unshare > 0);
      assert.deepEqual(launch.args.slice(unshare, unshare + 5),
        ['/usr/bin/unshare', '--mount', '--pid', '--fork', '--mount-proc']);
      assert.ok(launch.args[unshare + 5].endsWith('/init'));
      assert.deepEqual(launch.args.slice(unshare + 6, unshare + 12),
        ['/usr/bin/setpriv', '--reuid', String(process.getuid()), '--regid', String(process.getgid()), '--clear-groups']);
      assert.equal(launch.args[unshare + 12], process.execPath);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('historical producers refuse a missing or unchanged PID namespace', () => {
  const previous = process.env.XCLI_PARENT_PID_NS;
  try {
    delete process.env.XCLI_PARENT_PID_NS;
    assert.throws(assertPrivatePidNamespace, /private PID namespace launcher/);
    process.env.XCLI_PARENT_PID_NS = readlinkSync('/proc/self/ns/pid');
    assert.throws(assertPrivatePidNamespace, /different PID namespace/);
  } finally {
    if (previous === undefined) delete process.env.XCLI_PARENT_PID_NS;
    else process.env.XCLI_PARENT_PID_NS = previous;
  }
});

test('namespace init refuses to adopt or signal processes outside its private PID namespace', () => {
  const root = mkdtempSync('/tmp/xcli-pid-init-test-');
  try {
    const binary = join(root, 'init');
    assert.equal(spawnSync('/usr/bin/g++', ['-std=c++17', '-O2', join(repo, 'scripts/xcli-pid-init.cc'), '-o', binary]).status, 0);
    const refused = spawnSync(binary, ['/bin/true'], { encoding: 'utf8' });
    assert.equal(refused.status, 125);
    assert.match(refused.stderr, /must run as PID 1/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
