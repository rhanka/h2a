// Explicit affected/supplemental files. Never invokes the repository suite.
import fs from 'node:fs';
import { basename } from 'node:path';
import { spawnSync } from 'node:child_process';
const major = process.versions.node.split('.')[0];
if (!['22', '24'].includes(major)) throw new Error('Node_22_or_24_required');
const names = ['mh-l5-v1', 'mh-l5-legacy-writer', 'mh-l5-cold', 'mh-l5-cold-network', 'mh-l5-compensation', 'mh-l5-concurrency-oracles',
  'mh-l3-transfer', 'mh-l3-network', 'mh-l3-argon', 'mh-l3-recovery', 'mh-l3-central', 'mh-l3-state',
  'mh-l2-integration', 'mh-l2-cold', 'mh-l2-compensation', 'mh-l2-image',
  'mh-l1-shim', 'mh-l1-routing', 'mh-l1-transport', 'mcp-central-attachments',
  'mh-l4-ownership', 'mh-l4-writers', 'mh-l4-checkpoint', 'mh-l4-wake', 'mh-l4-launch',
  'mh-l4-integration', 'mh-l4-cuts', 'mh-l4-concurrency', 'mh-l4-central', 'mh-l4-idle'];
const results = [];
for (const name of names) {
  const file = `packages/h2a/test/${name}.test.js`;
  const r = spawnSync(process.execPath, ['scripts/mh-l5-test.mjs', file, 'qualified'], { env: process.env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const log = `docs/plan/mh-l5/evidence/${basename(file)}-node${major}-qualified.log`;
  const receipt = JSON.parse(fs.readFileSync(log, 'utf8').split('\nreceipt: ').at(-1));
  results.push({ file, log, ...receipt });
  fs.writeFileSync(`docs/plan/mh-l5/regressions-node${major}.json`, JSON.stringify({ node: process.version, results }, null, 2) + '\n');
  process.stdout.write(`${file}: ${receipt.tests} tests, exit=${r.status}, invalid=${receipt.invalid}\n`);
  if (r.status || receipt.invalid || receipt.code || receipt.signal) process.exitCode = 1;
}
