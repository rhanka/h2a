import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('R32: the local six-seat roster retains OpenCode without fabricating an upstream envelope', async () => {
  const { LOCAL_SEAT_SET } = await import('./xcli-campaign-local.mjs');
  const { provisionSeats, shredFiles } = await import('./xcli-seat-provision.mjs');
  const { loadSeatManifest, resolveCampaignPair } = await import('./xcli-seats.mjs');
  const { onboardingLaunchBlock } = await import('./xcli-seat-import.mjs');
  const { campaignWakePolicy } = await import('./xcli-wake-policy.mjs');
  assert.deepEqual(LOCAL_SEAT_SET.split(','), ['claude', 'codex', 'muse', 'agy', 'vibe', 'opencode']);
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-opencode-contract-'));
  try {
    let calls = 0;
    const result = await provisionSeats({ seatSet: 'opencode', mode: 'local', allowUnavailableSeats: true,
      homeDir: join(root, 'missing-home'), outBase: root,
      meshFacade: { listAccounts: () => { calls++; throw new Error('must not read credentials'); } } });
    const manifest = loadSeatManifest(result.manifestFile);
    assert.equal(manifest.seats[0].family, 'opencode');
    assert.equal(onboardingLaunchBlock(manifest.seats[0]), 'llm-mesh-seat-contract-unavailable:opencode');
    assert.equal(resolveCampaignPair(manifest, 'opencode:opencode').receiver, 'opencode');
    assert.equal(calls, 0);
    assert.equal(result.sources[0].contract.enrollmentCommand, null, 'no unsupported owner command is invented');
    assert.deepEqual(result.seats, [], 'no fake provisioning receipt');
    assert.deepEqual(shredFiles([result.outDir]), []);
    assert.equal(fs.existsSync(result.outDir), false);
    assert.equal(campaignWakePolicy('opencode').category, 'non-native');
    assert.equal(campaignWakePolicy('opencode').boundMs, 10000);
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
    assert.equal(config.permission.bash, 'ask');
    assert.equal(config.permission.other_tool, 'deny');
    assert.deepEqual(Object.keys(config.permission).filter(k => k.startsWith('h2a_')).sort(), [...OPENCODE_TOOLS].sort());
    for (const tool of OPENCODE_TOOLS) {
      assert.equal(config.permission[tool], 'allow');
      await hooks['tool.execute.before']({ tool }, {});
    }
    await assert.rejects(hooks['tool.execute.before']({ tool: 'h2a_h2a_run' }, {}), /h2a-tool-out-of-scope/);
    await hooks['tool.execute.before']({ tool: 'bash' }, {});
    const rendered = openCodeCellConfig({ command: '/private/h2a', args: ['mcp-serve'] }, plugin);
    assert.deepEqual(rendered.mcp.h2a, { type: 'local', command: ['/private/h2a', 'mcp-serve'], enabled: true });
    assert.deepEqual(rendered.plugin, [pathToFileURL(plugin).href]);
    assert.equal(rendered.mcpServers, undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
