// Lot L11: lane-shape tests. The campaign workflow refuses to run without
// an explicit seat set and refuses fork refs; the PR lane carries the
// receipt-check job; the release lane gates on the exact-SHA receipt.
// Red while any lane misses its gate.
import { homedir, tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';
import { spawnSync } from 'node:child_process';
import { environment } from './xcli-lab.mjs';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const campaign = fs.readFileSync(join(repo, '.github/workflows/cross-cli-campaign.yml'), 'utf8');
const prLane = fs.readFileSync(join(repo, '.github/workflows/cross-cli-messaging.yml'), 'utf8');
const release = fs.readFileSync(join(repo, '.github/workflows/release.yml'), 'utf8');

test('L4: malformed seat bundles never expose their bytes in job logs', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-materialize-'));
  try {
    const script = parse(campaign).jobs.campaign.steps.find(s => s.name === 'Materialise seat HOMEs from environment bundles').run;
    const canary = 'CANARY42';
    const out = spawnSync('/bin/bash', ['-c', script], { cwd: repo,
      env: { ...environment(join(root, 'env')), RUNNER_TEMP: root, SEAT_SET: 'codex', XCLI_SEAT_BUNDLE_CODEX: canary },
      encoding: 'utf8', timeout: 10000 });
    assert.notEqual(out.status, 0);
    assert.ok(!`${out.stdout}${out.stderr}`.includes(canary), 'a parse failure must be a closed diagnostic');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('L4: campaign materialization refuses an aliased or reused seat root before writing credentials', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-materialize-'));
  try {
    const script = parse(campaign).jobs.campaign.steps.find(s => s.name === 'Materialise seat HOMEs from environment bundles').run;
    const outside = join(root, 'outside'); fs.mkdirSync(outside); fs.symlinkSync(outside, join(root, 'seats'));
    const out = spawnSync('/bin/bash', ['-c', script], { cwd: repo,
      env: { ...environment(join(root, 'env')), RUNNER_TEMP: root, SEAT_SET: 'codex',
        XCLI_SEAT_BUNDLE_CODEX: JSON.stringify({ family: 'codex', files: { '.codex/auth.json': Buffer.from('{}').toString('base64') } }) },
      encoding: 'utf8', timeout: 10000 });
    assert.notEqual(out.status, 0);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('L11 review: candidate validation precedes checkout and every secret is step-scoped afterwards', async () => {
  const job = parse(campaign).jobs.campaign;
  assert.equal(job.env, undefined, 'no job-level bundles before candidate validation');
  const steps = job.steps, validation = steps.findIndex(step => step.id === 'validate');
  assert.ok(validation >= 0, 'a pre-checkout authenticated candidate validator exists');
  assert.ok(validation < steps.findIndex(step => step.uses?.startsWith('actions/checkout')));
  const script = steps[validation].with.script;
  const execute = new (Object.getPrototypeOf(async function(){}).constructor)('github', 'context', 'core', 'process', script);
  const sha = 'a'.repeat(40), context = { repo: { owner: 'rhanka', repo: 'h2a' }, sha, ref: 'refs/heads/feat/live-cross-cli-messaging', eventName: 'workflow_dispatch' };
  let protectedRef = true;
  const github = { rest: { repos: { getBranch: async () => ({ data: { protected: protectedRef, commit: { sha } } }) } } };
  const core = { setOutput() {}, setFailed(message) { throw new Error(message); } };
  await execute(github, context, core, { env: { CANDIDATE_SHA: sha, SEAT_SET: 'claude,codex' } });
  await assert.rejects(execute(github, context, core, { env: { CANDIDATE_SHA: 'b'.repeat(40), SEAT_SET: 'claude' } }), /candidate/);
  protectedRef = false;
  await assert.rejects(execute(github, context, core, { env: { CANDIDATE_SHA: sha, SEAT_SET: 'claude' } }), /protected/);
  for (const [i, step] of steps.entries()) if (Object.keys(step.env ?? {}).some(key => key.startsWith('XCLI_SEAT_BUNDLE_'))) assert.ok(i > validation);
  const measurement = steps.findIndex(step => step.name?.startsWith('Measure all provisioned'));
  assert.ok(measurement > validation && measurement < steps.findIndex(step => Object.keys(step.env ?? {}).some(key => key.startsWith('XCLI_SEAT_BUNDLE_'))),
    'missing vendor binaries refuse before any seat material is exposed');
});

test('L4: every workflow upload is preceded by a required publication scan', () => {
  for (const lane of [campaign, prLane]) for (const job of Object.values(parse(lane).jobs)) {
    for (const [index, step] of (job.steps ?? []).entries()) {
      if (!step.uses?.startsWith('actions/upload-artifact')) continue;
      assert.ok(job.steps.slice(0, index).some(s => s.run?.includes('xcli-evidence-scan.mjs')), 'scan before every upload');
      assert.ok(!step.if?.trim().endsWith('always()'), 'a failing scan must prevent publication');
    }
  }
});

test('L11 review: PR and release fetch authenticated artifacts for the exact head', () => {
  for (const lane of [prLane, release]) {
    assert.ok(lane.includes('--fetch-trusted'));
    assert.ok(!lane.includes('--receipt docs/cross-cli-receipt.json'));
    assert.ok(lane.includes('actions: read'));
  }
  assert.ok(prLane.includes('github.event.pull_request.head.sha'));
});

test('campaign review: funded windows, guarded root, Vibe measurement and explicit provisioned runner', () => {
  assert.ok(!campaign.includes('${RUNNER_TEMP}/h2a-qual-'), 'no RUNNER_TEMP campaign root: the guard refuses it');
  assert.ok(campaign.includes('.cache-tmp/h2a-test/run-'), 'the campaign root is minted under the admitted owner-cache base');
  assert.match(campaign, /--timeout-ms (?:[6-9]\d{4}|1[0-7]\d{4}|180000)/);
  assert.ok(campaign.includes('Object.keys(ORACLE_SOURCES)'));
  assert.ok(campaign.includes('XCLI_CAMPAIGN_RUNNER'), 'owner selects an ephemeral image with the required binaries');
});

test('L11 review: the allocated campaign root passes the admission guard and cleanup wipes it', () => {
  // Executes the workflow's own allocation and cleanup steps: the allocated
  // root must import the native-isolation guard (exit 0), and cleanup must
  // remove seats, manifest and the exact campaign root.
  const job = parse(campaign).jobs.campaign;
  const alloc = job.steps.find(s => s.name === 'Allocate a guarded campaign root').run;
  const wipe = job.steps.find(s => s.name === 'Wipe seat HOMEs unconditionally').run;
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-lane-root-'));
  try {
    const runnerTemp = join(dir, 'runner-temp'); fs.mkdirSync(runnerTemp);
    const githubEnv = join(dir, 'github-env'); fs.writeFileSync(githubEnv, '');
    const home = homedir();
    const allocOut = spawnSync('/bin/bash', ['-c', alloc], { cwd: repo,
      env: { PATH: '/usr/bin:/bin', HOME: home, RUNNER_TEMP: runnerTemp, GITHUB_ENV: githubEnv },
      encoding: 'utf8', timeout: 30000 });
    assert.equal(allocOut.status, 0, allocOut.stderr);
    const campaignRoot = (fs.readFileSync(githubEnv, 'utf8').split('\n')
      .find(l => l.startsWith('XCLI_CAMPAIGN_ROOT=')) ?? '').slice('XCLI_CAMPAIGN_ROOT='.length).trim();
    assert.ok(campaignRoot, 'the allocation step exports XCLI_CAMPAIGN_ROOT');
    const helper = pathToFileURL(join(repo, 'packages/h2a/test/helpers/native-isolation.js')).href;
    const admitted = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(helper)});`], {
      env: { ...process.env, H2A_TEST_QUALIFICATION_ROOT: campaignRoot }, encoding: 'utf8', timeout: 30000 });
    assert.equal(admitted.status, 0, `allocated root refused by the guard:\n${admitted.stderr}`);
    fs.writeFileSync(join(runnerTemp, 'seats.json'), '{}');
    fs.mkdirSync(join(runnerTemp, 'seats'));
    fs.writeFileSync(join(campaignRoot, 'campaign-ledger.json'), '{}');
    const wipeOut = spawnSync('/bin/bash', ['-c', wipe], { cwd: repo,
      env: { PATH: '/usr/bin:/bin', HOME: home, RUNNER_TEMP: runnerTemp, XCLI_CAMPAIGN_ROOT: campaignRoot },
      encoding: 'utf8', timeout: 30000 });
    assert.equal(wipeOut.status, 0, wipeOut.stderr);
    assert.equal(fs.existsSync(campaignRoot), false, 'cleanup wipes the campaign root');
    assert.equal(fs.existsSync(join(runnerTemp, 'seats.json')), false);
    assert.equal(fs.existsSync(join(runnerTemp, 'seats')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L11: the campaign lane demands an explicit seat set', () => {
  assert.ok(/seat_set:\s*\n(\s+\S.*\n)*?\s+required:\s*true/.test(campaign), 'seat_set input is required');
  assert.ok(campaign.includes('test -n "${SEAT_SET}"') || campaign.includes('seat set is required'),
    'the lane refuses an empty seat set at runtime');
});

test('L11: the campaign lane refuses fork refs', () => {
  assert.ok(!/^ {2}pull_request:/m.test(campaign), 'no pull_request trigger');
  assert.ok(!/^\s+pull_request_target:/m.test(campaign), 'no pull_request_target semantics');
  assert.ok(campaign.includes("github.event_name != 'pull_request'"), 'PR events are refused in the job');
  assert.ok(campaign.includes('environment: cross-cli-seats'), 'seat material stays in the protected environment');
  assert.ok(/cancel-in-progress:\s*false/.test(campaign), 'a queued campaign waits instead of racing seats');
  assert.ok(campaign.includes('Wipe seat HOMEs unconditionally'), 'cancel cleanup wipes seats');
  assert.ok(/if:\s*always\(\)/.test(campaign), 'cleanup runs even on cancellation');
  assert.ok(campaign.includes('xcli-receipt-check.mjs'), 'the lane checks the receipt before publishing');
});

test('L11: the PR lane carries the receipt-check gate', () => {
  assert.ok(prLane.includes('receipt-check') || prLane.includes('receipt_gate'),
    'the PR lane runs the receipt check');
  assert.ok(prLane.includes('xcli-receipt-check.mjs'), 'the PR lane invokes the receipt check script');
  assert.ok(prLane.includes('--report-only'), 'lot PRs get report-only qualification instead of a gate');
  assert.ok(prLane.includes('qualification: open') || prLane.includes('report-only'),
    'report-only output never reads as merge-readiness');
});

test('L13: every mandated scenario row runs on the CI scenario axis', () => {
  const manifest = JSON.parse(fs.readFileSync(join(repo, 'docs/cross-cli-matrix.json'), 'utf8'));
  for (const scenario of manifest.simulationMandatory.scenarios) {
    assert.ok(prLane.includes(`"${scenario}"`), `${scenario} is on the CI axis`);
  }
});

test('L11: the release lane gates on the exact-SHA receipt', () => {
  assert.ok(release.includes('xcli-receipt-check.mjs'), 'release invokes the receipt check');
  assert.ok(release.includes('resolve-release-sha'), 'release checks the resolved SHA, never a mutable tag');
  assert.ok(/--gate release/.test(release), 'release gates at release scope');
});
