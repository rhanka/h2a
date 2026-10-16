import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { PROBE, environment } from './xcli-lab.mjs';

test('the transparent MCP witness records outcomes and exact envelope IDs without retaining bodies', async () => {
  const root = fs.mkdtempSync('/tmp/xcli-proxy-');
  const server = join(root, 'server.mjs');
  const events = join(root, 'events.jsonl');
  const env = { ...environment(root), XCLI_CELL: root, XCLI_EVENTS: events, XCLI_BIN: server };
  fs.writeFileSync(server, `import {createInterface} from 'node:readline';
process.stderr.write('DO_NOT_RETAIN_PROVIDER_BODY\\n');
process.stderr.write('h2a mcp-serve: inbox-wake: 1 new envelope(s) → drive ok\\n');
process.stderr.write('h2a mcp-serve: inbox-wake: 2 new envelope(s) → drive failed\\n');
for await(const line of createInterface({input:process.stdin})) {
 const m=JSON.parse(line); let result;
 if(m.method==='initialize') result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
 else if(m.method==='tools/list')result={tools:['h2a_identity_status','h2a_inbox','h2a_send'].map(name=>({name}))};
 else result={isError:false,content:[{type:'text',text:JSON.stringify(m.params.name==='h2a_send'?{envelope:{id:'env:fixture',actor:{instance:'claude:sender'},target:{instance:'codex:receiver'},body:{text:${JSON.stringify(PROBE)}}},privateFixture:'DO_NOT_RETAIN_PROVIDER_BODY'}:{envelopes:[{id:'env:fixture',actor:{instance:'claude:sender'},target:{instance:'codex:receiver'},body:{text:${JSON.stringify(PROBE)}}}]})}]};
 console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
}
`);
  const child = spawn(process.execPath, [join(import.meta.dirname, 'xcli-proxy.mjs')], { env, cwd: root, stdio: ['pipe', 'pipe', 'ignore'] });
  const closed = once(child, 'close');
  let output = '';
  child.stdout.on('data', bytes => { output += bytes; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    const requests = [
      { id: 1, method: 'initialize' }, { id: 2, method: 'tools/list' },
      { id: 3, method: 'tools/call', params: { name: 'h2a_send', arguments: { to: 'codex:receiver', message: PROBE } } },
      { id: 4, method: 'tools/call', params: { name: 'h2a_inbox', arguments: { action: 'read', instance: 'codex:receiver' } } },
    ];
    child.stdin.end(requests.map(r => JSON.stringify({ jsonrpc: '2.0', ...r })).join('\n') + '\n');
    const [code] = await closed;
    assert.equal(code, 0);
    const rpc = output.trim().split('\n').map(JSON.parse);
    assert.equal(rpc.length, 4, 'witness must forward every original response');
    assert.ok(rpc[2].result.content[0].text.includes('DO_NOT_RETAIN_PROVIDER_BODY'));
    const raw = fs.readFileSync(events, 'utf8');
    assert.ok(!raw.includes('DO_NOT_RETAIN_PROVIDER_BODY'));
    assert.ok(!raw.includes(PROBE), 'retain only fixed marker classification, never bodies');
    const records = raw.trim().split('\n').map(JSON.parse);
    assert.deepEqual(records.filter(e => e.event === 'inbox-wake').map(e => ({ freshCount: e.freshCount, ok: e.ok })),
      [{ freshCount: 1, ok: true }, { freshCount: 2, ok: false }]);
    assert.ok(records.some(e => e.event === 'initialize' && e.ok));
    assert.ok(records.some(e => e.event === 'tools' && e.messaging));
    assert.ok(records.some(e => e.event === 'send' && e.ok && e.kind === 'probe' && e.envelopeId === 'env:fixture'));
    assert.ok(records.some(e => e.event === 'inbox' && e.ok && e.envelopes.some(v => v.id === 'env:fixture')));
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
