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

test('L4: both observe paths retain identical canonical records with a transcript field', async () => {
  const { canonicalEventRecord, REPLAY_TRANSCRIPT_BODY } = await import('./xcli-lab.mjs');
  const root = fs.mkdtempSync('/tmp/xcli-proxy-canonical-');
  const server = join(root, 'server.mjs');
  const events = join(root, 'events.jsonl');
  const env = { ...environment(root), XCLI_CELL: root, XCLI_EVENTS: events, XCLI_BIN: server };
  fs.writeFileSync(server, `import {createInterface} from 'node:readline';
process.stderr.write('h2a mcp-serve: inbox-wake: 1 new envelope(s) \\u2192 drive ok\\n');
process.stderr.write('h2a.mcp.phase {"role":"identity-child","phase":"identity_');
process.stderr.write('ready","event":"sample"}\\n');
for await(const line of createInterface({input:process.stdin})) {
 const m=JSON.parse(line); let result;
 if(m.method==='initialize') result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
 else if(m.method==='tools/call') result={content:[{type:'text',text:JSON.stringify({envelopes:[{id:'env:fixture',from:'codex:sender',to:'codex:receiver',kind:'probe',body:{text:'marker'}}]})}]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
}\n`);
  const { spawn: spawnChild } = await import('node:child_process');
  const child = spawnChild(process.execPath, [join(import.meta.dirname, 'xcli-proxy.mjs')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'h2a_inbox', arguments: { action: 'read', instance: 'codex:receiver' } } }) + '\n');
    await closed;
    const records = fs.readFileSync(events, 'utf8').trim().split('\n').map(JSON.parse);
    const byEvent = name => records.filter(e => e.event === name);
    // Every retained record shares the canonical envelope, including the
    // live transcript field carrying the evidence-shaped detail as JSON.
    for (const record of records) {
      assert.ok(Number.isSafeInteger(record.at), 'canonical record carries time');
      assert.equal(typeof record.event, 'string');
      assert.equal(typeof record[REPLAY_TRANSCRIPT_BODY], 'string', 'canonical record carries the live transcript field');
      assert.doesNotThrow(() => JSON.parse(record[REPLAY_TRANSCRIPT_BODY]), 'transcript is evidence-shaped JSON');
    }
    // Field-for-field equivalence with the single lab canonicalization
    // (modulo the local emit timestamp) across both observe paths.
    const same = (actual, event, detail) => {
      const expected = canonicalEventRecord(0, event, detail);
      assert.equal(actual.event, expected.event);
      assert.equal(actual[REPLAY_TRANSCRIPT_BODY], expected[REPLAY_TRANSCRIPT_BODY]);
    };
    const wake = byEvent('inbox-wake');
    assert.equal(wake.length, 1, 'stderr observe path retains the wake line once');
    same(wake[0], 'inbox-wake', { freshCount: 1, ok: true });
    const phase = byEvent('startup-phase');
    assert.equal(phase.length, 1, 'fragmented phase line reassembled once');
    same(phase[0], 'startup-phase', { phase: 'identity_ready', kind: 'sample', processRole: 'identity-child',
      durationMs: undefined, waitMs: undefined, holdMs: undefined });
    const init = byEvent('initialize');
    assert.equal(init.length, 1);
    same(init[0], 'initialize', { ok: true });
    const inbox = byEvent('inbox');
    assert.equal(inbox.length, 1, 'stdout observe path retains the inbox read once');
    assert.ok(inbox[0][REPLAY_TRANSCRIPT_BODY].includes('env:fixture'));
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
