import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { environment, repo } from './xcli-lab.mjs';

for (const poll of ['single:18000', 'periodic:60000:17000']) test(`L3 review: ${poll} cannot credit one repetition`, () => {
  const root = fs.mkdtempSync('/tmp/xcli-wake-review-');
  try {
    const worker = join(root, 'worker.mjs'), output = join(root, 'result.json');
    fs.writeFileSync(worker, `import fs from 'node:fs';
const r=JSON.parse(fs.readFileSync(0,'utf8'));
console.log(JSON.stringify({sender:r.sender,receiver:r.receiver,scenario:'probe',woke:true,status:'simulated-OK',secretWipe:true,processRecovery:true,evidence:[],elapsedMs:1}));`);
    const out = spawnSync(process.execPath, [join(repo, 'scripts/qualify-cross-cli.mjs'), '--simulated', '--pair', 'claude:codex', '--poll', poll, '--timeout-ms', '90000', '--output', output], {
      env: { ...environment(join(root, 'parent')), XCLI_WORKER_STUB: worker }, encoding: 'utf8', timeout: 120000,
    });
    assert.equal(out.status, 2, out.stdout + out.stderr);
    const cell = JSON.parse(fs.readFileSync(output)).cells[0];
    assert.equal(cell.woke, false);
    assert.equal(cell.wakeFailure, 'wake-phase-separation-unproven');
    assert.ok(!cell.wakeClaim?.includes('single replication'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
