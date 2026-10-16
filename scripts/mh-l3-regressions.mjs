// Affected/reference files and named supplements only. Never the repo suite.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
const pattern = '(mcp-central(-client|-shim|-context|-attachment)?|authentication|authenticated-http|evidence|ownership|participants|schemas|catalogue|shim-bridge|attachment-transports|request-mappings|generation-end|shim-evidence|streamable-http)\\.(js|ts)|mh-l0/schemas\\.json';
const args = ['-l', pattern, 'packages', 'apps', '-g', '*.test.js', '-g', '*.test.ts', '-g', '!**/node_modules/**', '-g', '!**/dist/**'];
const search = spawnSync('rg', args, { encoding: 'utf8' });
if (search.status !== 0) throw new Error('reference_search_failed');
const files = [...new Set([...search.stdout.trim().split('\n'),
  ...['authority', 'auth', 'starters', 'cold', 'compensation', 'integration', 'image', 'live', 'live-central', 'identity-contention'].map(n => `packages/h2a/test/mh-l2-${n}.test.js`),
  ...['ownership', 'writers', 'checkpoint', 'wake', 'launch', 'integration', 'cuts', 'concurrency', 'central', 'idle'].map(n => `packages/h2a/test/mh-l4-${n}.test.js`),
  ...['central', 'control', 'evidence', 'network', 'ownership', 'recovery', 'source-offer', 'state', 'transfer', 'transport'].map(n => `packages/h2a/test/mh-l3-${n}.test.js`),
  ...['mcp-stdio', 'mcp-sessions', 'mcp-identity-readiness', 'mcp-identity-burst', 'mh-l1-routing', 'mh-l1-preservation', 'mh-l0-state', 'mh-l0-wire'].map(n => `packages/h2a/test/${n}.test.js`)
])].sort();
fs.mkdirSync('docs/plan/mh-l3', { recursive: true });
const major = process.versions.node.split('.')[0], path = `docs/plan/mh-l3/regressions-node${major}.json`;
const manifest = { node: process.version, search: ['rg', ...args], files, gitDependent: 'packages/h2a/test/mh-l0-formats.test.js', results: [] };
if (process.argv.includes('--list')) { process.stdout.write(files.join('\n')+'\n'); process.exit(0); }
const selected = process.argv.slice(2);
if (selected.some(f => !files.includes(f))) throw new Error('unknown_explicit_file');
const old = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path)).results : [];
for (const file of selected.length ? selected : files.filter(f => f !== manifest.gitDependent)) {
  const label = 'qualified', command = [process.execPath, 'scripts/mh-l3-test.mjs', file, label, file.endsWith('.ts') ? 'vitest' : 'node'];
  const r = spawnSync(command[0], command.slice(1), { encoding: 'utf8', maxBuffer: 24*1024*1024 });
  const log = `docs/plan/mh-l3/evidence/${basename(file)}-node${major}-${label}.log`;
  const output = fs.existsSync(log) ? fs.readFileSync(log,'utf8') : r.stdout+r.stderr;
  const receipt = output.includes('\nreceipt: ') ? JSON.parse(output.split('\nreceipt: ').at(-1)) : {};
  manifest.results.push({ file, command, log, code: r.status, signal: r.signal, ...receipt });
  const combined = [...old.filter(o => !manifest.results.some(n => n.file === o.file)), ...manifest.results];
  fs.writeFileSync(path, JSON.stringify({ ...manifest, results: combined }, null, 2)+'\n');
  process.stdout.write(`node${major} ${file}: tests=${receipt.tests}, exit=${r.status}, invalid=${Boolean(receipt.invalid)}, leftovers=${receipt.leftovers?.length}\n`);
}
const results = JSON.parse(fs.readFileSync(path)).results;
if (results.some(r => r.code !== 0 || r.invalid || r.signal || !r.tests)) process.exitCode = 1;
