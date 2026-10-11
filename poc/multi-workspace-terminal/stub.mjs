import readline from 'node:readline';
const mode = process.argv[2];
if (mode === 'counter') {
  let counter = 0;
  process.stdout.write('\x1b[2J\x1b[H\x1b[32mCounter live\x1b[0m\r\n');
  setInterval(() => process.stdout.write(`\x1b[2;1H\x1b[2Kcounter = ${++counter}`), 200);
} else if (mode === 'question') {
  process.stdout.write('\x1b[2J\x1b[HProceed? [y/n] ');
  const lines = readline.createInterface({ input: process.stdin });
  lines.once('line', answer => {
    process.stdout.write(`\r\nanswer accepted: ${answer.trim()}\r\n`);
    lines.close(); process.stdin.pause();
    setInterval(() => {}, 1000);
  });
} else if (mode === 'idle') {
  process.stdout.write('\x1b[2J\x1b[HIdle session ready\r\n');
  setInterval(() => {}, 1000);
} else if (mode === 'exit') {
  process.stdout.write('Short session exited\r\n');
} else throw new Error(`unknown stub: ${mode}`);
