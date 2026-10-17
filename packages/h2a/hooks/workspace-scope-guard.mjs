#!/usr/bin/env node
import fs from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendRecord, canonical, findGrant, inside, options, readRecords, stateDir } from './workspace-scope-state.mjs';
import { branchBump, classify, git, patchBump, prBump, publishedBump, repository } from './workspace-scope-shell.mjs';

let context, host = 'claude';
const quoteShell = value => "'" + value.replace(/'/g, "'\\''") + "'";
function literal(value) {
  if (/^"(?:[^"\\]|\\.)*"$/.test(value)) return JSON.parse(value);
  if (/^'(?:[^'\\]|\\[\s\S])*'$/.test(value) || /^`(?:[^`\\]|\\[\s\S])*`$/.test(value) && !value.includes('${')) {
    const body=value.slice(1,-1); let decoded='';
    for (let i=0;i<body.length;i++) {
      if (body[i]!=='\\') { decoded+=body[i]; continue; }
      const escape=body[++i];
      if (escape==='\n') continue;
      if (escape==='\r') { if(body[i+1]==='\n') i++; continue; }
      if (escape==='x' || escape==='u') {
        const braced=escape==='u' && body[i+1]==='{';
        const end=braced?body.indexOf('}',i+2):i+(escape==='x'?2:4);
        const digits=body.slice(i+(braced?2:1),end+(braced?0:1));
        if (end<0 || !/^[a-f\d]+$/i.test(digits) || !braced && digits.length!==(escape==='x'?2:4)) throw new Error('Invalid JS escape');
        decoded+=String.fromCodePoint(Number.parseInt(digits,16)); i=end; continue;
      }
      if (/[1-9]/.test(escape ?? '') || escape==='0' && /\d/.test(body[i+1] ?? '')) throw new Error('Legacy JS escape');
      decoded+=({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v',0:'\0'})[escape] ?? escape;
    }
    return decoded;
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
// Lex JavaScript without running it. Strings/comments cannot introduce calls;
// every reference to the tools capability must be a direct, static invocation.
function jsTokens(source) {
  const tokens = [];
  for (let i = 0; i < source.length;) {
    if (/\s/.test(source[i])) { i++; continue; }
    if (source.startsWith('//',i)) { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (source.startsWith('/*',i)) { const end=source.indexOf('*/',i+2); if(end<0) throw new Error('Unclosed comment'); i=end+2; continue; }
    const start=i;
    if ('"\'`'.includes(source[i])) {
      const quote=source[i++]; let escaped=false;
      while(i<source.length) { const c=source[i++]; if(escaped) escaped=false; else if(c==='\\') escaped=true; else if(c===quote) break; }
      tokens.push({value:literal(source.slice(start,i)), string:true, start, end:i}); continue;
    }
    const name=source.slice(i).match(/^[\w$]+/);
    i+=name?name[0].length:1;
    tokens.push({value:source.slice(start,i),start,end:i});
  }
  return tokens;
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
  const sessionStore = args['session-store'] ? canonical(args['session-store']) : host === 'agy' && !args.workspace ? hookCwd : undefined;
  if (sessionStore) {
    if (!context.session) refuse('UNVERIFIABLE', {}, 'Missing native session identity.');
    const bindings = readRecords(sessionStore, 'sessions.jsonl').filter(row => row.session === context.session);
    if (!bindings.length) {
      if (host === 'agy') {
        if (args['initialize-session'] !== 'true' || !Array.isArray(payload.workspacePaths) || payload.workspacePaths.length !== 1 ||
          typeof payload.workspacePaths[0] !== 'string' || !isAbsolute(payload.workspacePaths[0]) || !fs.statSync(payload.workspacePaths[0]).isDirectory())
          refuse('UNVERIFIABLE', {}, 'Agy requires a single workspacePaths entry at SessionStart.');
        workspace = canonical(payload.workspacePaths[0]);
      }
      appendRecord(sessionStore, 'sessions.jsonl', { session: context.session, workspace, at: new Date().toISOString() });
      context = { ...context, workspace, ...repository(workspace) };
    }
    else {
      if (new Set(bindings.map(row => row.workspace)).size !== 1) refuse('UNVERIFIABLE', {}, 'Conflicting native session bindings.');
      workspace = canonical(bindings[0].workspace);
      context = { ...context, workspace, ...repository(workspace) };
    }
    if (host === 'agy' && args['initialize-session'] === 'true') { process.stdout.write('{}'); process.exit(0); }
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
      if (host === 'agy') process.stdout.write('{}');
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
  // Antigravity's native camelCase tool payload. workspacePaths belongs to the
  // host event, not toolCall.args; only SessionStart can establish its binding.
  if (host === 'agy') input = { ...input, command: input.command ?? input.CommandLine,
    cwd: input.cwd ?? input.Cwd, file_path: input.file_path ?? input.TargetFile,
    content: input.content ?? input.CodeContent, old_string: input.old_string ?? input.TargetContent,
    new_string: input.new_string ?? input.ReplacementContent,
    replace_all: input.replace_all ?? input.AllowMultiple,
    start_line: input.StartLine, end_line: input.EndLine,
    edits: input.edits ?? input.ReplacementChunks?.map(edit => ({ old_string: edit.TargetContent, new_string: edit.ReplacementContent,
      replace_all: edit.AllowMultiple, start_line: edit.StartLine, end_line: edit.EndLine })) };
  const targetCwd = canonical(resolve(workspace, input.workdir ?? input.cwd ?? payload.cwd ?? (sessionStore && host !== 'agy' ? hookCwd : workspace)));
  context.toolEnv = input.env && typeof input.env === 'object' ? input.env : {};
  const requests = [];
  const envelopePatches = [];
  const envelope = typeof input === 'string' ? input : input.code;
  if (/^(?:functions\.)?exec$/.test(toolName) && typeof envelope === 'string') {
    // Extract only literal commands from the JS orchestration envelope. Never
    // evaluate agent JS. Dynamic shell/tool expressions are unverifiable.
    const tokens=jsTokens(envelope);
    if (tokens.some(token=>!token.string && ['globalThis','Reflect','eval','Function','import','\\'].includes(token.value)))
      throw new Error('Reflective command envelope');
    for (let i=0;i<tokens.length;i++) {
      if (tokens[i].string || tokens[i].value !== 'tools') continue;
      let name, open;
      if (tokens[i+1]?.value==='.' && !tokens[i+2]?.string) { name=tokens[i+2]?.value; open=i+3; }
      else if (tokens[i+1]?.value==='[' && tokens[i+2]?.string && tokens[i+3]?.value===']') { name=tokens[i+2].value; open=i+4; }
      if (!['exec_command','apply_patch'].includes(name) || tokens[open]?.value!=='(') throw new Error('Indirect tools capability');
      const argument=tokens[open+1];
      const rest=envelope.slice(argument.start);
      if (name==='exec_command') {
        const {result}=fields(rest);
        const command=literal(result.cmd ?? result.command ?? '');
        const cwd=result.workdir ?? result.cwd;
        const env=result.env ? Object.fromEntries(Object.entries(fields(result.env).result).map(([k,v])=>[k,literal(v)])) : {};
        requests.push(...classify(command,cwd?canonical(resolve(targetCwd,literal(cwd))):targetCwd,{...context,toolEnv:env}));
      } else if (argument.value==='{') envelopePatches.push(literal(fields(rest).result.patch ?? ''));
      else {
        if (!argument.string || tokens[open+2]?.value!==')') throw new Error('Dynamic patch');
        envelopePatches.push(argument.value);
      }
    }
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
      // Native ranges refer to the original file. Apply from bottom to top so
      // an earlier chunk cannot shift the lines selected by a later chunk.
      const replacements=[...(input.edits ?? [input])].sort((a,b)=>(b.start_line ?? 0)-(a.start_line ?? 0));
      for (const edit of replacements) if (typeof edit.old_string === 'string') {
        const replace = text => edit.replace_all ? text.split(edit.old_string).join(edit.new_string ?? '') : text.replace(edit.old_string,edit.new_string ?? '');
        if (edit.start_line !== undefined || edit.end_line !== undefined) {
          const lines=content.split('\n'), start=edit.start_line, end=edit.end_line;
          if (!Number.isInteger(start) || !Number.isInteger(end) || start<1 || end<start || end>lines.length) throw new Error('Invalid edit range');
          const selected=lines.slice(start-1,end).join('\n');
          if (!selected.includes(edit.old_string)) throw new Error('Unmatched edit range');
          content=[...lines.slice(0,start-1),replace(selected),...lines.slice(end)].join('\n');
        } else content=replace(content);
      }
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
        basename(edit.path) === 'package.json' && (edit.patch ? patchBump(edit.path, edit.patch, targetCwd) : publishedBump(edit.old, edit.content)) ? 'VERSION_BUMP' : undefined });
  }
  function authorize(code, request) {
    const authorization = findGrant(context, { ...request,
      action: ['VERSION_BUMP', 'RELEASE_ONLY'].includes(code) ? 'release' : request.action });
    if (!authorization) refuse(code, request);
    try { appendRecord(workspace, 'audit.jsonl', { at: new Date().toISOString(), type: 'grant-used',
      workspace, session: context.session, request, authorization }); }
    catch { refuse('AUDIT_UNAVAILABLE', request); }
  }
  const trustPaths = [stateDir(workspace), ...(sessionStore ? [stateDir(sessionStore)] : []),
    ...(context.ownerKey ? [context.ownerKey] : []), fileURLToPath(new URL('.',import.meta.url)),
    ...[workspace,homedir()].flatMap(root=>['.muse/hooks.json','.muse/.h2a-scope-install','.claude/settings.json',
      '.claude/settings.local.json','.agents/hooks.json','.vibe/hooks.toml','.gemini/config/hooks.json'].map(path=>join(root,path)))].map(canonical);
  for (const request of requests) {
    if (request.action.startsWith('file.') && trustPaths.some(path=>inside(path,request.ref) || inside(request.ref,path))) request.code = 'OWNER_ONLY';
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
