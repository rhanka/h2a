import { spawnSync } from 'node:child_process';

// Explicit files only. Every invocation gets the private mh-l2-test environment.
const major = Number(process.versions.node.split('.')[0]);
if (![22, 24].includes(major)) throw new Error('Node 22/24 required');
const files = ['authority', 'auth', 'starters', 'cold', 'compensation', 'integration', 'image'];
for (const file of files) {
  const result = spawnSync(process.execPath, ['scripts/mh-l2-test.mjs', `packages/h2a/test/mh-l2-${file}.test.js`, `node${major}-final`], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
