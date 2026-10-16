import assert from 'node:assert/strict';
import test from 'node:test';
import { startupTerminal } from './xcli-terminal.mjs';
import { verifyReceiverIdleInput } from './xcli-ci-check.mjs';

test('receipt verifier rejects terminal replies after the receiver idle barrier', () => {
  const cell = { evidence: [{ event: 'receiver-idle-barrier', at: 100 }] };
  verifyReceiverIdleInput(cell);
  cell.evidence.push({ event: 'startup-terminal-response', role: 'receiver', at: 101 });
  assert.throws(() => verifyReceiverIdleInput(cell), /invalidates live-wake proof/);
});

test('startup terminal answers fragmented cursor queries and renders erasures', async () => {
  const terminal = startupTerminal();
  try {
    await terminal.write('old onboarding\r\x1b[2Kready\x1b[');
    await terminal.write('6n');
    assert.deepEqual(terminal.responses(), ['\x1b[1;6R']);
    assert.match(terminal.screen(), /^ready/);
    assert.doesNotMatch(terminal.screen(), /onboarding/);
    terminal.freeze();
    await terminal.write('\x1b[6n');
    assert.deepEqual(terminal.responses(), [], 'no terminal input after the idle barrier');
  } finally { terminal.dispose(); }
});
