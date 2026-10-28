// L0 executes desired contracts against a prepared/prepacked, installed RC.
// Strict RED: H2A_CLEANSE_STRICT=1 node --test <this file>.
// L0 CI records named missing contracts as diagnostics; infrastructure and
// safety assertions gate normally. A repaired contract becomes GREEN unchanged.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
after(() => { for (const fn of cleanups.reverse()) fn(); });

function contracts(t, observations) {
  const missing = [];
  for (const { id, lot, actual, expected } of observations) {
    try {
      assert.deepEqual(actual, expected, `${id} (${lot})`);
      t.diagnostic(`GREEN ${id} (${lot})`);
    } catch (error) {
      assert.equal(error.code, 'ERR_ASSERTION');
      missing.push(error);
      t.diagnostic(`RED ${id} (${lot}): actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
    }
  }
  assert.ok(observations.length > 0, 'a witness must execute desired assertions');
  if (process.env.H2A_CLEANSE_STRICT === '1' && missing.length) {
    throw new AggregateError(missing, missing.map(e => e.message).join('\n'));
  }
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
  } finally { writeFileSync(claude.mcp, original); }
  contracts(t, observeHosts(artifact, hosts));
});

test('L0 packaged RC: prepare and prepack preserve exact plugin and integration payload versions', t => {
  const tar = artifact.artifacts.find(a => a.name === 'h2a').path;
  const read = path => JSON.parse(run('tar', ['-xOf', tar, `package/${path}`], artifact.root, artifact.env));
  const pkg = read('package.json');
  assert.equal(pkg.version, artifact.version);
  const files = run('tar', ['-tzf', tar], artifact.root, artifact.env).split('\n');
  const manifest = files.includes('package/integration-manifest.json') ? read('integration-manifest.json') : undefined;
  contracts(t, [
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
  contracts(t, [{ id: 'dead claim archived before replacement', lot: 'L1',
    actual: files(f.root).some(p => p !== f.deadClaim && !p.endsWith('.pending') && lstatSync(p).isFile() && readFileSync(p, 'utf8') === f.deadClaimBytes),
    expected: true },
  { id: 'proven dead background row archived and retired', lot: 'L1',
    actual: !json(f.registry).entries.some(r => r.id === 'background-dead') &&
      files(f.root).some(p => p !== f.registry && /\.(json|jsonl)$/.test(p) && lstatSync(p).isFile() && readFileSync(p, 'utf8').includes('background-dead')),
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
  contracts(t, [{ id: 'both endpoints ready before restore dispatcher', lot: 'L1',
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
  const artifacts = files(f.root);
  contracts(t, stale.flatMap(old => [
    { id: old.socket.split('/').at(-1) + ' original inode quarantined', lot: 'L1',
      actual: artifacts.some(p => !f.sockets.includes(p) && lstatSync(p).isSocket() && lstatSync(p).dev === old.dev && lstatSync(p).ino === old.ino), expected: true },
    { id: old.socket.split('/').at(-1) + ' recovery record', lot: 'L1',
      actual: artifacts.some(p => lstatSync(p).isFile() && /\.(json|jsonl)$/.test(p) && readFileSync(p, 'utf8').includes(old.socket) && readFileSync(p, 'utf8').includes(String(old.ino))), expected: true },
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
  contracts(t, [{ id: 'legacy reclaim barrier coded refusal', lot: 'L1',
    actual: result.code !== 0 && /reclaim|unattributed|recovery.*refus/i.test(result.stderr + result.stdout), expected: true }]);
});
