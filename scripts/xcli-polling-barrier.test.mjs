import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { environment, repo, rehydrateEventRecord } from './xcli-lab.mjs';

test('a polling peer waits for the barrier timestamp to be fully published', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-poll-barrier-'));
  const env = environment(root);
  const build = join(root, 'build');
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
  const server = join(root, 'server.mjs');
  fs.writeFileSync(server, `import {createInterface} from 'node:readline';
for await (const line of createInterface({input:process.stdin})) {
 const m=JSON.parse(line); if(m.id===undefined)continue;
 const value=m.params?.name==='h2a_inbox' ? {envelopes:[]}
  : {state:'identity_ready',instance:'gemini:fixture',signingAvailable:true};
 const result=m.method==='tools/call' ? {content:[{type:'text',text:JSON.stringify(value)}]}
  : m.method==='tools/list' ? {tools:[]} : {protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'fixture',version:'1'}};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
}
`);
  fs.writeFileSync(join(root, 'bin/h2a'), `#!${process.execPath}\nimport(${JSON.stringify(new URL('./xcli-proxy.mjs', import.meta.url).href)});\n`, { mode: 0o700 });
  fs.mkdirSync(join(env.HOME, '.gemini'), { recursive: true });
  fs.writeFileSync(join(env.HOME, '.gemini/settings.json'), JSON.stringify({ mcpServers: { h2a: { command: 'h2a', args: [] } } }));
  const barrier = join(root, 'barrier-at');
  fs.writeFileSync(barrier, ''); // writer opened the marker but has not written its timestamp
  const child = spawn(process.execPath, [join(repo, 'scripts/xcli-simulated-model.mjs'), 'gemini'], {
    env: { ...env, XCLI_BUILD: build, XCLI_CELL: root, XCLI_EVENTS: events, XCLI_BIN: server,
      XCLI_MCP_CALL_CAP: '100', H2A_NATIVE_TARGET_SESSION: 'h2a-receiver',
      XCLI_SCRIPT: '[]', XCLI_POLL: 'periodic:5000:0' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  let output = '';
  child.stdout.on('data', bytes => { output += bytes; });
  child.stderr.resume();
  const records = () => fs.existsSync(events) ? fs.readFileSync(events, 'utf8').trim().split('\n')
    .filter(Boolean).map(line => rehydrateEventRecord(JSON.parse(line))) : [];
  const reads = () => records().filter(e => e.event === 'inbox').length;
  try {
    const until = Date.now() + 10000;
    while (!output.includes('Ready') && child.exitCode === null && Date.now() < until)
      await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(output.includes('Ready'), 'peer reaches identity readiness');
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(reads(), 0, 'an empty marker must not schedule catch-up polls from epoch zero');
    fs.writeFileSync(barrier, String(Date.now()));
    const published = Date.now() + 5000;
    while (reads() === 0 && child.exitCode === null && Date.now() < published)
      await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(reads(), 1, 'the first valid tick executes exactly once');
    assert.equal(records().some(e => e.event === 'mcp-call-cap-exceeded'), false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await closed;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
