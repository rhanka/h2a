// Explicit affected files only. The conductor owns the repository-wide suite.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';

process.umask(0o022);
const major = Number(process.versions.node.split('.')[0]);
if (![22, 24].includes(major)) throw new Error('Node 22/24 required');
const files = [
  ...['authority', 'auth', 'starters', 'cold', 'compensation', 'integration', 'image', 'live', 'live-central', 'identity-contention']
    .map(name => `packages/h2a/test/mh-l2-${name}.test.js`),
  ...['ownership', 'writers', 'checkpoint', 'wake', 'launch', 'integration', 'cuts', 'concurrency', 'central', 'idle']
    .map(name => `packages/h2a/test/mh-l4-${name}.test.js`),
  ...['mcp-central-attachments', 'identity-live-wiring', 'identity-bindings', 'identity-migration', 'identity-readers',
    'mcp-identity-burst', 'enrollment-ceremony', 'wp6-host-session-name', 'launch-index', 'lane-addressing-presence-name',
    'mh-l1-shim', 'mh-l1-package'].map(name => `packages/h2a/test/${name}.test.js`),
  'packages/h2a-runtime/src/central-mcp-0980.test.ts'
];
const selected = process.argv.slice(2);
if (selected.some(file => !files.includes(file))) throw new Error('unknown_targeted_file');
const label = `l2fix-node${major}-qualified`, results = [];
for (const file of selected.length ? selected : files) {
  const command = [process.execPath, 'scripts/mh-l2-test.mjs', file, label, file.endsWith('.ts') ? 'vitest' : 'node'];
  const homeFallback = /\/(wp6-host-session-name|lane-addressing-presence-name)\.test\.js$/.test(file);
  const child = spawnSync(command[0], command.slice(1), { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, H2A_TEST_CLAUDE_HOME_FALLBACK: homeFallback ? '1' : '0' } });
  const path = join('docs/plan/mh-l2/evidence', `${basename(file)}-${label}.log`);
  const output = fs.existsSync(path) ? fs.readFileSync(path, 'utf8').replace(/\u001b\[[0-9;]*m/g, '') : child.stdout + child.stderr;
  const tests = Number(/(?:#|ℹ) tests (\d+)/.exec(output)?.[1] ?? /Tests\s+(\d+) passed/.exec(output)?.[1] ?? 0);
  const invalid = !tests || /(?:#|ℹ) (?:skipped|cancelled|todo) [1-9]/.test(output) || /\b[1-9]\d* skipped\b/.test(output);
  results.push({ file, command, homeFallback, code: child.status, signal: child.signal, tests, invalid, evidence: path });
  process.stdout.write(`Node ${major}: ${file}: ${tests} tests, exit=${child.status}, invalid=${invalid}\n`);
}
const path = `docs/plan/mh-l2/l2fix-node${major}-qualification.json`;
const previous = selected.length && fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')).files : [];
const combined = [...previous.filter(prior => !results.some(r => r.file === prior.file)), ...results];
fs.writeFileSync(path, JSON.stringify({ node: process.version, files: combined }, null, 2) + '\n');
const failures = combined.filter(r => r.code !== 0 || r.invalid || r.signal);
process.stdout.write(`Node ${major}: ${combined.length} explicit files, ${combined.reduce((n, r) => n + r.tests, 0)} tests, ${failures.length} failing files; ${path}\n`);
if (failures.length) process.exitCode = 1;
