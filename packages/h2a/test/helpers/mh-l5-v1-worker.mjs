// Test executable importing only the verified, temporary published v1 dist.
import { createInterface } from 'node:readline';
const [module, mode, runtimeBase, root, endpoint] = process.argv.slice(2);
const v1 = await import(module);
if (mode === 'writer') {
  const { createLocalStore } = await import(new URL('./local-files/store.js', module));
  const store = createLocalStore({ root });
  const lines = createInterface({ input: process.stdin });
  process.stdout.write(JSON.stringify({ id: 'ready', kind: 'writer' }) + '\n');
  lines.on('line', line => {
    const command = JSON.parse(line);
    store.registerInstance({ id: command.instance, publicKeys: [], roles: [], scopes: [], createdAt: new Date().toISOString() });
    process.stdout.write(JSON.stringify({ id: command.id, registered: true }) + '\n');
  });
  process.stdin.once('end', () => { lines.close(); });
} else if (mode === 'bridge') {
  try { await v1.bridgeCentralMcpStdio({ runtimeBase, endpoint, stdin: process.stdin, stdout: process.stdout }); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
  process.stdin.destroy();
} else {
  let server;
  try {
    server = await v1.startCentralMcpServer({ runtimeBase, root, env: { ...process.env, H2A_MCP_CENTRAL_ENDPOINT: endpoint } });
    process.stdout.write(JSON.stringify({ id: 'ready', kind: server.kind, endpoint: server.endpoint, generation: server.generation }) + '\n');
  } catch (error) { process.stdout.write(JSON.stringify({ id: 'ready', error: error.message }) + '\n'); }
  const lines = createInterface({ input: process.stdin });
  const stop = async () => { if (server?.kind === 'started') await server.stop(); lines.close(); process.stdin.destroy(); };
  lines.on('line', () => { void stop(); });
  process.stdin.once('end', () => { void stop(); });
}
