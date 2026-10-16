import assert from 'node:assert/strict';
import { mkdtempSync, readlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { repo } from './xcli-lab.mjs';
import { assertPrivatePidNamespace } from '../packages/h2a/test/helpers/private-pid-namespace.mjs';

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
