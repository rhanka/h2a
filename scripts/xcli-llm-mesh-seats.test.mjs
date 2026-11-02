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
import { hostname } from 'node:os';
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
