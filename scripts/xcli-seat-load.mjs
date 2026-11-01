// R18 fixed seat-load helper (owner-procedure shape: KIND/INPUT_FD/ENV).
// Validates one seat envelope read from a private FD and prints a
// names-only provisioning receipt. Writes nothing, provisions nothing: the
// conductor creates the GitHub environment secret from the validated file
// (bytes from file, never argv). Secret bytes never reach stdout, logs, or
// error messages.
import fs from 'node:fs';
import { validateSeatBundle } from './xcli-seat-vendor/seat-bundle.js';
import { translateAgySeatToApplication } from './xcli-seat-vendor/agy-cli-import.js';
import { LOGIN_ALLOWLIST } from './xcli-lab.mjs';
import { SEAT_ENVIRONMENT } from './xcli-seat-custody.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const refuse = code => {
  console.log(`seat-load: REFUSED code=${code}`);
  process.exit(1);
};

const seatId = option('--seat');
const slotManifestFile = option('--slot-manifest');
const inputFd = Number(option('--input-fd', '0'));
if (!seatId || !slotManifestFile || !Number.isSafeInteger(inputFd) || inputFd < 0) {
  console.log('usage: node scripts/xcli-seat-load.mjs --seat <seatId> --slot-manifest <file> [--input-fd <n>]');
  process.exit(2);
}
let slotManifest;
try { slotManifest = JSON.parse(fs.readFileSync(slotManifestFile, 'utf8')); }
catch { refuse('slot-manifest-unreadable'); }
if (slotManifest.environment !== SEAT_ENVIRONMENT) refuse('environment-mismatch');
const slot = (slotManifest.seats ?? []).find(s => s.seatId === seatId);
if (!slot) refuse(`seat-unknown:${seatId}`);
let raw;
try { raw = fs.readFileSync(inputFd, 'utf8'); }
catch { refuse('seat-input-unreadable'); }
let envelope;
try { envelope = JSON.parse(raw); }
catch { refuse(`seat-bundle-invalid:${seatId}`); }
if (!envelope || typeof envelope !== 'object' || !envelope.bundle) refuse(`seat-bundle-invalid:${seatId}`);
const checked = validateSeatBundle(envelope.bundle);
if (!checked.ok) refuse(`seat-bundle-rejected:${seatId}:${checked.code}`);
const bundle = checked.bundle;
if (bundle.identity.cli !== slot.cli) refuse(`seat-cli-mismatch:${seatId}`);
if (bundle.identity.seatRef !== seatId) refuse(`seat-ref-mismatch:${seatId}`);
if (slot.cli === 'agy') {
  if (!envelope.agy || typeof envelope.agy !== 'object') refuse(`agy-tuple-missing:${seatId}`);
  try {
    translateAgySeatToApplication({ ownerScope: bundle.identity.ownerScope, seatRef: seatId,
      accountBinding: bundle.provenance.accountBinding, ...envelope.agy });
  } catch (error) { refuse(`agy-tuple-rejected:${seatId}:${error.code ?? 'unknown'}`); }
}
for (const rel of Object.keys(envelope.files ?? {})) {
  if (!(LOGIN_ALLOWLIST[slot.cli] ?? []).includes(rel)) refuse(`seat-file-not-allowlisted:${seatId}:${rel}`);
}
console.log(JSON.stringify({ version: 1, kind: 'CredentialProvisioningReceiptV1',
  environment: SEAT_ENVIRONMENT, seatId, cli: slot.cli, slot: slot.slot,
  canonicalSecret: slot.secret, candidateSecret: slot.candidateSecret, useSecret: slot.useSecret,
  files: Object.keys(envelope.files ?? {}).sort(),
  bundle: { epoch: bundle.lifecycle.epoch, generation: bundle.lifecycle.generation,
    operationId: bundle.lifecycle.operationId } }));
