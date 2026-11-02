// R23 RED: every seat is sourced from the llm-mesh account store — the
// enrolled account is the seat of record. vibe bytes come from the mesh
// mistral-vibe account (acquire/release through a stub facade here);
// claude/codex/muse/agy bytes stay the live CLI login files, gated on the
// mesh enrollment. No secret-tool, no MISTRAL_API_KEY, no keyring binary.
// Tests use synthetic fixture homes, a stub mesh facade and a stub gh only
// — never the real HOME, never the real mesh store, never real secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { buildSeatEnvelope, ensureEnvironment, provisionSeats, setSecret,
  shredFiles, validateEnvelopeViaFd,
  DEFAULT_SEAT_SET } from './xcli-seat-provision.mjs';

// Synthetic mesh facade: enrolled accounts as public metadata only, a
// fixed mistral-vibe key for acquire, call counters proving the script
// never acquires without enrollment and always releases.
const meshAccount = (provider, accountId = `acct-${provider}-01`) => ({
  accountId, providerId: provider, status: 'active',
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
});
const ALL_MESH_ACCOUNTS = ['claude-code', 'codex', 'muse', 'cloud-code', 'mistral-vibe']
  .map((provider) => meshAccount(provider));
function stubMesh({ accounts = ALL_MESH_ACCOUNTS, key = 'mesh-vibe-key-fixture', failList = null } = {}) {
  const calls = { acquire: [], release: 0 };
  const facade = {
    listAccounts: async () => {
      if (failList) throw failList;
      return accounts;
    },
    acquire: async (input) => {
      calls.acquire.push(input);
      return { material: { accessToken: key }, release: async () => { calls.release++; } };
    },
  };
  return { facade, calls };
}

const CANARY = 'canary-fixture-zz9';
const slotManifest = new URL('../docs/cross-cli-seat-slots.json', import.meta.url).pathname;

function fixtureHome(root) {
  const home = join(root, 'home');
  for (const dir of ['.codex', '.claude', '.config/muse', '.vibe', '.gemini/antigravity-cli']) {
    fs.mkdirSync(join(home, dir), { recursive: true });
  }
  fs.writeFileSync(join(home, '.codex/auth.json'), JSON.stringify({ token: CANARY }));
  fs.writeFileSync(join(home, '.claude/.credentials.json'), JSON.stringify({ token: CANARY }));
  fs.writeFileSync(join(home, '.claude.json'),
    JSON.stringify({ oauthAccount: { email: 'fixture@example.test' }, hasCompletedOnboarding: true }));
  fs.writeFileSync(join(home, '.config/muse/auth.json'), JSON.stringify({ token: CANARY }));
  fs.writeFileSync(join(home, '.gemini/antigravity-cli/antigravity-oauth-token'),
    JSON.stringify({ token: CANARY }));
  return home;
}

// R23: no environment key feeds the provision — vibe comes from the stub
// mesh facade, the other seats from the fixture login files.
const meshOnly = () => stubMesh();

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

test('R23: dry-run validates five mesh-sourced envelopes and records gh calls', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-dry-'));
  try {
    const home = fixtureHome(root);
    const { stub, calls } = stubGh(root);
    const { facade, calls: meshCalls } = meshOnly();
    const result = await provisionSeats({ seatSet: DEFAULT_SEAT_SET, slotManifestFile: slotManifest,
      homeDir: home, outBase: root, ghBin: stub, mode: 'dry-run', meshFacade: facade });
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
    // Seat sources are names-only and single-sourced per CLI.
    assert.deepEqual(result.sources.map(source => [source.seatId, source.kind, source.provider, source.meshGate]).sort(),
      [['agy', 'cli-login', 'cloud-code', 'enrolled'], ['claude', 'cli-login', 'claude-code', 'enrolled'],
        ['codex', 'cli-login', 'codex', 'enrolled'], ['muse', 'cli-login', 'muse', 'enrolled'],
        ['vibe', 'llm-mesh', 'mistral-vibe', 'enrolled']].sort());
    assert.ok(!JSON.stringify(result.sources).includes(CANARY), 'sources carry names only');
    assert.deepEqual(meshCalls.acquire.length, 1, 'only the vibe seat is acquired from the mesh');
    assert.equal(meshCalls.release, 1, 'the vibe lease is released after projection');
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

// R22 (bench round 22, agy diagonal): agy carries its OAuth token file in
// the envelope (auth-only, like the other families) while the envelope keeps
// the adapter-validated cloud-code tuple. A missing token refuses names-only.
test('R22: the agy envelope carries the token file plus the validated tuple', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-agy-'));
  try {
    const home = fixtureHome(root);
    const built = await buildSeatEnvelope({ seatId: 'agy', slot: '00',
      homeDir: home, meshFacade: meshOnly().facade });
    assert.deepEqual(built.files, ['.gemini/antigravity-cli/antigravity-oauth-token']);
    assert.deepEqual(built.envelope.agy, {
      packageProviderId: 'cloud-code', packageAccountTransport: 'cloud-code',
      issuingClientRef: 'agy-cli', endpointFamily: 'antigravity',
      requestedTargetProviderId: 'cloudcode-pa', requestedTransportProviderId: 'antigravity' });
    assert.ok(!built.serialized.includes(CANARY), 'no secret bytes in the serialized envelope');
    assert.ok(Buffer.byteLength(built.serialized, 'utf8') < 48 * 1024, 'token envelope fits the cap');
    assert.equal(built.source.meshGate, 'enrolled', 'the agy login is gated on the mesh enrollment');
    fs.rmSync(join(home, '.gemini/antigravity-cli/antigravity-oauth-token'));
    await assert.rejects(buildSeatEnvelope({ seatId: 'agy', slot: '00',
      homeDir: home, meshFacade: meshOnly().facade }),
    /login-source-missing:agy:\.gemini\/antigravity-cli\/antigravity-oauth-token/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R23: a missing allowlisted file refuses with a names-only code and shreds', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-refuse-'));
  try {
    const home = fixtureHome(root);
    fs.rmSync(join(home, '.claude.json'));
    const { stub } = stubGh(root);
    await assert.rejects(provisionSeats({ seatSet: 'claude', slotManifestFile: slotManifest,
      homeDir: home, outBase: root, ghBin: stub, mode: 'dry-run', meshFacade: meshOnly().facade }),
    /login-source-missing:claude:\.claude\.json/);
    await assert.rejects(buildSeatEnvelope({ seatId: 'unknown', slot: '00',
      homeDir: home, meshFacade: meshOnly().facade }), /seat-unknown:unknown/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R23: a CLI with no mesh account refuses with the exact enroll command', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-notenrolled-'));
  try {
    const home = fixtureHome(root);
    const { stub } = stubGh(root);
    const { facade, calls } = stubMesh({ accounts: [] });
    const error = await provisionSeats({ seatSet: 'vibe', slotManifestFile: slotManifest,
      homeDir: home, outBase: root, ghBin: stub, mode: 'dry-run', meshFacade: facade })
      .then(() => null, (err) => err);
    assert.ok(error instanceof Error, 'refusal is an error');
    assert.equal(error.message, 'seat-not-enrolled-in-llm-mesh:vibe');
    assert.equal(error.enroll, 'h2a llm-mesh account enroll mistral-vibe');
    assert.deepEqual(calls.acquire, [], 'the script never acquires without enrollment');
    const errorCodex = await provisionSeats({ seatSet: 'codex', slotManifestFile: slotManifest,
      homeDir: home, outBase: root, ghBin: stub, mode: 'dry-run', meshFacade: facade })
      .then(() => null, (err) => err);
    assert.equal(errorCodex.message, 'seat-not-enrolled-in-llm-mesh:codex');
    assert.equal(errorCodex.enroll, 'h2a llm-mesh account enroll codex');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R23: an unreachable mesh store refuses vibe but keeps file seats measurable', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-unreachable-'));
  try {
    const home = fixtureHome(root);
    const { stub } = stubGh(root);
    const denied = new Error('denied');
    denied.code = 'EROFS';
    const { facade } = stubMesh({ failList: denied });
    const vibeError = await provisionSeats({ seatSet: 'vibe', slotManifestFile: slotManifest,
      homeDir: home, outBase: root, ghBin: stub, mode: 'dry-run', meshFacade: facade })
      .then(() => null, (err) => err);
    assert.equal(vibeError.message, 'llm-mesh-store-unreachable:vibe');
    const result = await provisionSeats({ seatSet: 'codex', slotManifestFile: slotManifest,
      homeDir: home, outBase: root, ghBin: stub, mode: 'dry-run', meshFacade: facade });
    assert.equal(result.seats.length, 1);
    assert.equal(result.sources[0].meshGate, 'store-unreachable');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R19: provision uploads fifteen secrets and shreds through the stub gh', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-up-'));
  try {
    const home = fixtureHome(root);
    const { stub, calls } = stubGh(root);
    const result = await provisionSeats({ seatSet: DEFAULT_SEAT_SET, slotManifestFile: slotManifest,
      homeDir: home, outBase: root, ghBin: stub, mode: 'provision', meshFacade: meshOnly().facade });
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

test('R19: local mode materialises a lane manifest and keeps the dir for the campaign', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-local-'));
  try {
    const home = fixtureHome(root);
    const { stub } = stubGh(root);
    const result = await provisionSeats({ seatSet: 'codex,vibe', slotManifestFile: slotManifest,
      homeDir: home, outBase: root, ghBin: stub, mode: 'local', meshFacade: meshOnly().facade });
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

test('R20: an oversized .claude.json is minimized into a capped claude envelope', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-r20-'));
  try {
    const home = oversizedClaudeHome(root);
    const { stub } = stubGh(root);
    const result = await provisionSeats({ seatSet: 'claude', slotManifestFile: slotManifest,
      homeDir: home, outBase: root, ghBin: stub, mode: 'dry-run', meshFacade: meshOnly().facade });
    assert.equal(result.seats.length, 1);
    assert.deepEqual(result.seats[0].files, ['.claude.json', '.claude/.credentials.json']);
    const built = await buildSeatEnvelope({ seatId: 'claude', slot: '00',
      homeDir: home, meshFacade: meshOnly().facade });
    assert.ok(Buffer.byteLength(built.serialized, 'utf8') < 48 * 1024, 'minimized envelope fits the cap');
    const crossed = JSON.parse(Buffer.from(built.envelope.files['.claude.json'], 'base64').toString('utf8'));
    assert.ok(!('projects' in crossed) && !('history' in crossed), 'no product state crosses');
    assert.deepEqual(crossed.oauthAccount, { email: 'fixture@example.test' });
    assert.equal(crossed.hasCompletedOnboarding, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R20: a non-JSON .claude.json refuses with a names-only code', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-r20bad-'));
  try {
    const home = fixtureHome(root);
    fs.writeFileSync(join(home, '.claude.json'), 'not-json{{{');
    await assert.rejects(buildSeatEnvelope({ seatId: 'claude', slot: '00',
      homeDir: home, meshFacade: meshOnly().facade }),
    /login-source-invalid:claude:\.claude\.json/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// R23: the OS keyring path is removed. Passing --keyring-bin refuses loud
// (stale conductor invocations fail closed instead of silently ignoring the
// flag); vibe and codex resolve from the llm-mesh store only.
test('R23: the keyring flag is refused and the mesh store decides alone', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-nokeyring-'));
  try {
    const home = fixtureHome(root);
    const { stub } = stubGh(root);
    const script = new URL('./xcli-seat-provision.mjs', import.meta.url).pathname;
    const keyringDir = join(root, 'mesh-keyring');
    fs.mkdirSync(keyringDir, { recursive: true });
    const env = { ...process.env, SENTROPIC_LLM_MESH_KEYRING_DIR: keyringDir,
      MISTRAL_API_KEY: `vibe-${CANARY}` };
    const refused = spawnSync(process.execPath,
      [script, '--dry-run', '--seat-set', 'vibe', '--home', home,
        '--out-base', root, '--gh-bin', stub, '--keyring-bin', '/bin/false'],
      { env, encoding: 'utf8', timeout: 60000 });
    assert.equal(refused.status, 1, 'the keyring flag fails the run');
    assert.ok(refused.stdout.includes('keyring-source-removed'), 'the refusal is typed');
    assert.ok(!refused.stdout.includes(CANARY), 'no secret bytes on stdout');
    // An env key alone no longer provisions vibe: the mesh account decides.
    const probed = spawnSync(process.execPath,
      [script, '--dry-run', '--seat-set', 'vibe', '--home', home,
        '--out-base', root, '--gh-bin', stub],
      { env, encoding: 'utf8', timeout: 60000 });
    assert.equal(probed.status, 1, 'vibe without a mesh account refuses');
    assert.ok(probed.stdout.includes('seat-not-enrolled-in-llm-mesh:vibe'),
      'the refusal names the missing enrollment');
    assert.ok(probed.stdout.includes('h2a llm-mesh account enroll mistral-vibe'),
      'the refusal carries the exact enroll command');
    assert.ok(!probed.stdout.includes(CANARY), 'no secret bytes on stdout');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R23: the dry-run CLI refuses a file seat with no mesh account', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-cli-refuse-'));
  try {
    const home = fixtureHome(root);
    const { stub } = stubGh(root);
    const script = new URL('./xcli-seat-provision.mjs', import.meta.url).pathname;
    const keyringDir = join(root, 'mesh-keyring');
    fs.mkdirSync(keyringDir, { recursive: true });
    const probed = spawnSync(process.execPath,
      [script, '--dry-run', '--seat-set', 'codex', '--home', home,
        '--out-base', root, '--gh-bin', stub],
      { env: { ...process.env, SENTROPIC_LLM_MESH_KEYRING_DIR: keyringDir },
        encoding: 'utf8', timeout: 60000 });
    assert.equal(probed.status, 1, 'codex without a mesh account refuses');
    assert.ok(probed.stdout.includes('seat-not-enrolled-in-llm-mesh:codex'),
      'the refusal names the missing enrollment');
    assert.ok(probed.stdout.includes('h2a llm-mesh account enroll codex'),
      'the refusal carries the exact enroll command');
    assert.ok(!probed.stdout.includes(CANARY), 'no secret bytes on stdout');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R23: the dry-run provision prints receipts and sources with names only', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-provision-cli-'));
  try {
    const { facade } = meshOnly();
    const result = await provisionSeats({ seatSet: 'codex,vibe', slotManifestFile: slotManifest,
      homeDir: fixtureHome(root), outBase: root, ghBin: '/bin/false',
      mode: 'dry-run', meshFacade: facade });
    const printed = result.seats.map((receipt) => JSON.stringify(receipt)).join('\n') +
      result.sources.map((source) => JSON.stringify(source)).join('\n');
    assert.ok(printed.includes('SEAT_USE_VIBE_00'), 'the receipt names the projection');
    assert.ok(!printed.includes(CANARY), 'no secret bytes in receipts or sources');
    assert.ok(!printed.includes('mesh-vibe-key-fixture'), 'no mesh key bytes in receipts or sources');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
