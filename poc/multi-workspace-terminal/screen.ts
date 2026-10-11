import xterm from '@xterm/headless';
import type { IBufferCell } from '@xterm/headless';

const esc = '\x1b[';
export class Screen {
  terminal: InstanceType<typeof xterm.Terminal>;
  constructor(cols: number, rows: number) {
    this.terminal = new xterm.Terminal({ cols, rows, scrollback: 0, allowProposedApi: true });
  }
  async write(data: string): Promise<void> {
    if (data) await new Promise<void>(resolve => this.terminal.write(data, resolve));
  }
  text(): string {
    const buffer = this.terminal.buffer.active;
    return Array.from({ length: this.terminal.rows }, (_, row) =>
      buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '').join('\n');
  }
  paint(headers: string[], warning = ''): string {
    const terminal = this.terminal, buffer = terminal.buffer.active;
    let output = `${esc}?25l${esc}?7l${esc}0m`;
    for (let row = 0; row < 2; row++) {
      output += `${esc}${row + 1};1H${esc}2K${esc}7m${safeLabel(headers[row] ?? '').slice(0, terminal.cols)}${esc}0m`;
    }
    for (let row = 0; row < terminal.rows; row++) {
      output += `${esc}${row + 3};1H${esc}0m${esc}2K`;
      const line = buffer.getLine(buffer.viewportY + row);
      let lastStyle = '';
      for (let col = 0; col < terminal.cols; col++) {
        const cell = line?.getCell(col);
        if (!cell || cell.getWidth() === 0) continue;
        const style = cellStyle(cell);
        if (style !== lastStyle) { output += style; lastStyle = style; }
        output += cell.getChars() || ' ';
      }
    }
    if (warning) output += `${esc}3;1H${esc}0;31m${safeLabel(warning).slice(0, terminal.cols)}${esc}0m`;
    const cursorX = Math.min(buffer.cursorX + 1, terminal.cols);
    // Cursor visibility comes from the parser; this headless release has no public getter.
    const visible = !(terminal as unknown as { _core: { coreService: { isCursorHidden: boolean } } })._core.coreService.isCursorHidden;
    output += `${esc}?1${terminal.modes.applicationCursorKeysMode ? 'h' : 'l'}`;
    output += `${esc}?2004${terminal.modes.bracketedPasteMode ? 'h' : 'l'}`;
    output += terminal.modes.applicationKeypadMode ? '\x1b=' : '\x1b>';
    output += `${esc}0m${esc}${buffer.cursorY + 3};${cursorX}H${visible ? `${esc}?25h` : ''}`;
    return output;
  }
  dispose(): void { this.terminal.dispose(); }
}
export function safeLabel(text: string): string { return text.replace(/[\x00-\x1f\x7f-\x9f]/g, ' '); }
function cellStyle(cell: IBufferCell): string {
  const values = [0];
  for (const [active, value] of [[cell.isBold(), 1], [cell.isDim(), 2], [cell.isItalic(), 3],
    [cell.isUnderline(), 4], [cell.isBlink(), 5], [cell.isInverse(), 7], [cell.isInvisible(), 8],
    [cell.isStrikethrough(), 9], [cell.isOverline(), 53]]) if (active) values.push(value!);
  for (const fg of [true, false]) {
    const color = fg ? cell.getFgColor() : cell.getBgColor();
    const code = fg ? 38 : 48;
    if (fg ? cell.isFgRGB() : cell.isBgRGB()) values.push(code, 2, (color >> 16) & 255, (color >> 8) & 255, color & 255);
    else if (fg ? cell.isFgPalette() : cell.isBgPalette()) values.push(code, 5, color);
  }
  return `${esc}${values.join(';')}m`;
}
