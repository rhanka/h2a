// Transparent stdio witness. Never writes RPC bodies, model text or secrets.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { PROBE, REPLY, inside } from './xcli-lab.mjs';

const root = process.env.XCLI_CELL;
const evidence = inside(root, process.env.XCLI_EVENTS);
const emit = event => fs.appendFileSync(evidence, JSON.stringify({ at: Date.now(), ...event }) + '\n', { mode: 0o600 });
const child = spawn(process.execPath, [process.env.XCLI_BIN, ...process.argv.slice(2)], {
  env: process.env, stdio: ['pipe', 'pipe', 'pipe'],
});
emit({ event: 'proxy-start', pid: process.pid, childPid: child.pid });
const pending = new Map();
let diagnostic = '';
child.stderr.on('data', bytes => {
  diagnostic = (diagnostic + bytes.toString()).slice(-16384);
  if (diagnostic.includes('inbox-wake armed') && !diagnostic.includes('XCLI_ARMED_RECORDED')) {
    emit({ event: 'wake-armed' });
    diagnostic += 'XCLI_ARMED_RECORDED';
  }
});
const output = createInterface({ input: child.stdout });
output.on('line', line => { observe(line); process.stdout.write(line + '\n'); });
child.on('error', () => { emit({ event: 'server-start-failed' }); process.exitCode = 1; });
child.on('close', code => { emit({ event: 'server-exit', code }); process.exitCode = code ?? 1; });
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.once(signal, () => { child.kill(signal); setTimeout(() => child.kill('SIGKILL'), 1000).unref(); });
}
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const rpc = JSON.parse(line);
    if (rpc.id !== undefined) pending.set(rpc.id, { method: rpc.method,
      tool: rpc.params?.name, args: rpc.params?.arguments });
  } catch { /* pass original bytes through unchanged */ }
  child.stdin.write(line + '\n');
}
child.stdin.end();

// Registered before stdin is read: the host may initialize immediately.
function observe(line) {
  try {
    const rpc = JSON.parse(line), request = pending.get(rpc.id);
    if (!request) return;
    pending.delete(rpc.id);
    const result = rpc.result;
    const ok = !rpc.error && result?.isError !== true;
    if (request.method === 'initialize') emit({ event: 'initialize', ok });
    if (request.method === 'tools/list') emit({ event: 'tools', ok,
      messaging: ['h2a_identity_status', 'h2a_inbox', 'h2a_send'].every(name => result?.tools?.some(t => t.name === name)) });
    if (request.method !== 'tools/call') return;
    let value;
    try { value = JSON.parse(result?.content?.find(c => c.type === 'text')?.text); } catch { /* unsuccessful/non-JSON */ }
    if (request.tool === 'h2a_identity_status') emit({ event: 'identity', ok,
      ready: value?.state === 'identity_ready', instance: value?.instance });
    if (request.tool === 'h2a_send') {
      const kind = request.args?.message === PROBE ? 'probe' : request.args?.message === REPLY ? 'reply' : 'other';
      emit({ event: 'send', ok: ok && !value?.error && Boolean(value?.envelope?.id), kind,
        envelopeId: value?.envelope?.id, from: value?.envelope?.actor?.instance, to: value?.envelope?.target?.instance });
    }
    if (request.tool === 'h2a_inbox' && ['read', 'pop'].includes(request.args?.action)) {
      const values = Array.isArray(value) ? value : value?.envelopes ?? (value?.envelope ? [value.envelope] : []);
      emit({ event: 'inbox', ok: ok && !value?.error, instance: request.args?.instance,
        envelopes: values.filter(e => [PROBE, REPLY].includes(e?.body?.text)).map(e => ({
          id: e.id, from: e.actor?.instance, to: e.target?.instance,
          kind: e.body.text === PROBE ? 'probe' : 'reply',
        })) });
    }
  } catch { /* malformed RPC cannot be positive evidence */ }
}
