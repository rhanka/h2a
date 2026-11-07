// R19: the local campaign runs the same cells with the same envelopes on
// this machine — no GitHub secret, no workflow run — and reports per-cell
// pass/fail with typed reasons, labelled non-merge-gating. Tests run the
// simulated lane only, with synthetic fixture homes; the provision dir is
// shredded whatever the outcome.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { environment, removeCampaignRoot } from './xcli-lab.mjs';
import { LOCAL_GATE, classifyLocalCellReason, runLocalCampaign } from './xcli-campaign-local.mjs';

const CANARY = 'canary-fixture-zz9';

test('R31: a full matrix records an unenrolled seat without cancelling enrolled pairs', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-full-unenrolled-'));
  let report;
  try {
    const result = await runLocalCampaign({ seatSet: 'claude,codex', fullMatrix: true,
      homeDir: fixtureHome(root), outBase: join(root, 'provision'), simulated: true,
      meshFacade: stubMesh({ accounts: [meshAccount('codex')] }).facade,
      timeoutMs: 30000 });
    report = result.report;
    assert.equal(report.cells.length, 4);
    assert.equal(report.cells.filter(c => c.reason === 'seat-not-enrolled-in-llm-mesh:claude').length, 3);
    const codex = report.cells.find(c => c.sender === 'codex' && c.receiver === 'codex');
    assert.notEqual(codex.reason, 'qualification-cancelled');
    assert.ok(codex.elapsedMs > 0, 'the enrolled pair actually ran');
    assert.deepEqual(fs.readdirSync(join(root, 'provision')), [], 'all transported credentials were wiped');
  } finally {
    if (report) removeCampaignRoot(report.campaignRoot);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
const slotManifest = new URL('../docs/cross-cli-seat-slots.json', import.meta.url).pathname;

// R23: synthetic mesh facade — enrolled accounts as public metadata only.
// Code paths stay hermetic: never the real keyring, never real secrets.
const meshAccount = (provider, accountId = `acct-${provider}-01`) => ({
  accountId, providerId: provider, status: 'active',
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
});
const ALL_MESH_ACCOUNTS = ['claude-code', 'codex', 'muse', 'cloud-code', 'mistral-vibe']
  .map((provider) => meshAccount(provider));
function stubMesh({ accounts = ALL_MESH_ACCOUNTS, key = 'mesh-vibe-key-fixture' } = {}) {
  const facade = {
    listAccounts: async () => accounts,
    acquire: async (input) => ({
      input,
      material: { accessToken: key },
      release: async () => {},
    }),
  };
  return { facade };
}

function fixtureHome(root) {
  const home = join(root, 'home');
  for (const dir of ['.codex', '.claude', '.config/muse']) fs.mkdirSync(join(home, dir), { recursive: true });
  fs.writeFileSync(join(home, '.codex/auth.json'), JSON.stringify({ token: CANARY }));
  fs.writeFileSync(join(home, '.claude/.credentials.json'), JSON.stringify({ token: CANARY }));
  fs.writeFileSync(join(home, '.claude.json'),
    JSON.stringify({ oauthAccount: { email: 'fixture@example.test' }, hasCompletedOnboarding: true }));
  fs.writeFileSync(join(home, '.config/muse/auth.json'), JSON.stringify({ token: CANARY }));
  return home;
}

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);

test('R19: a simulated local campaign reports typed cells and shreds the provision dir', { timeout: 300000 }, async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-local-'));
  try {
    const home = fixtureHome(root);
    const outBase = join(root, 'provision');
    const { report, green } = await runLocalCampaign({ seatSet: 'codex,vibe', pairs: ['codex:codex'],
      slotManifestFile: slotManifest, homeDir: home, meshFacade: stubMesh().facade,
      outBase, timeoutMs: 15000, wakeOffsets: '0', simulated: true, spawnTimeoutMs: 290000 });
    try {
      assert.equal(report.gate, LOCAL_GATE);
      assert.deepEqual(report.pairs, ['codex:codex']);
      assert.match(report.manifestDigest, /^[0-9a-f]{64}$/);
      assert.equal(report.cells.length, 1);
      const [cell] = report.cells;
      assert.equal(cell.senderSeat, 'codex');
      assert.equal(cell.receiverSeat, 'codex');
      assert.ok(['simulated-OK', 'simulated-KO', 'blocked'].includes(cell.status), 'a known verdict');
      assert.ok(typeof cell.reason === 'string' && cell.reason.length > 0, 'a typed reason');
      assert.equal(cell.parentSecretWipe, true, 'each cell is wiped with a receipt');
      assert.equal(typeof green, 'boolean');
      assert.equal(report.counts.pass + report.counts.fail, 1);
      const stored = JSON.parse(fs.readFileSync(report.reportFile, 'utf8'));
      assert.equal(stored.gate, LOCAL_GATE, 'the report file carries the non-merge-gating label');
      assert.ok(!JSON.stringify(stored).includes(CANARY), 'the report carries names only');
      // R23: the report carries the seat source of record per seat (mesh
      // gate), names only.
      assert.deepEqual(report.sources.map(source => [source.seatId, source.kind, source.meshGate]).sort(),
        [['codex', 'cli-login', 'enrolled'], ['vibe', 'llm-mesh', 'enrolled']].sort());
      assert.deepEqual(stored.sources, report.sources, 'the report file carries the seat sources');
      assert.deepEqual(walk(outBase), [], 'the provision dir is shredded after the run');
    } finally { removeCampaignRoot(report.campaignRoot); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R20: a simulated claude cell provisions past product-state bloat', { timeout: 300000 }, async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-local-r20-'));
  try {
    const home = fixtureHome(root);
    const big = { oauthAccount: { email: 'fixture@example.test' },
      hasCompletedOnboarding: true, lastOnboardingVersion: '1.0.0', projects: {} };
    for (let i = 0; i < 4000; i++) big.projects[`/home/user/proj${i}`] = [{ p: 'x'.repeat(60) }];
    fs.writeFileSync(join(home, '.claude.json'), JSON.stringify(big));
    assert.ok(fs.statSync(join(home, '.claude.json')).size > 200 * 1024, 'fixture exceeds the cap like the real file');
    const outBase = join(root, 'provision');
    const { report } = await runLocalCampaign({ seatSet: 'claude', pairs: ['claude:claude'],
      slotManifestFile: slotManifest, homeDir: home, meshFacade: stubMesh().facade, outBase,
      timeoutMs: 15000, wakeOffsets: '0', simulated: true, spawnTimeoutMs: 290000 });
    try {
      assert.equal(report.gate, LOCAL_GATE);
      assert.equal(report.cells.length, 1);
      assert.equal(report.counts.pass + report.counts.fail, 1);
      assert.deepEqual(walk(outBase), [], 'the provision dir is shredded after the run');
    } finally { removeCampaignRoot(report.campaignRoot); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// R22 (bench round 22, claude diagonal 01/11): the campaign report lost
// the typed reason of a measured cell whose wake proof failed without a
// blocker or failure (sent/delivered/received/replied all true, woke
// false, wakeFailure wake-delay-exceeded) and printed `unknown`. The local
// reason keeps the wake failure typed.
test('R22: a measured-KO cell with only a wake failure keeps its typed reason', () => {
  assert.equal(typeof classifyLocalCellReason, 'function', 'the local reason is single-sourced');
  assert.equal(classifyLocalCellReason({ status: 'measured-KO', wakeFailure: 'wake-delay-exceeded' }, 'measured-OK'),
    'wake-delay-exceeded');
  assert.equal(classifyLocalCellReason({ status: 'measured-KO', blocker: 'cli-exited-before-ready',
    wakeFailure: 'wake-delay-exceeded' }, 'measured-OK'), 'cli-exited-before-ready');
  assert.equal(classifyLocalCellReason({ status: 'measured-KO', failure: 'wake-not-proven',
    wakeFailure: 'wake-delay-exceeded' }, 'measured-OK'), 'wake-not-proven');
  assert.equal(classifyLocalCellReason({ status: 'measured-OK' }, 'measured-OK'), 'round-trip');
  assert.equal(classifyLocalCellReason({ status: 'measured-KO' }, 'measured-OK'), 'unknown');
});

test('R19: a failed local provision refuses names-only and leaves no envelopes', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-local-refuse-'));
  try {
    const home = fixtureHome(root);
    fs.rmSync(join(home, '.codex/auth.json'));
    const outBase = join(root, 'provision');
    await assert.rejects(runLocalCampaign({ seatSet: 'codex', pairs: ['codex:codex'],
      slotManifestFile: slotManifest, homeDir: home, meshFacade: stubMesh().facade, outBase,
      timeoutMs: 15000, simulated: true }),
    /login-source-missing:codex:\.codex\/auth\.json/);
    assert.ok(!fs.existsSync(outBase) || walk(outBase).every(name => !name.endsWith('.envelope.json')),
      'no envelope survives a refused local run');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// R23: the spawned CLI resolves seats from the llm-mesh store, which the
// test pins to a fresh empty keyring dir — deterministic on every machine:
// codex refuses with the exact enroll command, names only.
test('R23: the local CLI refuses a seat with no mesh account', { timeout: 300000 }, () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-local-cli-'));
  try {
    const home = fixtureHome(root);
    const script = new URL('./xcli-campaign-local.mjs', import.meta.url).pathname;
    const keyringDir = join(root, 'mesh-keyring');
    fs.mkdirSync(keyringDir, { recursive: true });
    const env = { ...environment(join(root, 'env')), TMPDIR: tmpdir(),
      SENTROPIC_LLM_MESH_KEYRING_DIR: keyringDir,
      ...(process.env.XCLI_NODE_HEADERS ? { XCLI_NODE_HEADERS: process.env.XCLI_NODE_HEADERS } : {}) };
    const probed = spawnSync(process.execPath,
      [script, '--simulated', '--seat-set', 'codex', '--pair', 'codex:codex',
        '--home', home, '--out-base', join(root, 'provision'), '--timeout-ms', '15000'],
      { env, encoding: 'utf8', timeout: 290000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(probed.status, 1, 'the CLI refuses without a mesh account');
    assert.ok(probed.stdout.includes('seat-not-enrolled-in-llm-mesh:codex'),
      `the refusal names the missing enrollment\n${probed.stdout}\n${probed.stderr}`);
    assert.ok(probed.stdout.includes('h2a llm-mesh account enroll codex'),
      'the refusal carries the exact enroll command');
    assert.ok(!probed.stdout.includes(CANARY), 'no secret bytes on stdout');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
