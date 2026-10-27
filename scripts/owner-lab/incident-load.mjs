// Targeted qualification of concurrent resume storms. Pin this parent with
// taskset so all test processes and their children share the same CPUs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

assert.ok(process.env.TMPDIR && resolve(process.env.TMPDIR) !== '/tmp', 'Supply a disposable TMPDIR');
const rounds = Number(process.argv[2] ?? 5);
const instances = Number(process.argv[3] ?? 4);
for (const value of [rounds, instances]) assert.ok(Number.isSafeInteger(value) && value > 0);
const repo = resolve(import.meta.dirname, '../..');
const logs = mkdtempSync(join(tmpdir(), 'incident-load-'));
const loadProfile = instances === 8 && availableParallelism() === 8 ? '8x20/8cpu' : '';
let failed = false;
for (let round = 1; round <= rounds; round++) {
  const results = await Promise.all(Array.from({ length: instances }, (_, index) => new Promise(resolve => {
    const child = spawn(process.execPath, ['--test', 'packages/h2a/test/incident-20-resume.test.js'],
      { cwd: repo, env: { ...process.env, H2A_LAB_INCIDENT_LOAD_PROFILE: loadProfile }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { output += bytes; });
    child.on('error', error => { output += String(error); });
    child.on('close', code => {
      const file = join(logs, `${round}-${index + 1}.log`);
      writeFileSync(file, output);
      const pass = code === 0 && /# pass 1\b/.test(output) && /# skipped 0\b/.test(output);
      resolve({ round, instance: index + 1, code, pass, file,
        diagnostics: output.split('\n').filter(line => /^# (\{|pass |fail |skipped )|^  error:/.test(line)) });
    });
  })));
  for (const result of results) console.log(JSON.stringify(result));
  failed ||= results.some(result => !result.pass);
}
process.exitCode = failed ? 1 : 0;
