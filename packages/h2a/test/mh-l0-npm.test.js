import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readlinkSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { npmLab } from './helpers/mh-l0-npm-lab.js';
import { observeEntry, checkEntry } from '../src/runtime/handover/entry.js';

test('BX/U09 foundation: npm replaces a registered managed entry; all canonical-entry phases defer', async (t) => {
  const lab = await npmLab();
  try {
    assert.equal((await lab.npm('install', '-g', lab.tarballs['0.98.7'], '--offline')).code, 0);
    for (const [action, args, expectedVersion] of [
      ['upgrade', ['install', '-g', lab.tarballs['0.98.8'], '--offline'], '0.98.8'],
      ['downgrade', ['install', '-g', lab.tarballs['0.98.6'], '--offline'], '0.98.6'],
      ['reinstall', ['install', '-g', lab.tarballs['0.98.7'], '--offline'], '0.98.7'],
      ['update', ['update', '-g', '@sentropic/h2a', '--registry', lab.registry], '0.98.8'],
      ['force', ['install', '-g', lab.tarballs['0.98.8'], '--offline', '--force'], '0.98.8'],
      ['uninstall', ['uninstall', '-g', '@sentropic/h2a', '--offline'], null]
    ]) {
      assert.equal((await lab.npm('install', '-g', lab.tarballs['0.98.7'], '--offline', '--force')).code, 0);
      lab.adopt(); const expected = observeEntry(lab.link, lab.launcher);
      assert.equal(checkEntry(lab.link, expected, 'prepare').allowed, true);
      const result = await lab.npm(...args);
      const packagePath = join(lab.prefix, 'lib/node_modules/@sentropic/h2a/package.json');
      const installedVersion = existsSync(packagePath) ? JSON.parse(readFileSync(packagePath, 'utf8')).version : null;
      t.diagnostic(JSON.stringify({ action, code: result.code, stdout: result.stdout,
        stderr: result.stderr, installedVersion, observedLink: existsSync(lab.link) ? readlinkSync(lab.link) : null }));
      assert.equal(result.code, 0, action);
      assert.equal(installedVersion, expectedVersion, action);
      for (const phase of ['prepare', 'barrier', 'commit-stop']) {
        assert.deepEqual(checkEntry(lab.link, expected, phase),
          { allowed: false, phase, reason: 'external_install_detected' }, action);
      }
      assert.equal(readFileSync(lab.pin, 'utf8'), 'immutable-image-fixture');
      assert.equal(existsSync(lab.launcher), true);
    }
    // Now the package is absent: checkBin sees the external link and refuses.
    lab.adopt();
    const blocked = await lab.npm('install', '-g', lab.tarballs['0.98.8'], '--offline');
    t.diagnostic(JSON.stringify({ action: 'absent-package-EEXIST', ...blocked }));
    assert.equal(blocked.code, 1); assert.match(blocked.stderr, /EEXIST/);
    assert.equal(readlinkSync(lab.link), lab.launcher);
    assert.equal((await lab.npm('install', '-g', lab.tarballs['0.98.8'], '--offline', '--force')).code, 0);
    assert.notEqual(readlinkSync(lab.link), lab.launcher);
    assert.equal(readFileSync(lab.pin, 'utf8'), 'immutable-image-fixture');
  } finally { await lab.close(); }
});
