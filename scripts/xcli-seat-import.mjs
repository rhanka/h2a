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
import { materialiseSeatEnvelopes as materialiseSeatEnvelopesLib,
  materialiseCellHome as materialiseCellHomeLib } from './xcli-seat-onboarding.mjs';
import { LOGIN_ALLOWLIST, loginCopyPath } from './xcli-lab.mjs';
import { loadSeatManifest } from './xcli-seats.mjs';
import { CYBER_SEAT_MODE, SEAT_ENVIRONMENT, assertCyberManifest } from './xcli-seat-custody.mjs';
import { replayAgyCliCache, AGY_CLI_CACHE_PATH } from './xcli-agy-cli-cache.mjs';

export { validateSeatBundle, parseCliSeatProfile, parseTokenSeatEnvelope, translateAgySeatToApplication,
  MistralVibeEnrollmentProvider, MISTRAL_VIBE_SIGN_IN_URL, MISTRAL_VIBE_KEY_VALIDITY_MS };

export async function vendoredDigest() {
  return JSON.parse(fs.readFileSync(new URL('./xcli-seat-vendor/VENDOR.json', import.meta.url), 'utf8'));
}

// Validate one seat envelope and materialise its allowlisted files into an
// isolated seat HOME. `secrets` maps fixed secret names to envelope bytes;
// the caller (a fixed trusted step) read them from the protected
// environment, never from argv or a home directory.
//
// L7 (bench round 27): phase 2 runs through the published seat-onboarding
// stage 1. The bench keeps its phase-1 checks with their historical codes,
// then the library re-validates the full envelope (bundle + files allowlist
// + minimized claude projection + onboarding binding) and stages the auth
// files plus the seat record. Native CLI versions are not known yet here;
// stage 2 enforces them from the campaign preflight facts.
export async function materialiseSeatEnvelopes({ seatSet, slotManifest, secrets, baseDir }) {
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
    return { seatId, slot, files, envelope };
  });
  // A batch carries one owner scope: the stage-1 record binds every seat to
  // it, so a mixed batch refuses before any credential reaches disk.
  const scopes = new Set(validated.map(({ envelope }) => envelope.bundle?.identity?.ownerScope));
  if (scopes.size !== 1 || !scopes.has(validated[0].envelope.bundle.identity.ownerScope)) {
    throw new Error(`seat-owner-scope-mismatch:${[...scopes].join(',') || 'missing'}`);
  }
  const ownerScope = validated[0].envelope.bundle.identity.ownerScope;
  // Phase 2: the library stages validated files plus the seat record. An
  // aliased seat root is refused by both layers before any credential
  // reaches disk.
  const seatsDir = join(baseDir, 'seats');
  refuseAliasedRoot(seatsDir);
  const scope = validated.length === 1 ? validated[0].seatId : 'batch';
  let staged;
  try {
    staged = await materialiseSeatEnvelopesLib({ seats: validated.map(({ seatId, envelope }) =>
      ({ envelope, seatDir: join(seatsDir, seatId) })), ownerScope, expectedNativeCliVersions: {} });
  } catch (error) {
    throw new Error(`seat-stage-refused:${scope}:${error.code ?? 'unknown'}`);
  }
  if (!staged || staged.ok !== true) {
    throw new Error(`seat-stage-refused:${scope}:${staged?.code ?? 'unknown'}`);
  }
  const stagedSeats = staged.receipt?.seats ?? [];
  const stagedByRef = Object.fromEntries(stagedSeats.map(seat => [seat.seatRef, seat]));
  const seats = [];
  const receiptSeats = [];
  for (const { seatId, slot, files } of validated) {
    const stagedSeat = stagedByRef[seatId];
    assert.ok(stagedSeat, `seat-stage-missing:${seatId}`);
    const home = join(seatsDir, seatId);
    const onboarding = { status: stagedSeat.onboardingStatus, gate: stagedSeat.launchGate,
      authFiles: [...stagedSeat.authFiles],
      destKeys: (stagedSeat.onboarding?.files ?? []).map(file => file.destKey) };
    seats.push({ seatId, family: slot.cli, authSource: relative(baseDir, home), onboarding });
    receiptSeats.push({ seatId, cli: slot.cli, slot: slot.slot,
      canonicalSecret: slot.secret, candidateSecret: slot.candidateSecret, useSecret: slot.useSecret,
      files: Object.keys(files).sort(), onboardingStatus: stagedSeat.onboardingStatus,
      launchGate: stagedSeat.launchGate });
  }
  const manifest = { version: 1, seatMode: CYBER_SEAT_MODE, ownerScope, seats };
  const manifestFile = join(baseDir, 'seats.json');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  loadSeatManifest(manifestFile);
  assertCyberManifest(manifest);
  const manifestDigest = createHash('sha256').update(fs.readFileSync(manifestFile)).digest('hex');
  return { manifest, manifestFile, manifestDigest,
    receipt: { version: 1, kind: 'CredentialProvisioningReceiptV1', environment: SEAT_ENVIRONMENT,
      manifestDigest, seats: receiptSeats } };
}

// L7: onboarding cells never spawn on a closed gate. A manifest seat
// without onboarding state (pre-L7 manifests, simulated seats) and vibe
// keep the old cell path; every other closed gate is a typed refusal
// before any copy, any spawn, any debit.
export function onboardingLaunchBlock(manifestSeat) {
  if (manifestSeat && manifestSeat.unavailableReason === `seat-not-enrolled-in-llm-mesh:${manifestSeat.family}`)
    return manifestSeat.unavailableReason;
  if (!manifestSeat?.onboarding || manifestSeat.family === 'vibe') return undefined;
  if (manifestSeat.onboarding.gate?.eligible) return undefined;
  const refused = manifestSeat.onboarding.captureRefusal;
  if (manifestSeat.family === 'agy' && refused?.code === 'onboarding-version-unreviewed' &&
      /^\d+\.\d+\.\d+$/.test(refused.nativeCliVersion ?? '')) {
    return `onboarding-version-unreviewed:agy:${refused.nativeCliVersion}`;
  }
  return 'onboarding-required';
}

// L7: the record-relative storage name for each composed or synthesized
// onboarding file, so evidence and wipes cover exactly what stage 2
// writes (names only, never bytes). The claude composed file lands on the
// recorded `.claude.json` auth name, so it maps to no extra name.
const ONBOARDING_EXTRA_NAME = Object.freeze({
  'agy-jetski': '.gemini/antigravity-cli/jetski_state.pbtxt',
  'muse-trust': '.config/muse/trust.json',
  'codex-config': '.codex/config.toml',
});

// L7: run the published seat-onboarding stage 2 for one envelope seat and
// report the written files in the copyLoginReport shape ({copied, skipped}
// names). The caller pre-created empty dirs; the cell home itself is wiped
// first so stage-2 freshness holds, then the library recreates it as the
// single writer. A library refusal surfaces typed with zero bench writes
// beyond the pre-created empties.
export async function materialiseSeatCell({ cli, seatDir, cellHome, workspaceDir,
  configDirs, expectedNativeCliVersion, ownerScope, claudeMcpConfig, codexMcpServers,
  authFiles, destKeys }) {
  assert.ok(cli, 'seat-cell-cli-required');
  fs.rmSync(cellHome, { recursive: true, force: true });
  let staged;
  try {
    staged = await materialiseCellHomeLib({ seatDir, cellHome, workspaceDir, configDirs,
      expectedNativeCliVersion, ownerScope, claudeMcpConfig, codexMcpServers });
  } catch (error) {
    throw new Error(`seat-cell-refused:${error.code ?? 'unknown'}`);
  }
  if (!staged || staged.ok !== true) {
    throw new Error(`seat-cell-refused:${staged?.code ?? 'unknown'}`);
  }
  const names = [...(authFiles ?? [])];
  if (cli === 'agy' && replayAgyCliCache({ seatDir, cellHome, expectedNativeCliVersion })) {
    names.push(AGY_CLI_CACHE_PATH);
  }
  for (const key of destKeys ?? []) {
    const extra = ONBOARDING_EXTRA_NAME[key];
    if (extra && !names.includes(extra)) names.push(extra);
  }
  const env = { HOME: cellHome, CLAUDE_CONFIG_DIR: configDirs.claudeConfigDir,
    CODEX_HOME: configDirs.codexHome };
  const copied = [];
  const skipped = [];
  for (const name of names) {
    try {
      fs.statSync(loginCopyPath(env, cli, name));
      copied.push(name);
    } catch { skipped.push({ file: name, reason: 'cell-file-absent' }); }
  }
  return { copied, skipped };
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
