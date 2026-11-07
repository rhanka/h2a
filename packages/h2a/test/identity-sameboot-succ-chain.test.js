import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identitySelf, repairIdentityPreviousBootChainForRoot, runCli, withIdentityFence } from '../dist/index.js';
import { callRpc, spawnMcp, stopChildren, waitForIdentity } from './helpers/mcp-fix-lab.js';

const token = n => n.toString(16).padStart(32, '0');
function fixture(t, pid = process.pid) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'h2a-sameboot-chain-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'store'), identity = join(root, 'identity'), lock = join(identity, '.lock');
  fs.mkdirSync(identity, { recursive: true });
  const self = identitySelf();
  const paths = [];
  for (let i = 0; i <= 8; i++) {
    const path = i === 0 ? lock : `${lock}.succ.${token(i)}`;
    const rec = { recordVersion: 2, protocol: 'identity-binding-fence-v1', platform: 'linux', publication: 'link',
      ...self, pid, start: self.start === 'proc:1' ? 'proc:2' : 'proc:1', token: token(i + 1), fenceEpoch: token(i + 1),
      at: Date.now(), ...(i ? { target: token(1) } : {}) };
    fs.writeFileSync(path, JSON.stringify(rec)); paths.push(path);
  }
  return { dir, root, identity, lock, self, paths };
}
function aside(x) { return fs.readdirSync(x.identity).filter(n => n.startsWith('.stale-aside-')); }
function io(dir) {
  let out = '';
  return { stdout: { write: s => { out += s; } }, stderr: { write: () => {} }, cwd: () => dir, text: () => out };
}

for (const proof of ['start-mismatch', 'pid-absent']) {
  test(`same-boot chain: recovers every proven-dead entry (${proof}) with a durable receipt`, t => {
    const pid = proof === 'pid-absent' ? spawnSync(process.execPath, ['-e', '']).pid : process.pid;
    assert.ok(pid);
    const x = fixture(t, pid);
    const before = x.paths.map(p => fs.readFileSync(p, 'utf8'));
    const result = repairIdentityPreviousBootChainForRoot(x.root);
    assert.equal(result.recovered, true);
    assert.equal(result.reason, 'recovered-dead-same-boot-chain');
    assert.equal(aside(x).length, 1);
    assert.match(aside(x)[0], /^\.stale-aside-\d{8}T\d{9}Z-/);
    assert.deepEqual(result.moved, x.paths.map(p => p.slice(x.identity.length + 1)));
    const receipt = JSON.parse(fs.readFileSync(join(result.backupDir, 'receipt.json'), 'utf8'));
    assert.equal(receipt.actor.pid, process.pid);
    assert.ok(Number.isFinite(Date.parse(receipt.at)));
    assert.equal(receipt.entries.length, 9);
    for (let i = 0; i < x.paths.length; i++) {
      const name = result.moved[i];
      assert.equal(fs.existsSync(x.paths[i]), false);
      assert.equal(fs.readFileSync(join(result.backupDir, name), 'utf8'), before[i]);
      assert.equal(receipt.entries[i].name, name);
      assert.equal(receipt.entries[i].proof.kind, proof);
      assert.equal(receipt.entries[i].record.pid, pid);
    }
  });
}

for (const kind of ['alive', 'foreign-namespace', 'foreign-machine', 'missing-start', 'different-boot', 'unreadable-proc']) {
  test(`same-boot chain: refuses ${kind} in any entry and preserves all files`, t => {
    for (const index of [0, 4, 8]) {
      const x = fixture(t);
      const rec = JSON.parse(fs.readFileSync(x.paths[index], 'utf8'));
      if (kind === 'alive') rec.start = x.self.start;
      if (kind === 'foreign-namespace') rec.ns = 'pid:[999999999]';
      if (kind === 'foreign-machine') rec.host = '1'.repeat(32);
      if (kind === 'missing-start') rec.start = null;
      if (kind === 'different-boot') rec.boot = '00000000-0000-4000-8000-000000000001';
      fs.writeFileSync(x.paths[index], JSON.stringify(rec));
      const before = x.paths.map(p => fs.readFileSync(p, 'utf8'));
      const open = fs.openSync;
      if (kind === 'unreadable-proc') {
        fs.openSync = (path, ...args) => {
          if (String(path) === `/proc/${process.pid}/stat`) throw Object.assign(new Error('probe denied'), { code: 'EACCES' });
          return open(path, ...args);
        };
        syncBuiltinESMExports();
      }
      let result;
      try { result = repairIdentityPreviousBootChainForRoot(x.root); }
      finally { fs.openSync = open; syncBuiltinESMExports(); }
      assert.equal(result.recovered, false, `${kind}, entry ${index}`);
      assert.deepEqual(x.paths.map(p => fs.readFileSync(p, 'utf8')), before);
      assert.equal(aside(x).length, 0);
    }
  });
}

test('same-boot chain: automatic acquisition recovers a saturated dead chain', async t => {
  const x = fixture(t);
  await withIdentityFence(x.lock, lease => {
    assert.equal(lease.recovered, true);
    assert.equal(lease.recoveryKind, 'recovered-dead-same-boot-chain');
  }, { timeoutMs: 600, pollMs: 10 });
  assert.equal(aside(x).length, 1);
});

test('doctor --repair reports the same-boot files moved; dry-run preserves them', async t => {
  const x = fixture(t);
  const dry = io(x.dir);
  const options = { doctorHostInstallations: () => ({ ok: true, hosts: [] }) };
  await runCli(['doctor', '--root', x.root, '--repair', '--dry-run', '--skip-hosts'], dry, options);
  assert.ok(x.paths.every(p => fs.existsSync(p)));
  assert.equal(aside(x).length, 0);
  const output = io(x.dir);
  await runCli(['doctor', '--root', x.root, '--repair', '--skip-hosts'], output, options);
  const check = JSON.parse(output.text()).checks.identityPreviousBootChain;
  assert.equal(check.recovered, true);
  assert.equal(check.reason, 'recovered-dead-same-boot-chain');
  assert.equal(check.moved.length, 9);
  assert.ok(fs.existsSync(join(check.backupDir, 'receipt.json')));
});

test('same-boot chain: two processes racing recovery keep one aside and mutual exclusion', async t => {
  const x = fixture(t), marker = join(x.dir, 'critical-section');
  const children = [];
  t.after(() => { for (const c of children) if (c.exitCode === null) c.kill('SIGKILL'); });
  await Promise.all(Array.from({ length: 2 }, () => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [join(import.meta.dirname, 'helpers/identity-fence-child.mjs'), x.lock, marker, '2000', '100']);
    children.push(c); let err = '';
    c.stderr.on('data', s => { err += s; }); c.stdout.resume(); c.on('error', reject);
    c.on('exit', code => code === 0 ? resolve() : reject(new Error(`racer exit ${code}: ${err}`)));
  })));
  const rows = fs.readFileSync(marker, 'utf8').trim().split('\n');
  assert.equal(rows.length, 4);
  for (let i = 0; i < rows.length; i += 2) assert.equal(rows[i].replace('enter', 'exit'), rows[i + 1]);
  assert.equal(aside(x).length, 1);
});

test('same-boot chain: two real MCP servers recover once and both become ready', async t => {
  t.after(() => stopChildren());
  const x = fixture(t);
  await runCli(['init', '--root', x.root], io(x.dir), {});
  const handles = ['one', 'two'].map(id => spawnMcp({ root: x.root, args: ['--auto-open', '--host', 'claude'],
    env: { CLAUDE_CODE_SESSION_ID: `sameboot-${id}` } }));
  await Promise.all(handles.map(h => callRpc(h, { jsonrpc: '2.0', id: 1, method: 'initialize' })));
  const statuses = await Promise.all(handles.map(h => waitForIdentity(h, s => s.state === 'identity_ready')));
  assert.ok(statuses.every(s => s.state === 'identity_ready'), JSON.stringify({ statuses, stderr: handles.map(h => h.stderr) }));
  assert.equal(aside(x).length, 1);
});
