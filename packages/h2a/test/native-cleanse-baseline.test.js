// L0 — Baseline witnesses for the native-cleanse spec (lot L0).
//
// Old-format two-endpoint reboot fixture + independent packaged-host
// inventory. Records actual rc.7 behavior and the missing L1/L3 contracts
// as passing baseline facts (the desired contracts are RED on rc.7: no
// journaled quarantine, no versioned claim frame, no integration manifest).
// Temporary synthetic roots only; no real h2a state, owner session, provider
// or installed binary. Zero skip.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');

function privateTmpRoot(t) {
  assert.ok(
    process.env.TMPDIR && resolve(process.env.TMPDIR) !== resolve('/tmp'),
    'Supply a disposable private TMPDIR (never /tmp)',
  );
  const root = mkdtempSync(join(tmpdir(), 'l0-cleanse-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    assert.equal(existsSync(root), false);
  });
  return root;
}

function seedOldFormatFixture(root) {
  const nt = join(root, 'h2a-nt');
  mkdirSync(nt, { recursive: true, mode: 0o700 });
  const lockId = join(nt, '.h2a-native-terminal.lock-id');
  writeFileSync(lockId, 'lock-namespace-v1:deadbeef', { mode: 0o600 });
  const mainSock = join(nt, 'native-terminal.sock');
  const lf1Sock = join(nt, 'native-terminal.lf1.sock');
  for (const sock of [mainSock, lf1Sock]) {
    assert.throws(() => lstatSync(sock), /ENOENT/, 'both endpoint sockets stay absent post-reboot');
  }
  const maps = join(root, 'maps');
  mkdirSync(maps, { recursive: true });
  const legacyMap = { convId: 'other-0', pid: 2147483647, entries: 3 };
  writeFileSync(join(maps, 'dead-1.map'), JSON.stringify(legacyMap));
  writeFileSync(join(maps, 'dead-1.map.lock'), JSON.stringify({ pid: 2147483647 }));
  writeFileSync(join(maps, 'dead-1.map.tmp'), JSON.stringify({ partial: true }));
  const claims = join(root, 'resume-launch-claims');
  mkdirSync(claims, { recursive: true });
  const key = 'abc123';
  const claimPath = join(claims, `${key}.claim`);
  const oldOwner = { token: 'tok-old', pid: 2147483647, convId: 'other-0' };
  writeFileSync(claimPath, JSON.stringify(oldOwner), { mode: 0o600 });
  linkSync(claimPath, `${claimPath}.reclaim`);
  writeFileSync(join(claims, '.deadbeef.pending'), JSON.stringify(oldOwner), { mode: 0o600 });
  const debris = join(root, 'debris');
  mkdirSync(debris, { recursive: true });
  writeFileSync(join(debris, 'identity.lock.tmp.999'), 'partial-identity');
  writeFileSync(join(debris, 'presence-OLD.json.tmp-999-1'), 'partial-presence');
  writeFileSync(join(debris, 'registry.json.tmp.999'), 'partial-registry');
  const registry = {
    version: 1,
    entries: [
      { id: 'bg-dead', sessionClass: 'background', ownerHostPid: 2147483647, convId: 'other-1' },
      { id: 'human-1', sessionClass: 'human', convId: 'other-2' },
      { id: 'unclassified-1', convId: 'other-3' },
    ],
  };
  writeFileSync(join(root, 'registry.json'), JSON.stringify(registry));
  return { nt, lockId, mainSock, lf1Sock, maps, claims, claimPath, debris };
}

test('L0 baseline: old-format two-endpoint reboot fixture preserves a valid lock-id with both sockets absent', (t) => {
  const root = privateTmpRoot(t);
  const f = seedOldFormatFixture(root);
  assert.equal(readFileSync(f.lockId, 'utf8'), 'lock-namespace-v1:deadbeef');
  assert.equal(lstatSync(f.lockId).mode & 0o777, 0o600);
  for (const sock of [f.mainSock, f.lf1Sock]) {
    assert.throws(() => lstatSync(sock), /ENOENT/);
  }
  assert.equal(existsSync(join(f.maps, 'dead-1.map')), true);
  assert.equal(existsSync(join(f.maps, 'dead-1.map.lock')), true);
  assert.equal(existsSync(join(f.maps, 'dead-1.map.tmp')), true);
  assert.equal(existsSync(join(f.debris, 'identity.lock.tmp.999')), true);
  const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
  assert.equal(registry.entries.length, 3);
  assert.ok(registry.entries.some((e) => e.sessionClass === 'human'));
  assert.ok(registry.entries.some((e) => e.sessionClass === undefined));
});

test('L0 baseline: canonical socket override keeps its mate (two-endpoint inventory)', () => {
  const src = readFileSync(
    join(REPO, 'packages/h2a-runtime/src/native-terminal/socket-path.ts'),
    'utf8',
  );
  assert.ok(src.includes('native-terminal.lf1.sock'));
  assert.ok(src.includes('return [historical, compatibleNativeTerminalSocketPath(historical)]'));
});

test('L0 baseline: stale endpoint removal is unlink without journaled quarantine', () => {
  const src = readFileSync(
    join(REPO, 'packages/h2a-runtime/src/native-terminal/server.ts'),
    'utf8',
  );
  assert.ok(src.includes('unlinkOwnedPath(socketPath, socket)'));
  assert.ok(!src.includes('quarantine'));
  const op = readFileSync(
    join(REPO, 'packages/h2a-runtime/src/native-terminal/op.ts'),
    'utf8',
  );
  assert.ok(!op.includes('quarantine'));
});

test('L0 baseline: legacy claim and map debris carries no versioned owner frame', (t) => {
  const root = privateTmpRoot(t);
  const f = seedOldFormatFixture(root);
  const claim = JSON.parse(readFileSync(f.claimPath, 'utf8'));
  assert.deepEqual(Object.keys(claim).sort(), ['convId', 'pid', 'token']);
  const barrier = JSON.parse(readFileSync(`${f.claimPath}.reclaim`, 'utf8'));
  assert.deepEqual(barrier, claim);
  const map = JSON.parse(readFileSync(join(f.maps, 'dead-1.map'), 'utf8'));
  assert.ok(!('ownerFrame' in map) && !('bootId' in map) && !('generation' in map));
  const src = readFileSync(join(REPO, 'packages/h2a-runtime/src/relaunch.ts'), 'utf8');
  assert.ok(src.includes('type ResumeLaunchClaimOwner'));
  assert.ok(!src.includes('ownerFrame'));
  const gc = readFileSync(
    join(REPO, 'packages/h2a/src/runtime/local-files/orphan-gc.ts'),
    'utf8',
  );
  assert.ok(gc.includes('.lock.stale-'));
  assert.ok(!gc.includes('.lock.tmp.'));
});

test('L0 baseline: packaged payload pins stable plugin versions without an integration manifest', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'packages/h2a/package.json'), 'utf8'));
  assert.equal(pkg.version, '0.98.7');
  for (const plugin of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    const manifest = JSON.parse(readFileSync(join(REPO, 'packages/h2a', plugin), 'utf8'));
    assert.equal(manifest.version, '0.98.7');
  }
  assert.equal(existsSync(join(REPO, 'packages/h2a/integration-manifest.json')), false);
  const prepare = readFileSync(join(REPO, 'scripts/release-candidate.mjs'), 'utf8');
  assert.ok(!prepare.includes('plugin.json'));
  const pluginSrc = readFileSync(join(REPO, 'packages/h2a/src/hosts/plugin.ts'), 'utf8');
  for (const host of ['claude', 'codex', 'gemini', 'agy', 'hermes', 'muse', 'vibe', 'opencode']) {
    assert.ok(pluginSrc.includes(`${host}: {`), `adapter inventory names ${host}`);
  }
});
