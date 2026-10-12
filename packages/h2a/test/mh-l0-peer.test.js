import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { readCompatibilityEvidence } from '../src/runtime/handover/evidence.js';
import { digest } from '../src/runtime/handover/wire.js';
import { evidence } from './helpers/mh-l0-fixtures.js';

test('L0 network pair: valid future verdict, negative provenance, CAS and lost ACK without duplicate restoration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mh-l0-peer-'));
  const rootKey = Buffer.alloc(32, 0x11); const e = evidence();
  const report = { algorithmVersion: 'fixture-v1', verdict: 'additive-compatible', fixture: true };
  e.verifier.reportDigest = digest(report);
  const context = { service: 'h2a-mcp-central', namespaceId: e.namespaceId, generation: e.attester.generation };
  const delegation = { upgradeId: e.authorization.upgradeId, handoverId: e.authorization.handoverId,
    controllerEpoch: e.authorization.controllerEpoch, transactionEpoch: e.authorization.transactionEpoch,
    targetManifestDigest: e.authorization.selectedManifestDigest, controllerIdentity: e.authorization.delegatedControllerIdentity,
    delegatedBuildId: e.verifier.buildId, delegationReceiptDigest: e.authorization.delegationReceiptDigest,
    controllerAuthorityState: 'ACTIVE', delegationState: 'DELEGATED' };
  const config = join(dir, 'config.json');
  writeFileSync(config, JSON.stringify({ evidence: e, rootKey: rootKey.toString('hex'), context,
    dropAckOnce: true }), { mode: 0o600 });
  const child = spawn(process.execPath, [fileURLToPath(new URL('./helpers/mh-l0-peer.mjs', import.meta.url)), config],
    { env: { PATH: process.env.PATH, XDG_RUNTIME_DIR: dir, XDG_STATE_HOME: dir }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', b => { stderr += b; });
  const lines = createInterface({ input: child.stdout });
  const exit = once(child, 'exit');
  try {
    const first = await Promise.race([once(lines, 'line'), exit.then(([code]) => { throw new Error(`peer exited ${code}: ${stderr}`); })]);
    const { endpoint, pid } = JSON.parse(first[0]); assert.equal(pid, child.pid);
    const proof = await (await fetch(`${endpoint}/evidence`)).json();
    const expected = { mode: e.mode, namespaceId: e.namespaceId, root: e.root, uid: e.uid,
      source: e.source, target: e.target, attester: e.attester, attachmentId: e.attachmentId, inventoryRevision: e.inventoryRevision,
      authorization: e.authorization };
    const options = { rootKey, context, expected, delegation, report, now: 1500, challengeNonce: e.challengeNonce };
    assert.equal(readCompatibilityEvidence(proof, options).verifier.buildId, 'unknown-future-build');
    for (const changed of [{ ...options, now: 2000 }, { ...options, delegation: null },
      { ...options, challengeNonce: 'wrong' }, { ...options, delegation: { ...delegation, controllerEpoch: 99 } },
      { ...options, delegation: { ...delegation, controllerIdentity: { ...delegation.controllerIdentity, pid: 999 } } },
      { ...options, delegation: { ...delegation, targetManifestDigest: `sha256:${'b'.repeat(64)}` } }]) {
      assert.throws(() => readCompatibilityEvidence(proof, changed));
    }
    assert.throws(() => readCompatibilityEvidence({ ...proof, inventoryRevision: 999 }, options));
    const operation = { stepId: 'acquire-a', expectedEpoch: 0, owner: 'G1', checkpoint: 'fixture-checkpoint' };
    const acquire = () => fetch(`${endpoint}/cas`, { method: 'POST', body: JSON.stringify(operation) });
    await assert.rejects(acquire()); // Applied once, ACK dropped by the test-only peer.
    assert.deepEqual(await (await acquire()).json(), { epoch: 1, owner: 'G1', restored: true });
    const conflict = await fetch(`${endpoint}/cas`, { method: 'POST', body: JSON.stringify({ ...operation, owner: 'G2' }) });
    assert.equal(conflict.status, 409);
    assert.deepEqual(await (await fetch(`${endpoint}/counters`)).json(), { acquisitions: 1, restorations: 1 });
  } finally {
    lines.close(); child.stdin.end();
    const [code] = await exit; assert.equal(code, 0, stderr);
    rmSync(dir, { recursive: true, force: true });
  }
});
