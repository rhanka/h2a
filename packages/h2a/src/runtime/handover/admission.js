import fs from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, join, basename, resolve } from 'node:path';
import { digest } from './wire.js';
import { validate } from './formats.js';
import { privateDirectory, readState, publishState, replaceState } from './state.js';
import { acquirePreclaim, establishDomain } from './authority.js';
import { readProcessFrame, classifyDurableProcFrame } from './proc-identity.js';
import { readWriterGate, writerDirectory } from './mutation.js';
import { assertTrustedPrefixDirectory } from './upg-trust.js';

const CENTRAL_PING_PATH = '/_h2a-central/ping';
const DEFAULT_PING_TIMEOUT_MS = 1_500;
const TERMINAL_TX_STATES = new Set(['ABORTED', 'READY', 'STOPPED']);

function isLoopbackHost(hostname) {
  return hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function parseLoopbackEndpoint(value) {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('H2A_MCP_CENTRAL_ENDPOINT must be a non-empty absolute http URL');
  }
  let endpoint;
  try { endpoint = new URL(value); }
  catch { throw new Error('H2A_MCP_CENTRAL_ENDPOINT must be a non-empty absolute http URL'); }
  if (
    endpoint.protocol !== 'http:' ||
    !isLoopbackHost(endpoint.hostname) ||
    !endpoint.port ||
    Number(endpoint.port) < 1 ||
    Number(endpoint.port) > 65_535 ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error('H2A_MCP_CENTRAL_ENDPOINT must be an absolute http URL with an explicit port');
  }
  return endpoint.href;
}

function errorHasCode(error, expectedCode) {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    if (current.code === expectedCode) return true;
    current = current.cause;
  }
  return false;
}

export async function centralMcpPing(endpoint, timeoutMs = DEFAULT_PING_TIMEOUT_MS) {
  const canonicalEndpoint = parseLoopbackEndpoint(endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetch(new URL(CENTRAL_PING_PATH, canonicalEndpoint), { signal: controller.signal });
    if (!response.ok) return { kind: 'ambiguous' };
    try {
      const body = await response.json();
      return typeof body?.generation === 'string' && body.generation.length > 0
        ? { kind: 'generation', generation: body.generation }
        : { kind: 'ambiguous' };
    } catch {
      return { kind: 'ambiguous' };
    }
  } catch (error) {
    return errorHasCode(error, 'ECONNREFUSED') ? { kind: 'dead' } : { kind: 'ambiguous' };
  } finally {
    clearTimeout(timeout);
  }
}

function sleepMs(ms) {
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

/**
 * Probe health of an observed marker owner without sending any signal.
 * Combines `/proc` liveness with bounded loopback HTTP pings.
 */
export async function probeOwnerHealth(markerPath, observedMarker, authority, options = {}) {
  const {
    pingTimeoutMs = 800,
    pingAttempts = 3,
    pingBackoffMs = 150,
    startupGraceMs = 5_000,
    ping = centralMcpPing,
    now = () => Date.now()
  } = options;
  const marker = observedMarker.value;
  const liveness = ownerLiveness(marker, authority.frame, authority.observe);
  if (liveness === 'dead') return { status: 'dead', marker };
  if (liveness === 'unknown') return { status: 'unknown', marker };

  const expectedRoot = authority.domain?.canonicalRoot;
  for (let attempt = 0; attempt < pingAttempts; attempt++) {
    let result;
    try {
      result = await ping(marker.endpoint, pingTimeoutMs);
    } catch {
      result = { kind: 'ambiguous' };
    }
    if (result.kind === 'generation') {
      if (result.generation === marker.generation) {
        return { status: 'healthy', marker };
      }
      // Another healthy generation responded (B-08): re-read marker immediately
      // and reuse if compatible — never signal a healthy successor.
      try {
        const fresh = readMarkerObservation(markerPath);
        if (
          fresh &&
          fresh.value.generation === result.generation &&
          fresh.value.protocol === 2 &&
          (!expectedRoot || fresh.value.root === expectedRoot)
        ) {
          return { status: 'healthy', marker: fresh.value };
        }
      } catch { /* ignore transient marker read failure */ }
    }
    if (attempt + 1 < pingAttempts && pingBackoffMs > 0) {
      await sleepMs(pingBackoffMs);
    }
  }

  // Startup grace check: never kill a starting central within startupGraceMs or
  // covered by an active STARTING startup-reservation.json.
  const startedAtMs = Date.parse(marker.startedAt);
  if (Number.isFinite(startedAtMs) && now() - startedAtMs < startupGraceMs) {
    return { status: 'starting', marker };
  }
  const stateDir = authority.stateDirectory ?? marker.stateDirectory ?? dirname(markerPath);
  try {
    const slot = readState(join(stateDir, 'startup-reservation.json'), 'startupReservation')?.value;
    if (slot && slot.state === 'STARTING' && slot.candidateIdentity?.pid === marker.pid) {
      const slotLiveness = ownerLiveness({ processIdentity: slot.candidateIdentity }, authority.frame, authority.observe);
      if (slotLiveness === 'alive') return { status: 'starting', marker };
    }
  } catch { /* ignore absent/unreadable reservation */ }

  return { status: 'unresponsive', marker };
}

/**
 * Unique eviction owner. Caller MUST already hold `acquirePreclaim`.
 * Enforces O(1) transaction & writer-gate guards (0 reads of operation-*.json),
 * strict processIdentity.pid + startTime verification, and bounded SIGTERM -> SIGKILL.
 */
export async function evictUnresponsiveOwnerLocked(authority, oldMarker, options = {}) {
  const {
    finalPingTimeoutMs = 300,
    sigtermWaitMs = 1_000,
    sigkillWaitMs = 500,
    pollIntervalMs = 50,
    ping = centralMcpPing,
    killProcess = (pid, sig) => process.kill(pid, sig)
  } = options;
  const path = authority.domain.canonicalMarkerLocation;
  const stateDir = authority.stateDirectory;

  // 1. Re-read marker under already-held preclaim and run a final sanity ping
  // (skipped only when the caller just finished probeOwnerHealth on the exact same
  // marker inode under this same preclaim lock).
  const freshMarker = readMarkerObservation(path);
  if (!freshMarker) return { evicted: false, reason: 'marker_absent' };
  if (freshMarker.value.generation !== oldMarker.value.generation) {
    return { evicted: false, reason: 'generation_changed', marker: freshMarker.value };
  }
  const sameProbedInode =
    options.alreadyProbed === true &&
    freshMarker.dev === oldMarker.dev &&
    freshMarker.ino === oldMarker.ino;
  if (!sameProbedInode) {
    try {
      const finalPing = await ping(freshMarker.value.endpoint, finalPingTimeoutMs);
      if (finalPing.kind === 'generation') {
        if (finalPing.generation === freshMarker.value.generation) {
          return { evicted: false, reason: 'healthy', marker: freshMarker.value };
        }
        const latest = readMarkerObservation(path);
        if (
          latest &&
          latest.value.generation === finalPing.generation &&
          latest.value.protocol === 2 &&
          latest.value.root === authority.domain.canonicalRoot
        ) {
          return { evicted: false, reason: 'healthy', marker: latest.value };
        }
      }
    } catch { /* proceed to eviction checks */ }
  }

  // 2. O(1) guards: active non-terminal transaction or non-OPEN writer gate (0 reads of operation-*.json).
  const controlPath = join(stateDir, 'component-control.json');
  const control = readState(controlPath, 'componentControl');
  if (control?.value.activeTransaction) {
    const tx = readState(join(stateDir, control.value.activeTransaction), 'componentTransaction')?.value;
    if (!tx || !TERMINAL_TX_STATES.has(tx.state)) {
      throw new Error('eviction_refused_active_transaction');
    }
  }
  let gate;
  try {
    gate = readWriterGate(writerDirectory(authority.domain.canonicalRoot));
  } catch {
    gate = undefined;
  }
  if (gate !== undefined && gate !== 'OPEN') {
    throw new Error('eviction_refused_writer_gate_closed');
  }

  // 3. Strict target PID identity verification (B-08).
  const identity = freshMarker.value.processIdentity;
  if (!identity || freshMarker.value.pid !== identity.pid) {
    throw new Error('marker_corrupt');
  }
  const initialLiveness = ownerLiveness(freshMarker.value, authority.frame, authority.observe);
  if (initialLiveness === 'unknown') {
    throw new Error('owner_liveness_unknown');
  }
  const targetPid = identity.pid;
  // A process must never signal itself during eviction: matching pid + startTime
  // proves this very process is the live owner.
  if (targetPid === process.pid) {
    throw new Error('owner_alive');
  }

  // 4. Bounded SIGTERM -> SIGKILL escalation (skip signaling if already dead).
  if (initialLiveness === 'alive') {
    try { killProcess(targetPid, 'SIGTERM'); }
    catch (error) { if (error?.code !== 'ESRCH') throw error; }

    const termDeadline = Date.now() + sigtermWaitMs;
    let liveness = ownerLiveness(freshMarker.value, authority.frame, authority.observe);
    while (liveness === 'alive' && Date.now() < termDeadline) {
      await sleepMs(pollIntervalMs);
      liveness = ownerLiveness(freshMarker.value, authority.frame, authority.observe);
    }

    if (liveness === 'alive') {
      // Anti-PID-recycling re-verification right before SIGKILL.
      if (ownerLiveness(freshMarker.value, authority.frame, authority.observe) === 'alive') {
        try { killProcess(targetPid, 'SIGKILL'); }
        catch (error) { if (error?.code !== 'ESRCH') throw error; }
      }
      const killDeadline = Date.now() + sigkillWaitMs;
      liveness = ownerLiveness(freshMarker.value, authority.frame, authority.observe);
      while (liveness !== 'dead' && Date.now() < killDeadline) {
        await sleepMs(pollIntervalMs);
        liveness = ownerLiveness(freshMarker.value, authority.frame, authority.observe);
      }
      if (liveness !== 'dead') {
        throw new Error('eviction_kill_unconfirmed');
      }
    } else if (liveness !== 'dead') {
      throw new Error('eviction_kill_unconfirmed');
    }
  }

  // 5. Remove marker, mark component-control.json CLOSED if matching generation, log to stderr.
  removeMarker(path, freshMarker);
  const latestControl = readState(controlPath, 'componentControl');
  if (
    latestControl &&
    latestControl.value.ownerState === 'ACTIVE' &&
    latestControl.value.sourceGeneration === freshMarker.value.generation
  ) {
    replaceState(
      controlPath,
      { ...latestControl.value, revision: latestControl.value.revision + 1, ownerState: 'CLOSED' },
      'componentControl',
      latestControl
    );
  }
  process.stderr.write(
    `h2a central: evicted unresponsive owner pid=${targetPid} generation=${freshMarker.value.generation}\n`
  );
  return { evicted: true, pid: targetPid, generation: freshMarker.value.generation };
}

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

export async function prepareAuthority({ directory, root, physicalPrefix, frame = readProcessFrame(), observe = observeProcess, upgOptions = undefined }) {
  if (process.platform !== 'linux' || ![22, 24].includes(Number(process.versions.node.split('.')[0])) ||
    !process.report.getReport().header.glibcVersionRuntime) throw new Error('authority_profile_unqualified');
  fs.mkdirSync(directory, { mode: 0o700, recursive: true }); privateDirectory(directory);
  const canonicalPrefix = fs.realpathSync(physicalPrefix), canonicalRoot = canonicalRootPath(root);
  assertTrustedPrefixDirectory(canonicalPrefix, process.getuid(), upgOptions);
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

export async function admitGeneration(authority, ready, afterPublish = (_publication) => {}, options = {}) {
  const lock = await acquirePreclaim(authority.domain, authority.frame, authority.lockKey, classifyDurableProcFrame);
  try {
    const path = authority.domain.canonicalMarkerLocation;
    const old = readMarkerObservation(path);
    if (old) {
      if (old.value.prefixId && old.value.prefixId !== authority.domain.prefixId) throw new Error('foreign_installation_authority');
      if (options?.evictUnresponsive) {
        const probe = await probeOwnerHealth(path, old, authority, options.probeOptions);
        if (probe.status === 'healthy') throw new Error('owner_alive');
        if (probe.status === 'starting') throw new Error('startup_reserved');
        if (probe.status === 'unknown') throw new Error('owner_liveness_unknown');
        if (probe.status === 'unresponsive') {
          const evicted = await evictUnresponsiveOwnerLocked(authority, old, { ...options.evictionOptions, alreadyProbed: true });
          if (!evicted.evicted) {
            if (evicted.reason === 'healthy') throw new Error('owner_alive');
            if (evicted.reason === 'generation_changed') {
              const latest = readMarkerObservation(path);
              if (latest) {
                const recheck = await probeOwnerHealth(path, latest, authority, options.probeOptions);
                if (recheck.status === 'healthy') throw new Error('owner_alive');
                if (recheck.status === 'starting') throw new Error('startup_reserved');
                if (recheck.status === 'unknown') throw new Error('owner_liveness_unknown');
                if (recheck.status === 'dead') removeMarker(path, latest);
                else throw new Error('owner_alive');
              }
            }
          }
        } else {
          removeMarker(path, old);
        }
      } else {
        const liveness = ownerLiveness(old.value, authority.frame, authority.observe);
        if (liveness !== 'dead') throw new Error(liveness === 'alive' ? 'owner_alive' : 'owner_liveness_unknown');
        removeMarker(path, old);
      }
    }
    const control = readState(join(authority.stateDirectory, 'component-control.json'), 'componentControl');
    if (control?.value.ownerState === 'ACTIVE') {
      const liveness = ownerLiveness({ processIdentity: control.value.ownerIdentity }, authority.frame, authority.observe);
      if (liveness !== 'dead') throw new Error(liveness === 'alive' ? 'owner_alive' : 'owner_liveness_unknown');
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
