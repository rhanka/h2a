import fs from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { openQualificationRpc } from './qualification-rpc.mjs';
import { nativeStats } from './qualification-vibe.mjs';
import { inspectSkillEntries, inspectMcpEntries } from './qualification-oracles.mjs';
export async function qualifyVibeProbe({ command = 'vibe', commandArgs = [], appServer = 'vibe-app-server', appServerArgs = [], cwd, env, tools, budget, signal, evidence, cleanup, directory, requiredResources = [], busRoot, components = ['skills', 'MCP', 'context'] }) {
  if (!tools.length || tools.some(t => /bash|shell|exec|process|terminal|code|eval/i.test(t))) throw new Error('probe requires minimal native read-only tools; execution tools forbidden');
  const allocation = budget.begin('cli-probe');
  const needsMcp = components.some(c => c === 'MCP' || c === 'context');
  const args = [...commandArgs, '-p', 'Read the installed H2A skill resources at ' + requiredResources.map(r => r.path).join(', ') +
    (needsMcp ? '. Use h2a_identity_status, h2a_session_open and track_status with level=task and baselineCommit=qualification for this workspace.' : '') + ' Do not execute commands.', '--agent', 'auto-approve', '--enabled-tools', ...tools,
    '--max-turns', String(allocation.maxIterations), '--max-price', String(allocation.maxPrice), '--output', 'streaming'];
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let raw = '', pending = '', malformed = false, error, rpc;
  const ids = new Set(), entries = [];
  const consume = line => {
    if (!line.trim()) return;
    try {
      const entry = JSON.parse(line); entries.push(entry);
      if (typeof entry.sessionId === 'string' && entry.sessionId) { ids.add(entry.sessionId); if (!cleanup.sessions.includes(entry.sessionId)) cleanup.sessions.push(entry.sessionId); }
    } catch { malformed = true; }
  };
  child.stdout.setEncoding('utf8'); child.stdout.on('data', bytes => {
    raw += bytes;
    if (raw.length > 1_048_576) { malformed = true; child.kill('SIGTERM'); return; }
    pending += bytes; let at;
    while ((at = pending.indexOf('\n')) >= 0) { consume(pending.slice(0, at)); pending = pending.slice(at + 1); }
  });
  child.stderr.on('data', () => {}); child.on('error', e => { error = e; });
  const abort = () => child.kill('SIGTERM'); signal?.addEventListener('abort', abort, { once: true });
  const deadline = Math.min(allocation.maxSeconds * 1000, budget.remaining());
  const watchdog = setTimeout(abort, deadline), force = setTimeout(() => child.kill('SIGKILL'), deadline + 2000);
  try {
    const [code] = await once(child, 'close'); consume(pending); pending = '';
    if (error || code !== 0 || malformed || ids.size !== 1) throw new Error('native CLI probe incomplete or uncorrelated');
    const [sessionId] = ids;
    rpc = openQualificationRpc(appServer, appServerArgs, { cwd, env, signal });
    await rpc.request('initialize', { clientInfo: { name: 'h2a-qualification-probe', version: '1' } }); rpc.notify('initialized');
    const state = await rpc.request('session/read', { sessionId });
    const stats = await rpc.request('stats/read', { sessionId }); budget.account('cli-probe', nativeStats(stats.stats));
    const journal = state.state?.session?.id === sessionId && Array.isArray(state.state?.history) && state.state.history.length > 0;
    const resources = inspectSkillEntries(entries, requiredResources), mcp = inspectMcpEntries(entries, sessionId, { busRoot, workspace: cwd });
    const result = { status: journal && (!components.includes('skills') || resources) && (!components.includes('MCP') || mcp.MCP) && (!components.includes('context') || mcp.context) ? 'observed' : 'partial', sessionId, journal, resources, MCP: mcp.MCP, context: mcp.context };
    evidence.push({ method: 'qualification/cli-probe', ...result, sha256: createHash('sha256').update(raw).digest('hex') }); return result;
  } finally {
    clearTimeout(watchdog); clearTimeout(force); signal?.removeEventListener('abort', abort);
    if (child.pid && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'close'); }
    consume(pending);
    // A failed CLI may create a session before emitting an entry. Never scan
    // or delete unknown sessions; retain the private cleanup lane.
    if (!ids.size || malformed) cleanup.incomplete = true;
    if (ids.size) {
      try {
        if (!rpc) { rpc = openQualificationRpc(appServer, appServerArgs, { cwd, env }); await rpc.request('initialize', { clientInfo: { name: 'h2a-qualification-cleanup', version: '1' } }); rpc.notify('initialized'); }
        for (const sessionId of ids) { await rpc.request('session/delete', { sessionId }); if (!cleanup.deleted.includes(sessionId)) cleanup.deleted.push(sessionId); }
      } catch { cleanup.incomplete = true; }
      finally { await rpc?.close(); }
    }
  }
}
