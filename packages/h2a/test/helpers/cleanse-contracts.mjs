import assert from 'node:assert/strict';

export function contracts(t, observations) {
  const missing = [];
  assert.ok(observations.length > 0, 'a witness must execute desired assertions');
  for (const { id, lot, actual, expected, evidence, knownMissing } of observations) {
    const message = `${id} (${lot})`;
    try {
      assert.deepEqual(actual, expected, message);
      t.diagnostic(`GREEN ${id} (${lot})`);
    } catch (error) {
      // L0 accepts only this fixture's named, exact missing contract. A changed
      // assertion, unrelated exception or changed stale payload fails normally.
      assert.ok(knownMissing, `${message}: unexpected contract failure`, { cause: error });
      assert.deepEqual({ name: error.name, code: error.code, operator: error.operator,
        actual: error.actual, expected: error.expected, message: error.message.split('\n')[0] },
      { name: 'AssertionError', code: 'ERR_ASSERTION', operator: 'deepStrictEqual',
        actual: knownMissing.actual, expected: knownMissing.expected, message });
      assert.deepEqual(evidence, knownMissing.evidence, `${message}: missing-contract evidence changed`);
      missing.push(error);
      t.diagnostic(`KNOWN-MISSING RED ${message}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
    }
  }
  if (process.env.H2A_CLEANSE_STRICT === '1' && missing.length) {
    throw new AggregateError(missing, missing.map(e => e.message).join('\n'));
  }
}
