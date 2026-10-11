import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { identity, fds, json } from './lab.mjs';

const root = process.env.SPIKE_ROOT;
if (!root || process.env.HOME !== root || process.env.XDG_RUNTIME_DIR !== root)
  throw new Error('private environment required');
const [id, mode = 'tui'] = process.argv.slice(2);
const signals = [];
const info = { cli: identity(process.pid), guardian: identity(process.ppid),
  fds: fds(), signals, nonce: `${id}-${process.pid}` };
const file = path.join(root, `identity-${id}.json`);
json(file, info);
for (const signal of ['SIGHUP', 'SIGUSR2', 'SIGTERM', 'SIGWINCH']) {
  process.on(signal, () => {
    signals.push(signal); json(file, info);
    if (signal === 'SIGWINCH') emit(`SIZE:${process.stdout.columns}:${process.stdout.rows}\n`);
    else if (mode !== 'resistant') {
      process.removeAllListeners(signal); process.kill(process.pid, signal);
    }
  });
}
function emit(text) { process.stdout.write(text); }
if (mode === 'grandchild') {
  const child = spawn(process.execPath, [path.join(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), 'sentinel.mjs'),
    `${+id + 100000}`, 'resistant'], { env: process.env, stdio: 'inherit' });
  child.on('error', error => { throw error; });
}
if (mode === 'tui') emit('\x1b[?1049h\x1b[6n');
let counter = 0;
let blocked = false;
function tick() {
  if (blocked || mode === 'silent' || mode === 'exit') return;
  // Fragment Unicode and CSI across writes; raw replay must survive exec mid-token.
  const line = Buffer.from(`COUNT:${id}:${counter++}:é🙂\x1b[0m\n`);
  const cut = line.indexOf(0xc3) + 1;
  blocked = !process.stdout.write(line.subarray(0, cut));
  process.stdout.write(line.subarray(cut));
  if (mode === 'flood') blocked = !process.stdout.write('x'.repeat(16384));
}
process.stdout.on('drain', () => { blocked = false; });
const timer = setInterval(tick, mode === 'flood' ? 1 : 8);
process.stdin.setRawMode(true);
process.stdin.resume();
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk.toString();
  for (;;) {
    const end = buffer.indexOf('\n'); if (end < 0) break;
    const command = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (command.startsWith('EXIT:')) process.exit(+command.slice(5));
    else if (command.startsWith('SIGNAL:')) {
      const signal = command.slice(7); process.removeAllListeners(signal); process.kill(process.pid, signal);
    } else if (command.startsWith('ACK:')) emit(`${command}\n`);
    else if (command.startsWith('SIZE')) emit(`SIZE:${process.stdout.columns}:${process.stdout.rows}\n`);
    else if (command.startsWith('FINAL')) { clearInterval(timer); emit(`FINAL:${id}:${counter}\n`); }
  }
});
