import { realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:net';
import { canonicalBytes, digest } from './wire.js';
import { validate } from './formats.js';
import { publishState, readState, replaceState } from './state.js';

// Inputs must come from verified physical installation metadata, never npm prefix alone.
export function prefixLayout(physicalPrefix, legacyPrefix, uid) {
  const canonicalPrefix = realpathSync(physicalPrefix);
  const actual = statSync(canonicalPrefix); const legacy = statSync(realpathSync(legacyPrefix));
  if (!actual.isDirectory() || actual.dev !== legacy.dev || actual.ino !== legacy.ino) {
    throw new Error('legacy_prefix_mismatch');
  }
  if (uid !== process.getuid() || actual.uid !== uid || (actual.mode & 0o022)) {
    throw new Error('prefix_owner_mismatch');
  }
  return { canonicalPrefix, uid, prefixId: digest({ canonicalPrefix, uid }),
    managedRoot: join(canonicalPrefix, 'h2a-managed', String(uid)),
    legacyLock: join(canonicalPrefix, '.h2a-upgrade.lock') };
}

// Placement: authority-domain.json in the private historical marker directory.
// Exclusive link publication works independently of the network namespace.
export function establishDomain(path, candidate) {
  validate('authorityDomain', candidate);
  let current = readState(path, 'authorityDomain');
  if (!current) {
    try { current = publishState(path, candidate, 'authorityDomain'); }
    catch (e) { if (e.code !== 'EEXIST') throw e; current = readState(path, 'authorityDomain'); }
  }
  if (!current) throw new Error('authority_namespace_unknown');
  for (const field of ['prefixId', 'uid', 'canonicalMarkerLocation', 'canonicalRoot']) {
    if (current.value[field] !== candidate[field]) throw new Error('foreign_installation_authority');
  }
  return current.value;
}

// MH-L2 supplies .6's classifyDurableProcFrame from the shared lightweight leaf.
// nsNet is an additional admission check; it is not implied by that classifier.
export function assertDomainFrame(domain, current, classifyDurableProcFrame) {
  validate('authorityDomain', domain);
  if (!current.nsNet || !current.pidNamespace || !current.machineId || !current.bootId) {
    throw new Error('authority_namespace_unknown');
  }
  const verdict = classifyDurableProcFrame(domain.processFrame, current);
  if (verdict === 'stale-boot') throw new Error('authority_recovery_required');
  if (verdict !== 'current') throw new Error('authority_namespace_unknown');
  if (domain.processFrame.nsNet !== current.nsNet) throw new Error('authority_netns_mismatch');
}

// Caller holds filesystem publication exclusion. Only a comparable proven reboot
// authorizes this recovery; netns retirement within one boot needs MH-L2 evidence.
export function recoverDomainAfterBoot(path, candidate, current, classifyDurableProcFrame) {
  validate('authorityDomain', candidate);
  const observed = readState(path, 'authorityDomain');
  const frame = Object.fromEntries(['machineId', 'bootId', 'pidNamespace', 'nsNet'].map(key => [key, current[key]]));
  if (!observed || classifyDurableProcFrame(observed.value.processFrame, current) !== 'stale-boot' ||
      digest(candidate.processFrame) !== digest(frame)) throw new Error('authority_recovery_unproven');
  for (const key of ['prefixId', 'uid', 'namespaceId', 'canonicalMarkerLocation', 'canonicalRoot', 'lockSecretReference']) {
    if (candidate[key] !== observed.value[key]) throw new Error('foreign_installation_authority');
  }
  if (candidate.revision !== observed.value.revision + 1) throw new Error('state_revision_invalid');
  return replaceState(path, candidate, 'authorityDomain', observed).value;
}

export async function acquirePreclaim(domain, current, lockSecret, classifyDurableProcFrame) {
  if (process.platform !== 'linux') throw new Error('authority_profile_unqualified');
  assertDomainFrame(domain, current, classifyDurableProcFrame);
  if (!Buffer.isBuffer(lockSecret) || lockSecret.length < 32) throw new Error('invalid_lock_secret');
  const name = createHmac('sha256', lockSecret).update(canonicalBytes({
    domain: 'h2a-mcp-preclaim/v1', canonicalMarkerLocation: domain.canonicalMarkerLocation,
    uid: domain.uid, processFrame: domain.processFrame
  })).digest('hex');
  const server = createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    const fail = (cause) => reject(new Error('authority_lock_unavailable', { cause }));
    server.once('error', fail);
    server.listen({ path: `\0h2a-mcp-${name}` }, () => { server.off('error', fail); resolve(); });
  });
  let released = false;
  return { async release() {
    if (released) return; released = true;
    await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  } };
}
