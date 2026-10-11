import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import { StringDecoder } from 'node:string_decoder';
import { here, rpc } from './lab.mjs';
const require = createRequire(import.meta.url);

export async function historicalAttach(root) {
  const ts = require('typescript'); const esbuild = require('esbuild');
  const sourceDir = path.resolve(here, '../../packages/h2a-runtime/src/native-terminal');
  const source = fs.readFileSync(path.join(sourceDir, 'op.ts'), 'utf8');
  const ast = ts.createSourceFile('op.ts', source, ts.ScriptTarget.Latest, true);
  // Copy the actual AST declaration bytes, not a rewritten reconnect loop.
  // Exclude the CLI entrypoint and registry/supervisor imports structurally.
  const selected = ast.statements.filter(node => {
    if (ts.isFunctionDeclaration(node)) return ['runAttach', 'isDefinitiveNativeTerminalAbsence'].includes(node.name?.text);
    if (ts.isVariableStatement(node)) return node.declarationList.declarations.some(d =>
      d.name.text === 'DETACH_BYTE' || d.name.text?.startsWith('ATTACH_'));
    return false;
  }).map(node => node.getText(ast));
  if (!selected.some(s => s.startsWith('export async function runAttach'))) throw new Error('attach extraction failed');
  const imports = ['import { writeSync } from "node:fs";',
    ...['protocol', 'terminal-modes', 'reset-relay'].map((name, i) =>
      `import { ${['NATIVE_TERMINAL_INTERACTIVE_READ_TIMEOUT_MS, NativeTerminalRemoteError', 'TerminalModeTracker', 'TerminalResetRelay'][i]} } from ${JSON.stringify(path.join(sourceDir, `${name}.ts`))};`)];
  const outfile = path.join(root, 'source-attach.mjs');
  await esbuild.build({ stdin: { contents: [...imports, ...selected].join('\n'),
    loader: 'ts', resolveDir: here }, outfile, bundle: true, platform: 'node', format: 'esm' });
  return { runAttach: (await import(pathToFileURL(outfile))).runAttach,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    limitation: 'real runAttach source, adapted IPC protocol; installed/historical dist not used' };
}
export function adapter(socket, counts) {
  const decoder = new StringDecoder('utf8');
  return async () => {
    counts.connects++;
    const watcher = net.connect(socket); let closed = false, lease;
    watcher.on('error', () => { closed = true; }); watcher.on('close', () => { closed = true; });
    await new Promise((resolve, reject) => {
      watcher.once('error', reject); watcher.once('data', resolve);
      watcher.once('connect', () => watcher.write(`${JSON.stringify({ op: 'status', watch: true })}\n`));
    });
    const call = async request => {
      if (closed) throw Object.assign(new Error('accepted socket closed by exec'), { code: 'ECONNRESET' });
      const result = await rpc(socket, request);
      if (result.error) throw new Error(result.error);
      return result;
    };
    return {
      state: async id => {
        const state = await call({ op: 'status' }); const s = state.sessions[+id];
        return { status: s.exit ? 'exited' : 'running', exit: s.exit };
      },
      acquireController: async (id, client) => {
        const result = await call({ op: 'acquire', id: +id, client });
        lease = { id: +id, client, epoch: result.epoch }; return lease;
      },
      readOutput: async (id, after) => {
        const output = await call({ op: 'read', id: +id, after });
        counts.lastSeq = output.next;
        return { ...output, latestSeq: output.next, chunks: output.chunks.map(c =>
          ({ seq: c.seq, data: decoder.write(Buffer.from(c.data, 'base64')) })) };
      },
      write: (lease, data) => call({ op: 'write', ...lease, data }),
      resize: (lease, cols, rows) => call({ op: 'resize', ...lease, cols, rows }),
      releaseController: lease => call({ op: 'release', ...lease }),
      close: () => {
        watcher.destroy();
        if (lease) void rpc(socket, { op: 'release', ...lease }).catch(() => {});
      },
    };
  };
}
