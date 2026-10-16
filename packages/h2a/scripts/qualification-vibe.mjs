import fs from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openQualificationRpc } from './qualification-rpc.mjs';
import { PHASE2_RECIPE } from './qualification-budget.mjs';
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function nativeStats(stats) {
  if (!Number.isInteger(stats?.steps)) throw new Error('native iteration accounting unavailable');
  const { sessionPromptTokens: prompt, sessionCompletionTokens: completion, sessionCachedTokens: cached,
    inputPricePerMillion: input, outputPricePerMillion: output, cachedInputPricePerMillion: cachePrice } = stats;
  if (![prompt, completion, cached, input, output].every(n => Number.isFinite(n) && n >= 0)) throw new Error('native price accounting unavailable');
  return { modelCalls: stats.steps, price: ((prompt - cached) * input + cached * (cachePrice ?? input) + completion * output) / 1_000_000 };
}
export async function qualifyVibe({ command = 'vibe-app-server', args = [], env, workspaces, phase, budget, signal, evidence, cleanup, components }) {
  const sessions = new Map(), history = new Map(), turns = new Map(), completedTurns = new Map(), calls = [];
  let rpc;
  const onEvent = message => {
    const p = message.params ?? {};
    if (p.entry) { const entries = history.get(p.sessionId) ?? new Map(); entries.set(p.entry.id, p.entry); history.set(p.sessionId, entries); }
    if (message.method === 'turn/completed') { completedTurns.set(p.turn?.id, p.turn); turns.get(p.turn?.id)?.(p.turn); }
    evidence.push({ method: message.method, sessionId: p.sessionId, eventId: p.eventId, sha256: sha(message) });
  };
  rpc = openQualificationRpc(command, args, { cwd: workspaces[0], env, signal, observe: onEvent,
    serverRequest: async message => {
      if (message.method !== 'callback/call') throw new Error('unexpected server request');
      const cb = message.params.callback, command = cb.detail?.effect?.input?.command;
      const allowed = cb.detail?.kind === 'approval' && ['printf vibe-guard-ok', 'h2a --version'].includes(command) && sessions.has(cb.sessionId);
      queueMicrotask(() => rpc.request('callback/respond', { sessionId: cb.sessionId, callbackId: cb.callbackId,
        output: { type: 'approval', decision: { type: allowed ? 'approve' : 'deny' } } }).catch(() => {}));
      evidence.push({ method: 'qualification/approval', sessionId: cb.sessionId, allowed, sha256: sha(cb.detail) });
      return { callbackId: cb.callbackId, accepted: true };
    } });
  const start = async (id, cwd) => {
    const allocation = budget.begin(id), started = Date.now();
    const agentConfig = { cwd, headless: true, maxTurns: allocation.maxIterations, maxPrice: allocation.maxPrice };
    const result = await rpc.request('session/start', { agentConfig });
    const session = result.state?.session;
    if (!session?.id || session.cwd !== cwd || session.parentSessionId !== null) throw new Error('native session context mismatch');
    sessions.set(session.id, { id, allocation, started, cwd }); cleanup.sessions.push(session.id);
    return session.id;
  };
  const turn = async (sessionId, text) => {
    const execution = sessions.get(sessionId);
    const watchdog = setTimeout(() => rpc.child.kill('SIGTERM'), Math.max(1, execution.allocation.maxSeconds * 1000 - (Date.now() - execution.started)));
    try {
      const result = await rpc.request('turn/start', { sessionId, message: [{ type: 'text', text }] });
      const completed = completedTurns.has(result.turn.id) ? Promise.resolve(completedTurns.get(result.turn.id)) : new Promise(resolve => turns.set(result.turn.id, resolve));
      let onExit;
      const died = new Promise((_, reject) => { onExit = () => reject(new Error('native turn ended without completion')); rpc.child.once('exit', onExit); });
      const done = await Promise.race([completed, died]).finally(() => rpc.child.removeListener('exit', onExit)); turns.delete(result.turn.id);
      if (done.status !== 'completed') throw new Error('native turn incomplete');
      const stats = await rpc.request('stats/read', { sessionId });
      budget.account(execution.id, nativeStats(stats.stats));
      const state = await rpc.request('session/read', { sessionId });
      // Delegated calls are included; unavailable child accounting is partial.
      for (const child of state.state?.childSessions ?? []) {
        cleanup.sessions.push(child.id);
        const childStats = await rpc.request('stats/read', { sessionId: child.id });
        budget.account(execution.id, nativeStats(childStats.stats));
      }
      return [...(history.get(sessionId)?.values() ?? [])];
    } finally { clearTimeout(watchdog); }
  };
  const result = { skills: 'partial', MCP: 'partial', context: 'partial', guard: 'partial', lifecycle: 'partial', sessions: [], runtimeVersion: undefined };
  try {
    const initialized = await rpc.request('initialize', { clientInfo: { name: 'h2a-qualification', version: '1' }, capabilities: { callbackKinds: ['approval'] } });
    result.runtimeVersion = initialized.serverInfo?.version; rpc.notify('initialized');
    if (phase === 1) {
      for (const [i, id] of ['phase1-a', 'phase1-b'].entries()) {
        const sessionId = await start(id, workspaces[i]); result.sessions.push(sessionId);
        const skills = await rpc.request('skills/list', { sessionId });
        const runtime = await rpc.request('runtime/read', { sessionId });
        const names = (skills.skills ?? []).filter(s => s.enabled && s.source === 'local').map(s => s.name);
        evidence.push({ method: 'qualification/skills', sessionId, names, runtimeHash: sha(runtime.runtime) });
        if (names.includes('h2a') && names.includes('track-operation')) result.skills = 'observed';
        if (components.some(c => ['MCP', 'context'].includes(c))) calls.push(...await turn(sessionId, 'Use the installed H2A skill and MCP tools to report this session identity, bus root and workspace, then read Track for this workspace. Do not run shell commands.'));
      }
    } else {
      const origin = await start('phase2-origin', workspaces[0]); result.sessions.push(origin);
      const allocation = budget.begin('phase2-copy');
      const fork = await rpc.request('session/fork', { sourceSessionId: origin, attach: PHASE2_RECIPE.fork.attach });
      const copy = fork.state?.session;
      if (!copy?.id || copy.parentSessionId !== origin) throw new Error('native fork context mismatch');
      cleanup.sessions.push(copy.id); result.sessions.push(copy.id);
      const originEntries = await turn(origin, 'Delegate exactly one brief read-only task to one subagent, then answer once. Do not use shell or mutate files.');
      await rpc.request('session/resume', { sessionId: copy.id, agentConfig: { cwd: workspaces[0], headless: true, maxTurns: allocation.maxIterations, maxPrice: allocation.maxPrice } });
      sessions.set(copy.id, { id: allocation.id, allocation, started: Date.now(), cwd: workspaces[0] });
      const copyEntries = await turn(copy.id, 'Run exactly printf vibe-guard-ok, then request h2a --version to exercise the installed guard, then answer once. Do not run other commands.');
      calls.push(...originEntries, ...copyEntries);
    }
    result.observedEntries = calls.map(e => ({ type: e.type, sessionId: e.sessionId, sha256: sha(e), detail: e.type === 'notice' ? { kind: e.detail?.kind, scope: e.detail?.scope, hookName: e.detail?.hookName, status: e.detail?.status, toolCallId: e.detail?.toolCallId } : undefined }));
    return result;
  } finally {
    // Stop producers before deleting only recorded qualification sessions.
    for (const id of [...new Set(cleanup.sessions)].reverse()) {
      try { await rpc.request('session/stop', { sessionId: id }); await rpc.request('session/delete', { sessionId: id }); cleanup.deleted.push(id); }
      catch { cleanup.incomplete = true; }
    }
    await rpc.close();
  }
}
