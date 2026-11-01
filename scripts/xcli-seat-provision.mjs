// R19 conductor seat provisioning (owner 01/11: the conductor provisions
// the seats; vibe covered). For each seat in the set, this script — and only
// this script — reads the LOCAL auth-only material of that CLI (the exact
// LOGIN_ALLOWLIST paths under a home directory: the real HOME in conductor
// use, a synthetic fixture HOME in tests), builds the seat envelope, writes
// it 0600 in a private 0700 dir, validates it through
// scripts/xcli-seat-load.mjs over --input-fd, then uploads it with
// `gh secret set <NAME> --env cross-cli-seats --repo rhanka/h2a --body-file`
// for the canonical, candidate and runtime projection names, and shreds the
// files. Stdout carries receipts with names only — secret bytes never reach
// argv, logs, or error messages. `--dry-run` validates without uploading;
// `--local` validates and materialises a lane manifest for a local campaign
// without any GitHub write. It also creates the `cross-cli-seats`
// environment when absent, with the deployment branch policy limited to
// `main` + `feat/live-cross-cli-messaging`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LOGIN_ALLOWLIST } from './xcli-lab.mjs';
import { slotSecretNames, SEAT_ENVIRONMENT } from './xcli-seat-custody.mjs';
import { materialiseSeatEnvelopes, parseCliSeatProfile,
  translateAgySeatToApplication } from './xcli-seat-import.mjs';
import { SEAT_BUNDLE_MAX_BYTES } from './xcli-seat-vendor/seat-bundle.js';

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

// Build one seat envelope from local auth-only material. `env` supplies
// MISTRAL_API_KEY for vibe (the vendor product keeps no auth file: env wins,
// else the OS keyring — the script never touches the keyring). Returns the
// envelope plus the file's names for receipts.
export function buildSeatEnvelope({ seatId, slot, homeDir, env = {}, ownerScope = 'owner',
  issuedAt = new Date().toISOString(), operationId = null } = {}) {
  assert.ok(seatId && slot && homeDir, 'seat, slot and home required');
  const identity = SEAT_IDENTITIES[seatId];
  if (!identity) throw new Error(`seat-unknown:${seatId}`);
  const allowlisted = LOGIN_ALLOWLIST[identity.cli] ?? null;
  if (allowlisted === null && identity.cli !== 'agy') throw new Error(`login-not-confined:${seatId}`);
  const raws = [];
  const files = {};
  if (identity.cli === 'vibe') {
    const key = env.MISTRAL_API_KEY;
    if (typeof key !== 'string' || !key.trim()) throw new Error('vibe-key-missing:vibe');
    const bytes = Buffer.from(key.trim(), 'utf8');
    raws.push(bytes);
    files[VIBE_SEAT_FILE] = bytes.toString('base64');
  } else if (identity.cli === 'agy') {
    // Agy keeps no local auth files: its seat binds the cloud-code tuple
    // below (keyring-held account, never copied). The binding digests the
    // tuple itself, so re-provisioning the same tuple is stable.
    raws.push(Buffer.from(JSON.stringify(AGY_TUPLE), 'utf8'));
  } else {
    if (!allowlisted?.length) throw new Error(`no-allowlisted-login-files:${seatId}`);
    for (const rel of allowlisted) {
      const bytes = readAuthFile(homeDir, seatId, rel);
      raws.push(bytes);
      files[rel] = bytes.toString('base64');
    }
  }
  const digest = createHash('sha256').update(Buffer.concat(raws)).digest('hex');
  let bundle;
  try {
    bundle = parseCliSeatProfile({ seatRef: seatId, ownerScope, cli: identity.cli,
      issuingClientRef: identity.issuingClientRef, endpointFamily: identity.endpointFamily,
      credentialFormatVersion: 'v1', os: 'linux', accountBinding: `binding-${seatId}-${digest.slice(0, 16)}`,
      entitlementClass: 'seat', epoch: 1, generation: 0,
      operationId: operationId ?? `op-${seatId}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`,
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
  const serialized = JSON.stringify(envelope);
  if (Buffer.byteLength(serialized, 'utf8') > SEAT_BUNDLE_MAX_BYTES) {
    throw new Error(`seat-bundle-oversize:${seatId}`);
  }
  return { envelope, serialized, files: Object.keys(files).sort() };
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
export function provisionSeats({ seatSet = DEFAULT_SEAT_SET,
  slotManifestFile = join(repoRoot, 'docs/cross-cli-seat-slots.json'),
  homeDir = homedir(), env = process.env, ownerScope = 'owner',
  outBase = join(homedir(), '.cache-tmp', 'h2a-test'),
  ghBin = 'gh', mode = 'provision' } = {}) {
  assert.ok(['provision', 'dry-run', 'local'].includes(mode), 'known provision mode');
  const slotManifest = JSON.parse(fs.readFileSync(slotManifestFile, 'utf8'));
  if (slotManifest.environment !== SEAT_ENVIRONMENT) throw new Error('environment-mismatch');
  const ids = String(seatSet).split(',').map(seat => seat.trim()).filter(Boolean);
  if (!ids.length) throw new Error('seat-set-required');
  const byId = Object.fromEntries((slotManifest.seats ?? []).map(seat => [seat.seatId, seat]));
  fs.mkdirSync(outBase, { recursive: true });
  const outDir = fs.mkdtempSync(join(outBase, 'xcli-seat-provision-'));
  fs.chmodSync(outDir, 0o700);
  const seats = [];
  try {
    for (const seatId of ids) {
      const slot = byId[seatId];
      if (!slot) throw new Error(`seat-unknown:${seatId}`);
      const built = buildSeatEnvelope({ seatId, slot, homeDir, env, ownerScope });
      const file = writeEnvelopeFile(outDir, seatId, built.serialized);
      assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'envelope file is private');
      const receipt = validateEnvelopeViaFd({ seatId, slotManifestFile, envelopeFile: file });
      const names = slotSecretNames(seatId, slot.slot);
      seats.push({ seatId, slot: slot.slot, file, receipt, names });
    }
    if (mode === 'local') {
      const laneDir = join(outDir, 'lane');
      const secrets = Object.fromEntries(seats.map(seat =>
        [seat.names.projection, fs.readFileSync(seat.file, 'utf8')]));
      const materialised = materialiseSeatEnvelopes({ seatSet: ids.join(','), slotManifest, secrets, baseDir: laneDir });
      return { mode, outDir, manifestFile: materialised.manifestFile,
        manifestDigest: materialised.manifestDigest, seats: seats.map(seat => seat.receipt) };
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
  try {
    const result = provisionSeats({ seatSet: option(args, '--seat-set', DEFAULT_SEAT_SET),
      slotManifestFile: option(args, '--slot-manifest', join(repoRoot, 'docs/cross-cli-seat-slots.json')),
      homeDir: option(args, '--home', homedir()), env: process.env,
      ownerScope: option(args, '--owner-scope', 'owner'),
      outBase: option(args, '--out-base', join(homedir(), '.cache-tmp', 'h2a-test')),
      ghBin: option(args, '--gh-bin', 'gh'), mode });
    for (const receipt of result.seats) console.log(JSON.stringify(receipt));
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
    process.exit(1);
  }
}
