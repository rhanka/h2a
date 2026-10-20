// A terminal fixture with a real readline draft and submitted lines. No provider/API fake.
import { createInterface } from 'node:readline';
import { writeFileSync, appendFileSync, renameSync } from 'node:fs';
const state = process.argv[2];
if (!process.stdin.isTTY || !process.stdout.isTTY) process.exit(72);
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const lines = [];
const persist = () => { writeFileSync(state + '.tmp', JSON.stringify({ pid: process.pid, tty: true, draft: rl.line, lines })); renameSync(state + '.tmp', state); };
rl.on('line', line => { lines.push(line); appendFileSync(state + '.lines', line + '\n'); rl.prompt(); setImmediate(persist); });
process.stdin.on('data', () => setImmediate(persist));
rl.setPrompt('owner-lab> '); rl.prompt(); persist();
