#!/usr/bin/env node
import fs from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { appendRecord, canonical, findGrant, inside, options, stateDir } from './workspace-scope-state.mjs';
import { branchBump, classify, patchBump, prBump, publishedBump, repository } from './workspace-scope-shell.mjs';

let context, host = 'claude';
const quoteShell = value => "'" + value.replace(/'/g, "'\\''") + "'";
function literal(value) {
  if (/^"(?:[^"\\]|\\.)*"$/.test(value)) return JSON.parse(value);
  if (/^'(?:[^'\\]|\\.)*'$/.test(value)) return value.slice(1, -1).replace(/\\(['\\])/g, '$1');
  throw new Error('Dynamic command envelope');
}
function fields(source) {
  const result = {}; let start = 1, depth = 0, quote = '', escaped = false;
  for (let i = 1; i < source.length; i++) {
    const ch = source[i];
    if (escaped) { escaped = false; continue; }
    if (quote) { if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if ('"\'`'.includes(ch)) { quote = ch; continue; }
    if ('{[('.includes(ch)) depth++;
    if ('}])'.includes(ch)) depth--;
    if (ch === ',' && depth === 0 || depth === -1) {
      const pair = source.slice(start, i).match(/^\s*(?:"(\w+)"|(\w+))\s*:\s*([\s\S]*)$/);
      if (pair) result[pair[1] ?? pair[2]] = pair[3].trim();
      start = i + 1;
      if (depth === -1) return { result, end: i + 1 };
    }
  }
  throw new Error('Unclosed command envelope');
}
function refuse(code, request = {}, detail = '') {
  const reason = `[H2A_SCOPE:${code}] ${request.action ?? 'Tool action'} refused. Hand this action to the owning conductor; only an exact recorded owner grant can authorize an exception.${detail ? ' ' + detail : ''}`;
  let auditCode = code;
  try { appendRecord(context.workspace, 'audit.jsonl', { at: new Date().toISOString(), type: 'refusal',
    workspace: context.workspace, session: context.session, ...request, code }); }
  catch { auditCode = 'AUDIT_UNAVAILABLE'; }
  process.stderr.write(reason + (auditCode !== code ? ' Audit unavailable; action remains refused.' : '') + '\n');
  process.stdout.write(JSON.stringify({ decision: host === 'vibe' ? 'deny' : 'block', code: auditCode, reason,
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(host === 'vibe' ? 0 : 2);
}
try {
  const args = options(process.argv.slice(2)); host = args.host ?? host;
  // Installers pin --workspace. Packaged plugins use host-owned startup env/cwd,
  // never payload cwd or a command's env assignments as session authority.
  const workspace = canonical(args.workspace ?? process.env.CLAUDE_PROJECT_DIR ?? process.env.CODEX_WORKSPACE_ROOT ?? process.cwd());
  context = { workspace, session: args.session ?? process.env.H2A_SCOPE_SESSION ?? '', ownerKey: args['owner-key'], ...repository(workspace) };
  let raw = '';
  for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 2_000_000) refuse('UNVERIFIABLE', {}, 'Hook payload too large.'); }
  const payload = JSON.parse(raw || '{}');
  // Host session id selects a grant, but cannot redefine the workspace/key.
  context.session ||= payload.session_id ?? payload.sessionId ?? payload.thread_id ?? '';
  if (!args.workspace) {
    if (!context.session) refuse('UNVERIFIABLE', {}, 'Missing host session identity.');
    if (args['initialize-session'] === 'true') {
      appendRecord(workspace, 'sessions.jsonl', { session: context.session, workspace, at: new Date().toISOString() });
      process.exit(0);
    }
    let bound = false;
    try {
      bound = fs.readFileSync(resolve(stateDir(workspace), 'sessions.jsonl'), 'utf8').trim().split('\n')
        .some(line => { const row = JSON.parse(line); return row.session === context.session && row.workspace === workspace; });
    } catch { /* Missing binding refuses; foreign cwd cannot become a new workspace. */ }
    if (!bound) refuse('UNVERIFIABLE', {}, 'No SessionStart binding in this workspace; reload the session plugin.');
  }
  let input = payload.tool_input ?? payload.arguments ?? {};
  if (typeof input === 'string' && !/patch|exec$/.test(payload.tool_name ?? '')) {
    try { input = JSON.parse(input); } catch { /* raw custom tool input */ }
  }
  const targetCwd = canonical(resolve(workspace, input.workdir ?? input.cwd ?? payload.cwd ?? workspace));
  context.toolEnv = input.env && typeof input.env === 'object' ? input.env : {};
  const requests = [];
  const envelopePatches = [];
  const envelope = typeof input === 'string' ? input : input.code;
  if (/^(?:functions\.)?exec$/.test(payload.tool_name ?? '') && typeof envelope === 'string') {
    // Extract only literal commands from the JS orchestration envelope. Never
    // evaluate agent JS. Dynamic shell/tool expressions are unverifiable.
    const calls = [...envelope.matchAll(/\bexec_command\s*\(\s*(?=\{)/g)];
    for (const match of calls) {
      const { result } = fields(envelope.slice(match.index + match[0].length));
      const command = literal(result.cmd ?? result.command ?? '');
      const cwd = result.workdir ?? result.cwd;
      const env = result.env ? Object.fromEntries(Object.entries(fields(result.env).result).map(([k, v]) => [k, literal(v)])) : {};
      requests.push(...classify(command, cwd ? canonical(resolve(targetCwd, literal(cwd))) : targetCwd, { ...context, toolEnv: env }));
    }
    const patchCalls = [...envelope.matchAll(/\bapply_patch\s*\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\)/gs)];
    envelopePatches.push(...patchCalls.map(match => literal(match[1])));
    if ([...envelope.matchAll(/\bapply_patch\s*\(/g)].length !== patchCalls.length ||
      [...envelope.matchAll(/\bexec_command\s*\(/g)].length !== calls.length)
      requests.push({ action: 'shell.dynamic', code: 'UNVERIFIABLE', repo: context.repo, ref: '' });
  }
  let command = input.command ?? input.cmd;
  if (Array.isArray(command)) command = command.map(quoteShell).join(' ');
  else if (typeof command === 'string' && Array.isArray(input.args)) command = [command, ...input.args].map(quoteShell).join(' ');
  if (typeof command === 'string') requests.push(...classify(command, targetCwd, context));
  // Codex apply_patch accepts a string; Claude uses file_path + strings/content.
  const edits = [];
  if (typeof input.file_path === 'string' || typeof input.path === 'string') {
    if (/edit|write|patch|create|replace/i.test(payload.tool_name ?? '')) {
      const path = canonical(resolve(targetCwd, input.file_path ?? input.path));
      let old = ''; try { old = fs.readFileSync(path, 'utf8'); } catch { /* new file */ }
      const content = input.content ?? (typeof input.old_string === 'string' ? old.replace(input.old_string, input.new_string ?? '') : old);
      edits.push({ path, old, content });
    }
  }
  for (const patch of [typeof input === 'string' && !envelopePatches.length ? input : input.patch ?? input.input, ...envelopePatches]) {
    if (typeof patch !== 'string') continue;
    for (const line of patch.split('\n')) {
      const match = line.match(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/);
      if (match) edits.push({ path: canonical(resolve(targetCwd, match[1])), patch });
    }
  }
  for (const edit of edits) {
    const repo = repository(dirname(edit.path));
    requests.push({ action: 'file.write', repo: repo.repo, ref: edit.path, foreign: !inside(workspace, edit.path) || repo.path !== context.path,
      code: inside(stateDir(workspace), edit.path) ? 'OWNER_ONLY' :
        basename(edit.path) === 'package.json' && (edit.patch ? patchBump(edit.path, edit.patch) : publishedBump(edit.old, edit.content)) ? 'VERSION_BUMP' : undefined });
  }
  function authorize(code, request) {
    const authorization = findGrant(context, { ...request,
      action: ['VERSION_BUMP', 'RELEASE_ONLY'].includes(code) ? 'release' : request.action });
    if (!authorization) refuse(code, request);
    try { appendRecord(workspace, 'audit.jsonl', { at: new Date().toISOString(), type: 'grant-used',
      workspace, session: context.session, request, authorization }); }
    catch { refuse('AUDIT_UNAVAILABLE', request); }
  }
  for (const request of requests) {
    if (request.action.startsWith('file.') && (inside(stateDir(workspace), request.ref) ||
      ['file.rm', 'file.mv', 'file.write', 'file.truncate'].includes(request.action) && inside(request.ref, stateDir(workspace)) ||
      context.ownerKey && inside(request.ref, canonical(context.ownerKey)))) request.code = 'OWNER_ONLY';
    if (request.action === 'owner.grant' || request.code === 'OWNER_ONLY') refuse('OWNER_ONLY', request);
    if (request.uncertain) refuse('UNVERIFIABLE', request);
    let code = request.foreign ? 'FOREIGN_WORKSPACE' : request.code;
    if (code) authorize(code, request);
    if (request.release) authorize('RELEASE_ONLY', request);
    if (request.checkVersions) {
      for (const revision of request.versionRefs ?? [request.revision]) {
        const bump = branchBump(request.cwd, revision);
        if (bump === undefined) refuse('UNVERIFIABLE', request, 'Cannot establish package version baseline.');
        if (bump) authorize('VERSION_BUMP', request);
      }
    }
    if (['gh.pr.merge', 'gh.pr.ready'].includes(request.action)) {
      const bump = prBump(request);
      if (bump === undefined) refuse('UNVERIFIABLE', request, 'Cannot inspect the PR diff.');
      if (bump) authorize('VERSION_BUMP', request);
    }
  }
  if (host === 'vibe') process.stdout.write('{"decision":"allow"}');
} catch (error) {
  if (!context) context = { workspace: process.cwd(), session: '' };
  refuse('UNVERIFIABLE', {}, error instanceof SyntaxError ? 'Malformed hook input.' : 'Scope could not be verified.');
}
