// Transparent stdio witness. Never writes RPC bodies, model text or secrets.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { PROBE, REPLY, inside, canonicalEventRecord, recordExec } from './xcli-lab.mjs';

const root = process.env.XCLI_CELL;
const evidence = inside(root, process.env.XCLI_EVENTS);
// Lot L6 (§8.3): the witness is our chain — self-record its exec synchronously
// at startup. Never let journaling break the witness path.
if (process.env.XCLI_EXEC_JOURNAL) {
  try { recordExec(process.env.XCLI_EXEC_JOURNAL, { pid: process.pid, path: process.argv[1], tag: 'harness' }); }
  catch { /* classification reads whatever landed */ }
}
// Lot L4: single retention choke point. Every retained record shares the
// canonical {at, event, transcript} envelope; the transcript is the JSON of
// the evidence-shaped detail (secret-shaped keys stripped, 32768 chars max).
// Readers rehydrate the flat fields from the transcript (see readEvents in
// scripts/qualify-cross-cli.mjs), so on-disk evidence is canonical while
// consumers keep their established field access.
const emit = raw => {
  const { event, ...detail } = raw;
  fs.appendFileSync(evidence, JSON.stringify(canonicalEventRecord(Date.now(), event, detail)) + '\n', { mode: 0o600 });
};
const child = spawn(process.execPath, [process.env.XCLI_BIN, ...process.argv.slice(2)], {
  env: process.env, stdio: ['pipe', 'pipe', 'pipe'],
});
emit({ event: 'proxy-start', pid: process.pid, childPid: child.pid });
const pending = new Map();
let diagnostic = '';
let lastIdentity;
let diagnosticLines = '';
// Lot L4: the stderr observe path. Exported alongside observe() so the
// equivalence test can run the same line sequence through both paths.
export function observeDiagnosticLine(line) {
  const wake = /^h2a mcp-serve: inbox-wake: (\d+) new envelope\(s\) → drive (ok|failed)$/.exec(line);
  if (wake) emit({ event: 'inbox-wake', freshCount: Number(wake[1]), ok: wake[2] === 'ok' });
  const prefix = line.indexOf('h2a.mcp.phase ');
  if (prefix === -1) return;
  try {
    const trace = JSON.parse(line.slice(prefix + 'h2a.mcp.phase '.length));
    if ((trace.role === 'identity-child' || /^(?:process_start|identity_pending|identity_ready|identity_failed)$/.test(trace.phase)) && /^[a-z0-9_:. -]{1,80}$/i.test(trace.phase)) {
      emit({ event: 'startup-phase', phase: trace.phase, kind: trace.event, processRole: trace.role,
        durationMs: trace.durationMs, waitMs: trace.waitMs, holdMs: trace.holdMs });
    }
  } catch { /* never retain unparsed diagnostics */ }
}
child.stderr.on('data', bytes => {
  diagnosticLines += bytes.toString();
  let newline;
  while ((newline = diagnosticLines.indexOf('\n')) !== -1) {
    const line = diagnosticLines.slice(0, newline);
    diagnosticLines = diagnosticLines.slice(newline + 1);
    observeDiagnosticLine(line);
  }
  diagnosticLines = diagnosticLines.slice(-32768);
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
// Lot L8 (§6.4) runaway brake: witnessed MCP tool calls per launched session
// are counted live. Crossing the cap terminates that owned session only and
// witnesses the refusal. The count is exact at the witness; it does not bound
// silent reasoning, and the verdict says so.
const mcpCallCap = Number(process.env.XCLI_MCP_CALL_CAP ?? '0');
let mcpCalls = 0, mcpCapped = false;
const enforceMcpCallCap = () => {
  if (mcpCapped || !(mcpCallCap > 0) || mcpCalls <= mcpCallCap) return;
  mcpCapped = true;
  emit({ event: 'mcp-call-cap-exceeded', count: mcpCalls, cap: mcpCallCap });
  try { child.kill('SIGTERM'); } catch { /* already exited */ }
  setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* reaped */ } }, 1000).unref();
};
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const rpc = JSON.parse(line);
    if (rpc.id !== undefined) pending.set(rpc.id, { method: rpc.method,
      tool: rpc.params?.name, args: rpc.params?.arguments });
    if (rpc.method === 'tools/call') { mcpCalls += 1; enforceMcpCallCap(); }
  } catch { /* pass original bytes through unchanged */ }
  if (!mcpCapped) child.stdin.write(line + '\n');
}
child.stdin.end();

// Registered before stdin is read: the host may initialize immediately.
// Exported for the Lot L4 equivalence test (both observe paths).
export function observe(line) {
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
    if (request.tool === 'h2a_identity_status') {
      const state = `${ok}:${value?.state}:${value?.instance}`;
      if (state !== lastIdentity) emit({ event: 'identity', ok,
        ready: value?.state === 'identity_ready', instance: value?.instance,
        state: value?.state, cause: /^[a-z_]+$/.test(value?.cause ?? '') ? value.cause : undefined });
      lastIdentity = state;
    }
    if (request.tool === 'h2a_send') {
      const kind = request.args?.message === PROBE ? 'probe' : request.args?.message === REPLY ? 'reply' : 'other';
      const sent = ok && !value?.error && Boolean(value?.envelope?.id);
      emit({ event: 'send', ok: sent, kind,
        envelopeId: value?.envelope?.id, from: value?.envelope?.actor?.instance, to: value?.envelope?.target?.instance });
      // Lot L12: closed-vocabulary refusal events only. A failed send
      // witnesses {tool, kind, errorKind} — never error text, bodies, or
      // instances beyond the envelope endpoints the send event carries.
      if (!sent) emit({ event: 'refusal', tool: 'h2a_send', kind,
        errorKind: rpc.error ? 'rpc-error' : 'result-error' });
    }
    if (request.tool === 'h2a_inbox' && ['read', 'pop'].includes(request.args?.action)) {
      const values = Array.isArray(value) ? value : value?.envelopes ?? (value?.envelope ? [value.envelope] : []);
      const read = ok && !value?.error;
      emit({ event: 'inbox', ok: read, instance: request.args?.instance,
        envelopes: values.filter(e => [PROBE, REPLY].includes(e?.body?.text)).map(e => ({
          id: e.id, from: e.actor?.instance, to: e.target?.instance,
          kind: e.body.text === PROBE ? 'probe' : 'reply',
        })) });
      if (!read) emit({ event: 'refusal', tool: 'h2a_inbox', kind: 'read',
        errorKind: rpc.error ? 'rpc-error' : 'result-error' });
    }
  } catch { /* malformed RPC cannot be positive evidence */ }
}
