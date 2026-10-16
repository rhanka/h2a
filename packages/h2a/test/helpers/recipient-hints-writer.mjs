// Real subprocess; the gate holds an actual directory snapshot, not a mocked count.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { rememberRecipient } from '../../dist/runtime/local-files/recipient-hints.js';

const [root, id, mode] = process.argv.slice(2);
const dir = join(root, 'recipient-hints');
let gated = false;
function gate() {
  if (gated) return;
  gated = true;
  fs.writeFileSync(join(root, `ready-${id}`), 'ready');
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(join(root, 'release'))) {
    if (Date.now() >= deadline) throw new Error('writer gate timed out');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
}
if (mode === 'snapshot') {
  const opendir = fs.opendirSync;
  fs.opendirSync = (path, ...args) => {
    const handle = opendir(path, ...args);
    if (path === dir) {
      const read = handle.readSync.bind(handle);
      handle.readSync = () => {
        const entry = read();
        if (!entry) gate();
        return entry;
      };
    }
    return handle;
  };
} else if (mode === 'publication') {
  const write = fs.writeFileSync;
  fs.writeFileSync = (fd, ...args) => {
    if (typeof fd === 'number') gate();
    return write(fd, ...args);
  };
} else {
  throw new Error(`unknown writer mode: ${mode}`);
}
syncBuiltinESMExports();
rememberRecipient(root, { instance: `claude:parallel:${id}`, name: `parallel-${id}` });
if (!gated) throw new Error('writer did not reach its real filesystem gate');
