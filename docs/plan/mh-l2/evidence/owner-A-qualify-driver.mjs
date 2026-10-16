import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.umask(0o022);
const major = process.versions.node.split('.')[0], phase = process.argv[2] ?? 'tests';
if (!['22', '24'].includes(major) || !['tests', 'mutations'].includes(phase)) throw Error('explicit Node 22/24 and tests|mutations required');
const evidence = 'docs/plan/mh-l2/evidence'; fs.mkdirSync(evidence, { recursive: true });
fs.copyFileSync(fileURLToPath(import.meta.url), join(evidence, 'owner-A-qualify-driver.mjs'));
const failures = [], commands = [];
async function run(args, label, forward = false) {
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const startedAt = Date.now(); let output = '';
  const command = [process.execPath, ...args];
  process.stdout.write(`[node${major}] ${label} started own PID ${child.pid}: ${command.join(' ')}\n`);
  const timer = setInterval(() => process.stdout.write(`[node${major}] ${label} still running (${Math.round((Date.now() - startedAt) / 1000)}s), own PID ${child.pid}\n`), 30000);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data; if (forward) process.stdout.write(data); });
  const result = await new Promise(resolve => { child.once('error', error => resolve({ code: null, error: String(error) })); child.once('close', (code, signal) => resolve({ code, signal })); });
  clearInterval(timer);
  const receipt = { command, pid: child.pid, ...result, elapsedMs: Date.now() - startedAt };
  fs.writeFileSync(join(evidence, `owner-A-node${major}-${label}-campaign.log`), JSON.stringify(receipt) + '\n' + output + '\n');
  commands.push(receipt); if (result.code !== 0) failures.push(receipt);
  process.stdout.write(`[node${major}] ${label}: code=${result.code}, elapsed=${receipt.elapsedMs}ms; complete output retained\n`);
  return { ...result, output };
}
if (phase === 'tests') {
  await run(['scripts/mh-l2-live-regressions.mjs'], 'references', true);
  const refs = new Set(JSON.parse(fs.readFileSync(`docs/plan/mh-l2/owner-A-node${major}-affected-tests.json`, 'utf8')).files);
  const suites = { 'mh-l2': ['authority','auth','starters','cold','compensation','integration','image'],
    'mh-l4': ['ownership','writers','checkpoint','wake','launch','integration','cuts','concurrency','central','idle'] };
  for (const [lot, names] of Object.entries(suites)) for (const name of names) {
    const file = `packages/h2a/test/${lot}-${name}.test.js`;
    if (!refs.has(file)) await run(['scripts/mh-l2-test.mjs', file, `owner-A-node${major}-lot-regression`], `${lot}-${name}`);
  }
} else {
  await run(['scripts/mh-l2-live-mutate.mjs'], 'live-mutations', true);
  await run(['scripts/mh-l2-live-central-mutate.mjs'], 'real-source-mutations', true);
  for (const name of ['unicode','durable','owner-record','compensation','pause','mac','socket','owner','inode','precheck','stop','budget']) {
    const result = await run(['scripts/mh-l2-mutate.mjs', name], `cold-mutation-${name}`);
    if (result.code === 0) for (const leaf of fs.readdirSync(evidence).filter(leaf => leaf.endsWith(`-mutation-${name}-red.log`) || leaf.endsWith(`-mutation-${name}-green.log`))) {
      fs.copyFileSync(join(evidence, leaf), join(evidence, `owner-A-node${major}-cold-${leaf}`));
    }
  }
}
fs.writeFileSync(`docs/plan/mh-l2/owner-A-node${major}-${phase}-result.json`, JSON.stringify({ node: process.version, phase, commands, failures }, null, 2) + '\n');
process.stdout.write(`[node${major}] ${phase}: ${commands.length} explicit commands, failed commands=${failures.length}\n`);
if (failures.length) process.exitCode = 1;
