// R18 RED: cyber-seat custody contract for the h2a campaign lane.
// Same-repository custody like the sentropic cyber seats: fixed
// SEAT_<CLI>_<SLOT> environment secrets, one reviewed slot manifest, one
// protected environment, vendored (never re-implemented) seat-bundle
// adapters, per-cell wipe with a metadata-only receipt. No --auth-home path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  CYBER_SEAT_MODE,
  SEAT_ENVIRONMENT,
  SEAT_SLOT_CLIS,
  assertCyberManifest,
  assertNoAuthHome,
  slotSecretNames,
} from './xcli-seat-custody.mjs';
import {
  materialiseSeatEnvelopes,
  validateSeatBundle,
  translateAgySeatToApplication,
  vendoredDigest,
} from './xcli-seat-import.mjs';
import { classifyApprovalExhaustion } from './qualify-cross-cli.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('R18: fixed slot secret names per CLI and slot', () => {
  assert.deepEqual(slotSecretNames('claude', '00'),
    { canonical: 'SEAT_CLAUDE_00', candidate: 'SEAT_CANDIDATE_CLAUDE_00', projection: 'SEAT_USE_CLAUDE_00' });
  assert.deepEqual(slotSecretNames('agy', '01'),
    { canonical: 'SEAT_AGY_01', candidate: 'SEAT_CANDIDATE_AGY_01', projection: 'SEAT_USE_AGY_01' });
  assert.throws(() => slotSecretNames('gemini', '00'), /gemini-via-agy-required/);
  assert.throws(() => slotSecretNames('claude', '99'), /slot-ceiling/);
  assert.throws(() => slotSecretNames('unknown', '00'), /unknown-cli/);
});

test('R18: single protected environment and cyber seat mode', () => {
  assert.equal(SEAT_ENVIRONMENT, 'cross-cli-seats');
  assert.equal(CYBER_SEAT_MODE, 'cyber-seat-custody');
  assert.deepEqual([...SEAT_SLOT_CLIS].sort(), ['agy', 'claude', 'codex', 'muse', 'vibe']);
});

test('R18: campaign manifests must carry the cyber seat mode', () => {
  const cyber = { version: 1, seatMode: 'cyber-seat-custody',
    seats: [{ seatId: 'claude', family: 'claude', authSource: 'seats/claude' }] };
  assert.equal(assertCyberManifest(cyber).seatMode, 'cyber-seat-custody');
  assert.throws(() => assertCyberManifest({ version: 1, seatMode: 'interim-file-copy', seats: [] }),
    /seat-mode-superseded/);
  assert.throws(() => assertCyberManifest({ version: 1, seats: [] }), /seat-manifest-required/);
  assert.throws(() => assertCyberManifest({ version: 1, seatMode: 'cyber-seat-custody',
    seats: [{ seatId: 'gemini', family: 'gemini', authSource: 'seats/gemini' }] }),
  /gemini-via-agy-required/);
});

test('R18: the copy-from-home path is removed', () => {
  assert.throws(() => assertNoAuthHome(['node', 'qualify-cross-cli.mjs', '--auth-home', '/home/x']),
    /auth-home-removed/);
  assert.equal(assertNoAuthHome(['node', 'qualify-cross-cli.mjs', '--seat-manifest', 'seats.json']), undefined);
});

test('R18: vendored adapters are digest-pinned, never re-implemented', async () => {
  const vendor = await vendoredDigest();
  for (const file of ['seat-bundle.js', 'cli-seat-import.js', 'agy-cli-import.js']) {
    const bytes = fs.readFileSync(new URL(`./xcli-seat-vendor/${file}`, import.meta.url));
    assert.equal(sha256(bytes), vendor.outputs[file], `vendored ${file} matches its pin`);
  }
  assert.equal(vendor.repo, 'rhanka/sentropic');
  assert.match(vendor.ref, /^[0-9a-f]{40}$/);
  const direct = await import('./xcli-seat-vendor/seat-bundle.js');
  assert.equal(validateSeatBundle, direct.validateSeatBundle, 'the bridge re-exports the vendored validator');
});

const consumerBundle = (overrides = {}) => ({
  identity: { schemaVersion: 1, seatRef: 'codex', refreshFamilyRef: 'family-seat-1',
    ownerScope: 'owner', cli: 'codex', packageProviderId: 'codex',
    issuingClientRef: 'codex-cli', endpointFamily: 'codex',
    credentialFormatVersion: 'v1', os: 'linux' },
  provenance: { enrollmentSource: 'cli', accountBinding: 'binding-1', entitlementClass: 'seat' },
  authority: 'consumer', credentialClass: 'access-only',
  lifecycle: { epoch: 1, generation: 0, operationId: 'op-1',
    issuedAt: '2026-11-01T00:00:00Z', localExpiryPolicy: 'provider', refreshAuthority: 'none' },
  meshUse: { kind: 'access', accessRef: 'ref-1' },
  ...overrides,
});

test('R18: vendored bundle validation accepts and refuses without re-implementation', () => {
  assert.equal(validateSeatBundle(consumerBundle()).ok, true);
  const escalated = validateSeatBundle(consumerBundle({ canonical: { kind: 'static-key-material', materialRef: 'x' } }));
  assert.equal(escalated.ok, false);
  assert.equal(escalated.code, 'authority-escalation');
});

test('R18: agy maps only through the exact cloud-code tuple, never gemini', () => {
  const base = { packageProviderId: 'cloud-code', packageAccountTransport: 'cloud-code',
    issuingClientRef: 'agy-cli', endpointFamily: 'antigravity', ownerScope: 'owner',
    seatRef: 'agy-1', accountBinding: 'binding-1' };
  assert.deepEqual(translateAgySeatToApplication({ ...base,
    requestedTargetProviderId: 'cloudcode-pa', requestedTransportProviderId: 'antigravity' }),
  { transportProviderId: 'antigravity', targetProviderId: 'cloudcode-pa', productAccountSource: 'antigravity' });
  try {
    translateAgySeatToApplication({ ...base,
      requestedTargetProviderId: 'gemini', requestedTransportProviderId: 'cloud-code' });
    assert.fail('the gemini route must refuse');
  } catch (error) { assert.equal(error.code, 'mixed-tuple'); }
});

test('R18: seat envelopes materialise allowlisted files only, with a metadata-only receipt', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-cyber-seat-'));
  try {
    const secret = 'SEAT_USE_CODEX_00';
    const envelope = { bundle: consumerBundle(),
      files: { '.codex/auth.json': Buffer.from('{"token":"canary-zz9"}').toString('base64') } };
    const result = materialiseSeatEnvelopes({ seatSet: 'codex', slotManifest: {
      version: 1, environment: SEAT_ENVIRONMENT,
      seats: [{ seatId: 'codex', cli: 'codex', slot: '00', secret,
        candidateSecret: 'SEAT_CANDIDATE_CODEX_00', useSecret: secret }] },
    secrets: { [secret]: JSON.stringify(envelope) }, baseDir: dir });
    const home = join(dir, 'seats', 'codex');
    const written = fs.readFileSync(join(home, '.codex/auth.json'), 'utf8');
    assert.equal(written, '{"token":"canary-zz9"}');
    assert.equal(fs.statSync(join(home, '.codex/auth.json')).mode & 0o777, 0o600);
    assert.ok(!JSON.stringify(result.receipt).includes('canary-zz9'), 'the receipt carries names only, never bytes');
    assert.equal(result.receipt.seats[0].seatId, 'codex');
    assert.equal(result.manifest.seatMode, 'cyber-seat-custody');
    assert.throws(() => materialiseSeatEnvelopes({ seatSet: 'codex',
      slotManifest: { version: 1, environment: SEAT_ENVIRONMENT, seats: [] },
      secrets: {}, baseDir: dir }), /seat-unknown/);
    assert.throws(() => materialiseSeatEnvelopes({ seatSet: 'codex', slotManifest: {
      version: 1, environment: SEAT_ENVIRONMENT,
      seats: [{ seatId: 'codex', cli: 'codex', slot: '00', secret,
        candidateSecret: 'SEAT_CANDIDATE_CODEX_00', useSecret: secret }] },
    secrets: { [secret]: 'not-json' }, baseDir: dir }), /seat-bundle-invalid/);
    assert.throws(() => materialiseSeatEnvelopes({ seatSet: 'codex', slotManifest: {
      version: 1, environment: SEAT_ENVIRONMENT,
      seats: [{ seatId: 'codex', cli: 'codex', slot: '00', secret,
        candidateSecret: 'SEAT_CANDIDATE_CODEX_00', useSecret: secret }] },
    secrets: { [secret]: JSON.stringify({ bundle: consumerBundle(),
      files: { '.codex/config.toml': Buffer.from('x').toString('base64') } }) }, baseDir: dir }),
    /seat-file-not-allowlisted/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('R18: the fixed seat-load helper validates from a private FD with names-only output', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-seat-load-'));
  try {
    const slots = join(dir, 'slots.json');
    fs.writeFileSync(slots, JSON.stringify({ version: 1, environment: SEAT_ENVIRONMENT,
      seats: [{ seatId: 'codex', cli: 'codex', slot: '00', secret: 'SEAT_CODEX_00',
        candidateSecret: 'SEAT_CANDIDATE_CODEX_00', useSecret: 'SEAT_USE_CODEX_00' }] }));
    const envelope = join(dir, 'envelope.json');
    fs.writeFileSync(envelope, JSON.stringify({ bundle: consumerBundle(),
      files: { '.codex/auth.json': Buffer.from('{"token":"canary-zz9"}').toString('base64') } }));
    const load = new URL('./xcli-seat-load.mjs', import.meta.url).pathname;
    const good = spawnSync(process.execPath, [load, '--seat', 'codex', '--slot-manifest', slots],
      { input: fs.readFileSync(envelope, 'utf8'), encoding: 'utf8', timeout: 15000 });
    assert.equal(good.status, 0, good.stderr);
    const receipt = JSON.parse(good.stdout);
    assert.equal(receipt.kind, 'CredentialProvisioningReceiptV1');
    assert.equal(receipt.useSecret, 'SEAT_USE_CODEX_00');
    assert.ok(!good.stdout.includes('canary-zz9'), 'names only, never bytes');
    const bad = spawnSync(process.execPath, [load, '--seat', 'codex', '--slot-manifest', slots],
      { input: 'not-json', encoding: 'utf8', timeout: 15000 });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /seat-bundle-invalid:codex/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('R18: claude MCP-approval exhaustion fails with a typed reason, never a bare deadline', () => {
  assert.equal(classifyApprovalExhaustion({ cli: 'claude', presses: 6, limit: 5, mcpLoaded: false }),
    'claude-mcp-approval-unresolved');
  assert.equal(classifyApprovalExhaustion({ cli: 'claude', presses: 6, limit: 5, mcpLoaded: true }), undefined);
  assert.equal(classifyApprovalExhaustion({ cli: 'claude', presses: 2, limit: 5, mcpLoaded: false }), undefined);
});
