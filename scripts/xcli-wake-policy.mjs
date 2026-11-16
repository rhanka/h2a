import assert from 'node:assert/strict';
import { KNOWN_CLIS } from './xcli-lab.mjs';

export function wakeBoundForDelivery(nativeMessageDelivery) {
  assert.equal(typeof nativeMessageDelivery, 'boolean', 'delivery category must be evidenced');
  return nativeMessageDelivery ? 3000 : 10000;
}

// This campaign wires mcp-serve to the PTY driver for every host. "Native"
// in the terminal backend name does not mean a CLI-native session message.
// A signed prompt starts a model turn, which then calls h2a_inbox. Successful
// live rows additionally correlate the exact signed line and CR on that PTY.
// R39 (owner 16/11, muse/claude priority): the acceptance bound is calibrated
// per receiver family from measured wake-to-read latencies — the protocol
// (correlation, exclusive input, no polling, separation, funding) is
// unchanged, only this timing proposition moves, and only for the slow
// receiver. Measured gemini-4-argon-low wake-to-read: 7692, 12683, 16672,
// 19546 ms (R38 x3 + R39 diag x1), all with correlated exclusive input, zero
// polling reads and a delivered reply. The 10000 ms uniform bound cut genuine
// agy wakes; 25000 ms covers the measured max + ~28 % headroom. Claude stays
// at 10000 ms (measured 2569-4518 ms); muse stays at 10000 ms (sender
// identity-to-send 3.8 s, receiver calibration left to R39 measurement).
export function campaignWakePolicy(cli, { simulated = false } = {}) {
  assert.ok(KNOWN_CLIS.includes(cli), 'known wake receiver');
  const boundMs = simulated ? 3000 : cli === 'agy' ? 25000 : wakeBoundForDelivery(false);
  return { cli, category: 'non-native', boundMs,
    transport: 'signed-terminal-prompt', nativeMessageDelivery: false,
    evidence: ['packages/h2a/src/runtime/drive/inbox-wake.ts', 'packages/h2a/src/cli.ts:nativePtyBackchannelDriver',
      'scripts/xcli-wake-host.mjs:correlateWakeInput'] };
}
