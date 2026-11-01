// R18 seat import bridge: the campaign consumes the sentropic seat-bundle
// import adapters as a pinned vendored copy (scripts/xcli-seat-vendor/,
// VENDOR.json) — the validation logic is never re-implemented here. This
// module only re-exports the vendored API and adds the narrow custody step:
// write an already-validated envelope's allowlisted files into an isolated
// seat HOME (0600 files in a 0700 dir), and wipe it afterwards. The returned
// receipt carries names and digests only, never secret bytes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { validateSeatBundle } from './xcli-seat-vendor/seat-bundle.js';
import { parseCliSeatProfile, parseTokenSeatEnvelope } from './xcli-seat-vendor/cli-seat-import.js';
import { translateAgySeatToApplication } from './xcli-seat-vendor/agy-cli-import.js';
import { MistralVibeEnrollmentProvider, MISTRAL_VIBE_SIGN_IN_URL,
  MISTRAL_VIBE_KEY_VALIDITY_MS } from './xcli-seat-vendor/mistral-vibe.js';
import { LOGIN_ALLOWLIST } from './xcli-lab.mjs';
import { loadSeatManifest } from './xcli-seats.mjs';
import { CYBER_SEAT_MODE, SEAT_ENVIRONMENT, assertCyberManifest } from './xcli-seat-custody.mjs';

export { validateSeatBundle, parseCliSeatProfile, parseTokenSeatEnvelope, translateAgySeatToApplication,
  MistralVibeEnrollmentProvider, MISTRAL_VIBE_SIGN_IN_URL, MISTRAL_VIBE_KEY_VALIDITY_MS };

export async function vendoredDigest() {
  return JSON.parse(fs.readFileSync(new URL('./xcli-seat-vendor/VENDOR.json', import.meta.url), 'utf8'));
}

// Validate one seat envelope and materialise its allowlisted files into an
// isolated seat HOME. `secrets` maps fixed secret names to envelope bytes;
// the caller (a fixed trusted step) read them from the protected
// environment, never from argv or a home directory.
export function materialiseSeatEnvelopes({ seatSet, slotManifest, secrets, baseDir }) {
  assert.ok(slotManifest && typeof slotManifest === 'object', 'slot-manifest-required');
  if (slotManifest.environment !== SEAT_ENVIRONMENT) throw new Error('environment-mismatch');
  const ids = String(seatSet ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!ids.length) throw new Error('seat-set-required');
  const byId = Object.fromEntries((slotManifest.seats ?? []).map(seat => [seat.seatId, seat]));
  // Phase 1: parse and validate every envelope before any credential is
  // written. A malformed seat fails closed with no bytes on disk.
  const validated = ids.map(seatId => {
    const slot = byId[seatId];
    if (!slot) throw new Error(`seat-unknown:${seatId}`);
    const raw = secrets[slot.useSecret];
    if (!raw) throw new Error(`seat-bundle-missing:${seatId}`);
    let envelope;
    try { envelope = JSON.parse(raw); } catch { throw new Error(`seat-bundle-invalid:${seatId}`); }
    if (!envelope || typeof envelope !== 'object' || !envelope.bundle) {
      throw new Error(`seat-bundle-invalid:${seatId}`);
    }
    const checked = validateSeatBundle(envelope.bundle);
    if (!checked.ok) throw new Error(`seat-bundle-rejected:${seatId}:${checked.code}`);
    const bundle = checked.bundle;
    if (bundle.identity.cli !== slot.cli) throw new Error(`seat-cli-mismatch:${seatId}`);
    if (bundle.identity.seatRef !== seatId) throw new Error(`seat-ref-mismatch:${seatId}`);
    if (slot.cli === 'agy') {
      if (!envelope.agy || typeof envelope.agy !== 'object') throw new Error(`agy-tuple-missing:${seatId}`);
      translateAgySeatToApplication({ ownerScope: bundle.identity.ownerScope, seatRef: seatId,
        accountBinding: bundle.provenance.accountBinding, ...envelope.agy });
    }
    const files = envelope.files ?? {};
    for (const rel of Object.keys(files)) {
      if (!(LOGIN_ALLOWLIST[slot.cli] ?? []).includes(rel)) {
        throw new Error(`seat-file-not-allowlisted:${seatId}:${rel}`);
      }
    }
    return { seatId, slot, files };
  });
  // Phase 2: write validated files only. An aliased or reused seat root is
  // refused before any credential reaches disk.
  const seatsDir = join(baseDir, 'seats');
  refuseAliasedRoot(seatsDir);
  fs.mkdirSync(seatsDir, { mode: 0o700, recursive: true });
  const seats = [];
  const receiptSeats = [];
  for (const { seatId, slot, files } of validated) {
    const home = join(seatsDir, seatId);
    refuseAliasedRoot(home);
    fs.mkdirSync(home, { mode: 0o700, recursive: true });
    const written = [];
    for (const [rel, b64] of Object.entries(files)) {
      const target = join(home, rel);
      fs.mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, Buffer.from(String(b64), 'base64'), { mode: 0o600, flag: 'wx' });
      written.push(rel);
    }
    seats.push({ seatId, family: slot.cli, authSource: relative(baseDir, home) });
    receiptSeats.push({ seatId, cli: slot.cli, slot: slot.slot,
      canonicalSecret: slot.secret, candidateSecret: slot.candidateSecret, useSecret: slot.useSecret,
      files: [...written].sort() });
  }
  const manifest = { version: 1, seatMode: CYBER_SEAT_MODE, seats };
  const manifestFile = join(baseDir, 'seats.json');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  loadSeatManifest(manifestFile);
  assertCyberManifest(manifest);
  const manifestDigest = createHash('sha256').update(fs.readFileSync(manifestFile)).digest('hex');
  return { manifest, manifestFile, manifestDigest,
    receipt: { version: 1, kind: 'CredentialProvisioningReceiptV1', environment: SEAT_ENVIRONMENT,
      manifestDigest, seats: receiptSeats } };
}

// A seat root that already exists as a symlink, or resolves outside
// itself, is refused before any credential reaches disk.
function refuseAliasedRoot(path) {
  let stat = null;
  try { stat = fs.lstatSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!stat) return;
  if (stat.isSymbolicLink()) throw new Error('aliased-seat-root');
  if (fs.realpathSync(path) !== path) throw new Error('aliased-seat-root');
}

// Erase one materialised seat HOME. Returns surviving paths (empty = proven).
export function wipeSeatDir(home) {
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* the re-check below decides */ }
  return fs.existsSync(home) ? [home] : [];
}
