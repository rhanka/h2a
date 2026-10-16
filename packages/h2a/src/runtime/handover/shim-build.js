import fs from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embeddedPackageVersion } from '../mcp-central-descriptor.js';
import { digest } from './wire.js';
import { validate } from './formats.js';

// Pin metadata to the loaded image, never to the mutable selected-build file.
// This reader loads no CLI, business store, identity key or native module.
export function shimBuildInfo() {
  const path = fileURLToPath(import.meta.url);
  const match = /^(.*\/h2a-managed\/[0-9]+\/images\/([a-f0-9]{64}))(?:\/|$)/.exec(path);
  if (!match) return Object.freeze({ packageVersion: embeddedPackageVersion, buildId: 'npm-unmanaged' });
  const manifest = validate('manifest', JSON.parse(fs.readFileSync(join(match[1], 'manifest.json'), 'utf8')));
  if (digest(manifest) !== `sha256:${match[2]}` || !manifest.files.some(f => f.type === 'file' && f.path === relative(match[1], path))) throw new Error('shim_image_metadata_mismatch');
  return Object.freeze({ packageVersion: manifest.packageVersion, buildId: manifest.buildId });
}
