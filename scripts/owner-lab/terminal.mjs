#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

// The GUI adapter owns actual terminal PTYs and executes exactly the commands rendered by restore.
const root = process.env.H2A_OWNER_LAB_ROOT;
if (process.argv[2] !== '--serve') {
  const r = await fetch(process.env.OWNER_LAB_TERMINAL + '/open', { method: 'POST', body: JSON.stringify(process.argv.slice(2)) });
  if (!r.ok) throw new Error(await r.text());
  process.exit(0);
}
const require = createRequire(join(process.env.OWNER_LAB_CORE, 'package.json'));
const runtime = createRequire(require.resolve('@sentropic/h2a-runtime/package.json'));
const pty = runtime('node-pty');
const windows = [];
const save = () => { writeFileSync(join(root, 'terminal-windows.tmp'), JSON.stringify(windows, null, 2)); renameSync(join(root, 'terminal-windows.tmp'), join(root, 'terminal-windows.json')); if (process.env.OWNER_LAB_TERMINAL_EVIDENCE) writeFileSync(process.env.OWNER_LAB_TERMINAL_EVIDENCE, JSON.stringify(windows, null, 2)); };
const server = createServer(async (req, res) => {
  let body = ''; for await (const b of req) body += b;
  try {
    if (req.url === '/open') {
      const args = JSON.parse(body), map = args.at(-1);
      assert.ok(map.startsWith(root + '/'), 'Restore map escaped lab');
      const lines = readFileSync(map, 'utf8').trim().split('\n');
      for (const line of lines) {
        const index = line.indexOf('\t'); const cwd = line.slice(0, index), command = line.slice(index + 1);
        assert.ok(cwd.startsWith(process.env.HOME + '/src/'), 'Unexpected restore cwd');
        assert.match(command, /^h2a attach '[\w.-]+'$/, 'Restore attempted to run/replace a live CLI');
        const session = command.match(/'([^']+)'/)[1];
        const terminal = pty.spawn('/bin/sh', ['-c', 'exec ' + command], { cwd, env: process.env, cols: 120, rows: 30, name: 'xterm-256color' });
        const window = { session, cwd, command, pid: terminal.pid, output: '', exit: null };
        Object.defineProperty(window, 'terminal', { value: terminal }); windows.push(window);
        terminal.onData(b => { window.output += b; save(); });
        terminal.onExit(exit => { window.exit = exit; save(); });
      }
      save(); res.end('opened');
    } else if (req.url === '/write') {
      const { session, data } = JSON.parse(body);
      const matches = windows.filter(w => w.session === session && w.exit === null);
      assert.equal(matches.length, 1, 'Exactly one terminal per CLI');
      matches[0].terminal.write(data); res.end('written');
    } else { res.statusCode = 404; res.end('unknown'); }
  } catch (e) { res.statusCode = 500; res.end(e.stack); }
});
server.listen(0, '127.0.0.1', () => writeFileSync(join(root, 'terminal-ready.json'), JSON.stringify({ url: `http://127.0.0.1:${server.address().port}` })));
process.once('SIGTERM', () => { for (const w of windows) if (w.exit === null) w.terminal.kill(); server.close(); });
