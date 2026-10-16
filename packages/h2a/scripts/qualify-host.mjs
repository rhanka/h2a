#!/usr/bin/env node
// Opt-in native recipe. No native process is launched by doctor or upgrade.
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runCli as runTrackCli } from '@sentropic/track';
import { QualificationBudget, VIBE_QUALIFICATION_PLAN, PHASE2_RECIPE } from './qualification-budget.mjs';
import { qualifyVibe } from './qualification-vibe.mjs';
import { qualifyVibeProbe } from './qualification-probe.mjs';
import { qualifyPollHost } from './qualification-poll-hosts.mjs';
import { clearQualificationRecords, ownedRecordSnapshot } from './qualification-cleanup.mjs';
import { atomicNativeWrite, digest, jsonBytes, snapshot } from '../dist/hosts/native-files.js';
import { planVibeEquipment } from '../dist/hosts/vibe-equipment.js';
import { captureRuntimeGeneratedFiles, verifyRuntimeRecord } from '../dist/hosts/native-runtime-record.js';
import { parseNativeToml } from '../dist/hosts/native-toml.js';
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
const env = { ...process.env, HOME: flags.home, VIBE_HOME: join(flags.home, '.vibe'), XDG_RUNTIME_DIR: join(lane, 'runtime'), XDG_CONFIG_HOME: join(flags.home, '.config'), XDG_STATE_HOME: join(flags.home, '.local/state') };
const busRoot = flags.root ? resolve(flags.root) : join(lane, 'bus');
const instance = `h2a-qualification-${randomUUID()}`;
const entrypoint = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const evidence = [], cleanup = { sessions: [], deleted: [], incomplete: false, instances: [] };
const budget = new QualificationBudget();
let previousAttempt;
if (phase === 2) {
  if (!flags.previous) throw new Error('phase 2 requires --previous <phase-1 attempt.json>');
  const previous = JSON.parse(fs.readFileSync(flags.previous, 'utf8'));
  if (previous.host !== flags.host || previous.busRoot !== busRoot || previous.profileHome !== flags.home || previous.phase !== 1) throw new Error('phase-1 profile/bus mismatch');
  budget.restorePhase1(previous.accounting, previous.elapsedMilliseconds);
  previousAttempt = previous;
}
const controller = new AbortController(), interrupt = () => controller.abort();
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
const watchdog = setTimeout(interrupt, budget.remaining());
let receiptPublication;
const evidencePath = join(output, 'qualification-' + instance + '.json');
const report = { ...plan, status: 'partial', fixture: flags.fixture === true, phase, instance, busRoot, profileHome: flags.home, cleanup, evidence, results: {} };
try {
  if (flags.host !== 'vibe') {
    report.results = qualifyPollHost({ host: flags.host, env, cwd: join(lane, 'workspace-a'), evidence });
    if (flags.host === 'agy') {
      const root = join(flags.home, '.gemini'), state = join(root, '.h2a-install-agy');
      const shared = snapshot(join(root, '.h2a-install-agy/shared-owner.json'));
      if (shared) {
        const path = join(state, 'import-observation.json');
        atomicNativeWrite(path, jsonBytes({ schema: 1, root, status: report.results.import, sharedManifestHash: digest(shared.bytes) }), { state, expected: snapshot(path) });
      }
    }
    report.limit = 'The native Muse/agy model accounting and session trace contracts are unverified. No unbounded model invocation is launched; M-B remains required.';
  } else {
    // Track must resolve a real, private store in each disposable workspace;
    // an empty-view hint from an unadopted directory is not context evidence.
    for (const name of ['workspace-a', 'workspace-b']) {
      const workspace = join(lane, name);
      const code = await runTrackCli(['--track-dir', join(workspace, '.track'), 'init'], { cwd: workspace, out: () => {}, err: () => {} });
      if (code !== 0) throw new Error('private qualification Track initialization failed');
    }
    if (phase === 2) {
      const root = env.VIBE_HOME || join(flags.home, '.vibe');
      const manifest = JSON.parse(fs.readFileSync(join(root, '.h2a-install/manifest.json'), 'utf8'));
      // Never exercise a lifecycle that can mutate somebody else's instance.
      if (!manifest.lifecycle?.enabled || manifest.lifecycle.root !== busRoot || !flags['owned-instance'] || manifest.lifecycle.instance !== flags['owned-instance'])
        throw new Error('Phase 2 requires a dedicated lifecycle instance and exact private bus root explicitly declared with --owned-instance.');
      if (ownedRecordSnapshot(busRoot, flags['owned-instance']).own) throw new Error('qualification instance already has a record');
      cleanup.instances.push(flags['owned-instance']);
    }
    const profileRoot = env.VIBE_HOME || join(flags.home, '.vibe');
    const manifest = JSON.parse(fs.readFileSync(join(profileRoot, '.h2a-install/manifest.json'), 'utf8'));
    const requiredResources = Object.entries(manifest.files).filter(([path, entry]) => path.includes('/assets/') && entry.selected).map(([path]) => ({ path: resolve(profileRoot, path), bytes: fs.readFileSync(resolve(profileRoot, path), 'utf8') }));
    report.results = await qualifyVibe({ command: flags['app-server'] ?? 'vibe-app-server', args: [], env,
      workspaces: [join(lane, 'workspace-a'), join(lane, 'workspace-b')], busRoot, phase, budget, signal: controller.signal, evidence, cleanup, components, requiredResources,
      clearRecords: () => clearQualificationRecords({ root: busRoot, instances: cleanup.instances, entrypoint, env }),
      recordSnapshot: () => ownedRecordSnapshot(busRoot, flags['owned-instance']) });
    if (phase === 1) report.probe = await qualifyVibeProbe({ command: flags.vibe ?? 'vibe', appServer: flags['app-server'] ?? 'vibe-app-server', cwd: join(lane, 'workspace-a'), env,
      tools: report.results.probeTools ?? [], requiredResources, busRoot, components, budget, signal: controller.signal, evidence, cleanup, directory: lane });
    if (flags.record && flags.metadata && !cleanup.incomplete) {
      const metadata = fs.readFileSync(flags.metadata, 'utf8'), version = /^Version: (.+)$/m.exec(metadata)?.[1];
      if (!/Name: mistral[-_]vibe/i.test(metadata) || version !== report.results.runtimeVersion) throw new Error('mistral-vibe wheel metadata does not match the native runtime');
      const state = join(profileRoot, '.h2a-install'), config = parseNativeToml(fs.readFileSync(join(profileRoot, 'config.toml'), 'utf8'));
      const installed = planVibeEquipment({ root: profileRoot, state, version: manifest.version, config, mcpAvailable: (config.mcp_servers ?? []).length > 0, repair: false });
      const previous = snapshot(join(state, 'qualification.json'));
      const receipt = previous ? JSON.parse(previous.bytes.toString()) : { schema: 1, host: 'vibe', root: profileRoot, components: {} };
      if (previous && receipt.fixture !== report.fixture) receipt.components = {};
      receipt.fixture = report.fixture; receipt.recordedAt = new Date().toISOString();
      const generatedFiles = captureRuntimeGeneratedFiles(resolve(flags.record));
      if (!verifyRuntimeRecord(resolve(flags.record), generatedFiles)) throw new Error('native runtime RECORD verification failed');
      receipt.runtime = { generatedFiles, distribution: 'mistral-vibe', version, recordPath: resolve(flags.record), metadataPath: resolve(flags.metadata), recordSha256: digest(fs.readFileSync(flags.record)) };
      const dependencies = { MCP: ['MCP', 'profile', 'node', 'entrypoint'], context: ['MCP', 'profile', 'node', 'entrypoint'],
        skills: ['skills', 'filters', 'profile'], guard: ['guard', 'node', 'entrypoint', 'masking', 'guardBlock', 'MCP'], lifecycle: ['lifecycle', 'node', 'entrypoint', 'lifecycleSelection', 'lifecycleBlock'] };
      const exercised = phase === 1 ? ['skills', 'MCP', 'context'] : ['guard', 'lifecycle'];
      for (const component of components.filter(c => exercised.includes(c))) receipt.components[component] = { status: report.results[component] === 'observed' && (phase !== 1 || report.probe?.status === 'observed') ? 'qualified' : 'partial', dependencies: Object.fromEntries(dependencies[component].map(key => [key, installed.observed[key]])),
        evidence: [evidencePath], evidenceHashes: {}, scope: phase === 2 ? 'explicit lifecycle; parent non-forked only' : 'two isolated native sessions; observed direct MCP is non migrated' };
      receiptPublication = { state, previous, receipt, exercised };
    }
    report.limit = 'Native observations are partial until resource resolution, CLI probe, context and per-component oracles all agree; no fixture qualifies the target host.';
  }
} catch (error) { report.error = String(error.message).replace(/[\r\n]/g, ' ').slice(0, 500); }
finally {
  clearTimeout(watchdog); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  report.accounting = [...budget.executions.values()];
  report.elapsedMilliseconds = Date.now() - budget.start;
  const currentPhase = phase === 1 ? ['skills', 'MCP', 'context'] : ['guard', 'lifecycle'];
  report.componentStatus = Object.fromEntries(components.map(component => {
    const current = currentPhase.includes(component);
    const attempt = current ? report : previousAttempt;
    const observed = attempt?.results?.[component] === 'observed' &&
      (!['skills', 'MCP', 'context'].includes(component) || attempt?.probe?.status === 'observed') &&
      !attempt?.error && !attempt?.cleanup?.incomplete && attempt?.fixture === report.fixture;
    return [component, observed ? 'qualified' : 'partial'];
  }));
  if (!report.error && !cleanup.incomplete && Object.values(report.componentStatus).every(status => status === 'qualified'))
    report.status = report.fixture ? 'fixture-only' : 'qualified';
  // Persist only bounded metadata/hashes, never prompts, model output, stderr or credentials.
  const path = evidencePath;
  if (!cleanup.incomplete) fs.rmSync(lane, { recursive: true, force: true });
  else { report.cleanupResume = { sessions: cleanup.sessions.filter(id => !cleanup.deleted.includes(id)), lane, busRoot, instances: cleanup.instances }; }
  const bytes = JSON.stringify(report, null, 2) + '\n';
  fs.writeFileSync(path, bytes, { mode: 0o600, flag: 'wx' });
  if (receiptPublication && !report.error && !cleanup.incomplete) {
    const { state, previous, receipt, exercised } = receiptPublication;
    for (const c of components.filter(c => exercised.includes(c))) receipt.components[c].evidenceHashes[path] = digest(bytes);
    atomicNativeWrite(join(state, 'qualification.json'), jsonBytes(receipt), { state, expected: previous });
  }
}
process.stdout.write(JSON.stringify({ status: report.status, evidence: evidencePath, cleanupComplete: !cleanup.incomplete }) + '\n');
process.exitCode = report.status === 'qualified' ? 0 : 2;
