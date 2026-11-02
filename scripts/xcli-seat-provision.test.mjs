// R19 RED: the conductor provision script builds envelopes from local
// auth-only material only, validates each through seat-load over a private
// FD, uploads via gh --body-file (never argv), and shreds. Tests use
// synthetic fixture homes and a stub gh only — never the real HOME, never
// real secrets, never the network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { buildSeatEnvelope, ensureEnvironment, provisionSeats, setSecret,
  shredFiles, validateEnvelopeViaFd, resolveVibeKey,
  DEFAULT_SEAT_SET } from './xcli-seat-provision.mjs';

const CANARY = 'canary-fixture-zz9';
const slotManifest = new URL('../docs/cross-cli-seat-slots.json', import.meta.url).pathname;

function fixtureHome(root) {
  const home = join(root, 'home');
  for (const dir of ['.codex', '.claude', '.config/muse', '.vibe']) {
    fs.mkdirSync(join(home, dir), { recursive: true });
  }
  fs.writeFileSync(join(home, '.codex/auth.json'), JSON.stringify({ token: CANARY }));
  fs.writeFileSync(join(home, '.claude/.credentials.json'), JSON.stringify({ token: CANARY }));
  fs.writeFileSync(join(home, '.claude.json'),
    JSON.stringify({ oauthAccount: { email: 'fixture@example.test' }, hasCompletedOnboarding: true }));
  fs.writeFileSync(join(home, '.config/muse/auth.json'), JSON.stringify({ token: CANARY }));
  return home;
}

const fixtureEnv = { MISTRAL_API_KEY: `vibe-${CANARY}` };

// A stub gh: records invocations (names only), serves the environment API,
// and proves each --body-file exists and is 0600 at call time.
function stubGh(root) {
  const log = join(root, 'gh-calls.log');
  const stub = join(root, 'gh');
  fs.writeFileSync(stub, `#!/bin/sh
echo "$@" >> ${JSON.stringify(log)}
body=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--body-file" ]; then body="$arg"; fi
  prev="$arg"
done
if [ -n "$body" ]; then
  test -f "$body" || exit 3
  test "$(stat -c %a "$body")" = "600" || exit 4
fi
case "$1 $2 $4" in
  "api --method GET") echo '{"branch_policies":[]}' ;;
  *) echo '{}' ;;
esac
exit 0
`);
  fs.chmodSync(stub, 0o700);
  const calls = () => fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return { stub, calls };
}

test('R19: the default seat set covers the five seated families', () => {
  assert.deepEqual(DEFAULT_SEAT_SET.split(',').sort(), ['agy', 'claude', 'codex', 'muse', 'vibe']);
});

test('R19: dry-run validates five envelopes and records gh calls without uploading', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-dry-'));
  try {
    const home = fixtureHome(root);
    const { stub, calls } = stubGh(root);
    const result = provisionSeats({ seatSet: DEFAULT_SEAT_SET, slotManifestFile: slotManifest,
      homeDir: home, env: fixtureEnv, outBase: root, ghBin: stub, mode: 'dry-run' });
    assert.equal(result.seats.length, 5);
    for (const receipt of result.seats) {
      assert.equal(receipt.kind, 'CredentialProvisioningReceiptV1');
      assert.equal(receipt.environment, 'cross-cli-seats');
      assert.ok(!JSON.stringify(receipt).includes(CANARY), 'receipts carry names only');
    }
    assert.deepEqual(result.seats.map(receipt => receipt.seatId).sort(),
      ['agy', 'claude', 'codex', 'muse', 'vibe']);
    const vibe = result.seats.find(receipt => receipt.seatId === 'vibe');
    assert.deepEqual(vibe.files, ['.vibe/MISTRAL_API_KEY']);
    assert.equal(vibe.useSecret, 'SEAT_USE_VIBE_00');
    // One environment PUT, two branch-policy POSTs, fifteen secret sets.
    assert.equal(result.ghCalls.length, 1 + 2 + 15);
    assert.ok(result.ghCalls.slice(3).every(call => call.argv.includes('secret')),
      'dry-run records the fifteen uploads without running them');
    assert.deepEqual(calls(), [], 'the stub gh was never invoked');
    assert.deepEqual(fs.readdirSync(result.outDir).filter(name => name.endsWith('.envelope.json')), [],
      'envelopes are shredded after a dry-run');
    assert.deepEqual(result.shredded.seats.sort(), ['agy', 'claude', 'codex', 'muse', 'vibe']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R19: a missing allowlisted file refuses with a names-only code and shreds', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-refuse-'));
  try {
    const home = fixtureHome(root);
    fs.rmSync(join(home, '.claude.json'));
    const { stub } = stubGh(root);
    assert.throws(() => provisionSeats({ seatSet: 'claude', slotManifestFile: slotManifest,
      homeDir: home, env: fixtureEnv, outBase: root, ghBin: stub, mode: 'dry-run' }),
    /login-source-missing:claude:\.claude\.json/);
    assert.throws(() => provisionSeats({ seatSet: 'vibe', slotManifestFile: slotManifest,
      homeDir: home, env: {}, outBase: root, ghBin: stub, mode: 'dry-run' }),
    /vibe-key-missing:vibe/);
    assert.throws(() => buildSeatEnvelope({ seatId: 'unknown', slot: '00',
      homeDir: home, env: fixtureEnv }), /seat-unknown:unknown/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R19: provision uploads fifteen secrets and shreds through the stub gh', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-up-'));
  try {
    const home = fixtureHome(root);
    const { stub, calls } = stubGh(root);
    const result = provisionSeats({ seatSet: DEFAULT_SEAT_SET, slotManifestFile: slotManifest,
      homeDir: home, env: fixtureEnv, outBase: root, ghBin: stub, mode: 'provision' });
    assert.equal(result.uploaded.length, 15);
    const invocations = calls();
    const sets = invocations.filter(line => line.startsWith('secret set'));
    assert.equal(sets.length, 15);
    for (const seat of ['CLAUDE', 'CODEX', 'MUSE', 'AGY', 'VIBE']) {
      for (const name of [`SEAT_${seat}_00`, `SEAT_CANDIDATE_${seat}_00`, `SEAT_USE_${seat}_00`]) {
        assert.ok(sets.some(line => line.includes(`secret set ${name} --env cross-cli-seats --repo rhanka/h2a --body-file`)),
          `uploaded under ${name}`);
      }
    }
    assert.ok(invocations.some(line => line.includes('PUT') && line.includes('environments/cross-cli-seats')),
      'the environment is ensured first');
    assert.equal(invocations.filter(line => line.includes('deployment-branch-policies')).length, 3,
      'branch policies listed then limited to the two deployment branches');
    assert.deepEqual(fs.readdirSync(result.outDir).filter(name => name.endsWith('.envelope.json')), [],
      'envelopes are shredded after upload');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R19: local mode materialises a lane manifest and keeps the dir for the campaign', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-local-'));
  try {
    const home = fixtureHome(root);
    const { stub } = stubGh(root);
    const result = provisionSeats({ seatSet: 'codex,vibe', slotManifestFile: slotManifest,
      homeDir: home, env: fixtureEnv, outBase: root, ghBin: stub, mode: 'local' });
    const manifest = JSON.parse(fs.readFileSync(result.manifestFile, 'utf8'));
    assert.equal(manifest.seatMode, 'cyber-seat-custody');
    assert.deepEqual(manifest.seats.map(seat => seat.seatId).sort(), ['codex', 'vibe']);
    assert.equal(fs.statSync(join(result.outDir, 'lane/seats/codex/.codex/auth.json')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(join(result.outDir, 'lane/seats/vibe/.vibe/MISTRAL_API_KEY')).mode & 0o777, 0o600);
    assert.ok(!JSON.stringify(manifest).includes(CANARY), 'the manifest carries paths only');
    assert.equal(fs.existsSync(join(result.outDir, 'codex.envelope.json')), true);
    assert.equal(fs.existsSync(join(result.outDir, 'vibe.envelope.json')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R19: a tampered envelope is refused over the FD with a typed code', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-fd-'));
  try {
    const bad = join(root, 'bad.json');
    fs.writeFileSync(bad, 'not-json', { mode: 0o600 });
    assert.throws(() => validateEnvelopeViaFd({ seatId: 'codex',
      slotManifestFile: slotManifest, envelopeFile: bad }),
    /seat-load-refused:codex:seat-bundle-invalid:codex/);
    assert.throws(() => setSecret({ ghBin: '/bin/false', name: 'SEAT_USE_CODEX_00', file: bad }),
      /gh-secret-failed:SEAT_USE_CODEX_00/);
    assert.throws(() => ensureEnvironment({ ghBin: '/bin/false' }), /gh-api-failed/);
    assert.deepEqual(shredFiles([bad]), []);
    assert.equal(fs.existsSync(bad), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// R20: a product-state-sized .claude.json (projects/history bloat) crosses
// only as its minimal auth fields, so the envelope stays under the 48 KiB
// cap while still naming both allowlisted source files.
function oversizedClaudeHome(root) {
  const home = fixtureHome(root);
  const big = { oauthAccount: { email: 'fixture@example.test' },
    hasCompletedOnboarding: true, lastOnboardingVersion: '1.0.0',
    projects: {}, history: [] };
  for (let i = 0; i < 4000; i++) big.projects[`/home/user/proj${i}`] = [{ p: 'x'.repeat(60) }];
  fs.writeFileSync(join(home, '.claude.json'), JSON.stringify(big));
  assert.ok(fs.statSync(join(home, '.claude.json')).size > 200 * 1024, 'fixture exceeds the cap like the real file');
  return home;
}

test('R20: an oversized .claude.json is minimized into a capped claude envelope', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-r20-'));
  try {
    const home = oversizedClaudeHome(root);
    const { stub } = stubGh(root);
    const result = provisionSeats({ seatSet: 'claude', slotManifestFile: slotManifest,
      homeDir: home, env: fixtureEnv, outBase: root, ghBin: stub, mode: 'dry-run' });
    assert.equal(result.seats.length, 1);
    assert.deepEqual(result.seats[0].files, ['.claude.json', '.claude/.credentials.json']);
    const built = buildSeatEnvelope({ seatId: 'claude', slot: '00',
      homeDir: home, env: fixtureEnv });
    assert.ok(Buffer.byteLength(built.serialized, 'utf8') < 48 * 1024, 'minimized envelope fits the cap');
    const crossed = JSON.parse(Buffer.from(built.envelope.files['.claude.json'], 'base64').toString('utf8'));
    assert.ok(!('projects' in crossed) && !('history' in crossed), 'no product state crosses');
    assert.deepEqual(crossed.oauthAccount, { email: 'fixture@example.test' });
    assert.equal(crossed.hasCompletedOnboarding, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R20: a non-JSON .claude.json refuses with a names-only code', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-r20bad-'));
  try {
    const home = fixtureHome(root);
    fs.writeFileSync(join(home, '.claude.json'), 'not-json{{{');
    assert.throws(() => buildSeatEnvelope({ seatId: 'claude', slot: '00',
      homeDir: home, env: fixtureEnv }),
    /login-source-invalid:claude:\.claude\.json/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// R20: the OS keyring fallback. A stub secret-tool stands in for the native
// binary (never the real keyring, never real bytes on stdout).
const KEYRING_MARK = 'keyring-fixture-qq7';
function stubKeyring(root, { succeed = true } = {}) {
  const log = join(root, 'keyring-calls.log');
  const bin = join(root, 'secret-tool');
  fs.writeFileSync(bin, `#!/bin/sh
echo "$@" >> ${JSON.stringify(log)}
${succeed ? `echo ${JSON.stringify(KEYRING_MARK)}` : 'exit 1'}
exit 0
`);
  fs.chmodSync(bin, 0o700);
  const calls = () => fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return { bin, calls };
}

test('R20: vibe falls back to the OS keyring item when the env key is absent', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-keyring-'));
  try {
    const home = fixtureHome(root);
    const { stub } = stubGh(root);
    const { bin, calls } = stubKeyring(root);
    assert.equal(resolveVibeKey({ MISTRAL_API_KEY: 'env-key' }, '/bin/false'), 'env-key');
    assert.equal(resolveVibeKey({}, bin), KEYRING_MARK);
    assert.deepEqual(calls(), ['lookup service ai.mistral.vibe']);
    const result = provisionSeats({ seatSet: 'vibe', slotManifestFile: slotManifest,
      homeDir: home, env: {}, outBase: root, ghBin: stub,
      mode: 'dry-run', keyringBin: bin });
    assert.equal(result.seats.length, 1);
    assert.deepEqual(result.seats[0].files, ['.vibe/MISTRAL_API_KEY']);
    assert.ok(!JSON.stringify(result).includes(KEYRING_MARK), 'receipts carry names only');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R20: vibe refuses names-only when neither env nor keyring has a key', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-nokey-'));
  try {
    const home = fixtureHome(root);
    const { stub } = stubGh(root);
    const { bin } = stubKeyring(root, { succeed: false });
    assert.throws(() => resolveVibeKey({}, bin), /vibe-key-missing:vibe/);
    assert.throws(() => resolveVibeKey({}, '/bin/false'), /vibe-key-missing:vibe/);
    assert.throws(() => resolveVibeKey({}, '/nonexistent-secret-tool-bin'), /vibe-key-missing:vibe/);
    assert.throws(() => provisionSeats({ seatSet: 'vibe', slotManifestFile: slotManifest,
      homeDir: home, env: {}, outBase: root, ghBin: stub,
      mode: 'dry-run', keyringBin: bin }),
    /vibe-key-missing:vibe/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R20: the dry-run CLI resolves vibe from the keyring without leaking bytes', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-keyring-cli-'));
  try {
    const home = fixtureHome(root);
    const { stub } = stubGh(root);
    const { bin } = stubKeyring(root);
    const script = new URL('./xcli-seat-provision.mjs', import.meta.url).pathname;
    const { MISTRAL_API_KEY: _dropped, ...rest } = process.env;
    const probed = spawnSync(process.execPath,
      [script, '--dry-run', '--seat-set', 'vibe', '--home', home,
        '--out-base', root, '--gh-bin', stub, '--keyring-bin', bin],
      { env: rest, encoding: 'utf8', timeout: 60000 });
    assert.equal(probed.status, 0, probed.stderr);
    assert.ok(probed.stdout.includes('SEAT_USE_VIBE_00'), 'the receipt names the projection');
    assert.ok(!probed.stdout.includes(KEYRING_MARK), 'no secret bytes on stdout');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R19: the dry-run CLI prints receipts with names only', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-cli-'));
  try {
    const home = fixtureHome(root);
    const { stub } = stubGh(root);
    const script = new URL('./xcli-seat-provision.mjs', import.meta.url).pathname;
    const probed = spawnSync(process.execPath,
      [script, '--dry-run', '--seat-set', 'vibe', '--home', home, '--out-base', root, '--gh-bin', stub],
      { env: { ...process.env, MISTRAL_API_KEY: `vibe-${CANARY}` }, encoding: 'utf8', timeout: 60000 });
    assert.equal(probed.status, 0, probed.stderr);
    assert.ok(probed.stdout.includes('SEAT_USE_VIBE_00'), 'the receipt names the projection');
    assert.ok(!probed.stdout.includes(CANARY), 'no secret bytes on stdout');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
