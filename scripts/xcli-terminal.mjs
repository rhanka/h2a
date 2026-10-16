import { createRequire } from 'node:module';
import { join } from 'node:path';
import { repo } from './xcli-lab.mjs';
const xterm = createRequire(join(repo, 'packages/h2a-runtime/package.json'))('@xterm/headless');

// A real terminal answers VT queries. Replies are permitted only during
// startup; freezing is irreversible and prevents a later synthetic input.
export function startupTerminal() {
  const terminal = new xterm.Terminal({ cols: 140, rows: 40, scrollback: 0, allowProposedApi: true });
  let frozen = false;
  let replies = [];
  terminal.onData(data => {
    if (!frozen && /^\x1b\[[?\d;]*[Rcn]$/.test(data)) replies.push(data);
  });
  return {
    async write(data) { await new Promise(resolve => terminal.write(data, resolve)); },
    screen() {
      const buffer = terminal.buffer.active;
      return Array.from({ length: terminal.rows }, (_, row) =>
        buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '').join('\n');
    },
    responses() { const result = replies; replies = []; return result; },
    freeze() { frozen = true; replies = []; },
    dispose() { terminal.dispose(); },
  };
}
