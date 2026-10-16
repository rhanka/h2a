import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prefixLayout } from '../../src/runtime/handover/authority.js';
import { createManifest } from '../../src/runtime/handover/image.js';
import { digest } from '../../src/runtime/handover/wire.js';
import { publishState } from '../../src/runtime/handover/state.js';

// Small executable controller images for persistence tests, never a packaging proof.
export function installationFixture() {
  const prefix = fs.mkdtempSync(join(tmpdir(), 'mh-l6-installation-'));
  const layout = prefixLayout(prefix, prefix, process.getuid());
  for (const path of ['state', 'state/upgrade', 'state/upgrade/transactions', 'state/upgrade/private',
    'state/upgrade/receipts', 'state/selection-history', 'state/pins', 'images']) {
    fs.mkdirSync(join(layout.managedRoot, path), { recursive: true, mode: 0o700 });
  }
  const installation = { schemaVersion: 1, prefixId: layout.prefixId, canonicalPrefix: prefix,
    uid: process.getuid(), managedRoot: layout.managedRoot };
  publishState(join(layout.managedRoot, 'installation.json'), installation, 'installation');
  const image = (buildId = 'target', protocolVersion = 1) => {
    const stage = join(prefix, 'stage'); fs.mkdirSync(stage, { mode: 0o700 });
    fs.writeFileSync(join(stage, 'entry.mjs'), `export const buildId=${JSON.stringify(buildId)};\n`);
    fs.writeFileSync(join(stage, 'controller.json'), JSON.stringify({ schemaVersion: 1, protocolVersion, entrypoint: 'entry.mjs' }));
    const manifest = createManifest(stage, { packageVersion: '0.98.7', buildId,
      profile: { platform: 'linux', arch: process.arch, libc: 'glibc', nodeMajor: Number(process.versions.node.split('.')[0]), nodeAbi: process.versions.modules },
      entrypoints: { controller: 'entry.mjs', shim: 'entry.mjs' }, startupWaitBudgetMs: 10000,
      maxAttachments: 64, nativeArtifacts: [] });
    fs.writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest));
    const manifestDigest = digest(manifest), root = join(layout.managedRoot, 'images', manifestDigest.slice(7));
    fs.renameSync(stage, root);
    return { packageVersion: manifest.packageVersion, buildId, manifestDigest, entrypoint: 'entry.mjs', root };
  };
  return { layout: installation, state: join(layout.managedRoot, 'state'), image,
    close() { fs.rmSync(prefix, { recursive: true, force: true }); } };
}
