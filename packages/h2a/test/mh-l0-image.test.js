import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, linkSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createManifest, verifyImage } from '../src/runtime/handover/image.js';
import { auditModuleGraph } from '../../../scripts/mh-l0-image-audit.mjs';
import { hash } from './helpers/mh-l0-fixtures.js';
import { digest } from '../src/runtime/handover/wire.js';
import { createHash } from 'node:crypto';

const metadata = { packageVersion: '0.98.7', buildId: 'fixture',
  profile: { platform: 'linux', arch: 'x64', libc: 'glibc', nodeMajor: 22, nodeAbi: '127' },
  entrypoints: { shim: 'entry.mjs' }, startupWaitBudgetMs: 10000, maxAttachments: 64, nativeArtifacts: [] };

test('U10/U12 foundations: deterministic complete manifest, no hardlink or outgoing symlink', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mh-l0-image-'));
  try {
    mkdirSync(join(dir, 'image')); const root = join(dir, 'image');
    writeFileSync(join(root, 'entry.mjs'), "import './dep.mjs';\nimport 'node:fs';\n");
    writeFileSync(join(root, 'dep.mjs'), 'export const answer=42;\n');
    const m = createManifest(root, metadata);
    assert.deepEqual(createManifest(root, metadata), m);
    assert.equal(verifyImage(root, m, digest(m)).verified, true);
    assert.throws(() => verifyImage(root, m), /manifest_digest_required/);
    assert.deepEqual((await auditModuleGraph(root, m)).external, []);
    writeFileSync(join(root, 'dep.mjs'), 'export const answer=43;\n');
    assert.throws(() => verifyImage(root, m, digest(m)), /payload_mismatch/);
    rmSync(join(root, 'dep.mjs')); symlinkSync('../external.mjs', join(root, 'dep.mjs'));
    assert.throws(() => createManifest(root, metadata), /image_link_outside/);
    rmSync(join(root, 'dep.mjs')); writeFileSync(join(dir, 'external.mjs'), 'external');
    linkSync(join(dir, 'external.mjs'), join(root, 'dep.mjs'));
    assert.throws(() => createManifest(root, metadata), /image_hardlink/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('U12 foundation: parent/HOME/NODE_PATH decoys cannot satisfy a missing internal dependency', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mh-l0-closure-'));
  try {
    const root = join(dir, 'image'); mkdirSync(root);
    writeFileSync(join(root, 'entry.mjs'), "import 'deceptive';\n");
    mkdirSync(join(dir, 'node_modules', 'deceptive'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'deceptive', 'index.js'), "throw Error('decoy_loaded');");
    await assert.rejects(auditModuleGraph(root, createManifest(root, metadata)), /image_external_module/);
    writeFileSync(join(root, 'entry.mjs'), "import './missing.mjs';\n");
    await assert.rejects(auditModuleGraph(root, createManifest(root, metadata)), /image_dependency_missing/);
    writeFileSync(join(root, 'entry.mjs'), 'const p="./missing.mjs"; import(p);\n');
    await assert.rejects(auditModuleGraph(root, createManifest(root, metadata)), /image_dynamic_resolution/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('native manifest refuses a wrong ABI and absent binary before selection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mh-l0-native-manifest-'));
  try {
    writeFileSync(join(dir, 'entry.mjs'), 'export {};');
    assert.throws(() => createManifest(dir, { ...metadata, nativeArtifacts: [{ path: 'pty.node', digest: hash,
      nodeAbi: '115', arch: 'x64', libc: 'glibc', toolchainDigest: hash, probePath: 'node_modules/node-pty' }] }), /native_profile_mismatch/);
    assert.throws(() => createManifest(dir, { ...metadata, nativeArtifacts: [{ path: 'pty.node', digest: hash,
      nodeAbi: '127', arch: 'x64', libc: 'glibc', toolchainDigest: hash, probePath: 'node_modules/node-pty' }] }), /native_artifact_missing/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('R1 should refuse a native digest divergent from the payload even when the rest of the manifest is valid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mh-l1-native-digest-'));
  try {
    writeFileSync(join(dir, 'entry.mjs'), 'export {};');
    writeFileSync(join(dir, 'pty.node'), 'native-digest-fixture');
    mkdirSync(join(dir, 'node_modules/node-pty'), { recursive: true });
    writeFileSync(join(dir, 'node_modules/node-pty/package.json'), '{}');
    const native = { path: 'pty.node', digest: 'sha256:' + createHash('sha256').update('native-digest-fixture').digest('hex'),
      nodeAbi: '127', arch: 'x64', libc: 'glibc', toolchainDigest: hash, probePath: 'node_modules/node-pty' };
    const valid = createManifest(dir, { ...metadata, nativeArtifacts: [native] });
    assert.equal(verifyImage(dir, valid, digest(valid)).verified, true);
    const mismatch = { ...valid, nativeArtifacts: [{ ...native, digest: hash }] };
    assert.throws(() => verifyImage(dir, mismatch, digest(mismatch)), /native_digest_mismatch/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('owner Node 22 minimum should reject Node 20 payloads and recognize the Node 24 ABI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mh-l1-node-profile-'));
  try {
    writeFileSync(join(dir, 'entry.mjs'), 'export {};');
    assert.throws(() => createManifest(dir, { ...metadata, profile: { ...metadata.profile, nodeMajor: 20, nodeAbi: '115' } }), /invalid_format|native_profile_mismatch/);
    const node24 = createManifest(dir, { ...metadata, profile: { ...metadata.profile, nodeMajor: 24, nodeAbi: '137' } });
    assert.equal(verifyImage(dir, node24, digest(node24)).verified, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
