import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const [file, label = 'green', runner = 'node', ...extra] = process.argv.slice(2);
if (!file || !/\.test\.(js|ts)$/.test(file) || !['node', 'vitest'].includes(runner)) {
  throw new Error('usage: mh-l4-test.mjs <test file> <evidence label> [node|vitest] [runner args]');
}
if (![22, 24].includes(Number(process.versions.node.split('.')[0]))) throw new Error('Node 22/24 required');
// Build gate (same convention as root `npm test`, which runs `npm run build`
// first): refuse instead of failing obscurely when compiled output is absent.
const testDirectory = dirname(resolve(file));
const missingBuild = [...new Set([...readFileSync(resolve(file), 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)]
  .map(match => match[1]).filter(specifier => specifier.includes('/dist/'))
  .map(specifier => resolve(testDirectory, specifier)).filter(path => !existsSync(path)))];
if (missingBuild.length > 0) throw new Error(`mh-l4-test: missing built output required by ${file}: ${missingBuild.join(', ')}; run the documented setup first: npm ci --ignore-scripts && npm run build -w @sentropic/track && node node_modules/typescript/bin/tsc -b --force --pretty false (docs/plan/mh-l4/QUALIFICATION.md)`);
const directory = mkdtempSync('/tmp/mh-l4-test-');
const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', NODE_OPTIONS: '--max-old-space-size=768' };
for (const [key, leaf] of Object.entries({ HOME: 'home', XDG_RUNTIME_DIR: 'run',
  XDG_CONFIG_HOME: 'config', XDG_STATE_HOME: 'state', XDG_DATA_HOME: 'data',
  XDG_CACHE_HOME: 'cache', REMOTE_CLI_CONFIG_HOME: 'cli-config', CODEX_HOME: 'codex',
  CLAUDE_CONFIG_DIR: 'claude', TMPDIR: 'tmp', H2A_ROOT: 'store' })) {
  env[key] = join(directory, leaf);
  mkdirSync(env[key], { recursive: true, mode: 0o700 });
}
const args = runner === 'node' ? ['--test', ...extra, file]
  : [resolve('node_modules/vitest/vitest.mjs'), 'run', file, ...extra];
const command = [process.execPath, ...args];
const started = Date.now();
let output = `command: ${command.join(' ')}\nnode: ${process.version}\nprivate test root: ${directory}\n`;
process.stdout.write(output);
const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
  const text = bytes.toString(); output += text; process.stdout.write(text);
});
child.once('error', error => { output += String(error); });
const result = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
const skipped = [...output.matchAll(/(?:#|ℹ) skipped (\d+)/g)].some(match => Number(match[1]) !== 0);
if (skipped) { output += '\nrequired test skipped: treated as FAILED\n'; result.code = 1; }
const receipt = { command, ...result, elapsedMs: Date.now() - started };
output += `\nreceipt: ${JSON.stringify(receipt)}\n`;
process.stdout.write(`receipt: ${JSON.stringify(receipt)}\n`);
const target = resolve('docs/plan/mh-l4/evidence');
mkdirSync(target, { recursive: true });
writeFileSync(join(target, `${basename(file)}-${label}.log`), output);
rmSync(directory, { recursive: true, force: true });
process.exitCode = result.code ?? 1;
