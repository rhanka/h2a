import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
test('pilot CLI reports success only for all requested observed components and completed cleanup', t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'pilot-report-')), scripts = join(dir, 'scripts'), home = join(dir, 'home');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(resolve('packages/h2a/scripts'), scripts, { recursive: true }); fs.symlinkSync(resolve('packages/h2a/dist'), join(dir, 'dist'));
  fs.symlinkSync(resolve('node_modules'), join(dir, 'node_modules'));
  const state = join(home, '.vibe/.h2a-install'); fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(join(state, 'manifest.json'), JSON.stringify({ schema: 1, version: '0.98.6', files: {} }));
  // Only adapters are replaced: this tests the production executable/report/exit/cleanup orchestration.
  fs.writeFileSync(join(scripts, 'qualification-vibe.mjs'), `import fs from 'node:fs';import {join} from 'node:path';export async function qualifyVibe({cleanup,workspaces}) { if(!workspaces.every(w=>fs.existsSync(join(w,'.track'))))throw Error('private Track workspaces were not prepared'); if(process.env.PILOT_CASE==='cleanup')cleanup.incomplete=true; return {skills:process.env.PILOT_CASE==='partial'?'partial':'observed',MCP:'partial',context:'partial'}; }`);
  fs.writeFileSync(join(scripts, 'qualification-probe.mjs'), `export async function qualifyVibeProbe(){return {status:process.env.PILOT_CASE==='probe'?'partial':'observed'};}`);
  for (const scenario of ['success', 'partial', 'probe', 'cleanup', 'wrong-phase', 'fixture']) {
    const output = join(dir, scenario);
    const args = [join(scripts, 'qualify-host.mjs'), '--host', 'vibe', '--execute', '--home', home, '--output', output, '--components', scenario === 'wrong-phase' ? 'guard' : 'skills'];
    if (scenario === 'fixture') args.push('--fixture');
    const result = spawnSync(process.execPath, args, { env: { ...process.env, PILOT_CASE: scenario }, encoding: 'utf8' });
    assert.equal(result.status, scenario === 'success' ? 0 : 2, result.stderr + result.stdout);
    const summary = JSON.parse(result.stdout), report = JSON.parse(fs.readFileSync(summary.evidence));
    assert.equal(report.status, scenario === 'success' ? 'qualified' : scenario === 'fixture' ? 'fixture-only' : 'partial');
    if (scenario === 'cleanup') fs.rmSync(report.cleanupResume.lane, { recursive: true, force: true });
  }
});
