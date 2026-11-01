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
import { LOCAL_GATE, runLocalCampaign } from './xcli-campaign-local.mjs';

const CANARY = 'canary-fixture-zz9';
const slotManifest = new URL('../docs/cross-cli-seat-slots.json', import.meta.url).pathname;

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

test('R19: a simulated local campaign reports typed cells and shreds the provision dir', { timeout: 300000 }, () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-local-'));
  try {
    const home = fixtureHome(root);
    const outBase = join(root, 'provision');
    const { report, green } = runLocalCampaign({ seatSet: 'codex,vibe', pairs: ['codex:codex'],
      slotManifestFile: slotManifest, homeDir: home, env: { MISTRAL_API_KEY: `vibe-${CANARY}` },
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
      assert.deepEqual(walk(outBase), [], 'the provision dir is shredded after the run');
    } finally { removeCampaignRoot(report.campaignRoot); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R19: a failed local provision refuses names-only and leaves no envelopes', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-local-refuse-'));
  try {
    const home = fixtureHome(root);
    fs.rmSync(join(home, '.codex/auth.json'));
    const outBase = join(root, 'provision');
    assert.throws(() => runLocalCampaign({ seatSet: 'codex', pairs: ['codex:codex'],
      slotManifestFile: slotManifest, homeDir: home, env: {}, outBase,
      timeoutMs: 15000, simulated: true }),
    /login-source-missing:codex:\.codex\/auth\.json/);
    assert.ok(!fs.existsSync(outBase) || walk(outBase).every(name => !name.endsWith('.envelope.json')),
      'no envelope survives a refused local run');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R19: the local CLI labels its report non-merge-gating', { timeout: 300000 }, () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-local-cli-'));
  try {
    const home = fixtureHome(root);
    const script = new URL('./xcli-campaign-local.mjs', import.meta.url).pathname;
    const env = { ...environment(join(root, 'env')), TMPDIR: tmpdir(),
      MISTRAL_API_KEY: `vibe-${CANARY}`,
      ...(process.env.XCLI_NODE_HEADERS ? { XCLI_NODE_HEADERS: process.env.XCLI_NODE_HEADERS } : {}) };
    const probed = spawnSync(process.execPath,
      [script, '--simulated', '--seat-set', 'codex', '--pair', 'codex:codex',
        '--home', home, '--out-base', join(root, 'provision'), '--timeout-ms', '15000'],
      { env, encoding: 'utf8', timeout: 290000, maxBuffer: 16 * 1024 * 1024 });
    const lines = `${probed.stdout ?? ''}`.split('\n').filter(Boolean);
    const event = lines.map(line => { try { return JSON.parse(line); } catch { return null; } })
      .find(entry => entry?.event === 'local-campaign-report');
    assert.ok(event, `the CLI prints the report event\n${probed.stdout}\n${probed.stderr}`);
    assert.equal(event.gate, LOCAL_GATE);
    assert.ok(!probed.stdout.includes(CANARY), 'no secret bytes on stdout');
    const report = JSON.parse(fs.readFileSync(event.reportFile, 'utf8'));
    assert.equal(report.gate, LOCAL_GATE);
    assert.equal(report.cells.length, 1);
    // The lane mints an admitted sibling root that outlives this dir by
    // design; remove the exact root the report names.
    removeCampaignRoot(report.campaignRoot);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
