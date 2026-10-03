import xterm from "@xterm/headless";

/** Replay cursor moves/erasures before inspecting the current visible screen. */
export async function renderTerminalScreen(raw: string, cols = 160, rows = 48): Promise<string> {
  const terminal = new xterm.Terminal({ cols, rows, scrollback: 0, allowProposedApi: true });
  try {
    await new Promise<void>(resolve => terminal.write(raw, resolve));
    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    for (let row = 0; row < terminal.rows; row++) {
      lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "");
    }
    return lines.join("\n");
  } finally {
    terminal.dispose();
  }
}
