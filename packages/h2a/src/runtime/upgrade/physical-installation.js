import fs from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { prefixLayout } from '../handover/authority.js';
import { digest } from '../handover/wire.js';

const changed = () => { throw new Error('legacy_installation_changed'); };
const stamp = info => ({ dev: info.dev, ino: info.ino, uid: info.uid, mode: info.mode,
  nlink: info.nlink, size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs });
const same = (a, b) => digest(a) === digest(b);
const freeze = value => {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
};
function directory(path) {
  const info = fs.lstatSync(path);
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o022)) {
    throw new Error('legacy_directory_unqualified');
  }
  // Child creation (the compatible lock, I, staging) does not change the
  // directory's authority. Do not bind payload evidence to its mtime/nlink.
  return { dev: info.dev, ino: info.ino, uid: info.uid, mode: info.mode };
}
function file(path) {
  const qualify = info => {
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() || (info.mode & 0o022)) {
      throw new Error('legacy_file_unqualified');
    }
    return stamp(info);
  };
  const observed = qualify(fs.lstatSync(path));
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!same(observed, qualify(fs.fstatSync(fd)))) changed();
    const bytes = fs.readFileSync(fd);
    if (!same(observed, qualify(fs.fstatSync(fd))) || !same(observed, qualify(fs.lstatSync(path)))) changed();
    return { ...observed, digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex'), bytes };
  } finally { fs.closeSync(fd); }
}
function command(path, entrypoint) {
  const info = fs.lstatSync(path);
  if (!info.isSymbolicLink() || info.uid !== process.getuid()) throw new Error('legacy_command_unqualified');
  const target = fs.readlinkSync(path);
  if (resolve(dirname(path), target) !== entrypoint || fs.realpathSync(path) !== entrypoint) {
    throw new Error('legacy_command_unqualified');
  }
  if (!same(stamp(info), stamp(fs.lstatSync(path)))) changed();
  return { ...stamp(info), target };
}
const withoutBytes = ({ bytes, ...value }) => value;

// This is physical provenance, not publisher authentication or H4 authority.
// Never query the caller's npm configuration or execute the package being read.
export function inspectLegacyInstallation({ prefix, entrypoint, legacyPrefix }) {
  if (![prefix, entrypoint, legacyPrefix].every(value => typeof value === 'string' && isAbsolute(value))) {
    throw new Error('legacy_installation_paths_required');
  }
  const requestedEntry = resolve(entrypoint), entry = fs.realpathSync(requestedEntry);
  const match = entry.match(/^(.*)\/lib\/node_modules\/@sentropic\/h2a\/dist\/bin\.js$/);
  if (!match) throw new Error('legacy_entry_location_invalid');
  const layout = prefixLayout(match[1], legacyPrefix, process.getuid());
  const candidate = fs.statSync(fs.realpathSync(prefix)), actual = fs.statSync(layout.canonicalPrefix);
  if (candidate.dev !== actual.dev || candidate.ino !== actual.ino) throw new Error('legacy_prefix_mismatch');
  const packageDirectory = join(layout.canonicalPrefix, 'lib/node_modules/@sentropic/h2a');
  if (entry !== join(packageDirectory, 'dist/bin.js')) throw new Error('legacy_entry_location_invalid');
  const directories = [layout.canonicalPrefix, join(layout.canonicalPrefix, 'lib'),
    join(layout.canonicalPrefix, 'lib/node_modules'), join(layout.canonicalPrefix, 'lib/node_modules/@sentropic'),
    packageDirectory, join(packageDirectory, 'dist'), join(layout.canonicalPrefix, 'bin')];
  const directoryEvidence = directories.map(path => ({ path, ...directory(path) }));
  const metadataPath = join(packageDirectory, 'package.json'), metadata = file(metadataPath), executable = file(entry);
  let pkg;
  try { pkg = JSON.parse(metadata.bytes); } catch { throw new Error('legacy_package_metadata_invalid'); }
  const bin = typeof pkg?.bin === 'string' ? pkg.bin : pkg?.bin?.h2a;
  if (pkg?.name !== '@sentropic/h2a' || typeof pkg.version !== 'string' ||
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(pkg.version) ||
    !['dist/bin.js', './dist/bin.js'].includes(bin)) throw new Error('legacy_package_metadata_invalid');
  const commandPath = join(layout.canonicalPrefix, 'bin/h2a'), originalCommand = command(commandPath, entry);
  // Reads do not form a transaction. Reject a changed observation rather than
  // certifying a mixture of two npm installations or two command links.
  if (!same(withoutBytes(metadata), withoutBytes(file(metadataPath))) ||
    !same(withoutBytes(executable), withoutBytes(file(entry))) ||
    !same(originalCommand, command(commandPath, entry)) ||
    directoryEvidence.some(row => !same(row, { path: row.path, ...directory(row.path) })) ||
    fs.realpathSync(requestedEntry) !== entry) changed();
  try {
    const final = prefixLayout(prefix, legacyPrefix, process.getuid());
    if (final.canonicalPrefix !== layout.canonicalPrefix) changed();
  } catch (cause) { throw new Error('legacy_installation_changed', { cause }); }
  const evidence = { schemaVersion: 1, canonicalPrefix: layout.canonicalPrefix, prefixId: layout.prefixId,
    uid: layout.uid, packageDirectory, entrypoint: entry, packageVersion: pkg.version,
    requestedPrefix: resolve(prefix), legacyPrefix: resolve(legacyPrefix), requestedEntry,
    directories: directoryEvidence, metadata: withoutBytes(metadata), entry: withoutBytes(executable),
    commandPath, command: originalCommand, lateLoadSafety: 'unverified', managedImage: false };
  return freeze(evidence);
}

// Caller must still hold compatible exclusion for any later publication. This
// comparison does not fence noncooperating npm or grant admission/selection.
export function assertLegacyInstallationUnchanged(evidence) {
  let observed;
  try { observed = inspectLegacyInstallation({ prefix: evidence.requestedPrefix,
    entrypoint: evidence.requestedEntry, legacyPrefix: evidence.legacyPrefix }); }
  catch (cause) { throw new Error('legacy_installation_changed', { cause }); }
  if (!same(observed, evidence)) changed();
  return observed;
}
