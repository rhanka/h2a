// R18 cyber-seat custody contract (owner D1, 01/11): the h2a campaign
// consumes seats the same way as the sentropic cyber seats — same-repository
// custody, never a copy of auth files from ~.
// - Credential material lives only in the repository-owned protected GitHub
//   environment `cross-cli-seats`, under the fixed names SEAT_<CLI>_<SLOT>,
//   SEAT_CANDIDATE_<CLI>_<SLOT> and SEAT_USE_<CLI>_<SLOT>.
// - One reviewed slot manifest (docs/cross-cli-seat-slots.json) maps seat
//   names to those fixed names. The campaign job requests exactly one
//   environment; keys are loaded only by its fixed trusted steps.
// - Each cell materialises its CLI auth into an isolated cell HOME through
//   the vendored llm-mesh seat-bundle import adapters
//   (scripts/xcli-seat-vendor/, digest-pinned in VENDOR.json — the
//   validation logic is never re-implemented here), and erases it after the
//   cell with a metadata-only receipt (CredentialProvisioningReceiptV1
//   shape: names and digests, never bytes).
// - Gemini runs through agy/cloud-code exactly as in sentropic: no
//   SEAT_GEMINI_* secret exists; a `gemini` seat is refused with
//   gemini-via-agy-required and maps to the agy seat's cloud-code tuple
//   (antigravity transport, cloudcode-pa target).
import assert from 'node:assert/strict';

// The single protected environment holding every seat secret. The campaign
// job requests exactly this one environment and no other job does.
export const SEAT_ENVIRONMENT = 'cross-cli-seats';

// Seat mode recorded in campaign manifests and cell evidence. The
// interim-file-copy mode is superseded: manifests carrying it are refused.
export const CYBER_SEAT_MODE = 'cyber-seat-custody';

// Five-CLI envelope, same set as the sentropic seat-bundle contract.
export const SEAT_SLOT_CLIS = Object.freeze(['claude', 'codex', 'muse', 'vibe', 'agy']);

// Campaign-seated families for the R1 matrix. Gemini holds no seat: it runs
// through the agy seat (cloud-code). Vibe holds slot 00 (R19): its seat
// file is the harness-defined MISTRAL_API_KEY custody projection, validated
// by the vendored mistral-vibe adapter's five-CLI bundle contract.
export const CYBER_SEATED_FAMILIES = Object.freeze(['claude', 'codex', 'muse', 'agy', 'vibe']);

export const MAX_SLOTS = 40;

// Fixed secret names for one CLI slot, mirroring the cyber slot manifest.
export function slotSecretNames(cli, slot) {
  if (cli === 'gemini') throw new Error('gemini-via-agy-required');
  assert.ok(SEAT_SLOT_CLIS.includes(cli), `unknown-cli:${cli}`);
  assert.match(String(slot), /^[0-9]{2}$/, 'slot-must-be-two-digits');
  const n = Number(slot);
  assert.ok(Number.isSafeInteger(n) && n < MAX_SLOTS, 'slot-ceiling');
  const tag = `${cli.toUpperCase()}_${slot}`;
  return { canonical: `SEAT_${tag}`, candidate: `SEAT_CANDIDATE_${tag}`, projection: `SEAT_USE_${tag}` };
}

// Campaign-lane manifest gate: real runs require the cyber seat mode.
// Simulated runs strip auth sources before this gate ever applies.
export function assertCyberManifest(manifest) {
  assert.ok(manifest && typeof manifest === 'object', 'seat-manifest-required');
  if (!manifest.seatMode) throw new Error('seat-manifest-required');
  if (manifest.seatMode !== CYBER_SEAT_MODE) throw new Error('seat-mode-superseded');
  for (const seat of manifest.seats ?? []) {
    if (seat?.family === 'gemini') throw new Error(`gemini-via-agy-required:${seat.seatId}`);
  }
  return manifest;
}

// The copy-from-home path is removed: no flag may point the harness at an
// ambient home directory. Seat material comes only from the protected
// environment through the slot manifest.
export function assertNoAuthHome(argv) {
  if ((argv ?? []).includes('--auth-home')) throw new Error('auth-home-removed');
  return undefined;
}
