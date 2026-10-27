// Observe only self or PIDs returned by this fixture's own launchers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
export function recordCiOwnedProcess(pid, env = process.env) {
  const ledger = env.H2A_TEST_CI_OWNED_LEDGER;
  if (ledger === undefined) return;
  assert.equal(env.GITHUB_ACTIONS, 'true', 'CI owned ledger is GitHub-only');
  assert.equal(env.GITHUB_REPOSITORY, 'rhanka/h2a');
  assert.equal(env.GITHUB_WORKFLOW, 'ci');
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const directory = dirname(ledger), info = fs.lstatSync(directory), file = fs.lstatSync(ledger);
  assert.ok(/^bulk-ci-run-[A-Za-z0-9]+$/.test(basename(directory)) && fs.realpathSync(directory) === resolve(directory));
  assert.ok(info.isDirectory() && info.uid === process.getuid() && (info.mode & 0o777) === 0o700);
  assert.ok(file.isFile() && !file.isSymbolicLink() && file.uid === process.getuid() && (file.mode & 0o777) === 0o600);
  try {
    const text = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'), fields = text.slice(text.lastIndexOf(') ') + 2).split(' ');
    assert.ok(fields.length >= 20 && /^\d+$/.test(fields[19]));
    fs.appendFileSync(ledger, JSON.stringify({ pid, birth: fields[19] }) + '\n');
  } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
}
