import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { buildPackagingPrototype } from '../../../../scripts/mh-l1-package-prototype.mjs';
import { digest } from '../../src/runtime/handover/wire.js';
import { publishState } from '../../src/runtime/handover/state.js';

export async function managedImage() {
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l5-image-'));
  try {
    const managedRoot = join(dir, 'h2a-managed', String(process.getuid())), state = join(managedRoot, 'state');
    const images = join(managedRoot, 'images'), root = join(dir, 'store'), runtime = join(dir, 'run');
    for (const path of [images, state, root, runtime]) fs.mkdirSync(path, { recursive: true, mode: 0o700 });
    const payload = await buildPackagingPrototype(join(dir, 'payload'), { buildId: 'fixture-mh-l5-source', managedRoot });
    const image = join(images, payload.manifestDigest.slice(7)); fs.renameSync(payload.root, image);
    const installation = { schemaVersion: 1, canonicalPrefix: dir, uid: process.getuid(), managedRoot,
      prefixId: digest({ canonicalPrefix: dir, uid: process.getuid() }) };
    publishState(join(managedRoot, 'installation.json'), installation, 'installation');
    const npmBin = join(dir, 'lib/node_modules/@sentropic/h2a/dist/bin.js');
    fs.mkdirSync(join(dir, 'bin'), { mode: 0o700 }); fs.mkdirSync(join(npmBin, '..'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(npmBin, '// test-only H4 router fixture\n', { mode: 0o600 }); fs.symlinkSync(npmBin, join(dir, 'bin/h2a'));
    const selection = { schemaVersion: 1, prefixId: installation.prefixId, canonicalPrefix: dir, uid: process.getuid(),
      selectionEpoch: 1, packageVersion: payload.manifest.packageVersion, buildId: payload.manifest.buildId,
      manifestDigest: payload.manifestDigest, entrypoint: 'dist/bin.js', previousSelectionReference: null, upgradeId: 'u' };
    const selectionPath = join(state, 'selected-build.json'); publishState(selectionPath, selection, 'selection');
    const environment = { ...process.env, H2A_ROOT: root, XDG_RUNTIME_DIR: runtime }; delete environment.NODE_OPTIONS; delete environment.NODE_PATH;
    const children = [];
    return { dir, state, root, runtime, image, installation, payload, selection, selectionPath, children,
      startOptions: { directory: join(runtime, 'h2a-mcp-central'), root, installation, fallbackEntry: join(image, 'dist/bin.js'),
        environment, kind: 'controller', onSpawn: child => { child.closedForTest = once(child, 'close'); children.push(child); } },
      async close() {
        for (const child of children) if (child.exitCode === null && child.signalCode === null) { child.ref(); child.kill('SIGTERM'); await child.closedForTest; }
        fs.rmSync(dir, { recursive: true, force: true });
      } };
  } catch (error) { fs.rmSync(dir, { recursive: true, force: true }); throw error; }
}
