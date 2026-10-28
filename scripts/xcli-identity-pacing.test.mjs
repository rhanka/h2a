import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { environment, repo, rehydrateEventRecord } from './xcli-lab.mjs';

test('a simulated peer waits for delayed identity without exhausting the MCP cap', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-identity-pacing-'));
  const env = environment(root);
  const build = join(root, 'build');
  const server = join(root, 'server.mjs');
  const events = join(root, 'events.jsonl');
  fs.mkdirSync(join(build, 'packages/h2a/dist'), { recursive: true });
  fs.mkdirSync(join(build, 'packages/h2a/test/helpers'), { recursive: true });
  fs.writeFileSync(join(build, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(join(build, 'packages/h2a/dist/index.js'), `
export const createLocalStore = () => ({});
export const parseSignedDriveInstruction = () => null;
export const verifySignedDriveInstruction = () => ({ok:false});
export const createReplayGuard = () => ({});
`);
  fs.copyFileSync(join(repo, 'packages/h2a/test/helpers/identity-readiness.js'),
    join(build, 'packages/h2a/test/helpers/identity-readiness.js'));
  const stopped = join(root, 'server-stopped');
  fs.writeFileSync(server, `import {createInterface} from 'node:readline';
import fs from 'node:fs';
process.on('SIGTERM', () => setTimeout(() => {
 fs.writeFileSync(${JSON.stringify(stopped)}, 'stopped');
 process.exit(0);
}, 200));
const started = Date.now();
for await (const line of createInterface({input:process.stdin})) {
 const m=JSON.parse(line); if(m.id===undefined)continue;
 const ready=Date.now()-started>=6250;
 const result=m.method==='tools/call'
  ? {content:[{type:'text',text:JSON.stringify({state:ready?'identity_ready':'identity_pending',instance:'gemini:fixture',signingAvailable:ready,elapsedMs:Date.now()-started,timeoutMs:30000})}]}
  : m.method==='tools/list' ? {tools:[]} : {protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'fixture',version:'1'}};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
}
`);
  fs.writeFileSync(join(root, 'bin/h2a'), `#!${process.execPath}\nimport(${JSON.stringify(new URL('./xcli-proxy.mjs', import.meta.url).href)});\n`, { mode: 0o700 });
  fs.mkdirSync(join(env.HOME, '.gemini'), { recursive: true });
  fs.writeFileSync(join(env.HOME, '.gemini/settings.json'), JSON.stringify({ mcpServers: { h2a: { command: 'h2a', args: [] } } }));
  const child = spawn(process.execPath, [join(repo, 'scripts/xcli-simulated-model.mjs'), 'gemini'], {
    env: { ...env, XCLI_BUILD: build, XCLI_CELL: root, XCLI_EVENTS: events, XCLI_BIN: server,
      XCLI_MCP_CALL_CAP: '100', H2A_NATIVE_TARGET_SESSION: 'h2a-receiver', XCLI_SCRIPT: '[]' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  let output = '';
  child.stderr.resume();
  child.stdout.on('data', bytes => { output += bytes; });
  try {
    const until = Date.now() + 20000;
    while (!output.includes('Ready') && child.exitCode === null && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const records = fs.readFileSync(events, 'utf8').trim().split('\n').map(line => rehydrateEventRecord(JSON.parse(line)));
    const polls = records.filter(e => e.event === 'tool-call' && e.tool === 'h2a_identity_status').length;
    const capped = records.some(e => e.event === 'mcp-call-cap-exceeded');
    console.log(JSON.stringify({ ready: output.includes('Ready'), polls, capped, cap: 100 }));
    assert.equal(capped, false, 'readiness polling must preserve the unchanged per-session MCP cap');
    assert.ok(output.includes('Ready'), 'the delayed peer must reach readiness');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await closed;
    const serverStopped = fs.existsSync(stopped);
    // Let the RED implementation's owned descendant finish before removing
    // the fixture too; its late witness write is the CI ENOTEMPTY race.
    const until = Date.now() + 5000;
    while (!fs.existsSync(stopped) && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(serverStopped, true, 'the peer must await its MCP server before reporting close');
  }
});
