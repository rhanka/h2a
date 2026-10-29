import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { contracts } from './helpers/cleanse-contracts.mjs';
import { isolatedEnv } from './helpers/cleanse-artifact.mjs';
import { observeHosts, seedHosts } from './helpers/cleanse-hosts.mjs';

const put = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
const sink = { diagnostic() {} };
const known = { id: 'known', lot: 'L1', actual: false, expected: true, evidence: 'original',
  knownMissing: { actual: false, expected: true, evidence: 'original' } };

test('L0 contracts: only the exact known assertion is accepted and repaired contracts become GREEN', () => {
  const messages = [];
  contracts({ diagnostic: message => messages.push(message) }, [known]);
  for (const change of [{ actual: undefined }, { evidence: 'unexpected stale bytes' }, { knownMissing: undefined },
    { expected: 'changed assertion' }]) {
    assert.throws(() => contracts(sink, [{ ...known, ...change }]), 'an unrelated failure must block the gate');
  }
  assert.throws(() => contracts(sink, []));
  assert.match(messages.join('\n'), /KNOWN-MISSING.*known/);
  messages.length = 0;
  contracts({ diagnostic: message => messages.push(message) }, [{ ...known, actual: true, evidence: 'current' }]);
  assert.match(messages.join('\n'), /GREEN.*known/);
});

function fixture(t) {
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
  put(a.cli, `const readline=require('node:readline');readline.createInterface({input:process.stdin}).on('line',line=>{
    const q=JSON.parse(line);if(q.id===undefined)return;
    const result=q.method==='initialize'?{protocolVersion:'2024-11-05',serverInfo:{name:'@sentropic/h2a',version:'0.98.7'},capabilities:{tools:{}}}:
      {tools:[{name:'h2a_status'}]};
    console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
  });`);
  const hosts = seedHosts(a);
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
  else if (h.mcp.endsWith('.yaml')) put(h.mcp, 'mcp_servers:\n  h2a:\n    command: ' + command + '\n    args: ' + argv + '\nfixture: third-party\n');
  else {
    const config = JSON.parse(readFileSync(h.mcp));
    config.mcpServers.h2a = { command: process.execPath, args: [a.cli, ...args] };
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
