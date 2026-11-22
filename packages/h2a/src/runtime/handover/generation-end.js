import fs from 'node:fs';
import { join } from 'node:path';
import { digest, sign, verify } from './wire.js';
import { readState, publishState } from './state.js';

export const MAX_RETAINED_GENERATION_ENDS = 64;

const context = m => ({ service: m.service, namespaceId: m.namespaceId, generation: m.generation });
const rootPath = (dir, generation) => join(dir, `generation-end-${generation}.json`);

// Fallback per-stateDirectory archive index for callers without an OperationLedger instance
// (e.g. shim-bridge or standalone generationEnded calls). Never rescans archive/batch-* after startup.
const fallbackArchiveCaches = new Map();

function loadFallbackArchiveMap(stateDirectory) {
  const archiveDir = join(stateDirectory, 'archive');
  const manifestPath = join(archiveDir, 'manifest.jsonl');
  let mStat = null;
  try {
    mStat = fs.lstatSync(manifestPath, { bigint: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const mStamp = mStat ? `${mStat.dev}:${mStat.ino}:${mStat.size}:${mStat.mtimeNs}:${mStat.ctimeNs}` : null;
  let cache = fallbackArchiveCaches.get(stateDirectory);
  if (cache && cache.manifestStamp === mStamp && cache.scannedOnce) {
    return cache.map;
  }
  const map = new Map();
  if (mStat) {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec.reason === 'restore') {
          for (const g of rec.generationEnds ?? []) map.delete(g);
        } else if (typeof rec.batchDir === 'string') {
          for (const g of rec.generationEnds ?? []) map.set(g, rec.batchDir);
        }
      } catch { /* ignore malformed line */ }
    }
  }
  let batches = [];
  try {
    batches = fs.readdirSync(archiveDir).filter(d => d.startsWith('batch-')).sort();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const geRe = /^generation-end-(.+)\.json$/;
  for (const batchDir of batches) {
    let files;
    try { files = fs.readdirSync(join(archiveDir, batchDir)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const name of files) {
      const m = geRe.exec(name);
      if (m) map.set(m[1], batchDir);
    }
  }
  cache = { manifestStamp: mStamp, scannedOnce: true, map };
  fallbackArchiveCaches.set(stateDirectory, cache);
  return map;
}

function readGenerationEnd(stateDirectory, generation, ledgerOrMap = undefined) {
  const direct = readState(rootPath(stateDirectory, generation), 'generationEnd')?.value;
  if (direct) return direct;

  let batchDir;
  if (ledgerOrMap instanceof Map) {
    batchDir = ledgerOrMap.get(generation);
  } else if (ledgerOrMap && typeof ledgerOrMap === 'object' && ledgerOrMap.archivedGenerationEnds instanceof Map) {
    ledgerOrMap.registry?.syncIfExternalChange?.();
    batchDir = ledgerOrMap.archivedGenerationEnds.get(generation);
  } else {
    batchDir = loadFallbackArchiveMap(stateDirectory).get(generation);
  }
  if (!batchDir) return undefined;
  return readState(join(stateDirectory, 'archive', batchDir, `generation-end-${generation}.json`), 'generationEnd')?.value;
}

function verifyProof(proof, marker, key) {
  if (!proof) return false;
  const { mac, ...value } = proof;
  return proof.generation === marker.generation && proof.markerDigest === digest(marker) && verify(key, 'compatibility', context(marker), value, mac);
}

export function recordGenerationEnd(marker, key) {
  const value = { schemaVersion: 1, purpose: 'generation-ended', generation: marker.generation,
    source: marker, markerDigest: digest(marker), endedAt: Date.now() };
  const proof = { ...value, mac: sign(key, 'compatibility', context(marker), value) };
  const target = rootPath(marker.stateDirectory, marker.generation);
  if (!readState(target, 'generationEnd')) publishState(target, proof, 'generationEnd');
}

export function generationEnded(marker, key, archiveSource = undefined) {
  const proof = readGenerationEnd(marker.stateDirectory, marker.generation, archiveSource);
  return verifyProof(proof, marker, key);
}

export function endedOwner(owner, marker, key, archiveSource = undefined) {
  const proof = readGenerationEnd(marker.stateDirectory, owner.ownerGeneration, archiveSource);
  if (!proof || proof.source.root !== marker.root || proof.source.namespaceId !== marker.namespaceId ||
      digest(proof.source.processIdentity) !== digest(owner.ownerProcessIdentity)) return false;
  return verifyProof(proof, proof.source, key);
}
