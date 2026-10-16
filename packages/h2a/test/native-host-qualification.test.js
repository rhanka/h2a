import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { QualificationBudget, VIBE_QUALIFICATION_PLAN, PHASE2_RECIPE } from '../scripts/qualification-budget.mjs';
import { openQualificationRpc } from '../scripts/qualification-rpc.mjs';
import { nativeStats } from '../scripts/qualification-vibe.mjs';
test('corrected phase 2 fits two sessions and inclusive model-call accounting without enlarging the envelope', () => {
  const budget = new QualificationBudget();
  assert.equal(PHASE2_RECIPE.fork.attach, false); assert.equal(PHASE2_RECIPE.fork.beforeDelegation, true);
  assert.equal(VIBE_QUALIFICATION_PLAN.length, 5);
  assert.equal(VIBE_QUALIFICATION_PLAN.reduce((n, e) => n + e.maxIterations, 0), 15);
  assert.ok(VIBE_QUALIFICATION_PLAN.reduce((n, e) => n + e.maxPrice, 0) <= 0.75000001);
  budget.begin('phase2-origin'); budget.account('phase2-origin', { modelCalls: 1, price: 0.04 });
  budget.account('phase2-origin', { modelCalls: 1, price: 0.04 }); // delegated child
  budget.account('phase2-origin', { modelCalls: 1, price: 0.04 }); // parent after fork
  budget.begin('phase2-copy'); budget.account('phase2-copy', { modelCalls: PHASE2_RECIPE.copy.length, price: 0.17 });
  assert.throws(() => budget.begin('phase2-copy'), /retry/);
  assert.throws(() => budget.account('phase2-origin', { modelCalls: 1, price: 0 }), /budget/);
  assert.throws(() => budget.account('phase2-copy', { price: 0 }), /accounting/);
  let now = 0; const timed = new QualificationBudget(undefined, () => now); timed.begin('phase1-a'); now = 90_000;
  assert.throws(() => timed.check('phase1-a'), /watchdog/);
  assert.deepEqual(nativeStats({ steps: 3, sessionPromptTokens: 100, sessionCompletionTokens: 20, sessionCachedTokens: 50, inputPricePerMillion: 1, outputPricePerMillion: 2, cachedInputPricePerMillion: 0.5 }), { modelCalls: 3, price: 0.000115 });
});
test('native pilot is opt-in and reports the unchanged envelope without launching a host', () => {
  const r = spawnSync(process.execPath, [resolve('packages/h2a/scripts/qualify-host.mjs'), '--host', 'vibe'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); const p = JSON.parse(r.stdout);
  assert.equal(p.status, 'not executed'); assert.equal(p.budget.length, 5); assert.match(p.iteration, /delegated/);
});
test('RPC cleanup terminates only its owned fake host after success, error or abort', async t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'qualification-rpc-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stub = join(dir, 'host.mjs');
  fs.writeFileSync(stub, `import readline from 'node:readline';for await(const l of readline.createInterface({input:process.stdin})){const m=JSON.parse(l);if(m.id)console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,...(m.method==='bad'?{error:{code:-1}}:{result:{ok:true}})}));}`);
  for (const scenario of ['success', 'error', 'abort']) {
    const controller = new AbortController();
    const rpc = openQualificationRpc(process.execPath, [stub], { cwd: dir, env: process.env, signal: controller.signal });
    const pid = rpc.child.pid;
    try {
      if (scenario === 'success') assert.deepEqual(await rpc.request('probe'), { ok: true });
      if (scenario === 'error') await assert.rejects(rpc.request('bad'), /refused/);
      if (scenario === 'abort') { controller.abort(); await assert.rejects(rpc.request('probe'), /interrupted/); }
    } finally { await rpc.close(); }
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  }
});
