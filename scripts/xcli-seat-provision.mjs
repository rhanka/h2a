// R23 conductor seat provisioning (owner 01/11, bench round 23: every seat
// comes from the llm-mesh account store — no secret-tool, no OS keyring,
// no MISTRAL_API_KEY requirement). For each seat in the set, this script —
// and only it — resolves the seat bytes through scripts/xcli-llm-mesh-seats.mjs:
// vibe bytes come from the enrolled mistral-vibe mesh account (public
// facade acquire/release); the other four seats keep the LOCAL auth-only
// login files (the exact LOGIN_ALLOWLIST paths under a home directory: the
// real HOME in conductor use, a synthetic fixture HOME in tests), gated on
// the mesh enrollment. A CLI with no enrolled account refuses names-only as
// seat-not-enrolled-in-llm-mesh:<cli> with the exact enroll command (the
// script never enrolls). Each seat envelope is written 0600 in a private
// 0700 dir, validated through scripts/xcli-seat-load.mjs over --input-fd,
// then uploaded with `gh secret set <NAME> --env cross-cli-seats
// --repo rhanka/h2a --body-file` for the canonical, candidate and runtime
// projection names, and the files are shredded. Stdout carries receipts
// with names only — secret bytes never reach argv, logs, or error messages.
// `--dry-run` validates without uploading; `--local` validates and
// materialises a lane manifest for a local campaign without any GitHub
// write. It also creates the `cross-cli-seats` environment when absent,
// with the deployment branch policy limited to `main` +
// `feat/live-cross-cli-messaging`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LOGIN_ALLOWLIST, minimizeClaudeJson } from './xcli-lab.mjs';
import { slotSecretNames, SEAT_ENVIRONMENT } from './xcli-seat-custody.mjs';
import { materialiseSeatEnvelopes, parseCliSeatProfile,
  translateAgySeatToApplication } from './xcli-seat-import.mjs';
import { SEAT_BUNDLE_MAX_BYTES } from './xcli-seat-vendor/seat-bundle.js';
import { MESH_SEAT_PROVIDERS, createMeshSeatFacade, requireMeshAccount,
  acquireVibeKey, meshOwnerScope } from './xcli-llm-mesh-seats.mjs';
import { AGY_REQUIRED_COMPLETED_STEPS, CAPTURE_SOURCES, seatLaunchGate,
  AGY_ONBOARDING_REVIEW, agyOnboardingBinaryRefusal } from './xcli-seat-onboarding.mjs';
import { captureReviewedSeatOnboarding } from './xcli-agy-capture.mjs';
import { cliPath } from './xcli-lab.mjs';

const self = fileURLToPath(import.meta.url);
const repoRoot = dirname(dirname(self));

// Seat set default (owner D1 + R19): the five seated families.
export const DEFAULT_SEAT_SET = 'claude,codex,muse,agy,vibe';

// Per-seat enrollment identity carried inside the envelope bundle. These are
// descriptive contract strings, not secrets; the bundle validator requires
// them non-empty and pins packageProviderId per CLI.
export const SEAT_IDENTITIES = Object.freeze({
  claude: Object.freeze({ cli: 'claude', issuingClientRef: 'claude-cli', endpointFamily: 'claude' }),
  codex: Object.freeze({ cli: 'codex', issuingClientRef: 'codex-cli', endpointFamily: 'codex' }),
  muse: Object.freeze({ cli: 'muse', issuingClientRef: 'muse-cli', endpointFamily: 'muse' }),
  agy: Object.freeze({ cli: 'agy', issuingClientRef: 'agy-cli', endpointFamily: 'antigravity' }),
  vibe: Object.freeze({ cli: 'vibe', issuingClientRef: 'mistral-vibe-cli', endpointFamily: 'mistral' }),
});

// Fixed agy application tuple (antigravity/cloudcode-pa, never gemini),
// validated by the vendored adapter before the envelope is written.
export const AGY_TUPLE = Object.freeze({
  packageProviderId: 'cloud-code', packageAccountTransport: 'cloud-code',
  issuingClientRef: 'agy-cli', endpointFamily: 'antigravity',
  requestedTargetProviderId: 'cloudcode-pa', requestedTransportProviderId: 'antigravity',
});

export const VIBE_SEAT_FILE = '.vibe/MISTRAL_API_KEY';
const DEPLOY_BRANCHES = Object.freeze(['main', 'feat/live-cross-cli-messaging']);

// L7 (bench round 27): the custodian codex policy intent transported in the
// onboarding block. `approvalPolicy: 'on-request'` (the model decides when
// to ask) keeps today's effective behavior (the startup MCP approval press
// is unchanged); codex 0.163.0 rejects the old `untrusted` value at config
// load, so `untrusted` must never be issued. `mcpServerNames` is the
// harness's closed codex MCP set (the single h2a endpoint the cell renders).
// Harness and intent stay in sync by construction — a wider cell set
// refuses loudly at stage 2.
export const CODEX_SEAT_INTENT = Object.freeze({ approvalPolicy: 'on-request',
  mcpServerNames: Object.freeze(['h2a']) });

// L7: per-CLI standing trust decision carried in the block (design D3).
// agy carries consent state only; claude/muse/codex synthesize per-cell
// trust at stage 2 from this decision. Vibe has no measured gate.
export const SEAT_CELL_SYNTHESIS = Object.freeze({
  agy: Object.freeze([]),
  claude: Object.freeze(['claude-workspace-trust']),
  muse: Object.freeze(['muse-workspace-trust']),
  codex: Object.freeze(['codex-project-trust']),
});

// L7: read the installed CLI version for onboarding capture. Binary on
// PATH only, `--version` only, first x.y.z only — no login, no model. A
// missing binary or an unparseable version refuses (null): issuance then
// fails closed instead of inventing a version.
export function probeCliVersion(cli, { path = process.env.PATH ?? '' } = {}) {
  const executable = cliPath(cli, path);
  if (!executable) return null;
  try {
    const probed = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 15000,
      maxBuffer: 65536 });
    if (probed.status !== 0) return null;
    return `${probed.stdout ?? ''}\n${probed.stderr ?? ''}`.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null;
  } catch { return null; }
}

// Strict local auth read: a regular file only, never a symlink, never a
// directory. Names-only errors: the path named is allowlisted, never bytes.
function readAuthFile(homeDir, seatId, rel) {
  const path = join(homeDir, rel);
  let stat = null;
  try { stat = fs.lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new Error(`login-source-missing:${seatId}:${rel}`);
    throw new Error(`login-source-unreadable:${seatId}:${rel}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`login-source-rejected:${seatId}:${rel}`);
  const bytes = fs.readFileSync(path);
  if (!bytes.length) throw new Error(`login-source-empty:${seatId}:${rel}`);
  return bytes;
}

// Resolve the mesh gate for one seat. Vibe has no other source: without a
// readable mesh store the seat refuses (llm-mesh-store-unreachable). File
// seats keep the live login files when the store is unreadable — the gate
// verdict is recorded on the source receipt instead of blocking the bench.
async function resolveMeshGate({ seatId, cli, meshFacade, meshScope }) {
  const mapping = MESH_SEAT_PROVIDERS[cli];
  if (!mapping) throw new Error(`seat-unknown:${seatId}`);
  if (!meshFacade) {
    if (cli === 'vibe') throw new Error('llm-mesh-store-unreachable:vibe');
    return { provider: mapping.provider, accountId: null, meshGate: 'store-unreachable' };
  }
  try {
    const held = await requireMeshAccount({ cli, facade: meshFacade, ownerScope: meshScope });
    return { provider: held.provider, accountId: held.accountId, meshGate: 'enrolled' };
  } catch (error) {
    if (String(error.message ?? '').startsWith('seat-not-enrolled-in-llm-mesh:')) throw error;
    if (cli === 'vibe') throw error;
    return { provider: mapping.provider, accountId: null, meshGate: 'store-unreachable',
      cause: error.cause ?? 'unknown' };
  }
}

// Build one seat envelope from mesh-sourced auth-only material. `meshFacade`
// is the public llm-mesh facade (injected in tests, created from the owner
// mesh store in production); `meshScope` is the mesh owner scope the
// accounts are enrolled under. For vibe the bytes are the acquired mesh key
// projected to the harness seat file; for the other families the bytes are
// the live CLI login files, gated on the mesh enrollment (see
// resolveMeshGate). For claude the credential file crosses whole but
// .claude.json crosses only as its minimal auth fields (minimizeClaudeJson):
// the real whole file exceeds the 48 KiB cap. Returns the envelope plus the
// file's names and the seat source for receipts.
export async function buildSeatEnvelope({ seatId, slot, homeDir, ownerScope = 'owner',
  issuedAt = new Date().toISOString(), operationId = null, meshFacade = null,
  meshScope = meshOwnerScope(), cliVersions = {} } = {}) {
  assert.ok(seatId && slot && homeDir, 'seat, slot and home required');
  const identity = SEAT_IDENTITIES[seatId];
  if (!identity) throw new Error(`seat-unknown:${seatId}`);
  // Qualify the reviewed extension before any account or source-file read.
  // Hash the resolved executable directly; never copy the binary.
  if (identity.cli === 'agy' &&
      cliVersions.agy === AGY_ONBOARDING_REVIEW.nativeCliVersion) {
    let binaryDigest = null;
    try {
      const executable = cliPath('agy', process.env.PATH ?? '');
      if (executable && fs.statSync(executable).isFile()) {
        const hash = createHash('sha256');
        for await (const chunk of fs.createReadStream(executable)) hash.update(chunk);
        binaryDigest = hash.digest('hex');
      }
    } catch { /* names-only refusal below */ }
    const refusal = agyOnboardingBinaryRefusal(cliVersions.agy, binaryDigest);
    if (refusal) throw new Error(`${refusal}:agy:${cliVersions.agy}`);
  }
  const allowlisted = LOGIN_ALLOWLIST[identity.cli] ?? null;
  if (allowlisted === null) throw new Error(`login-not-confined:${seatId}`);
  const raws = [];
  const files = {};
  const gate = await resolveMeshGate({ seatId, cli: identity.cli, meshFacade, meshScope });
  if (identity.cli === 'vibe') {
    const key = await acquireVibeKey({ facade: meshFacade, ownerScope: meshScope,
      accountId: gate.accountId });
    const bytes = Buffer.from(key, 'utf8');
    raws.push(bytes);
    files[VIBE_SEAT_FILE] = bytes.toString('base64');
  } else {
    if (!allowlisted?.length) throw new Error(`no-allowlisted-login-files:${seatId}`);
    for (const rel of allowlisted) {
      let bytes = readAuthFile(homeDir, seatId, rel);
      if (rel === '.claude.json') bytes = minimizeClaudeJson(bytes);
      raws.push(bytes);
      files[rel] = bytes.toString('base64');
    }
  }
  const digest = createHash('sha256').update(Buffer.concat(raws)).digest('hex');
  const opId = operationId ?? `op-${seatId}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  // L7: issue the onboarding block through the published capture when the
  // seat is enrolled. The binding is the enrolled mesh account id (a stable
  // reference, never the hash-derived bundle binding); without it issuance
  // refuses with a typed code and the seat provisions auth-only. Vibe has
  // no measured gate and no block.
  let onboarding = undefined;
  let onboardingRefused = undefined;
  if (identity.cli !== 'vibe' && gate.accountId) {
    const nativeCliVersion = cliVersions[identity.cli];
    const captureInput = { cli: identity.cli, seatRef: seatId, ownerScope,
      accountBinding: gate.accountId, nativeCliVersion, os: 'linux', capturedAt: issuedAt,
      lineage: { epoch: 1, generation: 0, operationId: opId },
      cellSynthesis: [...(SEAT_CELL_SYNTHESIS[identity.cli] ?? [])] };
    if (identity.cli === 'codex') captureInput.intent = { ...CODEX_SEAT_INTENT,
      mcpServerNames: [...CODEX_SEAT_INTENT.mcpServerNames] };
    else {
      captureInput.sourceHome = homeDir;
      captureInput.selector = { sourceRelPath: CAPTURE_SOURCES[identity.cli] };
    }
    const captured = await captureReviewedSeatOnboarding(captureInput);
    if (captured.ok) onboarding = captured.block;
    else onboardingRefused = captured.code;
  } else if (identity.cli !== 'vibe') {
    onboardingRefused = 'onboarding-binding-unverifiable';
  }
  let bundle;
  try {
    // L7 (design §3.4): when a block is issued, the bundle binding switches
    // its source to the eligible one — the enrolled mesh account id — so it
    // matches the block exactly. Without a block the hash binding stays.
    bundle = parseCliSeatProfile({ seatRef: seatId, ownerScope, cli: identity.cli,
      issuingClientRef: identity.issuingClientRef, endpointFamily: identity.endpointFamily,
      credentialFormatVersion: 'v1', os: 'linux',
      accountBinding: onboarding ? gate.accountId : `binding-${seatId}-${digest.slice(0, 16)}`,
      entitlementClass: 'seat', epoch: 1, generation: 0, operationId: opId,
      ...(onboarding ? { nativeCliVersion: onboarding.nativeCliVersion } : {}),
      issuedAt, accessKind: 'access', accessRef: `access-${seatId}-${digest.slice(16, 32)}` });
  } catch (error) { throw new Error(`seat-bundle-rejected:${seatId}:${error.code ?? 'unknown'}`); }
  const envelope = { bundle, files };
  if (identity.cli === 'agy') {
    envelope.agy = { ...AGY_TUPLE };
    try {
      translateAgySeatToApplication({ ownerScope, seatRef: seatId,
        accountBinding: bundle.provenance.accountBinding, ...envelope.agy });
    } catch (error) { throw new Error(`agy-tuple-rejected:${seatId}:${error.code ?? 'unknown'}`); }
  }
  if (onboarding) envelope.onboarding = onboarding;
  const serialized = JSON.stringify(envelope);
  if (Buffer.byteLength(serialized, 'utf8') > SEAT_BUNDLE_MAX_BYTES) {
    throw new Error(`seat-bundle-oversize:${seatId}`);
  }
  // Names-only seat source: which store decided, under which gate. The
  // capture refusal code is names-only (design §3.4): it diagnoses why no
  // block was issued while the gate code stays the launch channel.
  const onboardingStatus = onboarding ? 'present' : 'absent';
  const source = { seatId, cli: identity.cli, kind: identity.cli === 'vibe' ? 'llm-mesh' : 'cli-login',
    provider: gate.provider, meshGate: gate.meshGate, files: Object.keys(files).sort(),
    onboardingStatus, launchGate: seatLaunchGate(identity.cli, onboardingStatus),
    ...(gate.accountId ? { accountId: gate.accountId } : {}),
    ...(gate.cause ? { cause: gate.cause } : {}),
    ...(onboardingRefused ? { onboardingRefused } : {}),
    ...(identity.cli === 'agy' && onboardingRefused && cliVersions.agy && !AGY_REQUIRED_COMPLETED_STEPS[cliVersions.agy]
      ? { captureRefusal: { code: 'onboarding-version-unreviewed', nativeCliVersion: cliVersions.agy,
        reviewedNativeCliVersions: Object.keys(AGY_REQUIRED_COMPLETED_STEPS) } } : {}) };
  return { envelope, serialized, files: Object.keys(files).sort(), source };
}

// Write one envelope 0600 (exclusive create, never overwrite).
export function writeEnvelopeFile(dir, seatId, serialized) {
  const file = join(dir, `${seatId}.envelope.json`);
  fs.writeFileSync(file, serialized, { mode: 0o600, flag: 'wx' });
  return file;
}

// Validate one envelope through the fixed seat-load helper over a private
// FD: the bytes travel from the 0600 file to the validator, never argv.
// Returns the names-only provisioning receipt.
export function validateEnvelopeViaFd({ seatId, slotManifestFile, envelopeFile }) {
  const load = join(repoRoot, 'scripts/xcli-seat-load.mjs');
  let fd = null;
  try {
    fd = fs.openSync(envelopeFile, 'r');
    const probed = spawnSync(process.execPath,
      [load, '--seat', seatId, '--slot-manifest', slotManifestFile, '--input-fd', '3'],
      { stdio: ['ignore', 'pipe', 'pipe', fd], encoding: 'utf8', timeout: 30000 });
    const out = `${probed.stdout ?? ''}`;
    if (probed.status === 0) {
      const receipt = JSON.parse(out);
      assert.equal(receipt.seatId, seatId, 'seat-load receipt names its seat');
      return receipt;
    }
    const code = (out.match(/seat-load: REFUSED code=(\S+)/) ?? [])[1] ?? 'unknown';
    throw new Error(`seat-load-refused:${seatId}:${code}`);
  } catch (error) {
    if (String(error.message ?? '').startsWith('seat-load-refused:')) throw error;
    throw new Error(`seat-load-failed:${seatId}`);
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* closed */ }
  }
}

// Minimal gh driver (conductor machine or a fixture stub in tests).
export function runGh(ghBin, args, { input = undefined } = {}) {
  const probed = spawnSync(ghBin, args,
    { input, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  return { status: probed.status, stdout: `${probed.stdout ?? ''}`, stderr: `${probed.stderr ?? ''}` };
}

const ghJson = (ghBin, method, path, body) => {
  const args = ['api', '--method', method, path, '--input', '-'];
  const probed = runGh(ghBin, args, { input: JSON.stringify(body) });
  if (probed.status !== 0) throw new Error(`gh-api-failed:${method}:${path}`);
  try { return JSON.parse(probed.stdout || '{}'); }
  catch { return {}; }
};

// Ensure the protected environment exists with the deployment branch policy
// limited to main + feat/live-cross-cli-messaging. In dry-run, record the
// commands without running them. Returns the recorded gh invocations.
export function ensureEnvironment({ ghBin = 'gh', dryRun = false } = {}) {
  const calls = [];
  const env = `repos/rhanka/h2a/environments/${SEAT_ENVIRONMENT}`;
  if (dryRun) {
    calls.push({ argv: [ghBin, 'api', '--method', 'PUT', env], stdin: 'environment-body' });
    for (const branch of DEPLOY_BRANCHES) {
      calls.push({ argv: [ghBin, 'api', '--method', 'POST', `${env}/deployment-branch-policies`], stdin: branch });
    }
    return calls;
  }
  ghJson(ghBin, 'PUT', env, { deployment_branch_policy:
    { protected_branches: false, custom_branch_policies: true } });
  calls.push({ argv: [ghBin, 'api', '--method', 'PUT', env] });
  let existing = [];
  try {
    const listed = ghJson(ghBin, 'GET', `${env}/deployment-branch-policies`, undefined);
    existing = (listed.branch_policies ?? []).map(entry => entry.name);
  } catch { existing = []; }
  for (const branch of DEPLOY_BRANCHES) {
    if (existing.includes(branch)) continue;
    ghJson(ghBin, 'POST', `${env}/deployment-branch-policies`, { name: branch });
    calls.push({ argv: [ghBin, 'api', '--method', 'POST', `${env}/deployment-branch-policies`], stdin: branch });
  }
  return calls;
}

// Upload one envelope under one secret name. Bytes travel via --body-file,
// never argv.
export function setSecret({ ghBin = 'gh', name, file }) {
  const probed = runGh(ghBin,
    ['secret', 'set', name, '--env', SEAT_ENVIRONMENT, '--repo', 'rhanka/h2a', '--body-file', file]);
  if (probed.status !== 0) throw new Error(`gh-secret-failed:${name}`);
  return { secret: name, ok: true };
}

// Shred envelope files (or whole provision dirs) and prove their absence.
// Returns survivors (empty = proven); callers print counts and seat names
// only, never paths that could name secret material.
export function shredFiles(files) {
  const surviving = [];
  for (const file of files) {
    try { fs.rmSync(file, { recursive: true, force: true }); } catch { /* the re-check below decides */ }
    if (fs.existsSync(file)) surviving.push(true);
  }
  return surviving;
}

// Build, write (0600, private 0700 dir) and FD-validate every seat in the
// set. Modes: 'provision' uploads then shreds; 'dry-run' records the gh
// calls then shreds; 'local' materialises a lane manifest and keeps the dir
// for the local campaign (its runner shreds it with a receipt).
export async function provisionSeats({ seatSet = DEFAULT_SEAT_SET,
  slotManifestFile = join(repoRoot, 'docs/cross-cli-seat-slots.json'),
  homeDir = homedir(), ownerScope = 'owner',
  outBase = join(homedir(), '.cache-tmp', 'h2a-test'),
  ghBin = 'gh', mode = 'provision', meshFacade = null,
  meshScope = meshOwnerScope(), cliVersions = {}, allowUnavailableSeats = false } = {}) {
  assert.ok(['provision', 'dry-run', 'local'].includes(mode), 'known provision mode');
  const slotManifest = JSON.parse(fs.readFileSync(slotManifestFile, 'utf8'));
  if (slotManifest.environment !== SEAT_ENVIRONMENT) throw new Error('environment-mismatch');
  const ids = String(seatSet).split(',').map(seat => seat.trim()).filter(Boolean);
  if (!ids.length) throw new Error('seat-set-required');
  const byId = Object.fromEntries((slotManifest.seats ?? []).map(seat => [seat.seatId, seat]));
  fs.mkdirSync(outBase, { recursive: true });
  const outDir = fs.mkdtempSync(join(outBase, 'xcli-seat-provision-'));
  fs.chmodSync(outDir, 0o700);
  // The production facade reads the owner mesh store (injected in tests).
  // A facade that cannot be created degrades to null: vibe then refuses,
  // file seats record store-unreachable on their source receipt.
  let facade = meshFacade;
  if (!facade) {
    try { facade = await createMeshSeatFacade({ ownerScope: meshScope }); }
    catch { facade = null; }
  }
  const seats = [];
  const unavailable = [];
  try {
    for (const seatId of ids) {
      const slot = byId[seatId];
      if (!slot) throw new Error(`seat-unknown:${seatId}`);
      let built;
      try {
        built = await buildSeatEnvelope({ seatId, slot, homeDir, ownerScope,
          meshFacade: facade, meshScope, cliVersions });
      } catch (error) {
        // Full local matrices retain the refused seat as a closed gate.
        // No envelope, credential read or launch is manufactured for it.
        if (mode !== 'local' || !allowUnavailableSeats ||
            error.message !== `seat-not-enrolled-in-llm-mesh:${seatId}`) throw error;
        unavailable.push({ seatId, cli: seatId, meshGate: 'not-enrolled', reason: error.message });
        continue;
      }
      const file = writeEnvelopeFile(outDir, seatId, built.serialized);
      assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'envelope file is private');
      const receipt = validateEnvelopeViaFd({ seatId, slotManifestFile, envelopeFile: file });
      const names = slotSecretNames(seatId, slot.slot);
      seats.push({ seatId, slot: slot.slot, file, receipt, names, source: built.source });
    }
    if (mode === 'local') {
      const laneDir = join(outDir, 'lane');
      const secrets = Object.fromEntries(seats.map(seat =>
        [seat.names.projection, fs.readFileSync(seat.file, 'utf8')]));
      const materialised = seats.length
        ? await materialiseSeatEnvelopes({ seatSet: seats.map(seat => seat.seatId).join(','), slotManifest, secrets, baseDir: laneDir })
        : { manifest: { version: 1, seatMode: 'cyber-seat-custody', ownerScope, seats: [] },
          manifestFile: join(laneDir, 'seats.json') };
      fs.mkdirSync(laneDir, { recursive: true, mode: 0o700 });
      for (const seat of unavailable) materialised.manifest.seats.push({
        seatId: seat.seatId, family: seat.cli, authSource: `unavailable/${seat.seatId}`,
        unavailableReason: seat.reason,
        onboarding: { status: 'absent', gate: { eligible: false, code: seat.reason } },
      });
      // Transport the names-only capture diagnosis beside the library's
      // closed gate. Never manufacture a block for an unreviewed version.
      for (const seat of materialised.manifest.seats) {
        const refused = seats.find(entry => entry.seatId === seat.seatId)?.source.captureRefusal;
        if (refused) seat.onboarding.captureRefusal = refused;
      }
      fs.writeFileSync(materialised.manifestFile, JSON.stringify(materialised.manifest, null, 2) + '\n', { mode: 0o600 });
      const manifestDigest = createHash('sha256').update(fs.readFileSync(materialised.manifestFile)).digest('hex');
      return { mode, outDir, manifestFile: materialised.manifestFile,
        manifestDigest, seats: seats.map(seat => seat.receipt),
        sources: [...seats.map(seat => seat.source), ...unavailable] };
    }
    const ghCalls = ensureEnvironment({ ghBin, dryRun: mode === 'dry-run' });
    const uploaded = [];
    if (mode === 'provision') {
      for (const seat of seats) {
        for (const name of [seat.names.canonical, seat.names.candidate, seat.names.projection]) {
          uploaded.push(setSecret({ ghBin, name, file: seat.file }));
        }
      }
    } else {
      for (const seat of seats) {
        for (const name of [seat.names.canonical, seat.names.candidate, seat.names.projection]) {
          ghCalls.push({ argv: [ghBin, 'secret', 'set', name, '--env', SEAT_ENVIRONMENT,
            '--repo', 'rhanka/h2a', '--body-file', `<envelope:${seat.seatId}>`] });
        }
      }
    }
    const surviving = shredFiles(seats.map(seat => seat.file));
    if (surviving.length) throw new Error('shred-unproven');
    return { mode, outDir, seats: seats.map(seat => seat.receipt), uploaded, ghCalls,
      sources: seats.map(seat => seat.source),
      shredded: { seats: seats.map(seat => seat.seatId), files: seats.length, surviving: [] } };
  } catch (error) {
    const surviving = shredFiles(seats.map(seat => seat.file));
    // A failed local run leaves no provision dir behind: the caller never
    // received its path, so nothing could shred it later.
    if (mode === 'local') shredFiles([outDir]);
    if (surviving.length) throw new Error('shred-unproven');
    throw error;
  }
}

const option = (args, name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

if (process.argv[1] && resolve(process.argv[1]) === self) {
  const args = process.argv.slice(2);
  const mode = args.includes('--local') ? 'local' : args.includes('--dry-run') ? 'dry-run' : 'provision';
  // R23: the OS keyring path is removed — a stale --keyring-bin invocation
  // fails closed instead of silently provisioning from another source.
  if (args.includes('--keyring-bin')) {
    console.log('seat-provision: REFUSED code=keyring-source-removed');
    process.exit(1);
  }
  try {
    // L7: probe the installed CLI versions once for onboarding capture.
    // A missing binary refuses per seat (null): issuance fails closed.
    const requested = option(args, '--seat-set', DEFAULT_SEAT_SET).split(',').map(s => s.trim()).filter(Boolean);
    const cliVersions = {};
    for (const seatId of requested) {
      const identity = SEAT_IDENTITIES[seatId];
      if (!identity || identity.cli === 'vibe') continue;
      const version = probeCliVersion(identity.cli);
      if (version) cliVersions[identity.cli] = version;
    }
    const result = await provisionSeats({ seatSet: option(args, '--seat-set', DEFAULT_SEAT_SET),
      slotManifestFile: option(args, '--slot-manifest', join(repoRoot, 'docs/cross-cli-seat-slots.json')),
      homeDir: option(args, '--home', homedir()),
      ownerScope: option(args, '--owner-scope', 'owner'),
      outBase: option(args, '--out-base', join(homedir(), '.cache-tmp', 'h2a-test')),
      ghBin: option(args, '--gh-bin', 'gh'), mode, cliVersions });
    for (const receipt of result.seats) console.log(JSON.stringify(receipt));
    for (const source of result.sources ?? []) {
      console.log(JSON.stringify({ event: 'seat-provision-sourced', ...source }));
    }
    if (mode === 'local') {
      console.log(JSON.stringify({ event: 'seat-provision-local', manifestFile: result.manifestFile,
        manifestDigest: result.manifestDigest, seats: result.seats.map(receipt => receipt.seatId) }));
    } else {
      for (const call of result.ghCalls ?? []) console.log(JSON.stringify({ event: 'seat-provision-gh', call }));
      for (const done of result.uploaded ?? []) console.log(JSON.stringify({ event: 'seat-provision-uploaded', ...done }));
      console.log(JSON.stringify({ event: 'seat-provision-shredded', ...result.shredded }));
    }
  } catch (error) {
    console.log(`seat-provision: REFUSED code=${error.message}`);
    if (error.enroll) console.log(`seat-provision: ENROLL ${error.enroll}`);
    process.exit(1);
  }
}
