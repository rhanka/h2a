import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { here } from './lab.mjs';

// Only S5 changes: prove the *same* JS exception without/with the return exec.
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'results/final/manifest.json')));
const sources = Object.fromEntries(fs.readdirSync(here).filter(n => n.endsWith('.mjs')).map(n =>
  [n, createHash('sha256').update(fs.readFileSync(path.join(here, n))).digest('hex')]));
const results = [];
for (const prior of manifest.results.filter(r => r.file === 'faults.test.mjs')) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pty-supplement-'));
  const env = { PATH: '/usr/bin:/bin', HOME: root, XDG_RUNTIME_DIR: root, TMPDIR: root,
    H2A_ROOT: root, XDG_CONFIG_HOME: root, XDG_STATE_HOME: root };
  let text = '';
  console.log(`RUN ${prior.command.join(' ')}`);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(prior.command[0], prior.command.slice(1), { cwd: path.resolve(here, '../..'), env });
    child.on('error', reject);
    child.stdout.on('data', b => { text += b; }); child.stderr.on('data', b => { text += b; });
    child.on('exit', (code, signal) => resolve(signal ? `signal:${signal}` : code));
  });
  const log = `results/final/${prior.name}-same-error-rollback.log`; fs.writeFileSync(path.join(here, log), text);
  const n = label => +(text.match(new RegExp(`^# ${label} (\\d+)$`, 'm'))?.[1] ?? -1);
  results.push({ command: prior.command, node: prior.runtime, code, tests: n('tests'), pass: n('pass'),
    fail: n('fail'), skipped: n('skipped'), log });
  console.log(`RESULT ${prior.name}-same-error-rollback: exit=${code} pass=${n('pass')} fail=${n('fail')} skipped=${n('skipped')}`);
  if (code !== 0 || n('pass') !== 6 || n('skipped') !== 0) process.exitCode = 1;
  fs.rmSync(root, { recursive: true, force: true });
}
fs.writeFileSync(path.join(here, 'results/final/supplement.json'), JSON.stringify({ sources, results }, null, 2));
