import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { chmodSync, cpSync, symlinkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { contracts as checkContracts } from './helpers/cleanse-contracts.mjs';
import { isolatedEnv } from './helpers/cleanse-artifact.mjs';
import { observeHosts, seedHosts } from './helpers/cleanse-hosts.mjs';
import { files } from './helpers/cleanse-lab.mjs';
import { mcpState, toolVisible } from './helpers/cleanse-host-state.mjs';
import YAML from 'yaml';

const put = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
const sink = { diagnostic() {} };
const contracts = (t, observations) => checkContracts(t, observations, { ledger: Object.fromEntries(observations.map(o => [o.id, { state: 'GREEN' }])) });
const known = { id: 'known', lot: 'L1', actual: false, expected: true, evidence: 'original' };

test('L0 contracts: only the committed state and exact failure signature are accepted', async () => {
  const { observeContract } = await import('../../../scripts/cleanse-contract-ledger.mjs');
  const { id, ...entry } = observeContract(known);
  const ledger = { [id]: entry }, messages = [], t = { diagnostic: message => messages.push(message) };
  checkContracts(t, [known], { ledger });
  for (const change of [{ actual: undefined }, { evidence: 'unexpected stale bytes' }, { expected: 'changed assertion' }]) {
    assert.throws(() => checkContracts(sink, [{ ...known, ...change }], { ledger }));
  }
  assert.throws(() => checkContracts(sink, []));
  assert.throws(() => checkContracts(sink, [{ ...known, actual: true }], { ledger }), /RED -> observed GREEN/);
  ledger[id] = { state: 'GREEN' };
  checkContracts(t, [{ ...known, actual: true }], { ledger });
  assert.throws(() => checkContracts(sink, [known], { ledger }), /GREEN -> observed RED/);
  assert.match(messages.join('\n'), /H2A_CLEANSE_CONTRACT/);
});

function fixture(t, options) {
  const root = mkdtempSync(join(tmpdir(), 'oracle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const a = { root, packages: join(root, 'payload'), env: isolatedEnv(root), version: '0.98.7', cli: join(root, 'candidate.cjs') };
  for (const path of ['hooks', 'skills', '.claude-plugin', '.codex-plugin', '.mcp.json']) {
    cpSync(new URL('../' + path, import.meta.url), join(a.packages, 'h2a', path), { recursive: true });
  }
  const resource = 'present-decision/assets/native-questions.md';
  put(join(a.packages, 'track/skills', resource), readFileSync(new URL('../../track/skills/' + resource, import.meta.url)));
  // A transport fixture for the oracle unit tests. The baseline file separately
  // exchanges MCP messages with the real installed candidate.
  put(a.cli, `#!${process.execPath}
const readline=require('node:readline');readline.createInterface({input:process.stdin}).on('line',line=>{
    const q=JSON.parse(line);if(q.id===undefined)return;
    const result=q.method==='initialize'?{protocolVersion:'2024-11-05',serverInfo:{name:'@sentropic/h2a',version:'0.98.7'},capabilities:{tools:{}}}:
      {tools:[{name:'h2a_status'}]};
    console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
  });`);
  chmodSync(a.cli, 0o700);
  symlinkSync(a.cli, join(a.root, 'bin/h2a'));
  const hosts = seedHosts(a, options);
  const legacy = new Map(hosts.map(h => [h.host, readFileSync(h.mcp, 'utf8')]));
  const skill = readFileSync(join(a.packages, 'h2a/skills/h2a-run/SKILL.md'), 'utf8');
  for (const h of hosts) {
    put(h.skill, h.format === 'markdown' ? skill : "prompt = '''\n" + skill.replace(/^---\n[\s\S]*?\n---\n/, '').trim() + "\n'''\n");
    put(h.resource, readFileSync(join(a.packages, 'track/skills', resource)));
    writeMcp(h, a, ['mcp-serve']);
    if (h.helper) for (const name of ['workspace-scope-guard.mjs', 'workspace-scope-shell.mjs', 'workspace-scope-state.mjs']) {
      put(join(dirname(h.helper), name), readFileSync(join(a.packages, 'h2a/hooks', name)));
    }
    if (h.hooks) {
      const command = [process.execPath, h.helper, '--host', h.host,
        ...(h.host === 'agy' ? ['--session-store', dirname(dirname(h.helper))] : ['--workspace', join(root, 'workspace')])]
        .map(arg => "'" + arg + "'").join(' ');
      const events = { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command }] }] };
      put(h.hooks, JSON.stringify({ ...(h.host === 'muse' ? { hooks: events } : { 'sentropic-h2a-workspace-scope': { enabled: true, ...events } }), fixture: 'third-party' }));
    }
    if (h.imported) put(h.imported, readFileSync(h.skill));
    if (h.registration) {
      const cache = join(h.root, 'plugins/cache/sentropic/h2a', a.version);
      cpSync(join(a.packages, 'h2a'), cache, { recursive: true });
      if (h.host === 'claude') put(h.registration, JSON.stringify({ version: 2, plugins: { 'h2a@sentropic': [{ scope: 'user', installPath: cache, version: a.version }] } }));
      else {
        const marketplace = join(h.root, 'local-marketplace');
        cpSync(join(a.packages, 'h2a'), join(marketplace, 'plugins/h2a'), { recursive: true });
        put(join(marketplace, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'sentropic', plugins: [{ name: 'h2a', source: { source: 'local', path: './plugins/h2a' } }] }));
        put(h.mcp, readFileSync(h.mcp, 'utf8').replace('source_type = "git"', 'source_type = "local"').replace('https://github.com/rhanka/h2a.git', marketplace).replace('ref = "main"', ''));
      }
    }
  }
  return { a, hosts, legacy };
}

function writeMcp(h, a, args) {
  const command = JSON.stringify(process.execPath), argv = JSON.stringify([a.cli, ...args]);
  if (h.mcp.endsWith('.toml')) put(h.mcp, readFileSync(h.mcp, 'utf8').replace(/^command = .*$/m, 'command = ' + command).replace(/^args = .*$/m, 'args = ' + argv));
  else if (h.mcp.endsWith('.yaml')) {
    const config = YAML.parse(readFileSync(h.mcp, 'utf8'));
    Object.assign(config.mcp_servers.h2a, { command: process.execPath, args: [a.cli, ...args] });
    put(h.mcp, YAML.stringify(config));
  }
  else {
    const config = JSON.parse(readFileSync(h.mcp));
    if (h.host === 'opencode') config.mcp.h2a = { ...config.mcp.h2a, command: [process.execPath, a.cli, ...args] };
    else config.mcpServers.h2a = { ...config.mcpServers.h2a, command: process.execPath, args: [a.cli, ...args] };
    put(h.mcp, JSON.stringify(config));
  }
}
const observation = async (f, host, family) => (await observeHosts(f.a, f.hosts)).find(o => o.id === host + ' installed ' + family);

test('L0 inventory: all frozen artifacts can be observed current', async t => {
  const f = fixture(t);
  writeMcp(f.hosts.find(h => h.host === 'vibe'), f.a,
    ['mcp-serve', '--auto-open', '--host', 'vibe', '--auto-upgrade', '--wake', 'auto']);
  const muse = f.hosts.find(h => h.host === 'muse'), hooks = JSON.parse(readFileSync(muse.hooks));
  hooks.hooks.PreToolUse[0].hooks[0].command = [process.execPath, muse.helper, '--host', 'muse'].map(JSON.stringify).join(' ');
  put(muse.hooks, JSON.stringify(hooks));
  const observations = await observeHosts(f.a, f.hosts);
  assert.equal(observations.length, 31);
  assert.deepEqual(observations.filter(o => o.actual !== o.expected), []);
  contracts(sink, observations);
  put(f.hosts.find(h => h.host === 'agy').imported, 'not TOML payload');
  assert.throws(() => observeHosts(f.a, f.hosts), 'malformed imported state cannot be current');
});

test('L0 MCP: version, echo, wrong protocol and duplicate routes cannot pass as the effective server', async t => {
  const f = fixture(t);
  const bad = [];
  for (const h of f.hosts) {
    writeMcp(h, f.a, ['version']);
    bad.push(await observation(f, h.host, 'MCP resolves activated prefix'));
    writeMcp(h, f.a, ['mcp-serve']);
  }
  const claude = f.hosts[0], config = JSON.parse(readFileSync(claude.mcp));
  config.mcpServers.h2a = { command: '/bin/echo', args: [f.a.cli, 'mcp-serve'] };
  put(claude.mcp, JSON.stringify(config));
  bad.push(await observation(f, 'claude', 'MCP resolves activated prefix'));
  writeMcp(claude, f.a, ['mcp-serve']);
  const duplicated = JSON.parse(readFileSync(claude.mcp));
  duplicated.mcpServers['h2a-shadow'] = duplicated.mcpServers.h2a;
  put(claude.mcp, JSON.stringify(duplicated));
  bad.push(await observation(f, 'claude', 'MCP resolves activated prefix'));
  delete duplicated.mcpServers['h2a-shadow'];
  put(claude.mcp, JSON.stringify(duplicated));
  put(f.a.cli, "console.log('not an MCP response');");
  bad.push(await observation(f, 'claude', 'MCP resolves activated prefix'));
  assert.deepEqual(bad.map(o => [o.id, o.actual]), bad.map(o => [o.id, false]));
  for (const o of bad) assert.throws(() => contracts(sink, [o]), 'changed MCP must fail the normal gate');
});

test('L0 hooks: comments, echo commands, disabled hooks and missing dependencies cannot pass', async t => {
  const f = fixture(t);
  const bad = [];
  for (const h of f.hosts.filter(h => h.hooks)) {
    const original = readFileSync(h.hooks, 'utf8');
    for (const value of [
      { fixture: 'third-party', note: h.helper },
      JSON.parse(original.replaceAll(process.execPath, '/bin/echo')),
      { ...JSON.parse(original), enabled: false },
    ]) {
      put(h.hooks, JSON.stringify(value));
      bad.push(await observation(f, h.host, 'selected hook registration'));
    }
    put(h.hooks, original);
    rmSync(join(dirname(h.helper), 'workspace-scope-state.mjs'));
    bad.push(await observation(f, h.host, 'selected helper bytes'));
  }
  assert.deepEqual(bad.map(o => [o.id, o.actual]), bad.map(o => [o.id, false]));
  for (const o of bad) assert.throws(() => contracts(sink, [o]));
});

test('L0 plugins: missing helpers and stale selected Codex sources cannot pass with a candidate cache', async t => {
  const f = fixture(t);
  const bad = [];
  for (const h of f.hosts.filter(h => h.registration)) {
    const helper = join(h.root, 'plugins/cache/sentropic/h2a', f.a.version, 'hooks/deny-manual-h2a-cli.mjs');
    const bytes = readFileSync(helper);
    rmSync(helper);
    bad.push(await observation(f, h.host, 'registered effective plugin cache'));
    put(helper, bytes);
  }
  const codex = f.hosts.find(h => h.host === 'codex');
  const mcp = join(codex.root, 'plugins/cache/sentropic/h2a', f.a.version, '.mcp.json');
  const mcpBytes = readFileSync(mcp);
  rmSync(mcp);
  bad.push(await observation(f, 'codex', 'registered effective plugin cache'));
  put(mcp, JSON.stringify({ mcpServers: { h2a: { command: '/stale-prefix/h2a', args: ['mcp-serve'] } } }));
  bad.push(await observation(f, 'codex', 'registered effective plugin cache'));
  put(mcp, mcpBytes);
  put(codex.mcp, readFileSync(codex.mcp, 'utf8').replace('source_type = "local"', 'source_type = "git"') + '\nref = "main"\n');
  bad.push(await observation(f, 'codex', 'registered effective plugin cache'));
  assert.deepEqual(bad.map(o => [o.id, o.actual]), bad.map(o => [o.id, false]));
  for (const o of bad) assert.throws(() => contracts(sink, [o]));
  const claude = f.hosts.find(h => h.host === 'claude');
  const asset = 'skills/h2a-run/assets/reference.bin';
  const cachedAsset = join(claude.root, 'plugins/cache/sentropic/h2a', f.a.version, asset);
  put(join(f.a.packages, 'h2a', asset), Buffer.from([0xff]));
  put(cachedAsset, Buffer.from([0xff]));
  assert.equal((await observation(f, 'claude', 'registered effective plugin cache')).actual, true);
  put(cachedAsset, Buffer.from([0xfe]));
  const staleAsset = await observation(f, 'claude', 'registered effective plugin cache');
  assert.equal(staleAsset.actual, false, 'distinct binary payloads must not collapse to the same UTF-8 replacement character');
  assert.throws(() => contracts(sink, [staleAsset]));
  rmSync(join(f.a.packages, 'h2a/.mcp.json'));
  assert.throws(() => observeHosts(f.a, f.hosts), /candidate payload missing required/);
});

test('L0 reviewers reproduction: version MCPs, echo hooks and incomplete unselected caches cannot yield 31 GREEN', async t => {
  const f = fixture(t);
  for (const h of f.hosts) {
    if (h.host === 'codex') put(h.mcp, f.legacy.get(h.host));
    writeMcp(h, f.a, ['version']);
    if (h.hooks) put(h.hooks, readFileSync(h.hooks, 'utf8').replaceAll(process.execPath, '/bin/echo'));
    if (h.registration) rmSync(join(h.root, 'plugins/cache/sentropic/h2a', f.a.version, 'hooks/deny-manual-h2a-cli.mjs'));
  }
  const observations = await observeHosts(f.a, f.hosts);
  assert.equal(observations.filter(o => o.actual === false).length, 12, 'eight MCPs, two hooks and two plugin sources/caches');
  assert.throws(() => contracts(sink, observations), 'the same composite must fail the normal npm gate');
});

test('L0 hooks: duplicate host and workspace options cannot redirect the selected hook', async t => {
  const f = fixture(t);
  for (const h of f.hosts.filter(h => h.hooks)) {
    const original = readFileSync(h.hooks, 'utf8');
    const config = JSON.parse(original);
    const command = (h.host === 'muse' ? config.hooks : config['sentropic-h2a-workspace-scope']).PreToolUse[0].hooks[0];
    const baseline = command.command;
    for (const extra of [' --host claude', ' --workspace /wrong-private-workspace', ' --session-store /wrong-private-store']) {
      command.command = baseline + extra;
      put(h.hooks, JSON.stringify(config));
      assert.equal((await observation(f, h.host, 'selected hook registration')).actual, false, h.host + extra);
    }
    put(h.hooks, original);
  }
});

test('L0 Agy: imported bytes must preserve the observed enabled or disabled selection', async t => {
  const f = fixture(t), h = f.hosts.find(h => h.host === 'agy');
  put(join(f.a.root, 'vendor-state/agy/enabled'), 'false');
  assert.equal((await observation(f, 'agy', 'observed Agy imported bytes')).actual, false);
  const disabled = fixture(t, { agyEnabled: false });
  assert.equal((await observation(disabled, 'agy', 'observed Agy imported bytes')).actual, true);
  put(join(disabled.a.root, 'vendor-state/agy/enabled'), 'true');
  assert.equal((await observation(disabled, 'agy', 'observed Agy imported bytes')).actual, false);
});

test('L0 plugins: the active plugin MCP must resolve and answer from the activated prefix', async t => {
  const f = fixture(t);
  // The separate direct MCP is healthy; only the active plugin route is stale.
  assert.equal((await observation(f, 'claude', 'registered effective plugin cache')).actual, true);
  rmSync(join(f.a.root, 'bin/h2a'));
  put(join(f.a.root, 'bin/h2a'), '#!' + process.execPath + '\nconsole.error("old wrong h2a MCP");process.exit(64);\n');
  chmodSync(join(f.a.root, 'bin/h2a'), 0o700);
  assert.equal((await observation(f, 'claude', 'MCP resolves activated prefix')).actual, true);
  assert.equal((await observation(f, 'claude', 'registered effective plugin cache')).actual, false);
});

test('L0 Vibe: disabling the selected MCP cannot pass with healthy candidate argv', async t => {
  const f = fixture(t), h = f.hosts.find(h => h.host === 'vibe');
  const original = readFileSync(h.mcp, 'utf8');
  assert.equal((await observation(f, 'vibe', 'MCP resolves activated prefix')).actual, true);
  put(h.mcp, original.replace('transport = "stdio"', 'transport = "stdio"\ndisabled = true'));
  const disabled = await observation(f, 'vibe', 'MCP resolves activated prefix');
  assert.equal(disabled.actual, false);
  assert.throws(() => contracts(sink, [disabled]));
});

test('L0 Vibe native state: enabled=false cannot conceal reactivation through disabled=false', async t => {
  const f = fixture(t, { vibeDisabled: true }), h = f.hosts.find(h => h.host === 'vibe');
  const selected = readFileSync(h.mcp, 'utf8');
  assert.equal((await observation(f, 'vibe', 'MCP resolves activated prefix')).actual, true);
  put(h.mcp, selected.replace('disabled = true', 'disabled = false\nenabled = false'));
  const changed = await observation(f, 'vibe', 'MCP resolves activated prefix');
  assert.equal(changed.actual, false, 'Vibe ignores enabled; disabled=false reactivates the server');
  assert.throws(() => contracts(sink, [changed]));
});

test('L0 Vibe native state: global and per-server tool filters cannot hide behind a healthy handshake', async t => {
  const f = fixture(t), h = f.hosts.find(h => h.host === 'vibe');
  const original = readFileSync(h.mcp, 'utf8');
  for (const config of [
    'disabled_tools = ["mcp_h2a_*"]\n' + original,
    'disabled_tools = ["h2a_*"]\n' + original,
    'enabled_tools = ["read_file"]\n' + original,
    'enabled_tools = ["h2a_*"]\ndisabled_tools = ["re:H2A_.*"]\n' + original,
    original.replace('transport = "stdio"', 'transport = "stdio"\ndisabled_tools = ["h2a_status"]'),
    original + '\n[tools.h2a_h2a_status]\npermission = "never"\n',
  ]) {
    put(h.mcp, config);
    const changed = await observation(f, 'vibe', 'MCP resolves activated prefix');
    assert.equal(changed.actual, false, config);
    assert.throws(() => contracts(sink, [changed]));
  }
});

test('L0 MCP native rules: adapter filter precedence determines the exposed tools', () => {
  const visible = (host, config, server, tool = 'h2a_status') => toolVisible(host, mcpState({ root: '/fixture' }, host, config, server), tool);
  assert.equal(visible('vibe', { enabled_tools: ['H2A_*'], disabled_tools: ['re:h2a_.*'] }, {}), false, 'Vibe deny wins over allow, case insensitive');
  assert.equal(visible('vibe', { disabled_tools: ['h2a_h2a_?tatus'] }, {}), false, 'Vibe glob uses the published server-prefixed name');
  assert.equal(visible('vibe', { disabled_tools: ['re:['] }, {}), true, 'invalid Vibe regex is ignored');
  assert.equal(visible('vibe', {}, { disabled_tools: ['h2a_status'] }), false, 'Vibe per-server lists use raw exact names');
  assert.equal(visible('vibe', {}, { disabled_tools: ['*'] }), true, 'Vibe per-server names are not globs');
  assert.equal(visible('vibe', { enabled_tools: [] }, {}), true, 'empty Vibe allowlist is unrestricted');
  assert.equal(visible('vibe', { tools: { h2a_h2a_status: { permission: 'never' } } }, {}), false, 'Vibe per-tool permission override');
  assert.equal(visible('codex', {}, { enabled_tools: [] }), false, 'empty Codex allowlist exposes nothing');
  assert.equal(visible('codex', {}, { disabled_tools: ['h2a_*'] }), true, 'Codex names are exact, not globs');
  assert.equal(visible('codex', {}, { enabled_tools: ['h2a_status'], disabled_tools: ['h2a_status'] }), false, 'Codex deny wins');
  assert.equal(visible('gemini', {}, { includeTools: ['h2a_status()'] }), true, 'Gemini accepts argument-qualified inclusions');
  assert.equal(visible('gemini', {}, { includeTools: ['h2a_status'], excludeTools: ['h2a_status'] }), false, 'Gemini exclude wins');
  assert.equal(visible('agy', {}, { enabledTools: ['h2a_status'], disabledTools: ['h2a_status'] }), false, 'Agy disabledTools wins');
  assert.equal(visible('hermes', {}, { tools: { include: ['h2a_*'], exclude: ['h2a_status'] } }), true, 'Hermes include wins');
  assert.equal(visible('hermes', {}, { tools: { include: [] } }), false, 'empty Hermes allowlist exposes nothing');
  assert.equal(visible('hermes', {}, { tools: { include: 'h2a_*' } }), true, 'Hermes accepts a scalar tool filter');
  assert.equal(visible('hermes', {}, { tools: { exclude: ['h2a_*'] } }), false, 'Hermes exclusion supports globs');
  assert.equal(visible('muse', {}, { enabled_tools: [], disabled_tools: ['h2a_status'] }), true, 'Muse 1.3.0 ignores these lists');
  assert.equal(visible('opencode', { tools: { 'h2a_*': false } }, {}), false, 'OpenCode tool glob');
  assert.equal(visible('opencode', { permission: 'deny' }, {}), false, 'OpenCode scalar permission applies to every tool');
  assert.equal(visible('opencode', { permission: { '*': 'deny', 'h2a_*': 'allow' } }, {}), true, 'OpenCode last matching permission');
  assert.equal(visible('opencode', { permission: { 'h2a_*': 'allow', '*': 'deny' } }, {}), false, 'OpenCode order matters');
  assert.equal(visible('opencode', { tools: { 'h2a_*': false }, default_agent: 'custom', agent: { custom: { tools: { 'h2a_*': true } } } }, {}), true, 'selected OpenCode agent overrides global tools');
});

test('L0 MCP native execution: environment and cwd overrides cannot reuse a healthy cached transport', async t => {
  const f = fixture(t), h = f.hosts.find(h => h.host === 'codex');
  put(f.a.cli, readFileSync(f.a.cli, 'utf8').replace('const readline=', "if(process.env.L0_WRONG_MCP==='1')process.exit(64);const readline="));
  const original = readFileSync(h.mcp, 'utf8');
  assert.equal((await observation(f, 'codex', 'MCP resolves activated prefix')).actual, true);
  put(h.mcp, original.replace('[fixture]', '[mcp_servers.h2a.env]\nL0_WRONG_MCP = "1"\n\n[fixture]'));
  assert.equal((await observation(f, 'codex', 'MCP resolves activated prefix')).actual, false, 'healthy Claude handshake does not attest Codex environment');
  put(h.mcp, original.replace('[mcp_servers.h2a]', '[mcp_servers.h2a]\ncwd = ' + JSON.stringify(join(f.a.root, 'absent-workspace'))));
  assert.equal((await observation(f, 'codex', 'MCP resolves activated prefix')).actual, false, 'native cwd is used to start the MCP');
});

test('L0 MCP native filters: intentional tool selections survive convergence and cannot be reactivated', async t => {
  for (const [host, filters] of [
    ['vibe', { global: { enabled_tools: ['h2a_*'], disabled_tools: ['h2a_*'] }, server: { disabled_tools: ['h2a_status'] } }],
    ['codex', { server: { enabled_tools: ['h2a_status'], disabled_tools: ['h2a_status'] } }],
    ['gemini', { server: { includeTools: ['h2a_status'], excludeTools: ['h2a_status'] } }],
    ['agy', { server: { enabledTools: ['h2a_status'], disabledTools: ['h2a_status'] } }],
    ['hermes', { server: { tools: { exclude: ['h2a_status'] } } }],
    ['opencode', { global: { tools: { 'h2a_*': false } } }],
  ]) {
    const f = fixture(t, { mcpFilters: { [host]: filters } }), h = f.hosts.find(h => h.host === host);
    assert.equal((await observation(f, host, 'MCP resolves activated prefix')).actual, true, host + ': intentional disabled tools preserved');
    // Removing the native filters reactivates the withheld tool.
    if (host === 'codex' || host === 'vibe') {
      put(h.mcp, readFileSync(h.mcp, 'utf8').replace(/^(?:enabled_tools|disabled_tools) = .*\n/gm, ''));
    } else if (host === 'hermes') {
      const config = YAML.parse(readFileSync(h.mcp, 'utf8')); delete config.mcp_servers.h2a.tools; put(h.mcp, YAML.stringify(config));
    } else {
      const config = JSON.parse(readFileSync(h.mcp));
      if (host === 'opencode') delete config.tools;
      else for (const k of ['includeTools', 'excludeTools', 'enabledTools', 'disabledTools']) delete config.mcpServers.h2a[k];
      put(h.mcp, JSON.stringify(config));
    }
    const changed = await observation(f, host, 'MCP resolves activated prefix');
    assert.equal(changed.actual, false, host + ': forbidden tool reactivation');
    assert.throws(() => contracts(sink, [changed]));
  }
});

test('L0 MCP selection: Codex disabled entry cannot pass after convergence', t => {
  const f = fixture(t), h = f.hosts.find(h => h.host === 'codex');
  assert.equal(observeHosts(f.a, f.hosts).filter(o => o.actual).length, 31);
  put(h.mcp, readFileSync(h.mcp, 'utf8').replace('[mcp_servers.h2a]', '[mcp_servers.h2a]\nenabled = false'));
  const disabled = observeHosts(f.a, f.hosts).find(o => o.id === 'codex installed MCP resolves activated prefix');
  assert.equal(disabled.actual, false);
  assert.throws(() => contracts(sink, [disabled]));
});

test('L0 Vibe: the configured transport must permit the stdio candidate probe', async t => {
  const f = fixture(t), h = f.hosts.find(h => h.host === 'vibe');
  const original = readFileSync(h.mcp, 'utf8');
  for (const transport of ['transport = "http"', 'transport = "streamable-http"', '']) {
    put(h.mcp, original.replace('transport = "stdio"', transport));
    const invalid = await observation(f, 'vibe', 'MCP resolves activated prefix');
    assert.equal(invalid.actual, false, transport || 'missing transport');
    assert.throws(() => contracts(sink, [invalid]));
  }
  put(h.mcp, original.replace('transport = "stdio"', 'transport = "stdio"\ndisabled = false'));
  assert.equal((await observation(f, 'vibe', 'MCP resolves activated prefix')).actual, true);
});

test('L0 Vibe: an initially disabled MCP keeps its selection without launching a probe', async t => {
  const f = fixture(t, { vibeDisabled: true }), h = f.hosts.find(h => h.host === 'vibe');
  assert.match(readFileSync(h.mcp, 'utf8'), /disabled = true/);
  // A disabled route has no handshake. Its target must still be the candidate.
  const candidateBytes = readFileSync(f.a.cli);
  put(f.a.cli, 'process.exit(64);');
  assert.equal((await observation(f, 'vibe', 'MCP resolves activated prefix')).actual, true);
  put(f.a.cli, candidateBytes);
  const original = readFileSync(h.mcp, 'utf8');
  put(h.mcp, original.replace('disabled = true', 'disabled = false'));
  assert.equal((await observation(f, 'vibe', 'MCP resolves activated prefix')).actual, false);
  put(h.mcp, original.replace(f.a.cli, '/stale-prefix/h2a'));
  assert.equal((await observation(f, 'vibe', 'MCP resolves activated prefix')).actual, false);
});

test('L0 artifacts: disappearing entries cannot break recovery observations or hide other errors', t => {
  const root = mkdtempSync(join(tmpdir(), 'oracle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const record = join(root, 'receipt.json'), transient = join(root, 'vanishing.lock');
  put(record, 'socket inode recovery receipt');
  put(transient, 'private transient lock');
  assert.deepEqual(files(root, path => {
    if (path === transient) rmSync(path);
    const stat = lstatSync(path);
    if (stat.isFile() && path.endsWith('.json')) return readFileSync(path, 'utf8');
  }), ['socket inode recovery receipt']);
  // Disappearance can also occur after stat and before reading a JSON record.
  assert.deepEqual(files(root, path => {
    assert.ok(lstatSync(path).isFile());
    rmSync(path);
    return readFileSync(path, 'utf8');
  }), []);
  put(record, 'retained');
  const denied = Object.assign(new Error('private read denied'), { code: 'EACCES' });
  assert.throws(() => files(root, () => { throw denied; }), error => error === denied);
  put(join(root, 'vanishing-dir/child.json'), '{}');
  const readdir = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', (path, ...args) => {
    const entries = readdir(path, ...args);
    if (path === root) rmSync(join(root, 'vanishing-dir'), { recursive: true });
    return entries;
  });
  syncBuiltinESMExports();
  try { assert.deepEqual(files(root, path => readFileSync(path, 'utf8')), ['retained']); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

function setMcpFlag(h, flag, value) {
  const original = readFileSync(h.mcp, 'utf8');
  if (h.mcp.endsWith('.toml')) {
    const index = original.search(/^command = /m), prefix = original.slice(0, index), field = flag + ' = ' + JSON.stringify(value) + '\n';
    const pattern = new RegExp('^' + flag + ' = .*\\n', 'm');
    put(h.mcp, (pattern.test(prefix) ? prefix.replace(pattern, field) : prefix + field) + original.slice(index));
  } else if (h.mcp.endsWith('.yaml')) {
    const config = YAML.parse(original); config.mcp_servers.h2a[flag] = value; put(h.mcp, YAML.stringify(config));
  }
  else {
    const config = JSON.parse(original);
    (config.mcpServers ?? config.mcp).h2a[flag] = value;
    put(h.mcp, JSON.stringify(config));
  }
}

function setMcpSelection(h, a, enabled) {
  if (h.host === 'claude' || h.host === 'gemini') {
    const config = JSON.parse(readFileSync(h.mcp));
    if (h.host === 'claude') config.projects = { [a.root]: { disabledMcpServers: enabled ? [] : ['h2a'] } };
    else config.mcp = { excluded: enabled ? [] : ['h2a'] };
    put(h.mcp, JSON.stringify(config));
  } else setMcpFlag(h, ['vibe', 'agy'].includes(h.host) ? 'disabled' : 'enabled', ['vibe', 'agy'].includes(h.host) ? !enabled : enabled);
}

async function mcpSelection(t, host) {
  const f = fixture(t), h = f.hosts.find(h => h.host === host);
  const original = readFileSync(h.mcp, 'utf8');
  assert.equal((await observation(f, host, 'MCP resolves activated prefix')).actual, true);
  setMcpSelection(h, f.a, false);
  const changed = await observation(f, host, 'MCP resolves activated prefix');
  assert.equal(changed.actual, false, host + ': native selection disabled');
  assert.throws(() => contracts(sink, [changed]));
  put(h.mcp, original);
  // The opposite spelling is ignored by this CLI. It must not invent a disabled
  // integration (nor conceal reactivation when both spellings are present).
  const disabledFlag = ['codex', 'hermes', 'opencode', 'muse'].includes(host);
  setMcpFlag(h, disabledFlag ? 'disabled' : 'enabled', disabledFlag);
  assert.equal((await observation(f, host, 'MCP resolves activated prefix')).actual, true, host + ': ignored alias');
  put(h.mcp, original);
  setMcpSelection(h, f.a, true);
  assert.equal((await observation(f, host, 'MCP resolves activated prefix')).actual, true, 'explicit native enable');
  put(h.mcp, original);
  if (!['claude', 'gemini'].includes(host)) {
    setMcpFlag(h, ['vibe', 'agy'].includes(host) ? 'disabled' : 'enabled', 'invalid');
    assert.equal((await observation(f, host, 'MCP resolves activated prefix')).actual, host === 'hermes', 'Hermes warns and defaults on for invalid booleans; strict adapters refuse');
    put(h.mcp, original);
  }
  const disabled = fixture(t, { mcpDisabled: [host] }), off = disabled.hosts.find(h => h.host === host);
  assert.equal(off.mcpEnabled, false, 'selection is captured before convergence');
  const selected = readFileSync(off.mcp, 'utf8');
  const candidateBytes = readFileSync(disabled.a.cli);
  put(disabled.a.cli, 'process.exit(64);');
  assert.equal((await observation(disabled, host, 'MCP resolves activated prefix')).actual, true);
  put(disabled.a.cli, candidateBytes);
  setMcpSelection(off, disabled.a, true);
  assert.notEqual(readFileSync(off.mcp, 'utf8'), selected, 'negative control changes the native selection');
  assert.equal((await observation(disabled, host, 'MCP resolves activated prefix')).actual, false, 'must not re-enable a disabled selection');
  put(off.mcp, selected.replace(disabled.a.cli, '/stale-prefix/h2a'));
  assert.equal((await observation(disabled, host, 'MCP resolves activated prefix')).actual, false, 'disabled payload still targets candidate');

  if (host === 'codex') put(h.mcp, original.replace('[mcp_servers.h2a]', '[mcp_servers.h2a]\ndisabled_tools = ["h2a_status"]'));
  else if (host === 'vibe') put(h.mcp, 'disabled_tools = ["h2a_*"]\n' + original);
  else if (host === 'hermes') {
    const config = YAML.parse(original); config.mcp_servers.h2a.tools = { exclude: ['h2a_status'] }; put(h.mcp, YAML.stringify(config));
  } else if (host === 'gemini' || host === 'agy') {
    const config = JSON.parse(original); config.mcpServers.h2a[host === 'agy' ? 'disabledTools' : 'excludeTools'] = ['h2a_status']; put(h.mcp, JSON.stringify(config));
  } else if (host === 'opencode') {
    const config = JSON.parse(original); config.tools = { 'h2a_*': false }; put(h.mcp, JSON.stringify(config));
  } else if (host === 'muse') {
    const config = JSON.parse(original); config.mcpServers.h2a.disabled_tools = ['h2a_status']; put(h.mcp, JSON.stringify(config));
    assert.equal((await observation(f, host, 'MCP resolves activated prefix')).actual, true, 'Muse 1.3.0 ignores tool filter lists');
    return;
  } else return;
  assert.equal((await observation(f, host, 'MCP resolves activated prefix')).actual, false, host + ': hidden tool despite healthy shared transport');
}

test('L0 MCP selection: claude preserves enabled and disabled choices', t => mcpSelection(t, 'claude'));

test('L0 MCP selection: codex preserves enabled and disabled choices', t => mcpSelection(t, 'codex'));

test('L0 MCP selection: gemini preserves enabled and disabled choices', t => mcpSelection(t, 'gemini'));

test('L0 MCP selection: agy preserves enabled and disabled choices', t => mcpSelection(t, 'agy'));

test('L0 MCP selection: hermes preserves enabled and disabled choices', t => mcpSelection(t, 'hermes'));

test('L0 MCP selection: opencode preserves enabled and disabled choices', t => mcpSelection(t, 'opencode'));

test('L0 MCP selection: muse preserves enabled and disabled choices', t => mcpSelection(t, 'muse'));

test('L0 MCP selection: vibe preserves enabled and disabled choices', t => mcpSelection(t, 'vibe'));
