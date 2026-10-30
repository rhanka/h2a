import { join } from 'node:path';
import { digest, sign, verify } from './wire.js';
import { readState, publishState } from './state.js';
const context = m => ({ service: m.service, namespaceId: m.namespaceId, generation: m.generation });
const path = m => join(m.stateDirectory, `generation-end-${m.generation}.json`);
export function recordGenerationEnd(marker, key) {
  const value = { schemaVersion: 1, purpose: 'generation-ended', generation: marker.generation,
    source: marker, markerDigest: digest(marker), endedAt: Date.now() };
  const proof = { ...value, mac: sign(key, 'compatibility', context(marker), value) };
  if (!readState(path(marker), 'generationEnd')) publishState(path(marker), proof, 'generationEnd');
}
export function generationEnded(marker, key) {
  const proof = readState(path(marker), 'generationEnd')?.value;
  if (!proof) return false;
  const { mac, ...value } = proof;
  return proof.generation === marker.generation && proof.markerDigest === digest(marker) && verify(key, 'compatibility', context(marker), value, mac);
}

export function endedOwner(owner, marker, key) {
  const proof = readState(join(marker.stateDirectory, `generation-end-${owner.ownerGeneration}.json`), 'generationEnd')?.value;
  if (!proof || proof.source.root !== marker.root || proof.source.namespaceId !== marker.namespaceId ||
      digest(proof.source.processIdentity) !== digest(owner.ownerProcessIdentity)) return false;
  return generationEnded(proof.source, key);
}
