// Only the affected shim references, Argon regressions and M18/M17 boundaries.
// No repository suite, no qualification of the deferred MH-L8 surface campaign.
import fs from 'node:fs';
import { basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const major = process.versions.node.split('.')[0];
if (!['22', '24'].includes(major)) throw new Error('Node_22_or_24_required');
const names = ['mh-l5-shim-recovery', 'mh-l5-concurrency-oracles', 'mh-l5-v1', 'mh-l5-legacy-writer',
  'mh-l3-transfer', 'mh-l3-network', 'mh-l3-argon', 'mh-l3-recovery', 'mh-l3-central',
  'mh-l2-integration', 'mh-l1-transport', 'mcp-central-attachments'];
const results = [];
for (const name of names) {
  const file = `packages/h2a/test/${name}.test.js`;
  const result = spawnSync(process.execPath, ['scripts/mh-l5-test.mjs', file, 'argon-qualified'],
    { env: process.env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const log = `docs/plan/mh-l5/evidence/${basename(file)}-node${major}-argon-qualified.log`;
  if (!fs.existsSync(log)) throw new Error(`missing_test_receipt:${file}:${result.stderr}`);
  const receipt = JSON.parse(fs.readFileSync(log, 'utf8').split('\nreceipt: ').at(-1));
  results.push({ file, log, runnerExit: result.status, ...receipt });
  fs.writeFileSync(`docs/plan/mh-l5/argon-check-node${major}.json`, JSON.stringify({ node: process.version, results }, null, 2) + '\n');
  console.log(`${file}: tests=${receipt.tests}, exit=${result.status}, invalid=${receipt.invalid}, leftovers=${receipt.leftovers.length}`);
  if (result.status || receipt.invalid || receipt.code || receipt.signal) { process.stdout.write(result.stdout + result.stderr); process.exitCode = 1; }
}
