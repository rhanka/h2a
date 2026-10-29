import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { digest } from '../handover/wire.js';
import { verifyImage } from '../handover/image.js';
import { assertImageRuntime } from './image-policy.js';

// Published code is shared by the two N-API profiles. Only manifest.json differs
// when an independent managed image is prepared; it is already the image
// format's sole self-digest exclusion. No code/dependency exclusion is added.
export function readPublishedPayload(directory) {
  const root = fs.realpathSync(directory), path = join(root, 'manifest.json'), info = fs.lstatSync(path);
  if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o022)) throw Error('published_manifest_unqualified');
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let published;
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || (opened.mode & 0o022) || opened.dev !== info.dev || opened.ino !== info.ino) throw Error('published_manifest_changed');
    const bytes = fs.readFileSync(fd, 'utf8'), after = fs.fstatSync(fd), current = fs.lstatSync(path);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs ||
      current.dev !== opened.dev || current.ino !== opened.ino) throw Error('published_manifest_changed');
    published = JSON.parse(bytes);
  } finally { fs.closeSync(fd); }
  if (!published || typeof published !== 'object' || Array.isArray(published) ||
    Object.keys(published).sort().join(',') !== 'kind,manifests,schemaVersion' || published.schemaVersion !== 1 ||
    published.kind !== 'h2a-published-payload' || !published.manifests || typeof published.manifests !== 'object' || Array.isArray(published.manifests)) {
    throw Error('published_manifest_invalid');
  }
  const names = Object.keys(published.manifests);
  if (!names.length || names.some(key => !['22', '24'].includes(key))) throw Error('published_profile_unknown');
  const manifest = published.manifests[process.versions.node.split('.')[0]];
  if (!manifest) throw Error('published_profile_absent');
  assertImageRuntime(manifest);
  let codeDigest;
  for (const key of names) {
    const candidate = published.manifests[key];
    if (candidate.profile?.nodeMajor !== Number(key)) throw Error('published_profile_mismatch');
    verifyImage(root, candidate, digest(candidate));
    const current = digest({ files: candidate.files, packageVersion: candidate.packageVersion,
      buildId: candidate.buildId, entrypoints: candidate.entrypoints });
    if (codeDigest && current !== codeDigest) throw Error('published_payload_profiles_disagree');
    codeDigest = current;
  }
  const pkg = JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8'));
  if (pkg.version !== manifest.packageVersion) throw Error('published_package_version_mismatch');
  return { root, packageName: pkg.name, manifest, manifestDigest: digest(manifest), publishedDigest: digest(published) };
}
function syncTree(root) {
  for (const name of fs.readdirSync(root)) {
    const path = join(root, name), info = fs.lstatSync(path);
    if (info.isDirectory()) syncTree(path);
    else if (info.isFile()) {
      const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
  }
  const fd = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
// Preparation is independent of H4 authority. It neither selects nor changes a
// mutable npm tree. The caller still needs maintained exclusion before selection.
export function preparePublishedImage(source, destination) {
  const published = readPublishedPayload(source);
  destination = resolve(destination);
  if (fs.realpathSync(dirname(destination)) !== dirname(destination)) throw Error('image_destination_noncanonical');
  fs.mkdirSync(destination, { mode: 0o700 });
  try {
    // Keep the exclusive directory reservation. Node 24 rejects copying a root
    // onto that existing directory with errorOnExist, so copy its children.
    for (const name of fs.readdirSync(published.root)) {
      fs.cpSync(join(published.root, name), join(destination, name),
        { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
    }
    fs.chmodSync(destination, 0o700);
    verifyImage(destination, published.manifest, published.manifestDigest);
    fs.writeFileSync(join(destination, 'manifest.json'), JSON.stringify(published.manifest, null, 2) + '\n');
    syncTree(destination);
    const parentFd = fs.openSync(dirname(destination), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(parentFd); } finally { fs.closeSync(parentFd); }
    verifyImage(destination, published.manifest, published.manifestDigest);
    return { ...published, root: destination };
  } catch (cause) { fs.rmSync(destination, { recursive: true, force: true }); throw cause; }
}
