import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { wipeSecrets } from './xcli-lab.mjs';
import { onboardingLaunchBlock } from './xcli-seat-import.mjs';
import { blockingScreen, startupKey, cellMcpConfigText, argsFor } from './qualify-cross-cli.mjs';

test('R31: reviewed Agy receives only exact h2a tool grants in session settings', () => {
  const prompt = 'qualification prompt';
  const args = argsFor('agy', prompt, { nativeCliVersion: '1.5.2' });
  assert.equal(args[0], '--settings');
  assert.deepEqual(JSON.parse(args[1]), { permissions: { allow: [
    'mcp(h2a/h2a_identity_status)', 'mcp(h2a/h2a_inbox)', 'mcp(h2a/h2a_send)',
  ] } });
  assert.deepEqual(args.slice(2), ['--model', 'gemini-3.8-flash-low', '--prompt-interactive', prompt]);
  for (const version of [undefined, '1.4.12', '1.5.3']) {
    assert.deepEqual(argsFor('agy', prompt, { nativeCliVersion: version }),
      ['--prompt-interactive', prompt], 'unknown or legacy schemas do not receive unreviewed policy');
  }
  assert.deepEqual(argsFor('vibe', prompt, { nativeCliVersion: '1.5.2' }), [prompt]);
});

test('R31: Vibe approves only the three bench tools on its h2a server', async () => {
  const { parseForESLint, getStaticTOMLValue } = await import('toml-eslint-parser');
  const config = getStaticTOMLValue(parseForESLint(cellMcpConfigText('vibe', { command: 'h2a', args: ['mcp-serve'] })).ast);
  assert.deepEqual(config.tools, {
    h2a_h2a_identity_status: { permission: 'always' },
    h2a_h2a_inbox: { permission: 'always' },
    h2a_h2a_send: { permission: 'always' },
  });
  assert.equal(config.bypass_tool_permissions, undefined);
  assert.equal(config.tools.bash, undefined);
  assert.equal(config.tools.other_h2a_send, undefined);
  assert.equal(config.enable_subagents, false);
  assert.equal(config.enable_background_processes, false);
  assert.equal(config.mcp_servers[0].enable_subagents, undefined);
  assert.equal(config.mcp_servers[0].enable_background_processes, undefined);
  assert.equal(config.mcp_servers.length, 1);
  assert.equal(config.mcp_servers[0].name, 'h2a');
});

test('R30: Vibe model tool approval is typed and never mistaken for MCP server approval', () => {
  const screen = 'Use only h2a MCP tools.\nWaiting for approval to run mcp.h2a_identity_status\n' +
    'Permission for tool mcp.h2a_identity_status\n1. Allow once\n2. Allow for this session\n3. Always allow\n4. Deny\nEnter confirm';
  assert.equal(blockingScreen(screen), 'tool-approval-required');
  assert.equal(startupKey(screen, 'vibe'), undefined);
});

test('R30: wipe removes Vibe immutable plugin directories without following symlinks', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-wipe-'));
  const cell = join(root, 'cell'), outside = join(root, 'outside');
  const plugin = join(cell, 'home/.vibe/plugins/package/skills');
  fs.mkdirSync(plugin, { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(join(plugin, 'plugin.json'), 'synthetic');
  fs.writeFileSync(join(outside, 'sentinel'), 'synthetic');
  fs.symlinkSync(outside, join(plugin, 'external'));
  fs.chmodSync(plugin, 0o500);
  fs.chmodSync(outside, 0o500);
  try {
    assert.deepEqual(wipeSecrets([cell]), []);
    assert.equal(fs.existsSync(cell), false);
    assert.equal(fs.existsSync(join(outside, 'sentinel')), true);
    assert.equal(fs.statSync(outside).mode & 0o777, 0o500);
  } finally {
    if (fs.existsSync(plugin)) fs.chmodSync(plugin, 0o700);
    fs.chmodSync(outside, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('R30: an unreviewed Agy version remains blocked with its exact external cause', () => {
  assert.equal(onboardingLaunchBlock(null), undefined);
  assert.equal(onboardingLaunchBlock(undefined), undefined);
  const seat = { family: 'agy', onboarding: { status: 'absent', gate: { eligible: false },
    captureRefusal: { code: 'onboarding-version-unreviewed', nativeCliVersion: '9.9.9',
      reviewedNativeCliVersions: ['1.4.12', '1.5.2'] } } };
  assert.equal(onboardingLaunchBlock(seat), 'onboarding-version-unreviewed:agy:9.9.9');
  assert.equal(onboardingLaunchBlock({ family: 'agy', onboarding: { gate: { eligible: false } } }), 'onboarding-required');
});

test('R30: provisioning carries the published Agy version refusal through the manifest', async () => {
  const { provisionSeats, shredFiles } = await import('./xcli-seat-provision.mjs');
  const { canonicalAgyJetskiBytes, AGY_REQUIRED_COMPLETED_STEPS } = await import('./xcli-seat-vendor/seat-onboarding.js');
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-agy-version-'));
  const home = join(root, 'home');
  fs.mkdirSync(join(home, '.gemini/antigravity-cli'), { recursive: true });
  fs.writeFileSync(join(home, '.gemini/antigravity-cli/antigravity-oauth-token'), 'synthetic');
  fs.writeFileSync(join(home, '.gemini/antigravity-cli/jetski_state.pbtxt'),
    canonicalAgyJetskiBytes('1.4.12', AGY_REQUIRED_COMPLETED_STEPS['1.4.12']));
  let held;
  try {
    held = await provisionSeats({ seatSet: 'agy', mode: 'local', homeDir: home, outBase: root,
      cliVersions: { agy: '9.9.9' }, meshFacade: { listAccounts: async () => [{ providerId: 'cloud-code', accountId: 'synthetic-agy' }] } });
    const manifest = JSON.parse(fs.readFileSync(held.manifestFile, 'utf8'));
    assert.equal(held.sources[0].onboardingRefused, 'onboarding-shape-unverified');
    assert.equal(manifest.seats[0].onboarding.status, 'absent');
    assert.equal(onboardingLaunchBlock(manifest.seats[0]), 'onboarding-version-unreviewed:agy:9.9.9');
    assert.deepEqual(manifest.seats[0].onboarding.captureRefusal.reviewedNativeCliVersions, ['1.4.12', '1.5.2']);
  } finally {
    if (held) assert.deepEqual(shredFiles([held.outDir]), []);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('R30: per-category bounds preserve the native limit and the simulation controls', async () => {
  const policy = await import('./xcli-wake-policy.mjs');
  assert.equal(policy.wakeBoundForDelivery(true), 3000);
  assert.equal(policy.wakeBoundForDelivery(false), 10000);
  assert.throws(() => policy.wakeBoundForDelivery(undefined));
  for (const cli of ['claude', 'codex', 'muse', 'agy', 'vibe']) {
    assert.deepEqual(policy.campaignWakePolicy(cli), { cli, category: 'non-native', boundMs: 10000,
      transport: 'signed-terminal-prompt', nativeMessageDelivery: false,
      evidence: ['packages/h2a/src/runtime/drive/inbox-wake.ts', 'packages/h2a/src/cli.ts:nativePtyBackchannelDriver',
        'scripts/xcli-wake-host.mjs:correlateWakeInput'] });
    assert.equal(policy.campaignWakePolicy(cli, { simulated: true }).boundMs, 3000);
  }
});

test('R30: the local parent funds the whole matrix instead of killing it after ten minutes', async () => {
  const { localCampaignTimeoutMs } = await import('./xcli-campaign-local.mjs');
  assert.equal(localCampaignTimeoutMs(14400000, 120000), 14685000);
  assert.throws(() => localCampaignTimeoutMs(0, 120000));
});

test('R30: Muse no-usage response requires a real model proof and records quota failures', async () => {
  const { runMuseAuthPrecheck } = await import('./xcli-auth-precheck.mjs');
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-auth-proof-'));
  const executable = join(root, 'muse');
  const seatDir = join(root, 'seat');
  fs.mkdirSync(join(seatDir, '.config/muse'), { recursive: true });
  fs.writeFileSync(join(seatDir, '.config/muse/auth.json'), 'synthetic');
  fs.writeFileSync(executable, `#!${process.execPath}
import fs from 'node:fs';
const authed = fs.existsSync(process.env.HOME + '/.config/muse/auth.json');
if (process.argv[2] === 'usage') {
  if (fs.existsSync(${JSON.stringify(join(root, 'bad-control'))})) { console.log('Subscription allowance'); process.exit(0); }
  if (!authed) { console.error('not logged in'); process.exit(1); }
  if (fs.existsSync(${JSON.stringify(join(root, 'invalid-login'))})) { console.error('not logged in'); process.exit(1); }
  console.log(JSON.stringify({allowance: null, reason: 'server_sent_no_usage', hint: 'no_allowance'}));
} else if (process.argv[2] === 'exec') {
  fs.appendFileSync(${JSON.stringify(join(root, 'calls'))}, 'model\\n');
  if (fs.existsSync(${JSON.stringify(join(root, 'quota'))})) { console.error('HTTP 429: usage limit reached; resets at 2026-11-09T00:00:00Z'); process.exit(1); }
  console.log(process.argv.at(-1).match(/H2A_AUTH_PROOF_[a-f0-9]+/)[0]);
} else process.exit(2);
`, { mode: 0o700 });
  try {
    const input = { seat: { family: 'muse', authSource: seatDir }, executable, root };
    const passed = await runMuseAuthPrecheck(input);
    assert.deepEqual(passed, { ok: true, modelCalls: 1, detail: 'model-response-accepted' });
    fs.writeFileSync(join(root, 'quota'), 'synthetic');
    const refused = await runMuseAuthPrecheck(input);
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, 'provider-quota');
    assert.equal(refused.modelCalls, 1);
    assert.deepEqual(refused.providerQuota, { observed: true, httpStatus: 429, resetAt: '2026-11-09T00:00:00.000Z' });
    assert.equal(fs.readFileSync(join(root, 'calls'), 'utf8'), 'model\nmodel\n');
    fs.writeFileSync(join(root, 'invalid-login'), 'synthetic');
    assert.deepEqual(await runMuseAuthPrecheck(input), { ok: false, reason: 'preflight-auth-unproven', modelCalls: 0 });
    fs.writeFileSync(join(root, 'bad-control'), 'synthetic');
    assert.deepEqual(await runMuseAuthPrecheck(input), { ok: false, reason: 'preflight-control-untrusted', modelCalls: 0 });
    assert.equal(fs.readFileSync(join(root, 'calls'), 'utf8'), 'model\nmodel\n', 'refused controls never reach a model');
    assert.deepEqual(fs.readdirSync(root).filter(name => name.startsWith('pre-')), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
