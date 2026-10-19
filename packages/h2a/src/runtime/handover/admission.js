import fs from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, join, basename, resolve } from 'node:path';
import { digest } from './wire.js';
import { validate } from './formats.js';
import { privateDirectory, readState, publishState, replaceState } from './state.js';
import { acquirePreclaim, establishDomain } from './authority.js';
import { readProcessFrame, classifyDurableProcFrame } from './proc-identity.js';

export function currentIdentity() {
  const frame = readProcessFrame();
  if (!frame.machineId || !frame.bootId || !frame.pidNamespace || !frame.nsNet || !Number.isSafeInteger(frame.startTime)) throw new Error('authority_namespace_unknown');
  return { machineId: frame.machineId, bootId: frame.bootId, pidNamespace: frame.pidNamespace,
    nsNet: frame.nsNet, startTime: frame.startTime, pid: process.pid };
}
export function canonicalRootPath(path) {
  let cursor = resolve(path); const suffix = [];
  for (;;) {
    try { return join(fs.realpathSync(cursor), ...suffix.reverse()); }
    catch (error) {
      if (error.code !== 'ENOENT' || dirname(cursor) === cursor) throw error;
      suffix.push(basename(cursor)); cursor = dirname(cursor);
    }
  }
}

// This primitive reads a recorded owner, never uses HTTP as a death oracle.
export function observeProcess(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const end = raw.lastIndexOf(') ');
    const startTime = end >= 0 ? Number(raw.slice(end + 2).split(' ')[19]) : NaN;
    return Number.isSafeInteger(startTime) && startTime >= 0 ? { startTime } : {};
  } catch (error) {
    if (error.code !== 'ENOENT') return {};
    try { fs.readFileSync('/proc/self/stat'); return { absent: true, visible: true }; } catch { return {}; }
  }
}

export function ownerLiveness(marker, current, observe = observeProcess) {
  const recorded = marker.processIdentity;
  if (!recorded) return 'unknown'; // Legacy provenance is not retroactively invented.
  const verdict = classifyDurableProcFrame(recorded, current);
  if (verdict === 'stale-boot') return 'dead';
  if (verdict !== 'current' || recorded.nsNet !== current.nsNet) return 'unknown';
  const proc = observe(recorded.pid);
  if (proc.absent && proc.visible) return 'dead';
  if (!Number.isSafeInteger(proc.startTime)) return 'unknown';
  return proc.startTime === recorded.startTime ? 'alive' : 'dead';
}

export function readMarkerObservation(path) {
  privateDirectory(dirname(path));
  let info;
  try { info = fs.lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600) throw new Error('private_state_required');
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.uid !== process.getuid() || (opened.mode & 0o777) !== 0o600 ||
      opened.dev !== info.dev || opened.ino !== info.ino) throw new Error('marker_compare_failed');
    const value = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (value.schemaVersion !== undefined) validate('marker', value);
    else if (!value.endpoint || !value.generation || !Number.isSafeInteger(value.pid) || value.pid < 1) throw new Error('marker_corrupt');
    return { value, dev: opened.dev, ino: opened.ino, digest: digest(value) };
  } finally { fs.closeSync(fd); }
}

export function compareMarker(path, expected) {
  const now = readMarkerObservation(path);
  if (!now || now.dev !== expected.dev || now.ino !== expected.ino || now.digest !== expected.digest ||
    now.value.generation !== expected.value.generation || digest(now.value.publicationEpoch ?? null) !== digest(expected.value.publicationEpoch ?? null)) throw new Error('marker_compare_failed');
  return now;
}
// Caller holds preclaim or a generation's serialized stop critical section.
export function removeMarker(path, expected) {
  compareMarker(path, expected);
  fs.unlinkSync(path);
  const fd = fs.openSync(dirname(path), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } catch (cause) { throw new Error('persistence_indeterminate:reconcile_before_mutation', { cause }); }
  finally { fs.closeSync(fd); }
}

export async function prepareAuthority({ directory, root, physicalPrefix, frame = readProcessFrame(), observe = observeProcess }) {
  if (process.platform !== 'linux' || ![22, 24].includes(Number(process.versions.node.split('.')[0])) ||
    !process.report.getReport().header.glibcVersionRuntime) throw new Error('authority_profile_unqualified');
  fs.mkdirSync(directory, { mode: 0o700, recursive: true }); privateDirectory(directory);
  const canonicalPrefix = fs.realpathSync(physicalPrefix), canonicalRoot = canonicalRootPath(root);
  const prefixInfo = fs.statSync(canonicalPrefix);
  if (!prefixInfo.isDirectory() || prefixInfo.uid !== process.getuid() || (prefixInfo.mode & 0o022)) throw new Error('prefix_owner_mismatch');
  const prefixId = digest({ canonicalPrefix, uid: process.getuid() });
  const canonicalMarkerLocation = join(directory, 'marker.json');
  const path = join(directory, 'authority-domain.json');
  const prior = readState(path, 'authorityDomain');
  if (prior && (prior.value.prefixId !== prefixId || prior.value.canonicalRoot !== canonicalRoot || prior.value.uid !== process.getuid())) throw new Error('foreign_installation_authority');
  let stateDirectory = directory, namespaceId = prior?.value.namespaceId ?? randomUUID();
  const managedRoot = join(canonicalPrefix, 'h2a-managed', String(process.getuid()));
  if (fs.existsSync(managedRoot)) {
    privateDirectory(managedRoot);
    const installation = readState(join(managedRoot, 'installation.json'), 'installation')?.value;
    if (!installation || installation.prefixId !== prefixId || installation.canonicalPrefix !== canonicalPrefix ||
      installation.managedRoot !== managedRoot || installation.uid !== process.getuid()) throw new Error('foreign_installation_authority');
    const registryDirectory = join(managedRoot, 'state', 'namespaces');
    fs.mkdirSync(registryDirectory, { recursive: true, mode: 0o700 });
    const registryPath = join(registryDirectory, 'namespace.json');
    let registry = readState(registryPath, 'namespace');
    if (!registry) {
      const candidate = { schemaVersion: 1, namespaceId, prefixId, uid: process.getuid(), canonicalRoot,
        canonicalMarkerLocation, stateDirectory: join(managedRoot, 'state', 'mcp', namespaceId),
        machineIdentity: frame.machineId, authorityDomainReference: 'authority-domain.json' };
      try { registry = publishState(registryPath, candidate, 'namespace'); }
      catch (error) { if (error.code !== 'EEXIST') throw error; registry = readState(registryPath, 'namespace'); }
    }
    if (!registry || registry.value.prefixId !== prefixId || registry.value.canonicalRoot !== canonicalRoot ||
      registry.value.uid !== process.getuid() || registry.value.machineIdentity !== frame.machineId) throw new Error('foreign_installation_authority');
    if (registry.value.canonicalMarkerLocation !== canonicalMarkerLocation) throw new Error('authority_reference_required');
    namespaceId = registry.value.namespaceId; stateDirectory = registry.value.stateDirectory;
    if (prior && prior.value.namespaceId !== namespaceId) throw new Error('authority_namespace_mismatch');
    fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 }); privateDirectory(stateDirectory);
  }
  const processFrame = Object.fromEntries(['machineId', 'bootId', 'pidNamespace', 'nsNet'].map(k => [k, frame[k]]));
  const binding = digest({ canonicalMarkerLocation, prefixId, uid: process.getuid() });
  const secret = (purpose, mustExist) => {
    const ref = `${purpose}-key.json`, path = join(stateDirectory, ref);
    let result = readState(path, 'secret');
    if (!result && mustExist) throw new Error('authority_incomplete');
    if (!result) {
      try { result = publishState(path, { schemaVersion: 1, authorityBinding: binding, purpose, key: randomBytes(32).toString('hex') }, 'secret'); }
      catch (error) { if (error.code !== 'EEXIST') throw error; result = readState(path, 'secret'); }
    }
    if (!result || result.value.purpose !== purpose || result.value.authorityBinding !== binding) throw new Error('foreign_installation_authority');
    return { ref, key: Buffer.from(result.value.key, 'hex') };
  };
  // Reject an existing foreign anchor before any publication of auxiliary state.
  if (prior && (prior.value.prefixId !== prefixId || prior.value.canonicalRoot !== canonicalRoot || prior.value.uid !== process.getuid())) throw new Error('foreign_installation_authority');
  const lock = secret('lock', Boolean(prior));
  const auth = secret('authentication', Boolean(prior));
  const domain = establishDomain(path, { schemaVersion: 1, namespaceId, prefixId,
    uid: process.getuid(), canonicalMarkerLocation, canonicalRoot, processFrame,
    lockSecretReference: lock.ref, revision: 1 });
  return { directory, stateDirectory, domain, frame, observe, rootKey: auth.key, lockKey: lock.key, authKeyReference: auth.ref };
}

export async function admitGeneration(authority, ready, afterPublish = (_publication) => {}) {
  const lock = await acquirePreclaim(authority.domain, authority.frame, authority.lockKey, classifyDurableProcFrame);
  try {
    const control = readState(join(authority.stateDirectory, 'component-control.json'), 'componentControl');
    if (control?.value.ownerState === 'ACTIVE') {
      const liveness = ownerLiveness({ processIdentity: control.value.ownerIdentity }, authority.frame, authority.observe);
      if (liveness !== 'dead') throw new Error(liveness === 'alive' ? 'owner_alive' : 'owner_liveness_unknown');
    }
    const path = authority.domain.canonicalMarkerLocation;
    const old = readMarkerObservation(path);
    if (old) {
      if (old.value.prefixId && old.value.prefixId !== authority.domain.prefixId) throw new Error('foreign_installation_authority');
      const liveness = ownerLiveness(old.value, authority.frame, authority.observe);
      if (liveness !== 'dead') throw new Error(liveness === 'alive' ? 'owner_alive' : 'owner_liveness_unknown');
      removeMarker(path, old);
    }
    const epochsPath = join(authority.stateDirectory, 'epochs.json');
    const previous = readState(epochsPath, 'epochs');
    const epochs = { schemaVersion: 1, revision: (previous?.value.revision ?? 0) + 1,
      bootId: authority.frame.bootId, counter: previous?.value.bootId === authority.frame.bootId ? previous.value.counter + 1 : 1 };
    if (previous) replaceState(epochsPath, epochs, 'epochs', previous); else publishState(epochsPath, epochs, 'epochs');
    const value = await ready({ bootId: epochs.bootId, counter: epochs.counter });
    if (value.prefixId !== authority.domain.prefixId || value.namespaceId !== authority.domain.namespaceId ||
      value.root !== authority.domain.canonicalRoot) throw new Error('authority_publication_mismatch');
    const publication = publishState(path, value, 'marker');
    await afterPublish(publication);
    return publication;
  } finally { await lock.release(); }
}
