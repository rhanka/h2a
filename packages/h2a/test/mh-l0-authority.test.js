import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prefixLayout, establishDomain, assertDomainFrame, acquirePreclaim, recoverDomainAfterBoot } from '../src/runtime/handover/authority.js';
import { identity, hash } from './helpers/mh-l0-fixtures.js';
import { procClassifier } from './helpers/mh-l0-proc-frame.js';

test('physical prefix identity survives aliases and rejects a different legacy lock directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mh-l0-prefix-'));
  try {
    mkdirSync(join(dir, 'prefix'), { mode: 0o700 }); symlinkSync(join(dir, 'prefix'), join(dir, 'alias'));
    const a = prefixLayout(join(dir, 'prefix'), join(dir, 'alias'), process.getuid());
    const b = prefixLayout(join(dir, 'alias'), join(dir, 'prefix'), process.getuid());
    assert.equal(a.prefixId, b.prefixId);
    assert.equal(a.managedRoot, join(dir, 'prefix', 'h2a-managed', String(process.getuid())));
    assert.throws(() => prefixLayout(join(dir, 'prefix'), dir, process.getuid()), /legacy_prefix_mismatch/);
    assert.throws(() => prefixLayout(join(dir, 'prefix'), join(dir, 'prefix'), process.getuid() + 1), /prefix_owner_mismatch/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('M04 foundation: shared exclusive anchor, explicit netns admission and bounded real abstract socket', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mh-l0-authority-'));
  try {
    const classify = await procClassifier(dir);
    const frame = { machineId: identity.machineId, bootId: identity.bootId,
      pidNamespace: identity.pidNamespace, nsNet: identity.nsNet };
    const domain = { schemaVersion: 1, namespaceId: 'ns-a', prefixId: hash, uid: process.getuid(),
      canonicalMarkerLocation: join(dir, 'marker.json'), canonicalRoot: join(dir, 'root'),
      processFrame: frame, lockSecretReference: 'private/lock-key.json', revision: 1 };
    const path = join(dir, 'authority-domain.json');
    assert.deepEqual(establishDomain(path, domain), domain);
    assert.deepEqual(establishDomain(path, domain), domain);
    assert.throws(() => establishDomain(path, { ...domain, prefixId: `sha256:${'b'.repeat(64)}` }), /foreign_installation_authority/);
    assert.throws(() => assertDomainFrame(domain, { ...frame, nsNet: '999' }, classify), /authority_netns_mismatch/);
    assert.throws(() => assertDomainFrame(domain, { ...frame, nsNet: undefined }, classify), /authority_namespace_unknown/);
    assert.throws(() => assertDomainFrame(domain, { ...frame, bootId: '22222222-2222-4222-8222-222222222222' }, classify), /authority_recovery_required/);
    const first = await acquirePreclaim(domain, frame, Buffer.alloc(32, 0x22), classify);
    try {
      await assert.rejects(acquirePreclaim(domain, frame, Buffer.alloc(32, 0x22), classify), /authority_lock_unavailable/);
      await assert.rejects(acquirePreclaim(domain, { ...frame, nsNet: '999' }, Buffer.alloc(32, 0x22), classify), /authority_netns_mismatch/);
    } finally { await first.release(); }
    const next = await acquirePreclaim(domain, frame, Buffer.alloc(32, 0x22), classify); await next.release();
    const reboot = { ...frame, bootId: '22222222-2222-4222-8222-222222222222' };
    assert.throws(() => recoverDomainAfterBoot(path, { ...domain, revision: 2 }, frame, classify), /authority_recovery_unproven/);
    const recovered = recoverDomainAfterBoot(path, { ...domain, processFrame: reboot, revision: 2 },
      { ...reboot, startTime: 999, bootTimeMs: 123456 }, classify);
    assert.equal(recovered.processFrame.bootId, reboot.bootId);
    assertDomainFrame(recovered, reboot, classify);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
