import fs from 'node:fs';
import { spawn } from 'node:child_process';
process.umask(0o022);
const ev = 'docs/plan/mh-l2/evidence/';
const command = ['/home/antoinefa/.npm/_npx/387698761821791d/node_modules/node/bin/node', 'scripts/mh-l2-mutate.mjs', 'owner-record'];
const started = Date.now(), child = spawn(command[0], command.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
let output = `command: ${command.join(' ')}\numask: 022\n`;
console.log(`Node 24 targeted owner-record retry, own PID ${child.pid}`);
for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output += bytes; process.stdout.write(bytes); });
const timer = setInterval(() => console.log(`Node 24 owner-record retry: own PID ${child.pid}, elapsed ${Math.round((Date.now() - started) / 1000)}s`), 30000);
const result = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
clearInterval(timer);
const leaves = ['mh-l2-image.test.js-mutation-owner-record-red.log', 'mh-l2-image.test.js-mutation-owner-record-green.log'];
for (const leaf of leaves) fs.copyFileSync(ev + leaf, ev + 'owner-A-node24-retry-cold-' + leaf);
const red = fs.readFileSync(ev + leaves[0], 'utf8'), green = fs.readFileSync(ev + leaves[1], 'utf8');
const receipt = { command, ...result, elapsedMs: Date.now() - started, umask: '022',
  redAssertion: red.includes('ERR_ASSERTION'), redCode1: red.includes('"code":1'),
  greenCode0: green.includes('"code":0'), noSkips: [red, green].every(s => /(?:#|ℹ) skipped 0\b/.test(s)),
  initialFailedRestoration: 'owner-A-node24-cold-mutation-owner-record-campaign.log' };
fs.writeFileSync(ev + 'owner-A-node24-owner-record-retry.log', output + '\nreceipt: ' + JSON.stringify(receipt) + '\n');
fs.writeFileSync(ev + 'owner-A-node24-owner-record-retry.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
process.exitCode = result.code === 0 && receipt.redAssertion && receipt.redCode1 && receipt.greenCode0 && receipt.noSkips ? 0 : 1;
