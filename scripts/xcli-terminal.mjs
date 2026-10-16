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
  let queryTail = '';
  const queryKinds = new Set();
  terminal.onData(data => {
    if (!frozen && /^\x1b\[[?\d;]*[Rcn]$/.test(data)) replies.push(data);
  });
  return {
    async write(data) {
      const window = queryTail + data;
      for (const [kind, query] of [['cursor-position', /\x1b\[6n/],
        ['background-color', /\x1b\]11;\?(?:\x07|\x1b\\)/],
        ['foreground-color', /\x1b\]10;\?(?:\x07|\x1b\\)/],
        ['keyboard-flags', /\x1b\[\?u/]]) {
        if (query.test(window)) queryKinds.add(kind);
      }
      queryTail = window.slice(-32);
      await new Promise(resolve => terminal.write(data, resolve));
    },
    screen() {
      const buffer = terminal.buffer.active;
      return Array.from({ length: terminal.rows }, (_, row) =>
        buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '').join('\n');
    },
    responses() { const result = replies; replies = []; return result; },
    queries() { return [...queryKinds]; },
    choiceStyles(choices) {
      const buffer = terminal.buffer.active, result = [];
      for (let row = 0; row < terminal.rows; row++) {
        const line = buffer.getLine(buffer.viewportY + row);
        const text = line?.translateToString(true) ?? '';
        for (const choice of choices) {
          const column = text.indexOf(choice);
          const cell = column < 0 ? undefined : line?.getCell(column);
          if (cell) result.push({ choice, row, bold: Boolean(cell.isBold()), inverse: Boolean(cell.isInverse()),
            fgMode: cell.getFgColorMode(), fg: cell.getFgColor(), bgMode: cell.getBgColorMode(), bg: cell.getBgColor() });
        }
      }
      return result;
    },
    freeze() { frozen = true; replies = []; },
    dispose() { terminal.dispose(); },
  };
}
