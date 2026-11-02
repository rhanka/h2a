// R23 RED: every bench seat is sourced from the llm-mesh account store —
// the enrolled account is the seat of record, never the OS keyring and
// never a MISTRAL_API_KEY requirement. vibe bytes come from the mesh
// mistral-vibe account (acquire/release through the public facade);
// claude/codex/muse/agy bytes stay the live CLI login files (the same
// stores the mesh CLI-import legs read), gated on the mesh enrollment.
// A CLI with no enrolled account refuses names-only as
// seat-not-enrolled-in-llm-mesh:<cli> with the exact enroll command (the
// script never enrolls). Tests use synthetic stub facades only — never the
// real keyring, never real secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

let meshSeats = null;
try { meshSeats = await import('./xcli-llm-mesh-seats.mjs'); }
catch { meshSeats = null; }

function requireModule() {
  assert.ok(meshSeats, 'xcli-llm-mesh-seats.mjs exists and imports');
  return meshSeats;
}

const stubMesh = ({ accounts = [], key = 'mesh-key-fixture', failList = null, failAcquire = null } = {}) => {
  const calls = { acquire: [], release: 0 };
  const facade = {
    listAccounts: async () => {
      if (failList) throw failList;
      return accounts;
    },
    acquire: async (input) => {
      calls.acquire.push(input);
      if (failAcquire) throw failAcquire;
      return { material: { accessToken: key }, release: async () => { calls.release++; } };
    },
  };
  return { facade, calls };
};

const meshAccount = (provider, accountId = `acct-${provider}-01`) => ({
  accountId, providerId: provider, status: 'active',
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
});

test('R23: the mesh provider table pins the exact enroll command per CLI', () => {
  const { MESH_SEAT_PROVIDERS } = requireModule();
  assert.deepEqual(MESH_SEAT_PROVIDERS.vibe,
    { provider: 'mistral-vibe', enroll: 'h2a llm-mesh account enroll mistral-vibe' });
  assert.deepEqual(MESH_SEAT_PROVIDERS.agy,
    { provider: 'cloud-code', enroll: 'h2a llm-mesh account enroll cloud-code' });
  assert.deepEqual(MESH_SEAT_PROVIDERS.claude,
    { provider: 'claude-code', enroll: 'h2a llm-mesh account enroll claude-code' });
  assert.deepEqual(MESH_SEAT_PROVIDERS.codex,
    { provider: 'codex', enroll: 'h2a llm-mesh account enroll codex' });
  assert.deepEqual(MESH_SEAT_PROVIDERS.muse,
    { provider: 'muse', enroll: 'h2a llm-mesh account enroll muse' });
});

test('R23: the mesh owner scope follows the h2a convention', () => {
  const { meshOwnerScope } = requireModule();
  assert.equal(meshOwnerScope({ H2A_LLM_MESH_OWNER_SCOPE: 'owner' }), 'owner');
  assert.equal(meshOwnerScope({}), `cli:${hostname()}`);
});

test('R23: an enrolled account resolves by mesh provider', async () => {
  const { requireMeshAccount } = requireModule();
  const { facade } = stubMesh({ accounts: [
    meshAccount('codex'), meshAccount('mistral-vibe', 'acct-mistral-vibe-9')] });
  const found = await requireMeshAccount({ cli: 'vibe', facade, ownerScope: 'owner' });
  assert.equal(found.accountId, 'acct-mistral-vibe-9');
  assert.equal(found.provider, 'mistral-vibe');
  assert.equal(found.meshGate, 'enrolled');
});

test('R23: no enrolled account refuses names-only with the exact enroll command', async () => {
  const { requireMeshAccount } = requireModule();
  const { facade, calls } = stubMesh({ accounts: [meshAccount('codex')] });
  const error = await requireMeshAccount({ cli: 'vibe', facade, ownerScope: 'owner' })
    .then(() => null, (err) => err);
  assert.ok(error instanceof Error, 'refusal is an error');
  assert.equal(error.message, 'seat-not-enrolled-in-llm-mesh:vibe');
  assert.equal(error.enroll, 'h2a llm-mesh account enroll mistral-vibe');
  assert.deepEqual(calls.acquire, [], 'the script never acquires without enrollment');
});

test('R23: an unreadable mesh store refuses with the typed store cause', async () => {
  const { requireMeshAccount } = requireModule();
  const denied = new Error('denied');
  denied.code = 'EROFS';
  const { facade } = stubMesh({ failList: denied });
  const error = await requireMeshAccount({ cli: 'agy', facade, ownerScope: 'owner' })
    .then(() => null, (err) => err);
  assert.equal(error.message, 'llm-mesh-store-unreachable:agy');
  assert.equal(error.cause, 'EROFS');
});

test('R23: an unknown CLI refuses before touching the mesh', async () => {
  const { requireMeshAccount } = requireModule();
  const { facade, calls } = stubMesh({ accounts: [] });
  await assert.rejects(requireMeshAccount({ cli: 'gemini', facade, ownerScope: 'owner' }),
    /seat-unknown:gemini/);
  assert.deepEqual(calls.acquire, [], 'no mesh call for an unknown CLI');
});

test('R23: the vibe key is acquired with the mistral serving pair and released', async () => {
  const { acquireVibeKey } = requireModule();
  const { facade, calls } = stubMesh({ key: '  mesh-vibe-key-1  ' });
  const key = await acquireVibeKey({ facade, ownerScope: 'owner', accountId: 'acct-mistral-vibe-9' });
  assert.equal(key, 'mesh-vibe-key-1');
  assert.deepEqual(calls.acquire, [{ accountId: 'acct-mistral-vibe-9', ownerScopeRef: 'owner',
    targetProviderId: 'mistral', transportProviderId: 'mistral-vibe' }]);
  assert.equal(calls.release, 1, 'the lease is released after projection');
});

test('R23: an empty or multiline mesh token is never projected', async () => {
  const { acquireVibeKey } = requireModule();
  for (const key of ['', '  ', 'abc\ndef']) {
    const { facade, calls } = stubMesh({ key });
    await assert.rejects(acquireVibeKey({ facade, ownerScope: 'owner', accountId: 'a' }),
      /mesh-seat-unprojectable:vibe/);
    assert.equal(calls.release, 1, 'the lease is released even when projection refuses');
  }
});

test('R23: a failed acquire refuses names-only', async () => {
  const { acquireVibeKey } = requireModule();
  const { facade } = stubMesh({ failAcquire: new Error('no_account') });
  await assert.rejects(acquireVibeKey({ facade, ownerScope: 'owner', accountId: 'a' }),
    /llm-mesh-acquire-failed:vibe/);
});

// R25: the bench sources seats from the store h2a actually uses at runtime —
// EncryptedFileKeyring at SENTROPIC_LLM_MESH_KEYRING_DIR ??
// ~/.sentropic/llm-mesh-keyring, opened through the same createLlmMeshFacade
// API the gateway uses (createCliLlmMeshFacade: mode cli +
// legacyAccountOwnerScopeRef). The store is explicit: keyringDir wins over
// the environment, the environment wins over the compiled default. Fixtures
// below are synthetic records written through the REAL keyring API into temp
// dirs — never the owner store, never real secrets.
const SYNTH_SCOPE = 'test-scope-r25';
const SYNTH_PROVIDER = 'mistral-vibe';

async function syntheticMeshStore({ scope = SYNTH_SCOPE, provider = SYNTH_PROVIDER,
  accountId = 'acct-synth-r25-1' } = {}) {
  const { EncryptedFileKeyring } = await import('@sentropic/llm-mesh/node');
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-mesh-r25-'));
  const keyring = new EncryptedFileKeyring(dir);
  const now = '2026-11-02T00:00:00.000Z';
  await keyring.setSecret('sentropic-llm-mesh:accounts:index', JSON.stringify([accountId]));
  await keyring.setSecret(`sentropic-llm-mesh:${accountId}:public`, JSON.stringify({
    accountId, providerId: provider, status: 'active', createdAt: now, updatedAt: now,
    account: { ownerScopeRef: scope, transportProviderId: provider, targetProviderId: 'mistral' },
  }));
  await keyring.setSecret(`sentropic-llm-mesh:${accountId}:envelope`, JSON.stringify({
    accountId, accessToken: 'synthetic-access-token', refreshToken: 'synthetic-refresh-token',
    expiresAt: '2030-01-01T00:00:00.000Z',
  }));
  return { dir, accountId };
}

async function withEnv(key, value, fn) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try { return await fn(); }
  finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

test('R25: createMeshSeatFacade honors an explicit keyringDir over the environment', async () => {
  const { createMeshSeatFacade, requireMeshAccount } = requireModule();
  const populated = await syntheticMeshStore();
  const emptyDir = fs.mkdtempSync(join(tmpdir(), 'xcli-mesh-r25-empty-'));
  try {
    await withEnv('SENTROPIC_LLM_MESH_KEYRING_DIR', emptyDir, async () => {
      // The ambient store is empty: without the explicit dir the seat refuses.
      const ambient = await createMeshSeatFacade({ ownerScope: SYNTH_SCOPE });
      await assert.rejects(requireMeshAccount({ cli: 'vibe', facade: ambient, ownerScope: SYNTH_SCOPE }),
        /seat-not-enrolled-in-llm-mesh:vibe/);
      // The explicit store decides: the same API finds the synthetic account.
      const explicit = await createMeshSeatFacade({ ownerScope: SYNTH_SCOPE, keyringDir: populated.dir });
      const found = await requireMeshAccount({ cli: 'vibe', facade: explicit, ownerScope: SYNTH_SCOPE });
      assert.equal(found.accountId, populated.accountId);
      assert.equal(found.provider, SYNTH_PROVIDER);
      assert.equal(found.meshGate, 'enrolled');
    });
  } finally {
    fs.rmSync(populated.dir, { recursive: true, force: true });
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});

test('R25: a store failure names the exact failing mesh call', async () => {
  const { requireMeshAccount } = requireModule();
  const denied = new Error('read-only file system');
  denied.code = 'EROFS';
  denied.stack = [
    'Error: EROFS: read-only file system, chmod',
    '    at async chmod (node:internal/fs/promises)',
    '    at async EncryptedFileKeyring.readMasterKey (llm-mesh/dist/node/keyring/encrypted-file-keyring.js)',
    '    at async EncryptedFileKeyring.getSecret (llm-mesh/dist/node/keyring/encrypted-file-keyring.js)',
    '    at async LocalAccountTransportService.listAccounts (llm-mesh/dist/service/local-account-transport-service.js)',
  ].join('\n');
  const { facade } = stubMesh({ failList: denied });
  const error = await requireMeshAccount({ cli: 'agy', facade, ownerScope: 'owner' })
    .then(() => null, (err) => err);
  assert.equal(error.message, 'llm-mesh-store-unreachable:agy');
  assert.equal(error.cause, 'EROFS');
  assert.equal(error.meshCall, 'EncryptedFileKeyring.readMasterKey',
    'the refusal names the exact mesh call that insists on writing');
});

// R25 upstream pin (h2a/llm-mesh bug report): a pure-read listAccounts mutates
// the store — EncryptedFileKeyring.readMasterKey runs mkdir+chmod on every
// getSecret, and restorePersistedAccounts claims missing owner scopes with a
// write. Until the mesh ships a read-only open path, a read-only mount
// (EROFS on chmod) fails the bench and the conductor must bind the runtime
// keyring writable. This test pins the mechanism: it flips red the day the
// mesh stops writing on reads, signalling the ISO_RW can go.
test('R25: a pure-read listAccounts mutates the store (upstream write-on-read pin)', async () => {
  const { createMeshSeatFacade } = requireModule();
  const populated = await syntheticMeshStore();
  try {
    await withEnv('SENTROPIC_LLM_MESH_KEYRING_DIR', populated.dir, async () => {
      const facade = await createMeshSeatFacade({ ownerScope: SYNTH_SCOPE });
      const before = fs.statSync(populated.dir).ctimeMs;
      const accounts = await facade.listAccounts({ ownerScope: SYNTH_SCOPE });
      assert.ok(accounts.some((entry) => entry.providerId === SYNTH_PROVIDER),
        'the synthetic enrollment resolves through the real facade');
      const after = fs.statSync(populated.dir).ctimeMs;
      assert.ok(after > before, 'a pure read advances the store ctime (upstream chmod/write-on-read)');
    });
  } finally {
    fs.rmSync(populated.dir, { recursive: true, force: true });
  }
});
