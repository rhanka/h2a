import assert from 'node:assert/strict';
import test from 'node:test';
import { Screen } from './screen.ts';

test('should protect tab rows from CLI erasures and preserve cells, colors and cursor', async () => {
  const inner = new Screen(30, 6), outer = new Screen(30, 8);
  try {
    await inner.write('\x1b[2J\x1b[H\x1b[31mA中\x1b[0m\x1b[3;4HZ');
    await outer.write(inner.paint(['repo[running]', '*counter[running]']));
    assert.equal(outer.text().split('\n')[0], 'repo[running]');
    assert.equal(outer.text().split('\n')[1], '*counter[running]');
    assert.equal(outer.text().split('\n')[2]?.trimEnd(), 'A中');
    assert.equal(outer.terminal.buffer.active.getLine(2)?.getCell(0)?.getFgColor(), 1);
    assert.equal(outer.terminal.buffer.active.getLine(2)?.getCell(1)?.getWidth(), 2);
    assert.equal(outer.terminal.buffer.active.cursorY, 4);
    assert.equal(outer.terminal.buffer.active.cursorX, 4);
  } finally { inner.dispose(); outer.dispose(); }
});

test('should restore alternate-screen content and keyboard modes when focusing another session', async () => {
  const normal = new Screen(30, 6), modal = new Screen(30, 6), outer = new Screen(30, 8);
  try {
    await normal.write('normal retained');
    await modal.write('old normal\x1b[?1049h\x1b[2J\x1b[Hmodal retained\x1b[?1h\x1b[?2004h\x1b[?25l');
    const painted = modal.paint(['repo', '*modal']);
    await outer.write(painted);
    assert.equal(outer.text().split('\n')[2]?.trimEnd(), 'modal retained');
    assert.equal(outer.terminal.modes.applicationCursorKeysMode, true);
    assert.equal(outer.terminal.modes.bracketedPasteMode, true);
    assert.ok(!painted.endsWith('\x1b[?25h'));
    await outer.write(normal.paint(['repo', '*normal']));
    assert.equal(outer.text().split('\n')[2]?.trimEnd(), 'normal retained');
    assert.equal(outer.terminal.modes.applicationCursorKeysMode, false);
    assert.equal(outer.terminal.modes.bracketedPasteMode, false);
  } finally { normal.dispose(); modal.dispose(); outer.dispose(); }
});
