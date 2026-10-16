import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { privateDirectory } from '../handover/state.js';
import { verifyImage } from '../handover/image.js';
import { imageExecutionContext, verifyImageLoader } from './image-execution.js';

// Only builtin/pure verification modules are loaded before this gate. The
// descriptor is covered by the image manifest; its loader lives outside npm.
export async function ensureManagedImageExecution(entryUrl) {
  const entry = fs.realpathSync(fileURLToPath(entryUrl));
  const match = /^(.*\/h2a-managed\/(\d+)\/images\/([0-9a-f]{64}))\//.exec(entry);
  if (!match) return undefined; // Development or explicitly unmanaged payload.
  if (Number(match[2]) !== process.getuid()) throw new Error('foreign_installation_authority');
  const root = match[1], manifestDigest = 'sha256:' + match[3], previous = imageExecutionContext();
  if (previous) {
    if (previous.root !== root || previous.manifestDigest !== manifestDigest) throw new Error('image_context_conflict');
    return previous;
  }
  privateDirectory(root);
  const manifest = JSON.parse(fs.readFileSync(join(root, 'manifest.json'), 'utf8'));
  verifyImage(root, manifest, manifestDigest);
  const descriptor = JSON.parse(fs.readFileSync(join(root, 'execution.json'), 'utf8'));
  if (Object.keys(descriptor).sort().join(',') !== 'loaderDigest,schemaVersion' || descriptor.schemaVersion !== 1 ||
      !/^sha256:[0-9a-f]{64}$/.test(descriptor.loaderDigest)) throw new Error('image_execution_descriptor_invalid');
  const managedRoot = dirname(dirname(root)), loader = join(managedRoot, 'bootstrap', 'image-loader-' + descriptor.loaderDigest.slice(7) + '.mjs');
  verifyImageLoader(loader, managedRoot, descriptor.loaderDigest);
  const url = pathToFileURL(loader); url.searchParams.set('image', root);
  await import(url.href);
  const installed = imageExecutionContext();
  if (!installed || installed.root !== root || installed.manifestDigest !== manifestDigest) throw new Error('image_context_missing');
  return installed;
}
