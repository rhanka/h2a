// R38 (owner 16/11): a LOCAL test must not depend on llm-mesh enrollment.
// The `local-login` gate decides on the presence of the allowlisted login
// files under the (real) home only; the mesh gate stays the default for the
// trusted-lane campaign. Tests use synthetic fixture homes only — never the
// real HOME, never the real mesh store, never real secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildSeatEnvelope } from './xcli-seat-provision.mjs';
import { argsFor } from './qualify-cross-cli.mjs';

const CANARY = 'canary-fixture-zz9';

function syntheticHome(files) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-local-seats-'));
  for (const [rel, content] of Object.entries(files)) {
    const file = join(dir, rel);
    fs.mkdirSync(join(dir, rel.split('/').slice(0, -1).join('/')), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, content, { mode: 0o600 });
  }
  return dir;
}

function claudeHome() {
  return syntheticHome({
    '.claude/.credentials.json': JSON.stringify({ claudeAiOauth: { accessToken: CANARY } }),
    '.claude.json': JSON.stringify({ oauthAccount: { accountId: 'synthetic' },
      hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.325',
      projects: { '/owner/old': { hasTrustDialogAccepted: true } } }),
  });
}

function museHome() {
  return syntheticHome({
    '.config/muse/auth.json': JSON.stringify({ token: CANARY }),
    '.config/muse/trust.json': JSON.stringify({ schema_version: 1,
      projects: { '/owner/old': { decision: 'trusted' } } }),
  });
}

const stubAccounts = (...entries) => ({
  listAccounts: async () => entries.map(([provider, accountId]) =>
    ({ accountId, providerId: provider, status: 'active',
      createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' })),
});

test('R38: a local-login claude seat provisions with no mesh facade at all', async () => {
  const homeDir = claudeHome();
  try {
    const built = await buildSeatEnvelope({ seatId: 'claude', slot: { slot: '00' },
      homeDir, gate: 'local-login', cliVersions: { claude: '2.1.325' } });
    assert.equal(built.source.meshGate, 'local-login-present');
    assert.deepEqual(built.files, ['.claude.json', '.claude/.credentials.json'].sort());
    assert.equal(built.source.onboardingStatus, 'present',
      'the onboarding capture proceeds under the local binding');
    assert.ok(!built.serialized.includes(CANARY), 'no secret bytes in the serialized envelope');
    assert.ok(!JSON.stringify(built.source).includes(CANARY), 'sources carry names only');
  } finally { fs.rmSync(homeDir, { recursive: true, force: true }); }
});

test('R38: a local-login muse seat provisions with no mesh facade at all', async () => {
  const homeDir = museHome();
  try {
    const built = await buildSeatEnvelope({ seatId: 'muse', slot: { slot: '00' },
      homeDir, gate: 'local-login', cliVersions: { muse: '1.4.20' } });
    assert.equal(built.source.meshGate, 'local-login-present');
    assert.deepEqual(built.files, ['.config/muse/auth.json']);
    assert.equal(built.source.onboardingStatus, 'present');
  } finally { fs.rmSync(homeDir, { recursive: true, force: true }); }
});

test('R38: local-login ignores an enrolled mesh account — the login file decides', async () => {
  const homeDir = syntheticHome({});
  try {
    await assert.rejects(
      buildSeatEnvelope({ seatId: 'claude', slot: { slot: '00' }, homeDir,
        gate: 'local-login', meshFacade: stubAccounts(['claude-code', 'acct-enrolled']),
        cliVersions: { claude: '2.1.325' } }),
      /login-source-missing:claude:\.claude\/\.credentials\.json/,
      'an enrolled account must not substitute for a missing login file');
  } finally { fs.rmSync(homeDir, { recursive: true, force: true }); }
});

test('R38: the mesh gate stays the default and still refuses without enrollment', async () => {
  const homeDir = claudeHome();
  try {
    await assert.rejects(
      buildSeatEnvelope({ seatId: 'claude', slot: { slot: '00' }, homeDir,
        meshFacade: stubAccounts(), cliVersions: { claude: '2.1.325' } }),
      /seat-not-enrolled-in-llm-mesh:claude/);
  } finally { fs.rmSync(homeDir, { recursive: true, force: true }); }
});

test('R38: local-login refuses seats without a local login source', async () => {
  const homeDir = syntheticHome({ '.vibe/MISTRAL_API_KEY': CANARY });
  try {
    await assert.rejects(
      buildSeatEnvelope({ seatId: 'vibe', slot: { slot: '00' }, homeDir, gate: 'local-login' }),
      /local-seats-unsupported:vibe/);
  } finally { fs.rmSync(homeDir, { recursive: true, force: true }); }
});

test('R38: seat models — claude default (never Opus), muse-ember, gemini-4-argon-low', () => {
  const claudeArgs = argsFor('claude', 'prompt');
  assert.ok(!claudeArgs.includes('--model') && !JSON.stringify(claudeArgs).toLowerCase().includes('opus'),
    'claude keeps its default model');
  const museArgs = argsFor('muse', 'prompt');
  assert.deepEqual(museArgs, ['--no-session-log', '--model', 'muse-ember', 'prompt']);
  const agyArgs = argsFor('agy', 'prompt', { nativeCliVersion: '1.5.9' });
  assert.ok(agyArgs.includes('--model') && agyArgs[agyArgs.indexOf('--model') + 1] === 'gemini-4-argon-low',
    'agy uses gemini-4-argon-low');
});
