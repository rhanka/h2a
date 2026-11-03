import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { digest } from './wire.js';
import { safeRelative, validate } from './formats.js';

const bytesHash = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
function payload(root) {
  if (!lstatSync(root).isDirectory()) throw new Error('image_directory_required');
  const files = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name); const rel = relative(root, path).split(sep).join('/');
      if (rel === 'manifest.json') continue; // Sole exclusion; avoids self-digest cycles.
      const info = lstatSync(path); const mode = info.mode & 0o777;
      if (info.isSymbolicLink()) {
        const raw = readlinkSync(path);
        const resolved = resolve(directory, raw);
        const target = relative(root, resolved).split(sep).join('/');
        if (!safeRelative(target)) throw new Error('image_link_outside');
        const final = relative(root, realpathSync(path)).split(sep).join('/');
        if (!safeRelative(final)) throw new Error('image_link_outside');
        files.push({ path: rel, type: 'symlink', mode, digest: bytesHash(Buffer.from(raw)), target });
      } else if (info.isDirectory()) {
        files.push({ path: rel, type: 'directory', mode, digest: null, target: null }); walk(path);
      } else if (info.isFile()) {
        if (info.nlink !== 1) throw new Error('image_hardlink');
        files.push({ path: rel, type: 'file', mode, digest: bytesHash(readFileSync(path)), target: null });
      } else throw new Error('image_special_file');
    }
  };
  walk(root);
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function validateContents(manifest) {
  const entries = new Map(manifest.files.map(f => [f.path, f]));
  if (entries.size !== manifest.files.length || entries.has('manifest.json')) throw new Error('invalid_manifest_entries');
  const expectedAbi = { 22: '127', 24: '137' }[manifest.profile.nodeMajor];
  if (manifest.profile.nodeAbi !== expectedAbi) throw new Error('native_profile_mismatch');
  for (const entry of Object.values(manifest.entrypoints)) {
    if (!entries.has(entry) || entries.get(entry).type !== 'file') throw new Error('image_entrypoint_missing');
  }
  for (const native of manifest.nativeArtifacts) {
    if (native.nodeAbi !== manifest.profile.nodeAbi || native.arch !== manifest.profile.arch ||
        native.libc !== manifest.profile.libc) throw new Error('native_profile_mismatch');
    const entry = entries.get(native.path);
    if (!entry || entry.type !== 'file') throw new Error('native_artifact_missing');
    if (entry.digest !== native.digest) throw new Error('native_digest_mismatch');
    if (native.probePath !== 'node_modules/node-pty' || !entries.has(`${native.probePath}/package.json`)) {
      throw new Error('native_probe_missing');
    }
  }
}
export function createManifest(root, metadata) {
  const manifest = validate('manifest', { schemaVersion: 1, ...metadata, files: payload(root) });
  validateContents(manifest);
  return manifest;
}
export function verifyImage(root, manifest, expectedManifestDigest) {
  if (typeof expectedManifestDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(expectedManifestDigest)) {
    throw new Error('manifest_digest_required');
  }
  validate('manifest', manifest); validateContents(manifest);
  if (digest(manifest) !== expectedManifestDigest || digest(payload(root)) !== digest(manifest.files)) {
    throw new Error('payload_mismatch');
  }
  return { verified: true, manifestDigest: expectedManifestDigest };
}
