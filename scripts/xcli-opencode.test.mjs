import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('R33: the OpenCode seat rides the codex seat with its own login gate', async () => {
  const { LOCAL_SEAT_SET } = await import('./xcli-campaign-local.mjs');
  const { provisionSeats, shredFiles } = await import('./xcli-seat-provision.mjs');
  const { loadSeatManifest, resolveCampaignPair } = await import('./xcli-seats.mjs');
  const { onboardingLaunchBlock, parseCliSeatProfile } = await import('./xcli-seat-import.mjs');
  const { campaignWakePolicy } = await import('./xcli-wake-policy.mjs');
  const { OPENCODE_SEAT_MAPPING } = await import('./xcli-llm-mesh-seats.mjs');
  assert.deepEqual(LOCAL_SEAT_SET.split(','), ['claude', 'codex', 'muse', 'agy', 'vibe', 'opencode']);
  assert.throws(() => parseCliSeatProfile({ seatRef: 'opencode', ownerScope: 'synthetic-owner', cli: 'opencode',
    issuingClientRef: 'opencode-cli', endpointFamily: 'opencode', accountBinding: 'synthetic-account',
    entitlementClass: 'seat', epoch: 1, generation: 0, operationId: 'synthetic-opencode',
    issuedAt: '2026-11-07T00:00:00.000Z', accessKind: 'access', accessRef: 'synthetic-access' }),
  error => error.code === 'client-mismatch', 'the upstream consumer validator still refuses the unlisted CLI');
  assert.deepEqual(OPENCODE_SEAT_MAPPING, { cli: 'opencode', seat: 'codex',
    loginGateCode: 'owner-action:opencode-login', loginStaleSince: '2026-09-14',
    loginCommand: '/home/antoinefa/.opencode/bin/opencode auth login' },
  'the mapping holds the reviewed owner decision, the stale-login verdict and the exact absolute owner command');
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-opencode-mapping-'));
  try {
    await assert.rejects(provisionSeats({ seatSet: 'opencode', mode: 'dry-run', allowUnavailableSeats: true,
      homeDir: join(root, 'missing-home'), outBase: root,
      meshFacade: { listAccounts: async () => [{ providerId: 'codex', accountId: 'synthetic-codex-account' }] } }),
    /opencode-seat-mapping-local-only/, 'the protected upload lane still refuses OpenCode names-only');
    const result = await provisionSeats({ seatSet: 'opencode', mode: 'local', allowUnavailableSeats: true,
      homeDir: join(root, 'missing-home'), outBase: root,
      meshFacade: { listAccounts: async () => [{ providerId: 'codex', accountId: 'synthetic-codex-account' }] } });
    const manifest = loadSeatManifest(result.manifestFile);
    const seat = manifest.seats[0];
    assert.equal(seat.family, 'opencode');
    assert.equal(seat.mappedSeat, 'codex', 'the seat rides the existing codex seat');
    assert.equal(seat.ownerLogin.command, OPENCODE_SEAT_MAPPING.loginCommand);
    assert.equal(seat.onboarding.gate.code, OPENCODE_SEAT_MAPPING.loginGateCode);
    assert.equal(onboardingLaunchBlock(seat), OPENCODE_SEAT_MAPPING.loginGateCode);
    assert.equal(onboardingLaunchBlock({ family: 'opencode', onboarding: { status: 'present', gate: { eligible: true } } }),
      OPENCODE_SEAT_MAPPING.loginGateCode, 'no unreviewed manifest claim can open the OpenCode launch gate');
    assert.equal(resolveCampaignPair(manifest, 'opencode:opencode').receiver, 'opencode');
    assert.deepEqual(result.seats, [], 'no envelope is minted for the mapped seat');
    const source = result.sources.find(s => s.seatId === 'opencode');
    assert.equal(source.mappedSeat, 'codex');
    assert.equal(source.meshGate, 'enrolled');
    assert.equal(source.provider, 'codex');
    assert.deepEqual(source.files, [], 'no credential bytes are read for the mapped seat');
    assert.equal(source.ownerLogin.staleSince, OPENCODE_SEAT_MAPPING.loginStaleSince);
    assert.equal(source.ownerLogin.command, OPENCODE_SEAT_MAPPING.loginCommand);
    assert.deepEqual(shredFiles([result.outDir]), []);
    assert.equal(fs.existsSync(result.outDir), false);
    assert.equal(campaignWakePolicy('opencode').category, 'non-native');
    assert.equal(campaignWakePolicy('opencode').boundMs, 10000);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R33: without a codex account the OpenCode seat takes the codex seat refusal', async () => {
  const { provisionSeats } = await import('./xcli-seat-provision.mjs');
  const { loadSeatManifest } = await import('./xcli-seats.mjs');
  const { onboardingLaunchBlock } = await import('./xcli-seat-import.mjs');
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-opencode-unenrolled-'));
  try {
    const result = await provisionSeats({ seatSet: 'opencode', mode: 'local', allowUnavailableSeats: true,
      homeDir: join(root, 'missing-home'), outBase: root,
      meshFacade: { listAccounts: async () => [] } });
    const manifest = loadSeatManifest(result.manifestFile);
    const seat = manifest.seats[0];
    assert.equal(seat.mappedSeat, 'codex');
    assert.equal(seat.unavailableReason, 'seat-not-enrolled-in-llm-mesh:codex', 'the seat carries the codex seat state');
    assert.equal(onboardingLaunchBlock(seat), 'seat-not-enrolled-in-llm-mesh:codex');
    const source = result.sources.find(s => s.seatId === 'opencode');
    assert.equal(source.meshGate, 'not-enrolled');
    assert.equal(source.enroll, 'h2a llm-mesh account enroll codex', 'the owner command is the codex seat command');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R33: the opencode binary resolves by absolute path, never by PATH mutation', async () => {
  const { cliPath } = await import('./xcli-lab.mjs');
  const { probeCliVersion } = await import('./xcli-seat-provision.mjs');
  const { OPENCODE_SEAT_MAPPING } = await import('./xcli-llm-mesh-seats.mjs');
  assert.ok(OPENCODE_SEAT_MAPPING.loginCommand.startsWith('/home/antoinefa/.opencode/bin/opencode '),
    'the owner command uses the absolute binary path');
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-opencode-binary-'));
  try {
    const stub = join(root, 'opencode');
    fs.writeFileSync(stub, `#!/bin/sh\nprintf 'opencode 1.17.15\\n'\n`, { mode: 0o700 });
    process.env.XCLI_OPENCODE_BIN = stub;
    try {
      assert.equal(cliPath('opencode', '/nonexistent-dir-only'), stub,
        'the absolute path resolves with no PATH entry at all');
      assert.equal(probeCliVersion('opencode', { path: '' }), '1.17.15');
    } finally { delete process.env.XCLI_OPENCODE_BIN; }
    assert.equal(cliPath('codex', '/nonexistent-dir-only'), undefined,
      'the absolute fallback is confined to the opencode family');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('R32: OpenCode receives only the three h2a grants through a native plugin', async () => {
  const { openCodeCellConfig, openCodePluginSource, OPENCODE_TOOLS } = await import('./xcli-opencode.mjs');
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-opencode-'));
  try {
    const plugin = join(root, 'h2a-plugin.mjs');
    fs.writeFileSync(plugin, openCodePluginSource());
    const hooks = await (await import(pathToFileURL(plugin))).default({});
    assert.deepEqual(Object.keys(hooks).sort(), ['config', 'tool.execute.before']);
    const config = { permission: { bash: 'ask', other_tool: 'deny' } };
    await hooks.config(config);
    assert.equal(config.permission['*'], 'deny');
    assert.deepEqual(Object.keys(config.permission).filter(k => k.startsWith('h2a_')).sort(), [...OPENCODE_TOOLS].sort());
    for (const tool of OPENCODE_TOOLS) {
      assert.equal(config.permission[tool], 'allow');
      await hooks['tool.execute.before']({ tool }, {});
    }
    for (const tool of ['bash', 'read', 'task', 'other_server_send', 'h2a_h2a_run'])
      await assert.rejects(hooks['tool.execute.before']({ tool }, {}), /h2a-tool-out-of-scope/);
    const rendered = openCodeCellConfig({ command: '/private/h2a', args: ['mcp-serve'] }, plugin);
    assert.deepEqual(rendered.mcp.h2a, { type: 'local', command: ['/private/h2a', 'mcp-serve'], enabled: true });
    assert.deepEqual(rendered.plugin, [pathToFileURL(plugin).href]);
    assert.equal(rendered.mcpServers, undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
