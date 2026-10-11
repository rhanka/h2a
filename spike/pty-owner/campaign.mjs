import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { here } from './lab.mjs';

const output = path.join(here, 'results/final'); fs.mkdirSync(output, { recursive: true });
const downloaded = JSON.parse(fs.readFileSync(path.join(here, 'results/downloaded-runtimes.json')));
const runtimes = { node22: '/usr/bin/node', node24: '/home/antoinefa/.nvm/versions/node/v24.18.0/bin/node',
  node20: '/home/antoinefa/.nvm/versions/node/v20.20.2/bin/node',
  node2215: downloaded['22.15.0'].path, node2214: downloaded['22.14.0'].path };
const sources = Object.fromEntries(fs.readdirSync(here).filter(n => n.endsWith('.mjs')).sort().map(n =>
  [n, createHash('sha256').update(fs.readFileSync(path.join(here, n))).digest('hex')]));
const jobs = [];
function add(runtime, file, env = {}, expected = 0, suffix = '') {
  jobs.push({ runtime, file, env, expected, name: `${file.replace('.test.mjs', '')}-${runtime}${suffix}` });
}
// Explicit files only; this is not repository-wide test discovery.
add('node22', 'reference.test.mjs');
add('node22', 'fd-hygiene.test.mjs', { SPIKE_HYGIENE: '0' }, 1, '-red');
add('node22', 'fd-hygiene.test.mjs');
add('node22', 'listener.test.mjs', { SPIKE_DIRECT_LISTENER: '1' }, 1, '-red');
add('node22', 'listener.test.mjs');
add('node22', 'split.test.mjs', { SPIKE_B_ACTIVATION: '0' }, 1, '-red');
add('node22', 'admission.test.mjs');
add('node22', 'binary-transition.test.mjs');
for (const runtime of ['node22', 'node2215', 'node24']) {
  for (const file of ['nominal.test.mjs', 'split.test.mjs', 'faults.test.mjs', 'flow.test.mjs', 'attach.test.mjs', 'cat.test.mjs']) add(runtime, file);
  add(runtime, 'exits.test.mjs', { SPIKE_REQUIRE_EXITS: '1' }, 1, '-contract-red');
  add(runtime, 'exits.test.mjs', {}, 0, '-negative-control');
  add(runtime, 'exact-guardian.test.mjs');
}
for (const runtime of ['node20', 'node2214']) {
  add(runtime, 'capability.test.mjs'); add(runtime, 'split.test.mjs');
}
const summary = { createdAt: new Date().toISOString(), platform: process.platform,
  arch: process.arch, kernel: os.release(), nodePty: '1.1.0', sources,
  downloaded, results: [] };
for (const job of jobs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pty-campaign-')); fs.chmodSync(root, 0o700);
  const env = { PATH: '/usr/bin:/bin', HOME: root, XDG_RUNTIME_DIR: root, TMPDIR: root,
    H2A_ROOT: root, XDG_CONFIG_HOME: root, XDG_STATE_HOME: root, ...job.env };
  const command = [runtimes[job.runtime], '--test', '--test-reporter=tap', path.join(here, job.file)];
  console.log(`RUN ${Object.entries(job.env).map(([k,v]) => `${k}=${v}`).join(' ')} ${command.join(' ')}`);
  const log = path.join(output, `${job.name}.log`); let text = '';
  const code = await new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { cwd: path.resolve(here, '../..'), env });
    child.on('error', reject);
    child.stdout.on('data', b => { text += b; }); child.stderr.on('data', b => { text += b; });
    child.on('exit', (code, signal) => resolve(signal ? `signal:${signal}` : code));
  });
  fs.writeFileSync(log, text);
  const count = label => +(text.match(new RegExp(`^# ${label} (\\d+)$`, 'm'))?.[1] ?? -1);
  const metrics = text.split('\n').filter(s => s.startsWith('# {')).flatMap(s => {
    try { return [JSON.parse(s.slice(2))]; } catch { return []; }
  });
  const result = { ...job, command, code, pass: count('pass'), fail: count('fail'),
    skipped: count('skipped'), tests: count('tests'), log: path.relative(here, log), metrics };
  summary.results.push(result);
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(summary, null, 2));
  console.log(`RESULT ${job.name}: exit=${code} pass=${result.pass} fail=${result.fail} skipped=${result.skipped} expectedExit=${job.expected}`);
  // A skip or absent TAP totals fails the campaign, even for a negative control.
  if (result.code !== job.expected || result.skipped !== 0 || result.tests < 1) process.exitCode = 1;
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(`CAMPAIGN ${summary.results.length} targeted invocations; status=${process.exitCode ?? 0}`);
