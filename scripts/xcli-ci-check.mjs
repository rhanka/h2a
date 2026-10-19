#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matrix } from './xcli-lab.mjs';

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
