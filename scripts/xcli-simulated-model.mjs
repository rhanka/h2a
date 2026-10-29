#!/usr/bin/env node
// Deterministic model substitute, not a real-CLI qualification. It drives the
// unchanged h2a MCP and accepts ONLY a verified product wake from its real PTY.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROBE, REPLY, recordExec, canonicalEventRecord } from './xcli-lab.mjs';
// Lot L6 (§8.3): the simulated model is our chain — self-record its exec
// synchronously at startup. Never let journaling break the model path.
if (process.env.XCLI_EXEC_JOURNAL) {
  try { recordExec(process.env.XCLI_EXEC_JOURNAL, { pid: process.pid, path: process.argv[1], tag: 'harness' }); }
  catch { /* classification reads whatever landed */ }
}

const profile = process.argv[2];
const prompt = process.argv.at(-1);
const role = process.env.H2A_NATIVE_TARGET_SESSION === 'h2a-receiver' ? 'receiver' : 'sender';
const build = process.env.XCLI_BUILD;
const { createLocalStore, parseSignedDriveInstruction, verifySignedDriveInstruction, createReplayGuard } =
  await import(pathToFileURL(join(build, 'packages/h2a/dist/index.js')));
const store = createLocalStore({ root: process.env.H2A_ROOT });
const { waitForIdentity } = await import(pathToFileURL(join(build, 'packages/h2a/test/helpers/identity-readiness.js')));

function endpoint() {
  // Deliberately use the native configuration locations, independently of
  // descriptor.path. This fixture emulates these layouts, not their full parsers.
  const paths = {
    claude: join(process.env.CLAUDE_CONFIG_DIR ?? join(process.env.HOME, '.claude'), '.claude.json'),
    codex: join(process.env.CODEX_HOME, 'config.toml'),
    agy: join(process.env.HOME, '.gemini/config/mcp_config.json'),
    gemini: join(process.env.HOME, '.gemini/settings.json'),
    muse: join(process.env.XDG_CONFIG_HOME, 'muse/settings.json'),
    vibe: join(process.env.VIBE_HOME, 'config.toml'),
  };
  const raw = fs.readFileSync(paths[profile], 'utf8');
  if (!['codex', 'vibe'].includes(profile)) {
    const settings = JSON.parse(raw);
    if (profile === 'muse') assert.equal(settings.schema_version, 1, 'native Muse requires settings schema_version 1');
    return settings.mcpServers.h2a;
  }
  const expected = profile === 'codex' ? '[mcp_servers.h2a]' : '[[mcp_servers]]';
  assert.ok(raw.includes(expected), 'native TOML table required');
  const command = JSON.parse(/^command = (.+)$/m.exec(raw)?.[1]);
  const args = JSON.parse(/^args = (.+)$/m.exec(raw)?.[1]);
  return { command, args };
}

const config = endpoint();
assert.equal(config.command, 'h2a', 'fixture must launch the private witnessed product shim');
const mcp = spawn(config.command, config.args, { env: process.env, stdio: ['pipe', 'pipe', 'ignore'] });
let stopping = false;
// The proxy writes its final server-exit witness before closing. Await that
// close before the peer exits so its caller can safely remove the cell.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => {
  if (stopping) return;
  stopping = true;
  mcp.once('close', () => process.exit(0));
  mcp.kill('SIGTERM');
  mcp.stdin.end();
});
let next = 1;
const requests = new Map();
createInterface({ input: mcp.stdout }).on('line', line => {
  const rpc = JSON.parse(line);
  const pending = requests.get(rpc.id);
  if (!pending) return; // notifications alone never trigger this simulated model
  requests.delete(rpc.id);
  clearTimeout(pending.timer);
  // Lot L15: oversize responses arrive as an error WITH a recovery ref —
  // the product's designed path. Attached for steps that consume the ref.
  if (rpc.error || rpc.result?.isError) {
    const failure = new Error('MCP request rejected');
    failure.recovery = rpc.error?.data?.recovery;
    pending.reject(failure);
  }
  else pending.resolve(rpc.result);
});
function call(method, params) {
  const id = next++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { requests.delete(id); reject(new Error('MCP fixture deadline')); }, 15000);
    requests.set(id, { resolve, reject, timer });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
async function tool(name, args) {
  const result = await call('tools/call', { name, arguments: args });
  const value = JSON.parse(result.content[0].text);
  assert.ok(!value.error, 'MCP tool must succeed');
  return value;
}
// Lot L12 (identity-never-ready): the harness faults the receiver's identity
// gate after MCP initialization — no identity call, no readiness, the session
// idles. Its witnessed deadline must classify identity-never-ready, never credit.
await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: `simulated-${profile}`, version: '1' } });
mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
await call('tools/list', {});
if (process.env.XCLI_SCENARIO_FAULT === 'never-ready' && role === 'receiver') {
  fs.appendFileSync(process.env.XCLI_EVENTS,
    JSON.stringify(canonicalEventRecord(Date.now(), 'scenario-identity-gate-held', {})) + '\n', { mode: 0o600 });
  process.stdout.write(`Simulated ${profile} model\r\nReady · ${process.cwd()}\r\n${profile === 'codex' ? '›' : '❯'} \r\n`);
  await new Promise(() => {});
}
const identity = await waitForIdentity(() => tool('h2a_identity_status', {}),
  // Readiness may spend several seconds activating the signer on a busy
  // runner. Preserve the per-session MCP cap for the scenario's actual calls.
  () => new Promise(r => setTimeout(r, 1000)));
assert.equal(identity.state, 'identity_ready');
assert.equal(identity.signingAvailable, true);
const instance = identity.instance;
const guard = createReplayGuard();
// Lot L13+: scripted peer mode. XCLI_SCRIPT carries deterministic tool
// steps executed after identity readiness; marker files coordinate peers.
// Scripted peers idle afterwards: no probe behavior, stdin ignored, no wake
// claimed. Step failures (including a step that refuses to fail) write a
// failure marker — never a silent pass.
const scriptJson = process.env.XCLI_SCRIPT ?? '';
async function runScriptedPeer(steps) {
  const { substituteScriptArgs } = await import('./xcli-scenarios.mjs');
  // Lot L14: worker-provided script vars (per-cell throwaway keys). Process
  // env only — never written to disk or evidence.
  const scriptVars = JSON.parse(process.env.XCLI_SCRIPT_VARS ?? '{}');
  const saved = {};
  const marker = name => join(process.env.XCLI_CELL, name);
  const outcome = { ok: true };
  try {
    for (const step of steps) {
      if (step.writeFile) { fs.writeFileSync(marker(step.writeFile), instance + '\n', { mode: 0o600 }); continue; }
      if (step.readVarFile) {
        assert.ok(/^[a-z0-9][a-z0-9.-]{0,40}$/.test(step.readVarFile.name), 'script-marker-name');
        assert.ok(/^[a-zA-Z][a-zA-Z0-9]{0,20}$/.test(step.readVarFile.as), 'script-var-name');
        saved[step.readVarFile.as] = fs.readFileSync(marker(step.readVarFile.name), 'utf8').trim();
        continue;
      }
      if (step.saveVarFile) {
        assert.ok(/^[a-z0-9][a-z0-9.-]{0,40}$/.test(step.saveVarFile.name), 'script-marker-name');
        assert.ok(/^[a-zA-Z][a-zA-Z0-9]{0,20}$/.test(step.saveVarFile.as), 'script-var-name');
        fs.writeFileSync(marker(step.saveVarFile.name), String(saved[step.saveVarFile.as] ?? ''), { mode: 0o600 });
        continue;
      }
      if (step.waitForFile) {
        const until = Date.now() + (step.timeoutMs ?? 120000);
        for (;;) {
          try { fs.readFileSync(marker(step.waitForFile), 'utf8'); break; }
          catch { /* peer has not arrived yet */ }
          if (Date.now() > until) throw new Error(`script-wait-timeout:${step.waitForFile}`);
          await new Promise(r => setTimeout(r, 250));
        }
        continue;
      }
      const until = Date.now() + (step.retryMs ?? 15000);
      for (;;) {
        const value = await tool(step.tool, substituteScriptArgs(step.args, { instance, cwd: process.cwd(), ...scriptVars, ...saved })).catch(error => error);
        // Lot L15: a recovery ref satisfies the step even though the call
        // errored — the ref IS the product's oversize answer.
        if (value instanceof Error && step.recoveryRef && value.recovery?.ref) {
          if (step.saveAs) saved[step.saveAs] = value.recovery.ref;
          break;
        }
        if (value instanceof Error && step.expectOk === false) break;
        if (!(value instanceof Error) && step.expectOk !== false) {
          if (step.saveAs) saved[step.saveAs] = value.loopId ?? value.id ?? value.negotiationId
            ?? value.sessionId ?? value.session?.sessionId ?? value.ref;
          break;
        }
        if (Date.now() > until) throw new Error(`script-step-failed:${step.tool}`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  } catch (error) {
    outcome.ok = false;
    outcome.failedStep = error.message;
  }
  fs.writeFileSync(marker(`${role}-script-done`), JSON.stringify(outcome) + '\n', { mode: 0o600 });
  if (!outcome.ok) process.exitCode = 73;
}
// Lot L3 polling fixtures: the receiver ignores the wake as a cause and polls
// its inbox on a harness-coordinated schedule instead. XCLI_POLL carries one
// of: `periodic:<periodMs>:<phaseMs>` (ticks at barrier+phase+k*period),
// `single:<atMs>` (one read at barrier+at), `wakedelay:<delayMs>` (one read
// delayMs after the first wake-shaped line arrives). Barrier time comes from
// the worker-published $XCLI_CELL/barrier-at file. Active for the receiver
// role only; the sender never polls.
const pollSpec = role === 'receiver' ? (process.env.XCLI_POLL ?? '') : '';
const pollMode = pollSpec.startsWith('periodic:') ? 'periodic'
  : pollSpec.startsWith('single:') ? 'single'
  : pollSpec.startsWith('wakedelay:') ? 'wakedelay' : '';
const pollNums = (pollSpec.split(':').slice(1).map(Number));
const pollValid = pollMode === 'periodic' ? pollNums.length === 2 && pollNums.every(n => Number.isSafeInteger(n) && n >= 0) && pollNums[0] > 0
  : pollMode !== '' ? pollNums.length === 1 && Number.isSafeInteger(pollNums[0]) && pollNums[0] >= 0 : true;
assert.ok(pollValid, 'malformed XCLI_POLL fixture schedule');
let pollFirstWakeAt = 0;
async function pollOnce() {
  const value = await tool('h2a_inbox', { action: 'read', instance });
  if (role === 'receiver' && !pollOnce.replied) {
    const message = value.envelopes.find(e => e.body?.text === PROBE && e.target?.instance === instance);
    if (message) {
      pollOnce.replied = true;
      await tool('h2a_send', { to: message.actor.instance, message: REPLY });
    }
  }
}
if (pollMode) {
  const barrierFile = join(process.env.XCLI_CELL, 'barrier-at');
  const readBarrier = () => {
    const started = Date.now();
    return (async () => {
      for (;;) {
        try { return Number(fs.readFileSync(barrierFile, 'utf8')); } catch { /* not published yet */ }
        if (Date.now() - started > 300000) throw new Error('barrier-at never published');
        await new Promise(r => setTimeout(r, 50));
      }
    })();
  };
  (async () => {
    try {
      if (pollMode === 'wakedelay') {
        for (;;) {
          if (pollFirstWakeAt) break;
          await new Promise(r => setTimeout(r, 25));
        }
        await new Promise(r => setTimeout(r, Math.max(0, pollFirstWakeAt + pollNums[0] - Date.now())));
        await pollOnce();
      } else {
        const barrierAt = await readBarrier();
        if (pollMode === 'single') {
          await new Promise(r => setTimeout(r, Math.max(0, barrierAt + pollNums[0] - Date.now())));
          await pollOnce();
        } else {
          const [period, phase] = pollNums;
          for (let k = 0; ; k++) {
            await new Promise(r => setTimeout(r, Math.max(0, barrierAt + phase + k * period - Date.now())));
            await pollOnce();
          }
        }
      }
    } catch { process.exit(73); }
  })();
}
if (scriptJson) {
  process.stdout.write(`Simulated ${profile} model\r\nReady · ${process.cwd()}\r\n${profile === 'codex' ? '›' : '❯'} \r\n`);
  await runScriptedPeer(JSON.parse(scriptJson));
  await new Promise(() => {});
}
process.stdin.setRawMode(true);
process.stdin.resume();
let input = '', processing = Promise.resolve();
process.stdin.on('data', bytes => {
  input += bytes.toString().replace(/\x1b\[20[01]~/g, '');
  let index;
  while ((index = input.search(/[\r\n]/)) !== -1) {
    const line = input.slice(0, index);
    input = input.slice(index + 1);
    if (!line) continue;
    if (process.env.XCLI_DROP_WAKE === '1') continue;
    if (pollMode === 'wakedelay') {
      if (!pollFirstWakeAt && line.includes('[h2a-wake reason=inbox ')) pollFirstWakeAt = Date.now();
      continue;
    }
    if (pollMode) continue; // periodic/single fixtures ignore the wake entirely
    processing = processing.then(async () => {
      const parsed = parseSignedDriveInstruction(line);
      assert.ok(parsed && parsed.payload.to === instance, 'wake must address this exact identity');
      const verified = verifySignedDriveInstruction(line, {
        resolvePublicKeys: name => store.listInstanceKeys(name), guard, now: Date.now(),
      });
      assert.equal(verified.ok, true, 'simulated model must reject unsigned or replayed wakes');
      assert.ok(parsed.payload.instruction.includes('[h2a-wake reason=inbox '));
      if (role === 'receiver') {
        try {
          const dir = join(process.env.XCLI_CELL, 'wake-lines');
          fs.mkdirSync(dir, { recursive: true });
          fs.appendFileSync(join(dir, 'receiver.log'), line + '\n');
        } catch { /* cell-private instrumentation must never break the model path */ }
      }
      const value = await tool('h2a_inbox', { action: 'read', instance });
      if (role === 'receiver') {
        const message = value.envelopes.find(e => e.body?.text === PROBE && e.target?.instance === instance);
        assert.ok(message, 'wake must expose the actual probe envelope');
        // V3 §3.2 models a receiver that consumes the probe (read then pop)
        // before replying. XCLI_SIM_POP=1 only; the wake proof must survive
        // this authorized consumption via the delivery witness.
        if (process.env.XCLI_SIM_POP === '1') {
          await tool('h2a_inbox', { action: 'pop', instance, envelopeId: message.id });
        }
        await tool('h2a_send', { to: message.actor.instance, message: REPLY });
      }
    }).catch(() => process.exit(73));
  }
});
if (role === 'sender') {
  const target = /to exactly ([^,\s]+), message exactly/.exec(prompt)?.[1];
  assert.ok(target && target !== instance, 'sender and receiver must have distinct identities');
  await tool('h2a_send', { to: target, message: PROBE });
}
process.stdout.write(`Simulated ${profile} model\r\nReady · ${process.cwd()}\r\n${profile === 'codex' ? '›' : '❯'} \r\n`);
mcp.once('exit', () => { if (!stopping) process.exit(74); });
