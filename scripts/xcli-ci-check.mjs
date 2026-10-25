#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { matrix, CLIS } from './xcli-lab.mjs';
import { computeHarnessDigests, loadMatrixManifest, RECEIPT_VERSION, STAGE_KEYS } from './xcli-receipt-check.mjs';

// Lot L11 (SPEC v3 §7.1): assemble the filtered campaign receipt from the
// lane's own outputs — the qualify result, the persisted cap ledger, and the
// CLI versions the lane measured. Harness digests are recomputed from the
// candidate tree (never trusted from the qualify output). Seat material
// never enters the receipt: the seat manifest digest binds the receipt to
// the manifest the lane used, and per-seat paths stay out.
export function buildCampaignReceipt({ campaignRoot, sha, gate, repoRoot, cliVersions, manifestFile, seatManifestDigest, provenance }) {
  assert.ok(['merge', 'release'].includes(gate), 'receipt gate is merge or release');
  // The seat manifest lives outside the candidate tree, so the lane measures
  // its digest from the exact file it used and passes it in: the receipt is
  // bound to that manifest by publication, never by re-derivation here.
  assert.match(seatManifestDigest ?? '', /^[0-9a-f]{64}$/, 'seat manifest digest required');
  const sourceBytes = fs.readFileSync(join(campaignRoot, 'qualification.json'));
  const qualify = JSON.parse(sourceBytes);
  assert.equal(qualify.version, 1, 'qualify output version must be 1');
  assert.equal(qualify.sha, sha, 'source-sha-mismatch');
  const simulated = qualify.mode === 'simulated-model';
  const ledger = JSON.parse(fs.readFileSync(join(campaignRoot, 'campaign-ledger.json'), 'utf8'));
  const manifest = loadMatrixManifest(manifestFile ?? join(repoRoot, 'docs/cross-cli-matrix.json'));
  const mandatory = manifest.mandatory?.[gate] ?? [];
  // An exact scenario and ordered pair are required; one scenario cannot
  // satisfy another row, even when they share the same pair.
  const byPair = new Map();
  for (const cell of qualify.cells) {
    const key = `${cell.scenario ?? 'probe'}:${cell.sender}:${cell.receiver}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(cell);
  }
  const cells = mandatory.map(row => {
    const repetitions = byPair.get(`${row.scenario}:${row.pair}`) ?? [];
    const source = repetitions.find(cell => cell.status !== 'measured-OK' || cell.blocker || cell.failure || cell.cleanupFailed) ?? repetitions[0] ?? {};
    return { scenario: row.scenario, pair: row.pair,
      status: source.status ?? 'blocked',
      simulated: simulated || source.status === undefined ? true : (source.simulated ?? false),
      blocker: source.blocker ?? (source.status === undefined ? 'cell-missing-in-output' : null),
      failure: source.failure ?? null, cleanupFailed: repetitions.some(cell => cell.cleanupFailed),
      sourceSha: qualify.sha,
      stages: Object.fromEntries(STAGE_KEYS.map(stage => [stage, repetitions.length > 0 && repetitions.every(cell => cell[stage] === true)])),
      proof: { identitiesReady: repetitions.length > 0 && repetitions.every(cell => {
        const identity = role => cell.evidence?.find(e => e.event === 'identity' && e.role === role && e.ok && e.ready)?.instance;
        return Boolean(identity('sender') && identity('receiver') && identity('sender') !== identity('receiver'));
      }), idleBarrier: repetitions.length > 0 && repetitions.every(cell => {
        try { verifyReceiverIdleInput(cell); return true; } catch { return false; }
      }) },
      noPostSendHarnessInput: repetitions.length > 0 && repetitions.every(cell => cell.noPostSendHarnessInput === true),
      wakeReplications: row.scenario === 'probe' ? repetitions.map(cell => ({ woke: cell.woke, wakeWindows: cell.wakeWindows,
        budgetMs: cell.budgetMs, startedAt: cell.startedAt, noPostSendHarnessInput: cell.noPostSendHarnessInput })) : undefined,
      scenarioExecuted: repetitions.length > 0 && repetitions.every(cell => cell.scenario === row.scenario && cell.senderScriptOk && cell.receiverScriptOk),
      caps: { sessionsDebited: repetitions.length * 2 },
      cleanup: { secretWipe: repetitions.length > 0 && repetitions.every(cell => cell.secretWipe === true && cell.parentSecretWipe === true),
        processRecovery: repetitions.length > 0 && repetitions.every(cell => cell.processRecovery === true && cell.parentProcessRecovery === true) } };
  });
  return { version: RECEIPT_VERSION, lane: 'campaign', sha,
    provenance, source: { sha: qualify.sha, digest: createHash('sha256').update(sourceBytes).digest('hex') },
    harnessDigests: computeHarnessDigests(repoRoot),
    seatManifestDigest,
    cliVersions, matrixVersion: manifest.version, mandatory,
    cells,
    caps: { sessionsDebited: ledger.sessionsDebited ?? 0,
      wallClockSpentMs: ledger.wallClockSpentMs ?? 0 },
    cleanup: { secretWipeProven: qualify.cells.every(cell => cell.secretWipe === true && cell.parentSecretWipe === true),
      processRecoveryProven: qualify.cells.every(cell => cell.processRecovery === true && cell.parentProcessRecovery === true) } };
}

export function verifyReceiverIdleInput(cell) {
  const barrier = cell.evidence.find(event => event.event === 'receiver-idle-barrier');
  assert.ok(Number.isFinite(barrier?.at), 'receiver idle barrier required');
  assert.ok(!cell.evidence.some(event => event.role === 'receiver' &&
    ['startup-ui', 'startup-terminal-response'].includes(event.event) && event.at >= barrier.at),
  'receiver input after the idle barrier invalidates live-wake proof');
}

export function verifySimulation(receipt, negative = false, sender) {
  assert.equal(receipt.mode, 'simulated-model', 'CI cannot relabel a real-CLI run');
  assert.ok(!sender || CLIS.includes(sender), 'known sender shard');
  const pairs = (sender ? [sender] : CLIS).flatMap(s => CLIS.map(r => `${s}:${r}`));
  assert.equal(receipt.cells.length, negative ? 1 : pairs.length * 3);
  if (!negative) {
    for (const pair of pairs) {
      const group = receipt.cells.filter(cell => `${cell.sender}:${cell.receiver}` === pair);
      assert.equal(group.length, 3, `three replications required: ${pair}`);
      assert.ok(verifyWakeBatch(group).pass, `separation required: ${pair}`);
    }
    if (!sender) matrix(pairs.map(pair => receipt.cells.find(cell => `${cell.sender}:${cell.receiver}` === pair)));
  }
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
    assert.equal(cell.execJournal?.scope, 'ptrace-exec-owned-subtree; vendor-subtree-allowance', 'execution journal verdict with stated scope');
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
    } else if (negative) {
      assert.match(cell.wakeClaim, /^no wake claimed/);
    } else if (cell.delivered) {
      assert.equal(cell.wakeClaim,
        `withheld-protocol, periods ≤ ${w.w1Ms}ms excluded, 3 separated replications; varying-phase polling not excluded`,
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
export function verifyWakePhases(cell) {
  const w = cell.wakeWindows ?? {};
  const failures = [];
  const fields = ['barrierAt', 'deliveryAt', 'withholdAt', 'releaseAt', 'wakeAt', 'firstReadAt',
    'w0Ms', 'w1Ms', 'dMs', 'releaseOffsetMs', 'notifyIntervalMs', 'timestampUncertaintyMs',
    'preBarrierReads', 'baselineReads', 'withheldReads'];
  if (!fields.every(key => Number.isSafeInteger(w[key]) && w[key] >= 0) ||
      w.w0Ms === 0 || w.w1Ms === 0 || w.dMs === 0 || w.notifyIntervalMs === 0 ||
      !Number.isSafeInteger(cell.budgetMs) || !Number.isFinite(Date.parse(cell.startedAt))) {
    return ['wake phase measurements missing'];
  }
  if (w.withholdAt > w.deliveryAt || w.deliveryAt - w.barrierAt < w.w0Ms ||
      w.releaseAt - w.deliveryAt < w.w1Ms + w.releaseOffsetMs ||
      w.wakeAt < w.releaseAt || w.firstReadAt < w.wakeAt || w.firstReadAt - w.wakeAt > w.dMs ||
      w.preBarrierReads !== 0 || w.baselineReads !== 0 || w.withheldReads !== 0 ||
      cell.noPostSendHarnessInput !== true) failures.push('wake phase ordering or read counts invalid');
  const deadline = Date.parse(cell.startedAt) + cell.budgetMs;
  if (w.releaseAt + w.notifyIntervalMs + 100 + w.dMs > deadline ||
      w.wakeAt + w.dMs > deadline || w.firstReadAt > deadline) failures.push('wake-window-unfunded');
  const journal = w.inputJournal;
  if (journal?.correlated !== true || journal?.onlyWakeInput !== true || journal?.writes !== 2 ||
      !Number.isSafeInteger(journal.lineAt) || journal.lineAt < w.releaseAt ||
      journal.lineAt >= journal.submitAt || journal.submitAt !== w.wakeAt) failures.push('wake-input-unproven');
  return failures;
}
export function verifyWakeBatch(cells) {
  const failures = [];
  if (!Array.isArray(cells) || cells.length < 3) {
    failures.push("wake batch needs at least 3 replications");
    return { pass: false, failures };
  }
  for (const [index, cell] of cells.entries()) {
    if (cell.woke !== true) failures.push(`rep ${index}: no stage-7 credit without cell-level phases 1-3`);
    failures.push(...verifyWakePhases(cell).map(f => `rep ${index}: ${f}`));
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
    const uncertainty = Math.max(cells[i].wakeWindows.timestampUncertaintyMs, cells[j].wakeWindows.timestampUncertaintyMs);
    const margin = Math.max(WAKE_SEPARATION_MARGIN_MS, uncertainty + 1);
    if (b.bStart + margin <= a.aStart && a.aEnd + margin <= b.bEnd) separated = true;
  }
  if (!separated) failures.push("wake-phase-separation-unproven: no acceptance window lies strictly inside another withheld window with margin");
  return { pass: failures.length === 0, failures };
}

if (process.argv[1]?.endsWith('/xcli-ci-check.mjs')) {
  const senderIndex = process.argv.indexOf('--sender');
  console.log(JSON.stringify(verifySimulation(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), process.argv.includes('--negative'), senderIndex < 0 ? undefined : process.argv[senderIndex + 1])));
}
