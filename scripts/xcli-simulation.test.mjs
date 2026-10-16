import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { environment } from './xcli-lab.mjs';
import { verifySimulation } from './xcli-ci-check.mjs';

test('a delivered envelope without a model reaction fails the live CI gate', () => {
  const root = fs.mkdtempSync('/tmp/xcli-negative-');
  const output = join(root, 'negative.json');
  const env = { ...environment(join(root, 'env')),
    ...(process.env.XCLI_NODE_HEADERS ? { XCLI_NODE_HEADERS: process.env.XCLI_NODE_HEADERS } : {}) };
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'qualify-cross-cli.mjs'),
    '--simulated', '--pair', 'codex:codex', '--drop-simulated-wake', '--timeout-ms', '30000', '--output', output],
  { env, encoding: 'utf8', timeout: 90000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 2, 'negative control must fail the qualification command');
  const receipt = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(verifySimulation(receipt, true).outcome, 'negative-control-detected');
  assert.throws(() => verifySimulation(receipt), 'delivery alone cannot pass the full matrix gate');
  console.log(`Negative control evidence: ${output}`);
});
