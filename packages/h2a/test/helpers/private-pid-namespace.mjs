import assert from 'node:assert/strict';
import { readlinkSync } from 'node:fs';

// The trusted test launcher records its own namespace before unshare creates
// the child. Old published hosts predate the owned-proc environment override.
export function assertPrivatePidNamespace() {
  assert.equal(process.platform, 'linux', 'historical host qualification requires Linux');
  const outer = process.env.XCLI_PARENT_PID_NS;
  assert.match(outer ?? '', /^pid:\[\d+\]$/, 'historical host requires the private PID namespace launcher');
  assert.notEqual(readlinkSync('/proc/self/ns/pid'), outer, 'unshare must actually create a different PID namespace');
}
