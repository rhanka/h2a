// Hidden `__operator-break` plumbing: the runtime CLI delegates here over the
// `h2a` binary so the runtime dist never names the core package.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runIdentityOperatorBreak } from '../dist/identity-operator-break.js';
import { identitySelf } from '../dist/runtime/local-files/identity-fence.js';

function streams() {
  let stdout = '', stderr = '';
  return {
    stdout: { write: (c) => { stdout += c; return true; } },
    stderr: { write: (c) => { stderr += c; return true; } },
    text: () => ({ stdout, stderr }),
  };
}

function deadPid() {
  const r = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  assert.equal(r.status, 0);
  return r.pid;
}

function setupIdentityLock() {
  const dir = fs.mkdtempSync(join(tmpdir(), 'opbreak-'));
  const root = join(dir, 'store');
  const id = join(root, 'identity');
  fs.mkdirSync(id, { recursive: true });
  // V2 tokens are exactly 32 lowercase hex chars (core parser rejects the rest).
  const token = createHash('sha256').update(dir).digest('hex').slice(0, 32);
  const rec = {
    recordVersion: 2, protocol: 'identity-binding-fence-v1', platform: 'linux',
    publication: 'link', ...identitySelf(), pid: deadPid(), token, fenceEpoch: token, at: Date.now(),
  };
  const lock = join(id, '.lock');
  fs.writeFileSync(lock, JSON.stringify(rec));
  fs.writeFileSync(join(id, 'bindings.jsonl'), '{"host":"claude"}\n');
  return { dir, root, lock, token };
}

function clean(x) { fs.rmSync(x.dir, { recursive: true, force: true }); }

test('__operator-break unlocks a dead-holder identity lock with operator JSON', () => {
  const x = setupIdentityLock();
  try {
    const s = streams();
    const code = runIdentityOperatorBreak(['--lock', x.lock, '--token', x.token], s);
    assert.equal(code, 0);
    const { stdout, stderr } = s.text();
    assert.equal(stderr, '');
    const body = JSON.parse(stdout.trim());
    assert.equal(body.path, 'identity/.lock');
    assert.equal(body.broken, true);
  } finally { clean(x); }
});

test('__operator-break refuses a token mismatch with the runtime wording', () => {
  const x = setupIdentityLock();
  try {
    const s = streams();
    const code = runIdentityOperatorBreak(['--lock', x.lock, '--token', '0'.repeat(64)], s);
    assert.equal(code, 1);
    const { stdout, stderr } = s.text();
    const body = JSON.parse(stdout.trim());
    assert.equal(body.broken, false);
    assert.equal(body.reason, 'token-mismatch');
    assert.match(stderr, /\[h2a\] lock break refused: token-mismatch/);
  } finally { clean(x); }
});

test('__operator-break reports an absent succession lock without touching the layout rule', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'opbreak-'));
  try {
    const s = streams();
    const missing = join(dir, 'succ.LOCK');
    const code = runIdentityOperatorBreak(['--lock', missing, '--token', 'a'.repeat(32)], s);
    assert.equal(code, 1);
    const { stdout } = s.text();
    const body = JSON.parse(stdout.trim());
    assert.equal(body.path, missing);
    assert.equal(body.broken, false);
    assert.equal(body.reason, 'absent');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('__operator-break rejects missing flags with usage (exit 2)', () => {
  const s = streams();
  const code = runIdentityOperatorBreak(['--lock', '/x/y.LOCK'], s);
  assert.equal(code, 2);
  assert.match(s.text().stderr, /missing required --token/);
});
