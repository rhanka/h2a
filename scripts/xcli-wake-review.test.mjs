import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { environment, repo } from './xcli-lab.mjs';
import { pathToFileURL } from 'node:url';

for (const poll of ['single:18000', 'periodic:60000:17000']) test(`L3 review: ${poll} cannot credit one repetition`, () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-wake-review-'));
  try {
    const worker = join(root, 'worker.mjs'), output = join(root, 'result.json');
    fs.writeFileSync(worker, `import fs from 'node:fs';
const r=JSON.parse(fs.readFileSync(0,'utf8'));
console.log(JSON.stringify({sender:r.sender,receiver:r.receiver,scenario:'probe',woke:true,status:'simulated-OK',secretWipe:true,processRecovery:true,evidence:[],elapsedMs:1}));`);
    const out = spawnSync(process.execPath, [join(repo, 'scripts/qualify-cross-cli.mjs'), '--simulated', '--pair', 'claude:codex', '--poll', poll, '--timeout-ms', '90000', '--output', output], {
      env: { ...environment(join(root, 'parent')), TMPDIR: tmpdir(), XCLI_WORKER_STUB: worker }, encoding: 'utf8', timeout: 120000,
    });
    assert.equal(out.status, 2, out.stdout + out.stderr);
    const cell = JSON.parse(fs.readFileSync(output)).cells[0];
    assert.equal(cell.woke, false);
    assert.equal(cell.wakeFailure, 'wake-phase-separation-unproven');
    assert.ok(!cell.wakeClaim?.includes('single replication'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const poll of ['single:18000', 'periodic:60000:17000']) test(`L3 poller counterexample: ${poll} reads while the delayed wake is withheld`, () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-wake-review-'));
  try {
    let script = join(repo, 'scripts/qualify-cross-cli.mjs');
    if (process.env.XCLI_WAKE_REVIEW_BASELINE) {
      const old = spawnSync('git', ['show', `${process.env.XCLI_WAKE_REVIEW_BASELINE}:scripts/qualify-cross-cli.mjs`], { cwd: repo, encoding: 'utf8' });
      assert.equal(old.status, 0, old.stderr);
      script = join(root, 'baseline.mjs');
      fs.writeFileSync(script, old.stdout.replace(/'\.\/([^']+\.mjs)'/g, (_, name) => JSON.stringify(pathToFileURL(join(repo, 'scripts', name)).href)));
    }
    const output = join(root, 'result.json');
    const result = spawnSync(process.execPath, [script, '--simulated', '--pair', 'claude:codex', '--poll', poll,
      '--wake-release-offsets-ms', '15000', '--timeout-ms', '90000', '--mcp-call-cap', '1000', '--output', output], {
      env: { ...environment(join(root, 'env')), TMPDIR: tmpdir() }, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
    });
    const cell = JSON.parse(fs.readFileSync(output)).cells[0];
    assert.equal(result.status, 2, JSON.stringify({ status: cell.status, woke: cell.woke }));
    assert.equal(cell.received, true, 'the wake-ignoring poller read the delivered envelope');
    assert.equal(cell.woke, false);
    assert.equal(cell.wakeFailure, 'wake-polling-detected');
    assert.ok(cell.wakeWindows.baselineReads + cell.wakeWindows.withheldReads > 0,
      'the fixed polling tick must be witnessed before release, independently of startup speed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
