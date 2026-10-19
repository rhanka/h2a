// Lot L11 (SPEC v3 §7.1): no-secrets receipt check for the campaign lane.
// Verifies a presented campaign receipt against the candidate tree: exact
// SHA, harness digests, seat-manifest digest binding, pinned CLI versions,
// matrix version, the mandatory set for the gate, every mandatory cell
// measured-OK (never simulated), and proven cleanup everywhere. Each refusal
// carries a distinct classified code. Report-only mode never fails: it
// prints `qualification: open` with the current balance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ORACLE_SOURCES } from './xcli-lab.mjs';
import { SEATED_FAMILIES } from './xcli-matrix-check.mjs';

export const RECEIPT_VERSION = 1;

export function loadMatrixManifest(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// sha256 over every harness script in the candidate tree, keyed by repo
// relative path. A receipt from before any harness change is stale.
export function computeHarnessDigests(repoRoot) {
  const names = fs.readdirSync(join(repoRoot, 'scripts')).filter(name => /^xcli-.*\.mjs$/.test(name));
  const files = [...names.map(name => join('scripts', name)), 'scripts/qualify-cross-cli.mjs'].sort();
  return Object.fromEntries(files.map(file =>
    [file, createHash('sha256').update(fs.readFileSync(join(repoRoot, file))).digest('hex')]));
}

const rowKey = row => `${row.scenario}:${row.pair}`;

function refuse(code) {
  throw new Error(code);
}

export function checkReceipt(receipt, ctx) {
  if (!receipt || typeof receipt !== 'object') refuse('receipt-absent');
  assert.equal(receipt.version, RECEIPT_VERSION, 'receipt-malformed: version');
  assert.equal(receipt.lane, 'campaign', 'receipt-malformed: lane');
  if (receipt.sha !== ctx.sha) refuse('sha-mismatch');
  assert.deepEqual(receipt.harnessDigests, computeHarnessDigests(ctx.repoRoot), 'harness-digest-stale');
  assert.match(receipt.seatManifestDigest ?? '', /^[0-9a-f]{64}$/, 'seat-manifest-digest-stale');
  // The seat manifest itself holds no seat material but lives outside the
  // candidate tree, so the check cannot re-derive its digest: the receipt is
  // bound to the digest the trusted lane published alongside it
  // (binding-by-publication). An expected digest pins the binding.
  if (ctx.seatManifestDigest && receipt.seatManifestDigest !== ctx.seatManifestDigest) {
    refuse('seat-manifest-digest-stale');
  }
  const pinned = Object.entries(ORACLE_SOURCES).filter(([, source]) => source.kind !== 'none');
  for (const family of SEATED_FAMILIES) {
    const entry = receipt.cliVersions?.[family];
    if (!/^\d+\.\d+\.\d+(-R\d+(\.\d+)?)?$/.test(entry?.version ?? '')) refuse(`cli-version-stale:${family}`);
    if (!/^[0-9a-f]{64}$/i.test(entry?.binaryDigest ?? '')) refuse(`cli-digest-missing:${family}`);
  }
  for (const [family, source] of pinned) {
    if (receipt.cliVersions[family].version !== source.pin) refuse(`cli-version-stale:${family}`);
  }
  const manifest = ctx.manifest ?? loadMatrixManifest(ctx.manifestFile ??
    join(ctx.repoRoot, 'docs/cross-cli-matrix.json'));
  if (receipt.matrixVersion !== manifest.version) refuse('matrix-version-stale');
  const expected = (manifest.mandatory?.[ctx.gate] ?? []).map(rowKey).sort();
  const declared = (receipt.mandatory ?? []).map(rowKey).sort();
  assert.deepEqual(declared, expected, 'mandatory-set-mismatch');
  const cells = new Map((receipt.cells ?? []).map(cell => [rowKey(cell), cell]));
  for (const key of expected) {
    const cell = cells.get(key);
    if (!cell) refuse(`cell-missing:${key}`);
    if (cell.status === 'blocked') refuse(`cell-blocked:${key}`);
    if (cell.simulated === true || /^simulated-/.test(cell.status ?? '')) refuse(`cell-simulated:${key}`);
    if (cell.status !== 'measured-OK') refuse(`cell-not-measured:${key}`);
    if (cell.cleanup?.secretWipe !== true) refuse(`cleanup-unproven:${key}`);
  }
  if (receipt.cleanup?.secretWipeProven !== true) refuse('cleanup-unproven:campaign');
  if (JSON.stringify(receipt).includes('secret-wipe-unproven')) refuse('secret-wipe-unproven');
  assert.ok(Number.isSafeInteger(receipt.caps?.sessionsDebited), 'caps-missing');
  return { cells: expected.length, gate: ctx.gate };
}

function printOpen(reason, balance) {
  console.log(`qualification: open (${reason})${balance ?? ''}`);
}

const invokedAsCli = process.argv[1] === new URL(import.meta.url).pathname;
if (invokedAsCli) {
  const raw = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < raw.length; i++) {
    if (!raw[i].startsWith('--')) continue;
    const next = raw[i + 1];
    if (next === undefined || next.startsWith('--')) args[raw[i].slice(2)] = true;
    else { args[raw[i].slice(2)] = next; i++; }
  }
  const repoRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
  const receiptFile = args.receipt ?? join(repoRoot, 'docs/cross-cli-receipt.json');
  const ctx = { sha: args.sha, gate: args.gate ?? 'merge', repoRoot,
    seatManifestDigest: typeof args['seat-manifest-digest'] === 'string' ? args['seat-manifest-digest'] : undefined };
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  } catch {
    if (args['report-only']) { printOpen('no receipt presented'); process.exit(0); }
    console.log('receipt-check: REFUSED code=receipt-absent');
    process.exit(1);
  }
  try {
    const result = checkReceipt(receipt, ctx);
    console.log(`receipt-check: pass gate=${result.gate} cells=${result.cells} sha=${receipt.sha}`);
  } catch (error) {
    if (args['report-only']) {
      printOpen(error.message);
      process.exit(0);
    }
    console.log(`receipt-check: REFUSED code=${error.message}`);
    process.exit(1);
  }
}
