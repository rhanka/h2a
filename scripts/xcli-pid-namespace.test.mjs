import assert from 'node:assert/strict';
import { readlinkSync } from 'node:fs';
import test from 'node:test';
import { assertPrivatePidNamespace } from '../packages/h2a/test/helpers/private-pid-namespace.mjs';

test('historical producers refuse a missing or unchanged PID namespace', () => {
  const previous = process.env.XCLI_PARENT_PID_NS;
  try {
    delete process.env.XCLI_PARENT_PID_NS;
    assert.throws(assertPrivatePidNamespace, /private PID namespace launcher/);
    process.env.XCLI_PARENT_PID_NS = readlinkSync('/proc/self/ns/pid');
    assert.throws(assertPrivatePidNamespace, /different PID namespace/);
  } finally {
    if (previous === undefined) delete process.env.XCLI_PARENT_PID_NS;
    else process.env.XCLI_PARENT_PID_NS = previous;
  }
});
