#!/usr/bin/env node
import fs from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { appendRecord, canonical, findGrant, inside, options, readRecords, stateDir } from './workspace-scope-state.mjs';
import { branchBump, classify, git, patchBump, prBump, publishedBump, repository } from './workspace-scope-shell.mjs';

let context, host = 'claude';
const quoteShell = value => "'" + value.replace(/'/g, "'\\''") + "'";
function literal(value) {
  if (/^"(?:[^"\\]|\\.)*"$/.test(value)) return JSON.parse(value);
  if (/^'(?:[^'\\]|\\.)*'$/.test(value)) return value.slice(1, -1).replace(/\\(['\\])/g, '$1');
  if (/^`(?:[^`\\]|\\.)*`$/.test(value) && !value.includes('${')) {
    return value.slice(1, -1).replace(/\\(n|r|t|`|\\)/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' }[c] ?? c));
  }
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
      else if (source.slice(start, i).trim()) throw new Error('Unsupported command object member');
      start = i + 1;
      if (depth === -1) return { result, end: i + 1 };
    }
  }
  throw new Error('Unclosed command envelope');
}
function refuse(code, request = {}, detail = '') {
  const selectors = { repo: request.repo ?? '', action: request.action ?? '', ref: request.ref ?? '', session: context.session ?? '' };
  const reason = `[H2A_SCOPE:${code}] ${request.action ?? 'Tool action'} refused. ${JSON.stringify(selectors)} Hand this action to the owning conductor; only an exact recorded owner grant can authorize an exception.${detail ? ' ' + detail : ''}`;
  let auditCode = code;
  try { appendRecord(context.workspace, 'audit.jsonl', { at: new Date().toISOString(), type: 'refusal',
    workspace: context.workspace, session: context.session, ...request, code }); }
  catch { auditCode = 'AUDIT_UNAVAILABLE'; }
  process.stderr.write(reason + (auditCode !== code ? ' Audit unavailable; action remains refused.' : '') + '\n');
  process.stdout.write(JSON.stringify({ ...(host === 'muse' ? {} : { decision: ['vibe', 'agy'].includes(host) ? 'deny' : 'block' }), code: auditCode, reason, ...selectors,
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(['vibe', 'agy'].includes(host) ? 0 : 2);
}
try {
  const args = options(process.argv.slice(2)); host = args.host ?? host;
  // Installers pin --workspace. Packaged plugins use host-owned startup env/cwd,
  // never payload cwd or a command's env assignments as session authority.
  const hookCwd = canonical(process.cwd());
  let workspace = canonical(args.workspace ?? process.env.CLAUDE_PROJECT_DIR ?? process.env.CODEX_WORKSPACE_ROOT ?? hookCwd);
  context = { workspace, session: args.session ?? process.env.H2A_SCOPE_SESSION ?? '', ownerKey: args['owner-key'] ?? process.env.H2A_SCOPE_OWNER_KEY, ...repository(workspace) };
  let raw = '';
  for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 2_000_000) refuse('UNVERIFIABLE', {}, 'Hook payload too large.'); }
  const payload = JSON.parse(raw || '{}');
  // Host session id selects a grant, but cannot redefine the workspace/key.
  context.session ||= payload.session_id ?? payload.sessionId ?? payload.thread_id ?? payload.conversationId ?? '';
  const sessionStore = args['session-store'] ? canonical(args['session-store']) : undefined;
  if (sessionStore) {
    if (!context.session) refuse('UNVERIFIABLE', {}, 'Missing native session identity.');
    const bindings = readRecords(sessionStore, 'sessions.jsonl').filter(row => row.session === context.session);
    if (!bindings.length) appendRecord(sessionStore, 'sessions.jsonl', { session: context.session, workspace, at: new Date().toISOString() });
    else {
      if (new Set(bindings.map(row => row.workspace)).size !== 1) refuse('UNVERIFIABLE', {}, 'Conflicting native session bindings.');
      workspace = canonical(bindings[0].workspace);
      context = { ...context, workspace, ...repository(workspace) };
    }
  }
  // Keep the first observed baseline for this native session. Mutable local
  // main/origin/main refs cannot erase a package bump already in its branch.
  const baselines = readRecords(workspace, 'baselines.jsonl');
  const baseline = baselines.find(row => row.session === context.session && row.path === context.path)?.base ??
    git(context.path, ['merge-base', 'origin/main', 'HEAD']) ?? git(context.path, ['merge-base', 'main', 'HEAD']);
  if (baseline && !baselines.some(row => row.session === context.session && row.path === context.path))
    appendRecord(workspace, 'baselines.jsonl', { session: context.session, path: context.path, base: baseline });
  if (!args.workspace && !sessionStore) {
    if (!context.session) refuse('UNVERIFIABLE', {}, 'Missing host session identity.');
    if (args['initialize-session'] === 'true') {
      appendRecord(workspace, 'sessions.jsonl', { session: context.session, workspace, at: new Date().toISOString() });
      process.exit(0);
    }
    let bound = false;
    try {
      bound = readRecords(workspace, 'sessions.jsonl').some(row => row.session === context.session && row.workspace === workspace);
    } catch { /* Missing binding refuses; foreign cwd cannot become a new workspace. */ }
    if (!bound) refuse('UNVERIFIABLE', {}, 'No SessionStart binding in this workspace; reload the session plugin.');
  }
  const toolName = payload.tool_name ?? payload.toolCall?.name ?? '';
  let input = payload.tool_input ?? payload.arguments ?? payload.toolCall?.args ?? {};
  if (typeof input === 'string' && !/patch|exec$/.test(toolName)) {
    try { input = JSON.parse(input); } catch { /* raw custom tool input */ }
  }
  // Antigravity's native camelCase tool payload (workspacePaths is never authority).
  if (host === 'agy') input = { ...input, command: input.command ?? input.CommandLine,
    cwd: input.cwd ?? input.Cwd, file_path: input.file_path ?? input.TargetFile,
    content: input.content ?? input.CodeContent, old_string: input.old_string ?? input.TargetContent,
    new_string: input.new_string ?? input.ReplacementContent,
    replace_all: input.replace_all ?? input.AllowMultiple,
    edits: input.edits ?? input.ReplacementChunks?.map(edit => ({ old_string: edit.TargetContent, new_string: edit.ReplacementContent,
      replace_all: edit.AllowMultiple })) };
  const targetCwd = canonical(resolve(workspace, input.workdir ?? input.cwd ?? payload.cwd ?? (sessionStore ? hookCwd : workspace)));
  context.toolEnv = input.env && typeof input.env === 'object' ? input.env : {};
  const requests = [];
  const envelopePatches = [];
  const envelope = typeof input === 'string' ? input : input.code;
  if (/^(?:functions\.)?exec$/.test(toolName) && typeof envelope === 'string') {
    // Extract only literal commands from the JS orchestration envelope. Never
    // evaluate agent JS. Dynamic shell/tool expressions are unverifiable.
    const execName = /(?:\bexec_command|\[\s*["']exec_command["']\s*\])\s*\(\s*/g;
    const calls = [...envelope.matchAll(execName)];
    for (const match of calls) {
      const { result } = fields(envelope.slice(match.index + match[0].length));
      const command = literal(result.cmd ?? result.command ?? '');
      const cwd = result.workdir ?? result.cwd;
      const env = result.env ? Object.fromEntries(Object.entries(fields(result.env).result).map(([k, v]) => [k, literal(v)])) : {};
      requests.push(...classify(command, cwd ? canonical(resolve(targetCwd, literal(cwd))) : targetCwd, { ...context, toolEnv: env }));
    }
    const patchCalls = [...envelope.matchAll(/(?:\bapply_patch|\[\s*["']apply_patch["']\s*\])\s*\(\s*/g)];
    for (const match of patchCalls) {
      const rest = envelope.slice(match.index + match[0].length);
      if (rest.startsWith('{')) envelopePatches.push(literal(fields(rest).result.patch ?? ''));
      else {
        const value = rest.match(/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)\s*\)/s);
        envelopePatches.push(literal(value?.[1] ?? ''));
      }
    }
    if ([...envelope.matchAll(/\b(?:exec_command|apply_patch)\b/g)].length !== calls.length + patchCalls.length ||
      /\btools\s*\[/.test(envelope.replace(/\[\s*["'](?:exec_command|apply_patch)["']\s*\]\s*\(/g, '(')))
      requests.push({ action: 'shell.dynamic', code: 'UNVERIFIABLE', repo: context.repo, ref: '' });
  }
  let command = input.command ?? input.cmd;
  if (Array.isArray(command)) command = command.map(quoteShell).join(' ');
  else if (typeof command === 'string' && Array.isArray(input.args)) command = [command, ...input.args].map(quoteShell).join(' ');
  if (typeof command === 'string') requests.push(...classify(command, targetCwd, context));
  // Codex apply_patch accepts a string; Claude uses file_path + strings/content.
  const edits = [];
  if (typeof input.file_path === 'string' || typeof input.path === 'string') {
    if (/edit|write|patch|create|replace/i.test(toolName)) {
      const path = canonical(resolve(targetCwd, input.file_path ?? input.path));
      let old = ''; try { old = fs.readFileSync(path, 'utf8'); } catch { /* new file */ }
      let content = input.content ?? old;
      for (const edit of input.edits ?? [input]) if (typeof edit.old_string === 'string')
        content = edit.replace_all ? content.split(edit.old_string).join(edit.new_string ?? '') : content.replace(edit.old_string, edit.new_string ?? '');
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
      context.ownerKey && inside(request.ref, canonical(context.ownerKey)) ||
      sessionStore && (inside(stateDir(sessionStore), request.ref) || inside(request.ref, stateDir(sessionStore))))) request.code = 'OWNER_ONLY';
    if (request.action === 'owner.grant' || request.code === 'OWNER_ONLY') refuse('OWNER_ONLY', request);
    if (request.uncertain) refuse('UNVERIFIABLE', request);
    if (request.foreign) authorize('FOREIGN_WORKSPACE', request);
    if (request.code) authorize(request.code, request);
    if (request.release) authorize('RELEASE_ONLY', request);
    if (request.checkVersions) {
      for (const revision of request.versionRefs ?? [request.revision]) {
        const bump = branchBump(request.cwd, revision, repository(request.cwd).path === context.path ? baseline : undefined);
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
  if (['vibe', 'agy'].includes(host)) process.stdout.write('{"decision":"allow"}');
} catch (error) {
  if (!context) context = { workspace: process.cwd(), session: '' };
  refuse('UNVERIFIABLE', {}, error instanceof SyntaxError ? 'Malformed hook input.' : 'Scope could not be verified.');
}
