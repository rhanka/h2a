import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readlinkSync, readFileSync, existsSync } from 'node:fs';
import { npmLab } from './helpers/mh-l0-npm-lab.js';
import { observeEntry, checkEntry } from '../src/runtime/handover/entry.js';

test('BX/U09 foundation: npm replaces a registered managed entry; all canonical-entry phases defer', async (t) => {
  const lab = await npmLab();
  try {
    assert.equal((await lab.npm('install', '-g', lab.tarballs['0.98.7'], '--offline')).code, 0);
    for (const [action, args] of [
      ['upgrade', ['install', '-g', lab.tarballs['0.98.8'], '--offline']],
      ['downgrade', ['install', '-g', lab.tarballs['0.98.6'], '--offline']],
      ['reinstall', ['install', '-g', lab.tarballs['0.98.7'], '--offline']],
      ['update', ['update', '-g', '@sentropic/h2a', '--registry', lab.registry]],
      ['force', ['install', '-g', lab.tarballs['0.98.8'], '--offline', '--force']],
      ['uninstall', ['uninstall', '-g', '@sentropic/h2a', '--offline']]
    ]) {
      assert.equal((await lab.npm('install', '-g', lab.tarballs['0.98.7'], '--offline', '--force')).code, 0);
      lab.adopt(); const expected = observeEntry(lab.link, lab.launcher);
      assert.equal(checkEntry(lab.link, expected, 'prepare').allowed, true);
      const result = await lab.npm(...args);
      t.diagnostic(JSON.stringify({ action, code: result.code, stdout: result.stdout,
        stderr: result.stderr, observedLink: existsSync(lab.link) ? readlinkSync(lab.link) : null }));
      assert.equal(result.code, 0, action);
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
