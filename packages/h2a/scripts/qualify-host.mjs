#!/usr/bin/env node
// Opt-in native recipe. No native process is launched by doctor or upgrade.
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { QualificationBudget, VIBE_QUALIFICATION_PLAN, PHASE2_RECIPE } from './qualification-budget.mjs';
import { qualifyVibe } from './qualification-vibe.mjs';
import { clearQualificationRecords, ownedRecordSnapshot } from './qualification-cleanup.mjs';
import { snapshot } from '../dist/hosts/native-files.js';
const flags = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i]; if (!key.startsWith('--')) throw new Error('named flags required');
  flags[key.slice(2)] = process.argv[i + 1]?.startsWith('--') || i + 1 === process.argv.length ? true : process.argv[++i];
}
if (!['vibe', 'muse', 'agy'].includes(flags.host)) throw new Error('--host vibe|muse|agy required');
const components = String(flags.components ?? 'skills,MCP,context,guard,lifecycle').split(',');
if (components.some(c => !['skills', 'MCP', 'context', 'guard', 'lifecycle'].includes(c))) throw new Error('unknown component');
const plan = { host: flags.host, components, status: 'not executed', execution: 'one app-server session (fork included), or the CLI probe',
  iteration: 'one model call, including every delegated child call', budget: VIBE_QUALIFICATION_PLAN, phase2: PHASE2_RECIPE,
  migration: 'bootstrap B and R5/R7 receipts remain external', notice: 'After every update run h2a doctor --repair; immediate visible relay is not guaranteed.' };
if (!flags.execute) { process.stdout.write(JSON.stringify(plan, null, 2) + '\n'); process.exit(0); }
if (!flags.home || !flags.output || !isAbsolute(flags.home) || !isAbsolute(flags.output)) throw new Error('--execute requires explicit absolute --home and --output paths');
const phase = Number(flags.phase ?? 1); if (![1, 2].includes(phase)) throw new Error('--phase 1|2 required');
const lane = fs.mkdtempSync(join(tmpdir(), 'h2a-qualification-'));
const output = resolve(flags.output); fs.mkdirSync(output, { recursive: true, mode: 0o700 });
for (const name of ['workspace-a', 'workspace-b', 'runtime', 'config', 'state']) fs.mkdirSync(join(lane, name), { mode: 0o700 });
const env = { ...process.env, HOME: flags.home, XDG_RUNTIME_DIR: join(lane, 'runtime'), XDG_CONFIG_HOME: join(lane, 'config'), XDG_STATE_HOME: join(lane, 'state') };
const busRoot = flags.root ? resolve(flags.root) : join(lane, 'bus');
const instance = `h2a-qualification-${randomUUID()}`;
const entrypoint = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const evidence = [], cleanup = { sessions: [], deleted: [], incomplete: false, instances: [] };
const budget = new QualificationBudget();
const controller = new AbortController(), interrupt = () => controller.abort();
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
const watchdog = setTimeout(interrupt, 450_000);
const report = { ...plan, status: 'partial', fixture: flags.fixture === true, phase, instance, busRoot, cleanup, evidence, results: {} };
try {
  if (flags.host !== 'vibe') {
    report.limit = 'The native Muse/agy model accounting and session trace contracts are unverified. No unbounded model invocation is launched; M-B remains required.';
  } else {
    if (phase === 2) {
      const root = env.VIBE_HOME || join(flags.home, '.vibe');
      const manifest = JSON.parse(fs.readFileSync(join(root, '.h2a-install/manifest.json'), 'utf8'));
      // Never exercise a lifecycle that can mutate somebody else's instance.
      if (!manifest.lifecycle?.enabled || manifest.lifecycle.root !== busRoot || !flags['owned-instance'] || manifest.lifecycle.instance !== flags['owned-instance'])
        throw new Error('Phase 2 requires a dedicated lifecycle instance and exact private bus root explicitly declared with --owned-instance.');
      if (ownedRecordSnapshot(busRoot, flags['owned-instance']).own) throw new Error('qualification instance already has a record');
      cleanup.instances.push(flags['owned-instance']);
    }
    report.results = await qualifyVibe({ command: flags['app-server'] ?? 'vibe-app-server', args: [], env,
      workspaces: [join(lane, 'workspace-a'), join(lane, 'workspace-b')], phase, budget, signal: controller.signal, evidence, cleanup, components,
      clearRecords: () => clearQualificationRecords({ root: busRoot, instances: cleanup.instances, entrypoint, env }),
      recordSnapshot: () => ownedRecordSnapshot(busRoot, flags['owned-instance']) });
    report.limit = 'Native observations are partial until resource resolution, CLI probe, context and per-component oracles all agree; no fixture qualifies the target host.';
  }
} catch (error) { report.error = String(error.message).replace(/[\r\n]/g, ' ').slice(0, 500); }
finally {
  clearTimeout(watchdog); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  report.accounting = [...budget.executions.values()];
  // Persist only bounded metadata/hashes, never prompts, model output, stderr or credentials.
  const path = join(output, 'qualification-attempt.json'); fs.writeFileSync(path, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  if (!cleanup.incomplete) fs.rmSync(lane, { recursive: true, force: true });
  else { report.cleanupResume = { sessions: cleanup.sessions.filter(id => !cleanup.deleted.includes(id)), lane, busRoot, instances: cleanup.instances }; fs.writeFileSync(path, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); }
}
process.stdout.write(JSON.stringify({ status: report.status, evidence: join(output, 'qualification-attempt.json'), cleanupComplete: !cleanup.incomplete }) + '\n');
process.exitCode = 2;
