// L0 executes desired contracts against a prepared/prepacked, installed RC.
// Each observation must match its committed ledger state/signature.
// Repairs require the ledger's RED -> GREEN update in the same change.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contracts } from './helpers/cleanse-contracts.mjs';
import { candidate, json, run } from './helpers/cleanse-artifact.mjs';
import { eventually, files, gui, lab } from './helpers/cleanse-lab.mjs';
import { observeHosts, seedHosts } from './helpers/cleanse-hosts.mjs';

let artifact;
let hosts;
const cleanups = [];
before(() => {
  artifact = candidate({ after: fn => cleanups.push(fn) });
  hosts = seedHosts(artifact);
  artifact.install();
  artifact.verify();
});
after(() => {
  try { assert.equal(observed.size, 0, 'every observed contract must execute its registered test'); }
  finally { for (const fn of cleanups.reverse()) fn(); }
});

const observed = new Map();
function record(observations) {
  for (const observation of observations) {
    assert.equal(observed.has(observation.id), false, 'one observation per contract');
    observed.set(observation.id, observation);
  }
}
function witness(id) {
  return t => {
    assert.ok(observed.has(id), id + ': product observation must have executed');
    const observation = observed.get(id);
    observed.delete(id);
    contracts(t, [observation], { root: artifact.root, version: artifact.version });
  };
}


test('L0 install: global candidate lifecycle converges the independent eight-host inventory', t => {
  artifact.verify();
  t.diagnostic(JSON.stringify({ candidate: artifact.version, tarballs: artifact.artifacts, hosts: hosts.map(h => h.host) }));
  const claude = hosts.find(h => h.host === 'claude');
  const original = readFileSync(claude.mcp, 'utf8');
  try {
    const wrong = JSON.parse(original);
    wrong.mcpServers.h2a = { command: '/bin/echo', args: [artifact.cli, 'mcp-serve'] };
    writeFileSync(claude.mcp, JSON.stringify(wrong));
    const control = observeHosts(artifact, hosts).find(o => o.id === 'claude installed MCP resolves activated prefix');
    assert.equal(control.actual, false, 'a candidate path passed to echo is not the effective MCP binary');
    wrong.mcpServers.h2a = { command: process.execPath, args: [artifact.cli, 'mcp-serve'] };
    writeFileSync(claude.mcp, JSON.stringify(wrong));
    const current = observeHosts(artifact, hosts).find(o => o.id === 'claude installed MCP resolves activated prefix');
    assert.equal(current.actual, true, 'the installed candidate must actually answer initialize and tools/list');
  } finally { writeFileSync(claude.mcp, original); }
  record(observeHosts(artifact, hosts));
});

test('L0 packaged RC: prepare and prepack preserve exact plugin and integration payload versions', t => {
  const tar = artifact.artifacts.find(a => a.name === 'h2a').path;
  const read = path => JSON.parse(run('tar', ['-xOf', tar, `package/${path}`], artifact.root, artifact.env));
  const pkg = read('package.json');
  assert.equal(pkg.version, artifact.version);
  const files = run('tar', ['-tzf', tar], artifact.root, artifact.env).split('\n');
  const manifest = files.includes('package/integration-manifest.json') ? read('integration-manifest.json') : undefined;
  record([
    ...['.claude-plugin/plugin.json', '.codex-plugin/plugin.json'].map(path => ({
      id: `packaged ${path} exact RC`, lot: 'L3', actual: read(path).version, expected: artifact.version,
    })),
    { id: 'packaged integration manifest exact RC', lot: 'L3', actual: manifest?.version, expected: artifact.version },
  ]);
});

test('L0 R1: packaged public fresh and resume recover two endpoints and archive the dead claim', { timeout: 60000 }, async t => {
  const f = await lab(t, artifact);
  for (const socket of f.sockets) assert.equal(existsSync(socket), false);
  const fresh = await f.start(['run', 'codex', f.env.HOME, '--name', 'fresh', '--background', '--no-attach', '--no-h2a', '--no-gw', '--bare']).done;
  assert.equal(fresh.code, 0, JSON.stringify(fresh));
  const resumed = await f.start(['run', 'codex', f.env.HOME, '--resume', f.deadClaimId, '--name', 'resumed', '--background', '--no-attach', '--no-h2a', '--no-gw', '--bare']).done;
  assert.equal(resumed.code, 0, JSON.stringify(resumed));
  const inventory = await f.inventory();
  assert.equal(new Set(inventory.map(h => h.ping.hostPid)).size, 2);
  for (const id of ['h2a-fresh', 'h2a-resumed']) {
    const owners = inventory.filter(h => h.sessions.some(s => s.id === id));
    assert.equal(owners.length, 1, 'one owner per conversation');
    await f.usable(owners[0].socket, id);
  }
  assert.equal(f.transcripts().filter(r => r.id === f.deadClaimId).length, 1);
  f.preserve();
  t.diagnostic(JSON.stringify({ freshExit: fresh.code, resumeExit: resumed.code, endpoints: inventory.map(h => ({ socket: h.socket, hostPid: h.ping.hostPid })), transcripts: f.transcripts() }));
  record([{ id: 'dead claim archived before replacement', lot: 'L1',
    actual: files(f.root, p => p !== f.deadClaim && !p.endsWith('.pending') && lstatSync(p).isFile() && readFileSync(p, 'utf8') === f.deadClaimBytes).some(Boolean),
    expected: true },
  { id: 'proven dead background row archived and retired', lot: 'L1',
    actual: !json(f.registry).entries.some(r => r.id === 'background-dead') &&
      files(f.root, p => p !== f.registry && /\.(json|jsonl)$/.test(p) && lstatSync(p).isFile() && readFileSync(p, 'utf8').includes('background-dead')).some(Boolean),
    expected: true }]);
});

test('L0 R2: packaged real restore dispatches twenty conversations through flock after endpoint preparation', { timeout: 60000 }, async t => {
  const f = await lab(t, artifact);
  gui(f, artifact);
  const project = join(f.env.HOME, 'src/project');
  mkdirSync(project, { recursive: true });
  const targets = Array.from({ length: 20 }, (_, i) => ({ ...f.row('target-' + i), cwd: project }));
  f.save([...f.saved, ...targets]);
  writeFileSync(join(f.config, 'config.json'), JSON.stringify({ layout: { maxPerWindow: 20, groups: [{ title: 'cleanse', projects: ['project'] }] } }));
  const result = await f.start(['restore']).done;
  assert.equal(result.code, 0, JSON.stringify(result));
  await eventually(f.transcripts, rows => targets.every(target => rows.some(r => r.id === target.convId)), 30000);
  const inventory = await f.inventory();
  for (const target of targets) {
    assert.equal(f.transcripts().filter(r => r.id === target.convId).length, 1, 'original UUID exactly once');
    const owners = inventory.filter(h => h.sessions.some(s => s.id === target.tmuxSession));
    assert.equal(owners.length, 1);
    await f.usable(owners[0].socket, target.tmuxSession);
  }
  f.preserve();
  const dispatches = readFileSync(join(f.env.HOME, 'gui-args'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(readFileSync(join(f.env.HOME, 'flock-calls'), 'utf8').trim().length > 0, 'the real kernel flock was executed');
  for (const args of dispatches) {
    const map = args.at(-1);
    assert.ok(!existsSync(map) || readFileSync(map, 'utf8').trim() === '', 'all map lines consumed by the product dispatcher');
  }
  t.diagnostic(JSON.stringify({ restoreExit: result.code, conversations: f.transcripts().length, dispatchers: dispatches.length }));
  record([{ id: 'both endpoints ready before restore dispatcher', lot: 'L1',
    actual: json(join(f.env.HOME, 'before-dispatch')).ready, expected: [true, true] }]);
});

test('L0 R1: public run quarantines the original stale socket inodes with a recovery record', { timeout: 60000 }, async t => {
  const f = await lab(t, artifact);
  const stale = [];
  for (const socket of f.sockets) {
    const host = f.start(['--socket', socket, '--registry-path', f.registry], join(artifact.runtime, 'native-terminal/process.js'));
    await eventually(async () => {
      const c = await f.NativeTerminalClient.connect(socket);
      try { return await c.ping(); } finally { c.close(); }
    }, Boolean);
    const stat = lstatSync(socket);
    host.child.kill('SIGKILL');
    await host.done;
    assert.equal(lstatSync(socket).ino, stat.ino, 'SIGKILL leaves the actual socket');
    stale.push({ socket, dev: stat.dev, ino: stat.ino });
  }
  const result = await f.start(['run', 'codex', f.env.HOME, '--name', 'after-crash', '--background', '--no-attach', '--no-h2a', '--no-gw', '--bare']).done;
  assert.equal(result.code, 0, JSON.stringify(result));
  const inventory = await f.inventory();
  const owner = inventory.find(h => h.sessions.some(s => s.id === 'h2a-after-crash'));
  assert.ok(owner);
  await f.usable(owner.socket, 'h2a-after-crash');
  f.preserve();
  const artifacts = files(f.root, path => {
    const stat = lstatSync(path);
    if (stat.isSocket() && !f.sockets.includes(path)) return { dev: stat.dev, ino: stat.ino };
    if (stat.isFile() && /\.(json|jsonl)$/.test(path)) return { bytes: readFileSync(path, 'utf8') };
  });
  record(stale.flatMap(old => [
    { id: old.socket.split('/').at(-1) + ' original inode quarantined', lot: 'L1',
      actual: artifacts.some(p => p.dev === old.dev && p.ino === old.ino), expected: true },
    { id: old.socket.split('/').at(-1) + ' recovery record', lot: 'L1',
      actual: artifacts.some(p => p.bytes?.includes(old.socket) && p.bytes.includes(String(old.ino))), expected: true },
  ]));
});

test('L0 R1: public resume reports a coded refusal for an unattributed legacy reclaim barrier', { timeout: 60000 }, async t => {
  const f = await lab(t, artifact);
  const bytes = readFileSync(f.barrier + '.reclaim', 'utf8');
  const result = await f.start(['run', 'codex', f.env.HOME, '--resume', f.barrierId, '--name', 'barrier', '--background', '--no-attach', '--no-h2a', '--no-gw', '--bare']).done;
  assert.equal(f.transcripts().filter(r => r.id === f.barrierId).length, 0, 'a legacy barrier never grants another writer');
  assert.equal(readFileSync(f.barrier + '.reclaim', 'utf8'), bytes);
  f.preserve();
  t.diagnostic(JSON.stringify({ exit: result.code, stderr: result.stderr }));
  record([{ id: 'legacy reclaim barrier coded refusal', lot: 'L1',
    actual: result.code !== 0 && /reclaim|unattributed|recovery.*refus/i.test(result.stderr + result.stdout), expected: true,
    evidence: { code: result.code, stdout: result.stdout, stderr: result.stderr.replaceAll(f.barrierId, '<conversation>') } }]);
});

// Literal identities are independently required by the npm execution inventory.
test("L0 contract: claude installed skill bytes", witness("claude installed skill bytes"));
test("L0 contract: claude installed linked resource bytes", witness("claude installed linked resource bytes"));
test("L0 contract: claude installed MCP resolves activated prefix", witness("claude installed MCP resolves activated prefix"));
test("L0 contract: claude installed registered effective plugin cache", witness("claude installed registered effective plugin cache"));
test("L0 contract: codex installed skill bytes", witness("codex installed skill bytes"));
test("L0 contract: codex installed linked resource bytes", witness("codex installed linked resource bytes"));
test("L0 contract: codex installed MCP resolves activated prefix", witness("codex installed MCP resolves activated prefix"));
test("L0 contract: codex installed registered effective plugin cache", witness("codex installed registered effective plugin cache"));
test("L0 contract: gemini installed skill bytes", witness("gemini installed skill bytes"));
test("L0 contract: gemini installed linked resource bytes", witness("gemini installed linked resource bytes"));
test("L0 contract: gemini installed MCP resolves activated prefix", witness("gemini installed MCP resolves activated prefix"));
test("L0 contract: agy installed skill bytes", witness("agy installed skill bytes"));
test("L0 contract: agy installed linked resource bytes", witness("agy installed linked resource bytes"));
test("L0 contract: agy installed MCP resolves activated prefix", witness("agy installed MCP resolves activated prefix"));
test("L0 contract: agy installed selected helper bytes", witness("agy installed selected helper bytes"));
test("L0 contract: agy installed selected hook registration", witness("agy installed selected hook registration"));
test("L0 contract: agy installed observed Agy imported bytes", witness("agy installed observed Agy imported bytes"));
test("L0 contract: hermes installed skill bytes", witness("hermes installed skill bytes"));
test("L0 contract: hermes installed linked resource bytes", witness("hermes installed linked resource bytes"));
test("L0 contract: hermes installed MCP resolves activated prefix", witness("hermes installed MCP resolves activated prefix"));
test("L0 contract: opencode installed skill bytes", witness("opencode installed skill bytes"));
test("L0 contract: opencode installed linked resource bytes", witness("opencode installed linked resource bytes"));
test("L0 contract: opencode installed MCP resolves activated prefix", witness("opencode installed MCP resolves activated prefix"));
test("L0 contract: muse installed skill bytes", witness("muse installed skill bytes"));
test("L0 contract: muse installed linked resource bytes", witness("muse installed linked resource bytes"));
test("L0 contract: muse installed MCP resolves activated prefix", witness("muse installed MCP resolves activated prefix"));
test("L0 contract: muse installed selected helper bytes", witness("muse installed selected helper bytes"));
test("L0 contract: muse installed selected hook registration", witness("muse installed selected hook registration"));
test("L0 contract: vibe installed skill bytes", witness("vibe installed skill bytes"));
test("L0 contract: vibe installed linked resource bytes", witness("vibe installed linked resource bytes"));
test("L0 contract: vibe installed MCP resolves activated prefix", witness("vibe installed MCP resolves activated prefix"));
test("L0 contract: packaged .claude-plugin/plugin.json exact RC", witness("packaged .claude-plugin/plugin.json exact RC"));
test("L0 contract: packaged .codex-plugin/plugin.json exact RC", witness("packaged .codex-plugin/plugin.json exact RC"));
test("L0 contract: packaged integration manifest exact RC", witness("packaged integration manifest exact RC"));
test("L0 contract: dead claim archived before replacement", witness("dead claim archived before replacement"));
test("L0 contract: proven dead background row archived and retired", witness("proven dead background row archived and retired"));
test("L0 contract: both endpoints ready before restore dispatcher", witness("both endpoints ready before restore dispatcher"));
test("L0 contract: native-terminal.sock original inode quarantined", witness("native-terminal.sock original inode quarantined"));
test("L0 contract: native-terminal.sock recovery record", witness("native-terminal.sock recovery record"));
test("L0 contract: native-terminal.lf1.sock original inode quarantined", witness("native-terminal.lf1.sock original inode quarantined"));
test("L0 contract: native-terminal.lf1.sock recovery record", witness("native-terminal.lf1.sock recovery record"));
test("L0 contract: legacy reclaim barrier coded refusal", witness("legacy reclaim barrier coded refusal"));
