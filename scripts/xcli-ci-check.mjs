#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matrix } from './xcli-lab.mjs';

export function verifySimulation(receipt, negative = false) {
  assert.equal(receipt.mode, 'simulated-model', 'CI cannot relabel a real-CLI run');
  assert.equal(receipt.cells.length, negative ? 1 : 36);
  if (!negative) matrix(receipt.cells); // validates all distinct ordered pairs
  for (const cell of receipt.cells) {
    assert.equal(cell.status, negative ? 'simulated-KO' : 'simulated-OK');
    assert.equal(cell.blocker, undefined);
    assert.notEqual(cell.cleanupFailed, true);
    assert.equal(cell.noPostSendHarnessInput, true);
    for (const key of ['senderMcp', 'receiverMcp', 'sent', 'delivered']) assert.equal(cell[key], true, key);
    for (const key of ['received', 'woke', 'replied', 'replyDelivered']) assert.equal(cell[key], !negative, key);
    assert.ok(Object.values(cell.credentialsCopied).every(files => files.length === 0), 'simulation must use no logins');
  }
  return { cells: receipt.cells.length, outcome: negative ? 'negative-control-detected' : 'simulated-round-trips-proven' };
}

if (process.argv[1]?.endsWith('/xcli-ci-check.mjs')) {
  console.log(JSON.stringify(verifySimulation(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), process.argv.includes('--negative'))));
}
