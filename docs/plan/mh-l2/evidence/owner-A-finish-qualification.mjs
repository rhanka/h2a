import fs from 'node:fs';
import { spawn } from 'node:child_process';
process.umask(0o022);
const evidence = 'docs/plan/mh-l2/evidence';
const node24 = '/home/antoinefa/.npm/_npx/387698761821791d/node_modules/node/bin/node';
const cases = [
  [node24, ['scripts/mh-l2-test.mjs', 'packages/h2a/test/mcp-central-attachments.test.js', 'owner-A-node24-final-022'], 'node24-attachments-022'],
  ['/usr/bin/node', ['/tmp/owner-A-mhl3b-qualify-driver.mjs', 'mutations'], 'node22-mutations'],
  [node24, ['/tmp/owner-A-mhl3b-qualify-driver.mjs', 'mutations'], 'node24-mutations']
];
const results = [];
for (const [node, args, label] of cases) {
  const started = Date.now(), command = [node, ...args];
  const child = spawn(node, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const fd = fs.openSync(`${evidence}/owner-A-final-${label}.log`, 'w');
  fs.writeSync(fd, `command: ${command.join(' ')}\numask: 022\n`);
  console.log(`START ${label}, own PID ${child.pid}`);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
    fs.writeSync(fd, data); process.stdout.write(data);
  });
  const timer = setInterval(() => console.log(`${label}: own PID ${child.pid}, elapsed ${Math.round((Date.now() - started) / 1000)}s`), 30000);
  const result = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  clearInterval(timer);
  const receipt = { command, umask: '022', pid: child.pid, ...result, elapsedMs: Date.now() - started };
  fs.writeSync(fd, `\nreceipt: ${JSON.stringify(receipt)}\n`); fs.closeSync(fd);
  results.push(receipt); console.log(`DONE ${label}, code=${result.code}`);
}
fs.writeFileSync(`${evidence}/owner-A-final-requalification.json`, JSON.stringify(results, null, 2) + '\n');
process.exitCode = results.some(r => r.code !== 0) ? 1 : 0;
