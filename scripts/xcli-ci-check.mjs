#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { matrix } from './xcli-lab.mjs';
import { computeHarnessDigests, loadMatrixManifest, RECEIPT_VERSION } from './xcli-receipt-check.mjs';

// Lot L11 (SPEC v3 §7.1): assemble the filtered campaign receipt from the
// lane's own outputs — the qualify result, the persisted cap ledger, and the
// CLI versions the lane measured. Harness digests are recomputed from the
// candidate tree (never trusted from the qualify output). Seat material
// never enters the receipt: the seat manifest digest binds the receipt to
// the manifest the lane used, and per-seat paths stay out.
export function buildCampaignReceipt({ campaignRoot, sha, gate, repoRoot, cliVersions, manifestFile, seatManifestDigest }) {
  assert.ok(['merge', 'release'].includes(gate), 'receipt gate is merge or release');
  // The seat manifest lives outside the candidate tree, so the lane measures
  // its digest from the exact file it used and passes it in: the receipt is
  // bound to that manifest by publication, never by re-derivation here.
  assert.match(seatManifestDigest ?? '', /^[0-9a-f]{64}$/, 'seat manifest digest required');
  const qualify = JSON.parse(fs.readFileSync(join(campaignRoot, 'qualification.json'), 'utf8'));
  assert.equal(qualify.version, 1, 'qualify output version must be 1');
  const simulated = qualify.mode === 'simulated-model';
  const ledger = JSON.parse(fs.readFileSync(join(campaignRoot, 'campaign-ledger.json'), 'utf8'));
  const manifest = loadMatrixManifest(manifestFile ?? join(repoRoot, 'docs/cross-cli-matrix.json'));
  const mandatory = manifest.mandatory?.[gate] ?? [];
  const byPair = new Map(qualify.cells.map(cell => [`${cell.sender}:${cell.receiver}`, cell]));
  const cells = mandatory.map(row => {
    const source = byPair.get(row.pair) ?? {};
    return { scenario: row.scenario, pair: row.pair,
      status: source.status ?? 'blocked',
      simulated: simulated || source.status === undefined ? true : (source.simulated ?? false),
      blocker: source.blocker ?? (source.status === undefined ? 'cell-missing-in-output' : null),
      stages: { sent: source.sent ?? null, delivered: source.delivered ?? null },
      caps: { sessionsDebited: 1 },
      cleanup: { secretWipe: source.secretWipe === true } };
  });
  return { version: RECEIPT_VERSION, lane: 'campaign', sha,
    harnessDigests: computeHarnessDigests(repoRoot),
    seatManifestDigest,
    cliVersions, matrixVersion: manifest.version, mandatory,
    cells,
    caps: { sessionsDebited: ledger.sessionsDebited ?? 0,
      wallClockSpentMs: ledger.wallClockSpentMs ?? 0 },
    cleanup: { secretWipeProven: cells.every(cell => cell.cleanup.secretWipe) } };
}

export function verifyReceiverIdleInput(cell) {
  const barrier = cell.evidence.find(event => event.event === 'receiver-idle-barrier');
  assert.ok(Number.isFinite(barrier?.at), 'receiver idle barrier required');
  assert.ok(!cell.evidence.some(event => event.role === 'receiver' &&
    ['startup-ui', 'startup-terminal-response'].includes(event.event) && event.at >= barrier.at),
  'receiver input after the idle barrier invalidates live-wake proof');
}

export function verifySimulation(receipt, negative = false) {
  assert.equal(receipt.mode, 'simulated-model', 'CI cannot relabel a real-CLI run');
  assert.equal(receipt.cells.length, negative ? 1 : 36);
  if (!negative) matrix(receipt.cells); // validates all distinct ordered pairs
  for (const cell of receipt.cells) {
    assert.equal(cell.status, negative ? 'simulated-KO' : 'simulated-OK');
    assert.equal(cell.blocker, undefined);
    assert.notEqual(cell.cleanupFailed, true);
    assert.equal(cell.noPostSendHarnessInput, true);
    verifyReceiverIdleInput(cell);
    for (const key of ['senderMcp', 'receiverMcp', 'sent', 'delivered']) assert.equal(cell[key], true, key);
    for (const key of ['received', 'woke', 'replied', 'replyDelivered']) assert.equal(cell[key], !negative, key);
    assert.ok(Object.values(cell.credentialsCopied).every(files => files.length === 0), 'simulation must use no logins');
    // Lot L6: every cell carries its execution-journal verdict with the stated
    // scope, and no Python interpreter ran in our launch chain.
    assert.equal(cell.execJournal?.scope, 'spawn-event-our-chain; vendor-subtree-allowance', 'execution journal verdict with stated scope');
    assert.deepEqual(cell.execJournal.pythonDescendants, [], 'no Python in our launch chain');
    // Lot L3: every cell carries the withheld-wake protocol evidence and the
    // bounded claim — never an absolute wake-consumption proof. Windows must
    // fit inside the reported cell budget; the claim wording is exact.
    const w = cell.wakeWindows;
    assert.ok(w && Number.isSafeInteger(w.w0Ms) && Number.isSafeInteger(w.w1Ms) && Number.isSafeInteger(w.dMs) &&
      Number.isSafeInteger(w.barrierAt) && Number.isSafeInteger(cell.budgetMs) &&
      Number.isSafeInteger(w.notifyIntervalMs), 'wake windows, budget and tick interval witnessed');
    assert.ok(cell.budgetMs - (w.barrierAt - Date.parse(cell.startedAt)) >= w.w0Ms + w.w1Ms + w.dMs,
      'wake windows funded inside the cell budget, never silently shrunk');
    if (cell.wakeFailure === 'wake-withheld-forever') {
      assert.equal(cell.wakeClaim, 'no wake claimed (wake never released)');
    } else if (cell.delivered) {
      assert.equal(cell.wakeClaim,
        `withheld-protocol, periods ≤ ${w.w1Ms}ms excluded, single replication (no batch separation); varying-phase polling not excluded`,
        'bounded wake claim required');
    } else {
      assert.equal(cell.wakeClaim, 'no wake claimed (no durable delivery)');
    }
  }
  return { cells: receipt.cells.length, outcome: negative ? 'negative-control-detected' : 'simulated-round-trips-proven' };
}

// Lot L3 batch separation (§3.3): at least 3 cells per receiver family must
// pass the withheld-wake protocol with harness-chosen, recorded release
// delays, and the batch must satisfy the separation condition on ACTUAL
// witnessed times, all relative to each cell's idle barrier: for two distinct
// repetitions i and j, the whole acceptance window A_i = [wake_i, wake_i + D]
// must lie strictly inside the withheld window B_j = [delivery_j, release_j),
// with margins exceeding the recorded timestamp uncertainty. Intended release
// offsets are not a substitute for observed wake injections.
export const WAKE_SEPARATION_MARGIN_MS = 500;
export function verifyWakeBatch(cells) {
  const failures = [];
  if (!Array.isArray(cells) || cells.length < 3) {
    failures.push("wake batch needs at least 3 replications");
    return { pass: false, failures };
  }
  for (const [index, cell] of cells.entries()) {
    if (cell.woke !== true) failures.push(`rep ${index}: no stage-7 credit without cell-level phases 1-3`);
    for (const key of ["barrierAt", "deliveryAt", "releaseAt", "wakeAt", "firstReadAt", "dMs"]) {
      if (!Number.isFinite(cell.wakeWindows?.[key])) failures.push(`rep ${index}: wakeWindows.${key} not witnessed`);
    }
  }
  if (failures.length) return { pass: false, failures };
  const rel = cells.map(cell => {
    const w = cell.wakeWindows;
    return { aStart: w.wakeAt - w.barrierAt, aEnd: w.wakeAt + w.dMs - w.barrierAt,
      bStart: w.deliveryAt - w.barrierAt, bEnd: w.releaseAt - w.barrierAt };
  });
  let separated = false;
  for (let i = 0; i < rel.length && !separated; i++) for (let j = 0; j < rel.length && !separated; j++) {
    if (i === j) continue;
    const a = rel[i], b = rel[j];
    if (b.bStart + WAKE_SEPARATION_MARGIN_MS <= a.aStart && a.aEnd + WAKE_SEPARATION_MARGIN_MS <= b.bEnd) separated = true;
  }
  if (!separated) failures.push("wake-phase-separation-unproven: no acceptance window lies strictly inside another withheld window with margin");
  return { pass: failures.length === 0, failures };
}

if (process.argv[1]?.endsWith('/xcli-ci-check.mjs')) {
  console.log(JSON.stringify(verifySimulation(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), process.argv.includes('--negative'))));
}
