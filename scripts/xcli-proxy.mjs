// Transparent stdio witness. Never writes RPC bodies, model text or secrets.
import fs from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { PROBE, REPLY, inside, canonicalEventRecord, recordExec, repo } from './xcli-lab.mjs';
import { UNKNOWN_INSTANCE } from './xcli-scenarios.mjs';

const root = process.env.XCLI_CELL;
const evidence = inside(root, process.env.XCLI_EVENTS);
const identities = join(root, 'known-instances.jsonl');
const knownTools = new Set((fs.readFileSync(join(repo, 'packages/h2a/src/mcp.ts'), 'utf8').match(/["']h2a_[a-z_]+["']/g) ?? []).map(name => name.slice(1, -1)));
const knownInstance = value => {
  if (typeof value !== 'string') return undefined;
  try { return fs.readFileSync(identities, 'utf8').split('\n').includes(value) ? value : undefined; }
  catch { return undefined; }
};
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
    if (['process_start', 'identity_pending', 'identity_ready', 'identity_failed'].includes(trace.phase)) {
      const number = key => Number.isFinite(trace[key]) ? trace[key] : undefined;
      emit({ event: 'startup-phase', phase: trace.phase,
        kind: ['begin', 'end', 'error', 'sample'].includes(trace.event) ? trace.event : undefined,
        processRole: ['server', 'identity-child'].includes(trace.role) ? trace.role : undefined,
        durationMs: number('durationMs'), waitMs: number('waitMs'), holdMs: number('holdMs') });
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
    // Lot L13: every h2a tool call witnesses a closed {tool, ok} event —
    // names are the finite product vocabulary, bodies never retained.
    // Failures outside send/inbox witness the generic closed refusal.
    if (knownTools.has(request.tool) &&
      !['h2a_send', 'h2a_inbox'].includes(request.tool)) {
      const callOk = !rpc.error && rpc.result?.isError !== true;
      emit({ event: 'tool-call', tool: request.tool, ok: callOk });
      if (!callOk) emit({ event: 'refusal', tool: request.tool, kind: 'tool',
        errorKind: rpc.error ? 'rpc-error' : 'result-error' });
    }
    let value;
    try { value = JSON.parse(result?.content?.find(c => c.type === 'text')?.text); } catch { /* unsuccessful/non-JSON */ }
    if (request.tool === 'h2a_identity_status') {
      if (ok && value?.state === 'identity_ready' && typeof value.instance === 'string' &&
          /^[a-zA-Z0-9_.:-]{1,200}$/.test(value.instance)) {
        fs.appendFileSync(identities, value.instance + '\n', { mode: 0o600 });
      }
      const state = `${ok}:${value?.state}:${value?.instance}`;
      if (state !== lastIdentity) emit({ event: 'identity', ok,
        ready: value?.state === 'identity_ready', instance: knownInstance(value?.instance),
        state: ['identity_ready', 'identity_pending', 'identity_failed'].includes(value?.state) ? value.state : undefined });
      lastIdentity = state;
    }
    if (request.tool === 'h2a_send') {
      const kind = request.args?.message === PROBE ? 'probe' : request.args?.message === REPLY ? 'reply' : 'other';
      const sent = ok && !value?.error && Boolean(value?.envelope?.id);
      const unknownRefusal = request.args?.to === UNKNOWN_INSTANCE && value?.error ===
        `'${UNKNOWN_INSTANCE}' matches no live or registered agent — likely a phantom/invented id or sub-label. Resolve via discover; do not invent labels.`;
      emit({ event: 'send', ok: sent, kind,
        requestedTo: knownInstance(request.args?.to) ?? (request.args?.to === UNKNOWN_INSTANCE ? UNKNOWN_INSTANCE : undefined),
        refusalCode: !sent ? (unknownRefusal ? 'unknown-instance' : value?.code === 'recipient_not_live' ? 'recipient-not-live' : undefined) : undefined,
        envelopeId: sent && knownInstance(value?.envelope?.actor?.instance) && knownInstance(value?.envelope?.target?.instance) ? value.envelope.id : undefined,
        from: knownInstance(value?.envelope?.actor?.instance), to: knownInstance(value?.envelope?.target?.instance) });
      // Lot L12: closed-vocabulary refusal events only. A failed send
      // witnesses {tool, kind, errorKind} — never error text, bodies, or
      // instances beyond the envelope endpoints the send event carries.
      if (!sent) emit({ event: 'refusal', tool: 'h2a_send', kind,
        errorKind: rpc.error ? 'rpc-error' : 'result-error' });
    }
    if (request.tool === 'h2a_inbox' && ['read', 'pop', 'put'].includes(request.args?.action)) {
      const values = Array.isArray(value) ? value : value?.envelopes ?? (value?.envelope ? [value.envelope] : []);
      const action = request.args?.action;
      const done = ok && !value?.error;
      emit({ event: 'inbox', ok: done, action, instance: knownInstance(request.args?.instance),
        envelopes: values.filter(e => [PROBE, REPLY].includes(e?.body?.text) && knownInstance(e.actor?.instance) && knownInstance(e.target?.instance)).map(e => ({
          id: e.id, from: e.actor?.instance, to: e.target?.instance,
          kind: e.body.text === PROBE ? 'probe' : 'reply',
        })) });
      if (!done) emit({ event: 'refusal', tool: 'h2a_inbox', kind: action === 'put' ? 'put' : 'read',
        errorKind: rpc.error ? 'rpc-error' : 'result-error' });
    }
  } catch { /* malformed RPC cannot be positive evidence */ }
}
