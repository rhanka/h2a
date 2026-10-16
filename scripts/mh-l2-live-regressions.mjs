import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
process.umask(0o022);
if (![22, 24].includes(Number(process.versions.node.split('.')[0]))) throw new Error('Node 22/24 required');
const pattern = '(administration|participants|schemas|live-source|ownership|launch-memo|mcp-central|mcp-central-attachment)\\.(js|ts)|runtime/mcp/stdio\\.(js|ts)|mh-l0/schemas\\.json|mh-l2-live(-peer)?\\.(js|mjs)';
const args = ['-l', pattern, 'packages', 'apps', '--glob', '*.test.js', '--glob', '*.test.ts', '--glob', '!**/node_modules/**', '--glob', '!**/dist/**', '--glob', '!**/evidence/**'];
const search = spawnSync('rg', args, { encoding: 'utf8' });
if (search.status !== 0) throw new Error('affected_test_search_failed');
const files = [...new Set([...search.stdout.trim().split('\n'),
  'packages/h2a/test/mcp-stdio.test.js', 'packages/h2a/test/mcp-sessions.test.js', 'packages/h2a/test/mcp-identity-readiness.test.js'
])].filter(path => /\.test\.(js|ts)$/.test(path)).sort();
const major = process.versions.node.split('.')[0], label = `owner-A-node${major}-references`;
fs.writeFileSync(`docs/plan/mh-l2/owner-A-node${major}-affected-tests.json`, JSON.stringify({
  command: ['rg', ...args], files, gitHistoryException: 'mh-l0-formats.test.js runs in the worktree with the same isolated runner'
}, null, 2) + '\n');
let tests = 0;
const failures = [];
for (const file of files) {
  if (file.endsWith('/mh-l0-formats.test.js')) continue;
  const args = ['scripts/mh-l2-test.mjs', file, label, file.endsWith('.ts') ? 'vitest' : 'node'];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) {
    failures.push({ file, code: result.status });
    process.stdout.write(`node${major}: ${file}: FAILED code=${result.status}; see its ${label} evidence log\n`);
    continue;
  }
  const output = fs.readFileSync(join('docs/plan/mh-l2/evidence', `${basename(file)}-${label}.log`), 'utf8').replace(/\u001b\[[0-9;]*m/g, '');
  if (/\b[1-9][0-9]* skipped\b/.test(output)) throw new Error('required_test_skipped:' + file);
  const count = Number(/(?:#|ℹ) tests (\d+)/.exec(output)?.[1] ?? /Tests\s+(\d+) passed/.exec(output)?.[1] ?? 0);
  if (!count) throw new Error('required_test_not_run:' + file);
  tests += count;
  process.stdout.write(`node${major}: ${file}: ${count} passed, code=0\n`);
}
process.stdout.write(`node${major}: ${files.length - 1} explicit reference/supplement files, ${tests} tests passed; failed files=${failures.length}; Git-dependent format file verified separately; no skips\n`);
fs.writeFileSync(`docs/plan/mh-l2/owner-A-node${major}-reference-result.json`, JSON.stringify({ files: files.filter(f => !f.endsWith('/mh-l0-formats.test.js')), testsPassed: tests, failures }, null, 2) + '\n');
if (failures.length) process.exitCode = 1;
