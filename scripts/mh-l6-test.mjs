// Explicit files only, private state, bounded child lifetime, zero skipped tests.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
process.umask(0o022);
const [file, label = 'green', runner = 'node'] = process.argv.slice(2);
if (!file || !/\.test\.(js|ts)$/.test(file) || !['node', 'vitest'].includes(runner)) throw new Error('explicit_test_file_required');
if (![22, 24].includes(Number(process.versions.node.split('.')[0]))) throw new Error('Node 22/24 required');
const directory = fs.mkdtempSync('/tmp/mh-l6-test-'), ledger = join(directory, 'spawned.jsonl'), hook = join(directory, 'spawn-hook.mjs');
fs.writeFileSync(hook, `import fs from 'node:fs'; import cp from 'node:child_process'; import { syncBuiltinESMExports } from 'node:module';
try {const s=fs.readFileSync('/proc/self/stat','utf8'); const birth=Number(s.slice(s.lastIndexOf(') ')+2).split(' ')[19]); fs.appendFileSync(${JSON.stringify(ledger)},JSON.stringify({pid:process.pid,birth})+'\\n');}catch{}
const original=cp.spawn; cp.spawn=function(...args) { const child=original.apply(this,args); child.once('spawn',()=>{try {const s=fs.readFileSync('/proc/'+child.pid+'/stat','utf8'); const birth=Number(s.slice(s.lastIndexOf(') ')+2).split(' ')[19]); fs.appendFileSync(${JSON.stringify(ledger)},JSON.stringify({pid:child.pid,birth})+'\\n');}catch{}});return child;};syncBuiltinESMExports();\n`);
const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', NODE_OPTIONS: `--max-old-space-size=768 --import=${hook}` };
for (const key of ['HOME', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
  'REMOTE_CLI_CONFIG_HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'TMPDIR', 'H2A_ROOT']) {
  env[key] = join(directory, key.toLowerCase()); fs.mkdirSync(env[key], { mode: 0o700 });
}
if (process.env.H2A_TEST_CLAUDE_HOME_FALLBACK === '1') delete env.CLAUDE_CONFIG_DIR;
if (process.env.MH_L5_CASE) env.MH_L5_CASE = process.env.MH_L5_CASE;
if (process.env.MH_L6_CASE) env.MH_L6_CASE = process.env.MH_L6_CASE;
if (process.env.MH_L5_ARTIFACTS) {
  const root = fs.realpathSync(process.env.MH_L5_ARTIFACTS);
  if (!root.startsWith('/tmp/mh-l5-artifacts-')) throw new Error('private_artifacts_required');
  env.MH_L5_ARTIFACTS = root;
}
const args = runner === 'node' ? ['--test', '--test-reporter=tap', file] : [resolve('node_modules/vitest/vitest.mjs'), 'run', file];
const command = [process.execPath, ...args];
let output = `command: ${command.join(' ')}\nnode: ${process.version}\nprivate root: ${directory}\ncase: ${env.MH_L5_CASE ?? 'all cases in explicit file'}\n`;
const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
const deadline = setTimeout(() => { output += '\nfile budget exceeded\n'; child.kill('SIGTERM'); }, 900_000);
for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output += bytes; process.stdout.write(bytes); });
const result = await new Promise((resolve, reject) => { child.once('close', (code, signal) => resolve({ code, signal })); child.once('error', reject); });
clearTimeout(deadline);
const spawned = fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const alive = row => { try { const s = fs.readFileSync(`/proc/${row.pid}/stat`, 'utf8'), f = s.slice(s.lastIndexOf(') ') + 2).split(' ');
  return f[0] !== 'Z' && Number(f[19]) === row.birth; } catch { return false; } };
const leftovers = spawned.filter(alive);
for (const row of leftovers) if (alive(row)) process.kill(row.pid, 'SIGTERM');
if (leftovers.length) await new Promise(r => setTimeout(r, 1000));
for (const row of leftovers) if (alive(row)) process.kill(row.pid, 'SIGKILL');
const text = output.replace(/\u001b\[[0-9;]*m/g, '');
const tests = Number(/# tests (\d+)/.exec(text)?.[1] ?? /Tests\s+(\d+) passed/.exec(text)?.[1] ?? 0);
const invalid = !tests || /# (?:skipped|cancelled|todo) [1-9]/.test(text) || /\b[1-9]\d* skipped\b/.test(text) || leftovers.length > 0;
const receipt = { command, ...result, tests, invalid, spawned: spawned.length, leftovers };
output += `\nreceipt: ${JSON.stringify(receipt)}\n`;
fs.mkdirSync('docs/plan/mh-l6/evidence', { recursive: true });
const target = join('docs/plan/mh-l6/evidence', `${basename(file)}-node${process.versions.node.split('.')[0]}-${label}.log`);
fs.writeFileSync(target, output);
process.stdout.write(`${target}: ${tests} tests, exit=${result.code}, invalid=${Boolean(invalid)}, own spawned=${spawned.length}, leftovers=${leftovers.length}\n`);
if (result.code !== 0 || invalid || result.signal) { process.stdout.write(output); process.exitCode = 1; }
fs.rmSync(directory, { recursive: true, force: true });
