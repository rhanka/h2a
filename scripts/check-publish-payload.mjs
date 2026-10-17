import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPublishedPayload } from '../packages/h2a/src/runtime/upgrade/published-payload.js';

// This gate accepts the closed staged tree, never a raw workspace publication.
// The manifest hashes the shrinkwrap and every dependency's metadata as code.
export function verifyPublishablePayload(directory) {
  const published = readPublishedPayload(directory), root = published.root;
  const json = path => JSON.parse(fs.readFileSync(join(root, path), 'utf8'));
  const pkg = json('package.json'), lock = json('npm-shrinkwrap.json');
  if (!['@sentropic/h2a', '@sentropic/h2a-runtime'].includes(pkg.name) || pkg.private ||
    lock.lockfileVersion !== 3 || lock.name !== pkg.name || lock.version !== pkg.version || !lock.packages?.['']) throw Error('release_shrinkwrap_invalid');
  const keys = Object.keys(lock.packages), paths = new Set(keys), files = new Set(published.manifest.files.filter(row => row.type === 'file').map(row => row.path));
  const dependencyPath = (requester, name) => {
    if (name === pkg.name) return '';
    for (let cursor = requester;; cursor = dirname(cursor) === '.' ? '' : dirname(cursor)) {
      const candidate = cursor ? `${cursor}/node_modules/${name}` : `node_modules/${name}`;
      if (paths.has(candidate)) return candidate;
      if (!cursor || cursor === '.') return undefined;
    }
  };
  for (const path of keys) {
    if (path && (!path.startsWith('node_modules/') || path.split('/').some(part => !part || part === '.' || part === '..'))) throw Error('release_shrinkwrap_path_invalid');
    const metadataPath = path ? `${path}/package.json` : 'package.json';
    if (!files.has(metadataPath)) throw Error('release_dependency_unrecorded');
    const metadata = json(metadataPath), record = lock.packages[path];
    if (record.name !== metadata.name || record.version !== metadata.version ||
      ['scripts', 'peerDependencies', 'peerDependenciesMeta', 'optionalDependencies', 'devDependencies'].some(field => metadata[field] !== undefined) ||
      JSON.stringify(record.dependencies ?? {}) !== JSON.stringify(metadata.dependencies ?? {})) throw Error('release_dependency_metadata_invalid');
    for (const [name, version] of Object.entries(metadata.dependencies ?? {})) {
      const target = dependencyPath(path, name);
      if (target === undefined || lock.packages[target]?.version !== version) throw Error('release_dependency_not_exact:' + name + ':requester=' + (path || '<root>') + ':wanted=' + version + ':target=' + target + ':observed=' + lock.packages[target]?.version);
    }
  }
  if (JSON.stringify([...(pkg.bundleDependencies ?? [])].sort()) !== JSON.stringify(Object.keys(pkg.dependencies ?? {}).sort())) throw Error('release_bundle_incomplete');
  const sibling = pkg.name === '@sentropic/h2a' ? '@sentropic/h2a-runtime' : '@sentropic/h2a';
  if (pkg.dependencies[sibling] !== pkg.version) throw Error('release_runtime_not_lockstep');
  return published;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { verifyPublishablePayload(process.cwd()); }
  catch (cause) {
    process.stderr.write('Publish requires the closed payload tarball. Use node scripts/package-release.mjs --package @sentropic/h2a (or @sentropic/h2a-runtime). ' + cause.message + '\n');
    process.exitCode = 1;
  }
}
