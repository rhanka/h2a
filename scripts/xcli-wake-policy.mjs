import assert from 'node:assert/strict';
import { CLIS } from './xcli-lab.mjs';

export function wakeBoundForDelivery(nativeMessageDelivery) {
  assert.equal(typeof nativeMessageDelivery, 'boolean', 'delivery category must be evidenced');
  return nativeMessageDelivery ? 3000 : 10000;
}

// This campaign wires mcp-serve to the PTY driver for every host. "Native"
// in the terminal backend name does not mean a CLI-native session message.
// A signed prompt starts a model turn, which then calls h2a_inbox. Successful
// live rows additionally correlate the exact signed line and CR on that PTY.
export function campaignWakePolicy(cli, { simulated = false } = {}) {
  assert.ok(CLIS.includes(cli), 'known wake receiver');
  return { cli, category: 'non-native', boundMs: simulated ? 3000 : wakeBoundForDelivery(false),
    transport: 'signed-terminal-prompt', nativeMessageDelivery: false,
    evidence: ['packages/h2a/src/runtime/drive/inbox-wake.ts', 'packages/h2a/src/cli.ts:nativePtyBackchannelDriver',
      'scripts/xcli-wake-host.mjs:correlateWakeInput'] };
}
