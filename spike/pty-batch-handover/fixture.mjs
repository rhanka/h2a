// Real long-running raw-terminal child: autonomous output and exact input receipts.
import tty from 'node:tty';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const native = createRequire(import.meta.url)(join(process.env.SPIKE_BUILD, 'native.node'));
const id = process.argv[2];
if (!tty.isatty(0) || !tty.isatty(1)) throw new Error('fixture requires a real PTY');
process.stdin.setRawMode(true);
console.log(`READY ${id} ${process.pid} leaked=${native.masterLeaks()}`);
let tick = 0;
const ticker = setInterval(() => process.stdout.write(`TICK ${id} ${tick++}\n`), 8);
process.stdout.on('resize', () => console.log(`SIZE ${id} ${process.stdout.rows} ${process.stdout.columns}`));
let pending = '';
process.stdin.on('data', bytes => {
  pending += bytes.toString();
  let cut;
  while ((cut = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, cut); pending = pending.slice(cut + 1);
    if (line.startsWith('EXIT ')) {
      clearInterval(ticker);
      process.stdout.write(`FINAL ${id} ${tick}\n`, () => process.exit(+line.slice(5)));
    } else if (line === 'SIGNAL') process.kill(process.pid, 'SIGTERM');
    else process.stdout.write(`ACK ${id} ${line}\n`);
  }
});
