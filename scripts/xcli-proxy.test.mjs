import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { PROBE, environment, rehydrateEventRecord } from './xcli-lab.mjs';
import { UNKNOWN_INSTANCE } from './xcli-scenarios.mjs';

test('L8: a looping session trips the live per-session MCP-call cap and dies', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-proxy-cap-'));
  const server = join(root, 'server.mjs');
  const events = join(root, 'events.jsonl');
  const env = { ...environment(root), XCLI_CELL: root, XCLI_EVENTS: events, XCLI_BIN: server, XCLI_MCP_CALL_CAP: '3' };
  fs.writeFileSync(server, `import {createInterface} from 'node:readline';
for await(const line of createInterface({input:process.stdin})) {
 const m=JSON.parse(line);
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'{}'}]}})+'\\n');
}\n`);
  const child = spawn(process.execPath, [join(import.meta.dirname, 'xcli-proxy.mjs')], { env, cwd: root, stdio: ['pipe', 'pipe', 'ignore'] });
  const closed = once(child, 'close');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    const calls = [];
    for (let id = 1; id <= 10; id++) calls.push(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'h2a_inbox', arguments: { action: 'read' } } }));
    child.stdin.end(calls.join('\n') + '\n');
    await closed;
    const records = fs.readFileSync(events, 'utf8').trim().split('\n').map(line => rehydrateEventRecord(JSON.parse(line)));
    const caps = records.filter(e => e.event === 'mcp-call-cap-exceeded');
    assert.equal(caps.length, 1, 'the cap trips exactly once');
    assert.equal(caps[0].count, 4, 'the call crossing the cap is witnessed');
    assert.equal(caps[0].cap, 3);
    assert.ok(records.some(e => e.event === 'server-exit'), 'the owned session is terminated');
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the transparent MCP witness records outcomes and exact envelope IDs without retaining bodies', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-proxy-'));
  fs.writeFileSync(join(root, 'known-instances.jsonl'), 'claude:sender\ncodex:receiver\n');
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
    // Lot L4: on-disk records are canonical envelopes; established flat-field
    // assertions read through the shared rehydration helper.
    const records = raw.trim().split('\n').map(line => rehydrateEventRecord(JSON.parse(line)));
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

test('L13: loop tool calls witness closed tool-call events with no bodies', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-proxy-loop-'));
  const server = join(root, 'server.mjs');
  const events = join(root, 'events.jsonl');
  const env = { ...environment(root), XCLI_CELL: root, XCLI_EVENTS: events, XCLI_BIN: server };
  fs.writeFileSync(server, `import {createInterface} from 'node:readline';
for await(const line of createInterface({input:process.stdin})) {
 const m=JSON.parse(line);
 const ok = m.params.arguments.loopId !== 'xcli-no-such-loop';
 const body = ok ? {content:[{type:'text',text:'{"loopId":"xcli-loop","state":"open"}'}]} : {isError:true,content:[{type:'text',text:'{"error":"SECRET_TEXT_NO_LOOP"}'}]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:body})+'\\n');
}\n`);
  const child = spawn(process.execPath, [join(import.meta.dirname, 'xcli-proxy.mjs')], { env, cwd: root, stdio: ['pipe', 'pipe', 'ignore'] });
  const closed = once(child, 'close');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'h2a_loop_join', arguments: { loopId: 'xcli-loop' } } }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'h2a_loop_join', arguments: { loopId: 'xcli-no-such-loop' } } }) + '\n');
    await closed;
    const raw = fs.readFileSync(events, 'utf8');
    assert.ok(!raw.includes('SECRET_TEXT'), 'loop failures retain no error text');
    const records = raw.trim().split('\n').map(line => rehydrateEventRecord(JSON.parse(line)));
    assert.deepEqual(records.filter(e => e.event === 'tool-call').map(e => ({ tool: e.tool, ok: e.ok })), [
      { tool: 'h2a_loop_join', ok: true },
      { tool: 'h2a_loop_join', ok: false },
    ]);
    const refusals = records.filter(e => e.event === 'refusal');
    assert.deepEqual(refusals.map(e => ({ tool: e.tool, errorKind: e.errorKind })), [
      { tool: 'h2a_loop_join', errorKind: 'result-error' },
    ]);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('L12: failed sends and reads witness closed-vocabulary refusals, never error text', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-proxy-refusal-'));
  const server = join(root, 'server.mjs');
  const events = join(root, 'events.jsonl');
  const env = { ...environment(root), XCLI_CELL: root, XCLI_EVENTS: events, XCLI_BIN: server };
  fs.writeFileSync(join(root, 'known-instances.jsonl'), 'codex:receiver\n');
  fs.writeFileSync(server, `import {createInterface} from 'node:readline';
process.stderr.write('h2a.mcp.phase {"role":"identity-child","phase":"codex:workspace:deadbeefcafe","event":"sample"}\\n');
for await(const line of createInterface({input:process.stdin})) {
 const m=JSON.parse(line);
 if(m.id===5) process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:JSON.stringify({error:${JSON.stringify(`'${UNKNOWN_INSTANCE}' matches no live or registered agent — likely a phantom/invented id or sub-label. Resolve via discover; do not invent labels.`)}})}]}})+'\\n');
 else if(m.id===6) process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:JSON.stringify({error:'SECRET_TEXT_STOPPED_TARGET',code:'recipient_not_live'})}]}})+'\\n');
 else if(m.params?.name==='h2a_send') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32000,message:'SECRET_TEXT_UNKNOWN_TARGET'}})+'\\n');
 else process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{isError:true,content:[{type:'text',text:'{"error":"SECRET_TEXT_READ_FAILED"}'}]}})+'\\n');
}\n`);
  const child = spawn(process.execPath, [join(import.meta.dirname, 'xcli-proxy.mjs')], { env, cwd: root, stdio: ['pipe', 'pipe', 'ignore'] });
  const closed = once(child, 'close');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'h2a_send', arguments: { to: 'xcli-unknown-instance', message: 'hello' } } }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'h2a_inbox', arguments: { action: 'read', instance: 'x' } } }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'h2a_inbox', arguments: { action: 'put', instance: 'x', envelope: {} } } }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'h2a_inbox', arguments: { action: 'read', instance: 'codex:workspace:deadbeefcafe' } } }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'h2a_send', arguments: { to: UNKNOWN_INSTANCE, message: PROBE } } }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'h2a_send', arguments: { to: 'codex:receiver', message: PROBE } } }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'h2a_send', arguments: { to: UNKNOWN_INSTANCE, message: PROBE } } }) + '\n');
    await closed;
    const raw = fs.readFileSync(events, 'utf8');
    assert.ok(!raw.includes('SECRET_TEXT'), 'refusals retain no error text');
    assert.ok(!raw.includes('codex:workspace:deadbeefcafe'), 'L4 review: an instance-shaped canary before identity is never retained');
    const records = raw.trim().split('\n').map(line => rehydrateEventRecord(JSON.parse(line)));
    const refusals = records.filter(e => e.event === 'refusal');
    assert.deepEqual(refusals.map(e => ({ tool: e.tool, kind: e.kind, errorKind: e.errorKind })), [
      { tool: 'h2a_send', kind: 'other', errorKind: 'rpc-error' },
      { tool: 'h2a_inbox', kind: 'read', errorKind: 'result-error' },
      { tool: 'h2a_inbox', kind: 'put', errorKind: 'result-error' },
      { tool: 'h2a_inbox', kind: 'read', errorKind: 'result-error' },
      { tool: 'h2a_send', kind: 'probe', errorKind: 'result-error' },
      { tool: 'h2a_send', kind: 'probe', errorKind: 'result-error' },
      { tool: 'h2a_send', kind: 'probe', errorKind: 'rpc-error' },
    ]);
    assert.deepEqual(records.filter(e => e.event === 'send' && e.kind === 'probe')
      .map(e => ({ target: e.requestedTo, refusal: e.refusalCode })), [
      { target: UNKNOWN_INSTANCE, refusal: 'unknown-instance' },
      { target: 'codex:receiver', refusal: 'recipient-not-live' },
      { target: UNKNOWN_INSTANCE, refusal: undefined },
    ]);
    const puts = records.filter(e => e.event === 'inbox' && e.action === 'put');
    assert.equal(puts.length, 1, 'put is witnessed with its action');
    assert.equal(puts[0].ok, false);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('L4: both observe paths retain identical canonical records with a transcript field', async () => {
  const { canonicalEventRecord, REPLAY_TRANSCRIPT_BODY } = await import('./xcli-lab.mjs');
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-proxy-canonical-'));
  fs.writeFileSync(join(root, 'known-instances.jsonl'), 'codex:sender\ncodex:receiver\n');
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
 else if(m.method==='tools/call') result={content:[{type:'text',text:JSON.stringify({envelopes:[{id:'env:fixture',actor:{instance:'codex:sender'},target:{instance:'codex:receiver'},body:{text:${JSON.stringify(PROBE)}}}]})}]};
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
