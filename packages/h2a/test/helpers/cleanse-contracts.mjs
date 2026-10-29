import assert from 'node:assert/strict';
import { CONTRACT_PREFIX, contractFailure, observeContract, readCleanseLedger } from '../../../../scripts/cleanse-contract-ledger.mjs';

export function contracts(t, observations, context = {}) {
  assert.ok(observations.length > 0, 'a witness must execute desired assertions');
  const ledger = context.ledger ?? readCleanseLedger();
  for (const observation of observations) {
    const result = observeContract(observation, context);
    t.diagnostic(CONTRACT_PREFIX + JSON.stringify(result));
    const failure = contractFailure(result, ledger);
    assert.equal(failure, undefined, failure);
  }
}
