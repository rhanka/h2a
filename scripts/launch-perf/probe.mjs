// Real installed binaries, synthetic state, private host, local API witness.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lab = repo + '/.qual-tmp/lab';
const opts = JSON.parse(process.argv[2] || '{}');
if (!opts.worktree || !opts.sourceSha) throw new Error('an explicit measured worktree and source SHA are required');
const installed = opts.worktree + '/packages/h2a';
const rt = opts.worktree + '/packages/h2a-runtime/dist';
const binJs = opts.worktree + '/packages/h2a/dist/bin.js';
const { NativeTerminalClient } = await import(rt + '/native-terminal/client.js');
const label = opts.label || 'pilot-' + Date.now();
const output = lab + '/results/' + label;
fs.mkdirSync(output, { recursive: false, mode: 0o700 });
const runtime = fs.mkdtempSync((repo + '/.qual-tmp/runtime') + '/q-');
const home = output + '/home', workspace = runtime + '/workspace', bin = output + '/bin';
for (const p of [home, home + '/.claude', home + '/.config/sentropic/h2a', workspace, bin]) fs.mkdirSync(p, { recursive: true, mode: 0o700 });
fs.writeFileSync(workspace + '/CLAUDE.md', '');
execFileSync('git', ['init', '-q', workspace]);
const root = opts.fixtureRoot || lab + (opts.small ? '/small' : '/large');
if (!path.resolve(root).startsWith(repo+'/.qual-tmp/')) throw new Error('fixture root must remain inside qualification storage');
if (!fs.existsSync(root + '/.launch-perf-synthetic.json')) throw new Error('synthetic marker required');
const corpus=JSON.parse(fs.readFileSync(root+'/.launch-perf-synthetic.json'));
// Prior cohorts have been stopped. Refresh this fixed metadata workload; keep
// append-only historical logs and synthetic keys intact.
for(const name of fs.readdirSync(root+'/presence'))if(name.endsWith('.json'))fs.unlinkSync(root+'/presence/'+name);
for(let i=0;i<corpus.counts.presence;i++){
  const sessionId='synthetic-presence-'+i;
  const uuid=`00000000-${i.toString(16).padStart(4,'0')}-4000-8000-000000000000`;
  fs.writeFileSync(root+'/presence/'+sessionId+'.json',JSON.stringify({sessionId,instance:`claude:s-${i}:${uuid.replaceAll('-','').slice(0,12)}`,host:'claude',state:'live',interests:{scopes:['scope:default'],negotiations:[]},subscribedTopics:[],startedAt:'2026-01-01T00:00:00.000Z',heartbeatAt:new Date().toISOString()}),{mode:0o600});
}
if (opts.evict) execFileSync(lab + '/scripts/evict', ['registry/instances.jsonl','identity/bindings.jsonl','identity/aliases.jsonl','registry/keys.jsonl'].map(f=>root+'/'+f));
if ((opts.n || 1) > 4) {
  const reference = JSON.parse(fs.readFileSync(lab + '/results/' + opts.admission + '/result.json'));
  const begin = JSON.parse(fs.readFileSync(lab + '/results/' + opts.admission + '/events.jsonl','utf8').split('\n')[0]);
  const current = Number(fs.readFileSync('/sys/fs/cgroup'+fs.readFileSync('/proc/self/cgroup','utf8').trim().split('::')[1]+'/memory.current'));
  const projection = current + Math.max(0,reference.memory.peakBytes - begin.memoryCurrent) * opts.n / reference.opts.n;
  const cap = reference.memory.limit * .85;
  fs.writeFileSync(output+'/admission.json',JSON.stringify({reference:opts.admission,current,projection,cap}));
  if (projection > cap) throw new Error('N>4 memory projection exceeds 85% cap: '+Math.round(projection/1024**2)+' MiB');
}
const now = () => performance.timeOrigin + performance.now();
const events = [], children = [], known = new Map(), sessions = [], results = [];
const mark = (name, fields = {}) => { const e = { at: now(), name, ...fields }; events.push(e); fs.appendFileSync(output + '/events.jsonl', JSON.stringify(e) + '\n'); return e.at; };
const delay = ms => new Promise(r => setTimeout(r, ms));
const cg = '/sys/fs/cgroup' + fs.readFileSync('/proc/self/cgroup', 'utf8').trim().split('::')[1];
const limit = Number(fs.readFileSync(cg + '/memory.max'));
if (!Number.isFinite(limit) || limit > 8 * 1024 ** 3) throw new Error('<=8 GiB scope required');
let peak = 0, peakTree = 0, aborted = false, client, host;
const pressure = () => Object.fromEntries(['io', 'memory', 'cpu'].map(k => [k, fs.readFileSync('/proc/pressure/' + k, 'utf8').trim()]));
const snapshot = pid => { const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8'); const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); const f = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/); return { pid, state: f[0], start: f[19], ppid: Number(f[1]), comm: status.match(/^Name:\s+(.*)/m)?.[1], rssKiB: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0), cpuTicks: Number(f[11]) + Number(f[12]) }; };
const sample = () => {
  let total = 0; const seen = new Set();
  const visit = pid => { if (!pid || seen.has(pid)) return; seen.add(pid); try { const s = snapshot(pid); const old = known.get(pid); if (old && old.start !== s.start) return; known.set(pid, { ...s, rssPeakKiB: Math.max(old?.rssPeakKiB || 0, s.rssKiB) }); total += s.rssKiB; for (const v of fs.readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/)) visit(Number(v)); } catch {} };
  for (const c of children) visit(c.pid);
  peak = Math.max(peak, Number(fs.readFileSync(cg + '/memory.current'))); peakTree = Math.max(peakTree, total);
  if (peak > limit * .85) { aborted = true; for (const c of children) if (c.exitCode === null) c.kill('SIGTERM'); }
};
const timer = setInterval(sample, 100);
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
const stubRequests = [];
const stub = http.createServer((req, res) => {
  let text = ''; req.on('data', c => text += c); req.on('end', async () => {
    stubRequests.push({ at: now(), method: req.method, path: req.url, body: text });
    if (req.url.includes('count_tokens')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ input_tokens: 1 })); return; }
    if (!req.url.includes('/messages')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return; }
    let d = {}; try { d = JSON.parse(text); } catch {}
    if (opts.httpStatus) {
      res.writeHead(Number(opts.httpStatus), { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: Number(opts.httpStatus) === 401 ? 'authentication_error' : 'rate_limit_error', message: Number(opts.httpStatus) === 401 ? 'Invalid API key' : 'Quota exhausted' } }));
      return;
    }
    if (opts.responseDelayMs) await delay(Number(opts.responseDelayMs));
    const message = { id: 'msg_lab', type: 'message', role: 'assistant', model: d.model || 'claude-sonnet-4-6', content: [{ type: 'text', text: 'LAB_READY' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    if (!d.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(message)); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const [type, value] of [['message_start', { message: { ...message, content: [], stop_reason: null } }], ['content_block_start', { index: 0, content_block: { type: 'text', text: '' } }], ['content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'LAB_READY' } }], ['content_block_stop', { index: 0 }], ['message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }], ['message_stop', {}]]) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
    res.end();
  });
});
await new Promise(r => stub.listen(0, '127.0.0.1', r));
const apiPort = stub.address().port;
if (apiPort === 3002) throw new Error('forbidden port');
let slowRegistry,upgradeRegistryDone;
if(opts.upgradeSlow){
  fs.rmSync(root+'/upgrade-check.json',{force:true});
  slowRegistry=http.createServer((req,res)=>{
    mark('upgrade_registry_begin');
    setTimeout(()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({name:'@sentropic/h2a','dist-tags':{latest:'0.98.1'},versions:{'0.98.1':{name:'@sentropic/h2a',version:'0.98.1'}}}));upgradeRegistryDone=mark('upgrade_registry_end');},10000);
  });
  await new Promise(r=>slowRegistry.listen(0,'127.0.0.1',r));
  if(slowRegistry.address().port===3002)throw new Error('forbidden port');
}
const cache = lab + '/cache-' + (opts.cache || 'warm');
fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
const env = { HOME: home, CLAUDE_CONFIG_DIR: home + '/.claude', XDG_STATE_HOME: home + '/.state', XDG_CONFIG_HOME: home + '/.config', TMPDIR: runtime + '/tmp', REMOTE_CLI_CONFIG_HOME: home, XDG_RUNTIME_DIR: runtime, H2A_NATIVE_SOCKET: runtime + '/host.sock', H2A_ROOT: root, H2A_SESSION_HOST: 'native', PATH: bin + ':/home/antoinefa/.npm-global/bin:/usr/bin:/bin', TERM: 'xterm-256color', LANG: 'C.UTF-8', ANTHROPIC_API_KEY: 'lab-placeholder', ANTHROPIC_BASE_URL: `http://127.0.0.1:${apiPort}`, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: '1', npm_config_cache: cache, npm_config_prefix: lab + '/prefix', npm_config_userconfig: home + '/empty.npmrc', npm_config_registry: 'https://registry.npmjs.org', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false', npm_config_fetch_retries: '0', npm_config_fetch_timeout: '20000', LAUNCH_PERF_OUTPUT: output, NODE_OPTIONS: '--require=' + lab + '/scripts/preload.cjs', H2A_MCP_TRACE: '1', H2A_UPGRADE_REEXECED: '1' };
fs.mkdirSync(env.XDG_STATE_HOME,{recursive:true});fs.mkdirSync(env.TMPDIR,{recursive:true});fs.writeFileSync(home + '/empty.npmrc', '');
if (opts.qualifyDispatch) env.LAUNCH_PERF_QUALIFY_DISPATCH = '1';
env.TMUX_TMPDIR=runtime+'/tmux';fs.mkdirSync(env.TMUX_TMPDIR,{mode:0o700});
if(opts.upgradeSlow)delete env.H2A_UPGRADE_REEXECED;
const mcpServers = {};
if (['h2a', 'both'].includes(opts.mcp)) mcpServers.h2a = { command: process.execPath, args: [installed + '/dist/bin.js', 'mcp-serve', '--root', root, '--auto-open', '--host', 'claude', '--backend', 'local',...(opts.upgradeSlow?['--upgrade-check']:[])],...(opts.upgradeSlow?{env:{npm_config_registry:'http://127.0.0.1:'+slowRegistry.address().port,npm_config_fetch_timeout:'15000'}}:{}) };
if (['playwright', 'both'].includes(opts.mcp)) mcpServers.playwright = { command: opts.pinned ? process.execPath : '/home/antoinefa/.npm-global/bin/npx', args: opts.pinned ? [opts.pinned] : ['--yes', '@playwright/mcp@latest'] };
if (opts.mcpDelayMs !== undefined || opts.toolsDelayMs !== undefined) {
  if (!opts.pinned) throw new Error('the slow MCP witness requires pinned Playwright');
  const shim = output + '/slow-mcp.cjs';
  fs.writeFileSync(shim, `const {spawn}=require('node:child_process');const {createInterface}=require('node:readline');const child=spawn(process.execPath,[${JSON.stringify(opts.pinned)}],{stdio:['pipe','pipe','inherit']});const methods=new Map();createInterface({input:process.stdin}).on('line',line=>{try{const m=JSON.parse(line);methods.set(m.id,m.method);}catch{}child.stdin.write(line+'\\n');}).on('close',()=>child.stdin.end());createInterface({input:child.stdout}).on('line',line=>{let delay=0;try{const r=JSON.parse(line);const method=methods.get(r.id);delay=method==='initialize'?${Number(opts.mcpDelayMs||0)}:method==='tools/list'?${Number(opts.toolsDelayMs||0)}:0;}catch{}setTimeout(()=>process.stdout.write(line+'\\n'),delay);});`);
  mcpServers.playwright = { command: process.execPath, args: [shim] };
}
const mcpFile = output + '/mcp.json'; fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers }));
env.H2A_CLAUDE_MCP_CONFIG = mcpFile;
const cfg = { hasCompletedOnboarding: true, theme: 'dark', numStartups: 5, customApiKeyResponses: { approved: ['lab-placeholder'], rejected: [] }, projects: { [workspace]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true, hasClaudeMdExternalIncludesApproved: true, hasClaudeMdExternalIncludesWarningShown: true }, '/home/antoinefa': { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true, hasClaudeMdExternalIncludesApproved: true, hasClaudeMdExternalIncludesWarningShown: true } } };
for (const p of [home + '/.claude.json', home + '/.claude/.claude.json']) fs.writeFileSync(p, JSON.stringify(cfg));
const hooks = {};
if (opts.userHookMs !== undefined || opts.userHookVeto) {
  const hook = output + '/user-hook.cjs';
  fs.writeFileSync(hook, `const fs=require('node:fs');const file=${JSON.stringify(output+'/hook-events.jsonl')};fs.appendFileSync(file,JSON.stringify({at:Date.now(),event:'begin'})+'\\n');setTimeout(()=>{fs.appendFileSync(file,JSON.stringify({at:Date.now(),event:'end',veto:${Boolean(opts.userHookVeto)}})+'\\n');${opts.userHookVeto ? "process.stderr.write('fixture veto\\n');process.exit(2);" : "process.stdout.write('{}');"}},${Number(opts.userHookMs || 0)});`);
  hooks.UserPromptSubmit = [{ hooks: [{ type: 'command', command: quote(process.execPath)+' '+quote(hook) }] }];
}
fs.writeFileSync(home + '/.claude/settings.json', JSON.stringify({ enabledPlugins: {}, permissions: { defaultMode: 'default' },hooks }));
fs.writeFileSync(home + '/.config/sentropic/h2a/config.json', JSON.stringify({ h2a: { enabled: true, command: `${quote(process.execPath)} ${quote(installed + '/dist/bin.js')} mcp-serve --root ${quote(root)} --auto-open --host claude --backend local`, central: { enabled: false } } }));
const claudeArgs = ['--strict-mcp-config', '--mcp-config', mcpFile, '--settings', home + '/.claude/settings.json'];
fs.writeFileSync(bin + '/claude', opts.noDebug ? '#!/bin/sh\nexec /home/antoinefa/.local/bin/claude ' + claudeArgs.map(quote).join(' ') + ' "$@"\n' : '#!/bin/sh\ncase " $* " in *" --debug-file "*) exec /home/antoinefa/.local/bin/claude ' + claudeArgs.map(quote).join(' ') + ' "$@";; esac\nexec /home/antoinefa/.local/bin/claude ' + claudeArgs.map(quote).join(' ') + ' --debug-file ' + quote(output) + '/claude-debug-$$.log "$@"\n', { mode: 0o700 });
fs.writeFileSync(bin + '/h2a', '#!/bin/sh\nexec ' + quote(process.execPath) + ' ' + quote(binJs) + ' "$@"\n', { mode: 0o700 });
const bashenv = output + '/bash-env.sh'; fs.writeFileSync(bashenv, Object.entries(env).map(([k,v]) => 'export ' + k + '=' + quote(v)).join('\n') + '\n'); env.BASH_ENV = bashenv;
const startChild = (command, args, role, stdin) => { const c = spawn(command, args, { cwd: workspace, env: { ...env, LAUNCH_PERF_ROLE: role }, stdio: ['pipe','pipe','pipe'] }); children.push(c); const out = fs.createWriteStream(output + '/' + role + '-' + c.pid + '.stdout'); const err = fs.createWriteStream(output + '/' + role + '-' + c.pid + '.stderr'); c.stdout.pipe(out); c.stderr.pipe(err); if (stdin !== undefined) c.stdin.end(stdin); return c; };
const readDiagnostics = () => fs.readdirSync(output).filter(f=>/^claude-debug.*\.log$/.test(f)).map(f=>fs.readFileSync(output+'/'+f,'utf8')).join('\n') + (fs.existsSync(workspace+'/.h2a/runs') ? fs.readdirSync(workspace+'/.h2a/runs').map(name=>{const f=workspace+'/.h2a/runs/'+name+'/claude-debug.log';return fs.existsSync(f)?fs.readFileSync(f,'utf8'):''}).join('\n') : '');
const cleanText = s => s.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b[>=]/g,'');
const observe = async (id, begin, receipt) => {
  let seq = 0, text = '', firstPrompt, accepted, answer, ptyPid, trustSent = false;
  const deadline = Date.now() + (opts.timeoutMs || 65000);
  while (Date.now() < deadline && !aborted) {
    try {
      const state = await client.state(id); ptyPid = state.pid;
      const replay = await client.readOutput(id, seq);
      for (const chunk of replay.chunks || []) { text += chunk.data; seq = Math.max(seq, chunk.seq); }
      if (!replay.chunks && replay.events) for (const chunk of replay.events) { text += chunk.data; seq = Math.max(seq, chunk.seq); }
      const plain = cleanText(text);
      if (!firstPrompt && /❯/.test(plain) && /ClaudeCode|Claude Code/.test(plain) && /shortcuts|Sonnet|Opus|sonnet|opus/.test(plain)) { firstPrompt = mark('first_prompt', { id }) - begin; }
      if (!trustSent && /trust this|trust the files|Use this API key/i.test(plain)) { const lease = await client.acquireController(id, 'lab-onboarding'); await client.write(lease, '\r'); await client.releaseController(lease); trustSent = true; mark('lab_confirm', { id }); }
      if (firstPrompt && !opts.mode?.startsWith('runtime') && !accepted) {
        await delay(Number(opts.pacingMs || 0));
        const lease = await client.acquireController(id, 'lab-prompt');
        await client.write(lease, '\u001b[200~Return the word READY_WITNESS.\u001b[201~');
        await delay(25); await client.write(lease, '\r'); await client.releaseController(lease);
        accepted = mark('prompt_submitted', { id }) - begin;
      }
      if (plain.includes('LAB_READY') && stubRequests.some(r => r.path.includes('/messages') && !r.path.includes('count_tokens'))) { answer = mark('answer_visible', { id }) - begin; fs.writeFileSync(output + '/' + id + '.terminal', text); return { id, firstPromptMs: firstPrompt, promptSubmittedMs: accepted, answerMs: answer, ptyPid: state.pid }; }
      if (state.status === 'exited') break;
    } catch {}
    await delay(50);
  }
  fs.writeFileSync(output + '/' + id + '.terminal', text);
  return { id, ptyPid, firstPromptMs: firstPrompt, promptSubmittedMs: accepted, error: 'no local answer before deadline' };
};
let failure;
mark('experiment_begin', { opts, fixturePresence:corpus.counts.presence, pressure: pressure(), memoryCurrent: Number(fs.readFileSync(cg + '/memory.current')) });
try {
  const beginHost = mark('host_spawn'); host = startChild(process.execPath, [rt + '/native-terminal/process.js', '--socket', env.H2A_NATIVE_SOCKET, '--registry-path', home + '/.config/sentropic/h2a/registry.json'], 'host');
  for (let i=0; i<200; i++) { try { client = await NativeTerminalClient.connect(env.H2A_NATIVE_SOCKET); break; } catch { await delay(25); } }
  if (!client) throw new Error('private host unavailable');
  const hostMs = mark('host_ready') - beginHost;
  if (opts.pressure) {
    const file=lab + '/io-pressure-sync.bin';
    const writer = startChild(lab + '/scripts/io-writer', [file], 'writer');
    await delay(1000);
    if (writer.exitCode !== null || !fs.existsSync(file) || fs.statSync(file).size < 1024**2) throw new Error('I/O writer failed admission');
    mark('pressure_started', { pid: writer.pid,writer:'synchronous-fsync',pressure:pressure(),fileBytes:fs.statSync(file).size });
  }
  await Promise.all(Array.from({ length: opts.n || 1 }, async (_, i) => {
    const name = `perf-probe-${Date.now()}-${i}`, id = 'h2a-' + name;
    const begin = mark('launch_begin', { id });
    if (opts.mode?.startsWith('runtime')) {
      sessions.push(id, id + '.h2a');
      const args = [binJs, 'run', 'claude', workspace, '--name', name, '--no-gw', '--no-attach', '--background', '--json', '--prompt-stdin', ...(opts.sidecar === false ? ['--no-h2a'] : ['--h2a'])];
      const c = opts.adapter
        ? startChild(process.execPath,[lab+'/scripts/adapter-worker.mjs'],'launcher-'+i,JSON.stringify({profile:'claude',name,workspace,prompt:'Return the word READY_WITNESS.',background:true,gateway:'off',headless:false,h2aSidecar:opts.sidecar!==false}))
        : startChild(process.execPath, args, 'launcher-' + i, 'Return the word READY_WITNESS.');
      const observation = observe(id, begin);
      await new Promise((r,j) => { c.once('close', r); c.once('error',j); });
      const receiptMs = mark('launcher_exit', { id, code: c.exitCode }) - begin;
      results.push({ name, hostMs, receiptMs, exitCode: c.exitCode, ...await observation });
    } else {
      sessions.push(id);
      const convId=opts.seedRelaunch ? randomUUID() : undefined;
      const state = await client.create({ id, command: bin + '/claude', args: convId ? ['--session-id',convId] : [], cwd: workspace, env, cols: 140, rows: 40 });
      const ptyMs = mark('pty_created', { id, pid: state.pid }) - begin;
      results.push({ name, hostMs, ptyMs,convId, ...await observe(id, begin) });
    }
  }));
  // A visible composer does not prove the configured tools have finished booting.
  const expectedH2a = ((['h2a','both'].includes(opts.mcp) ? 1 : 0) + (opts.mode?.startsWith('runtime') && opts.sidecar !== false ? 1 : 0)) * (opts.n || 1);
  const expectedPw = (['playwright','both'].includes(opts.mcp) ? 1 : 0) * (opts.n || 1);
  const deadline = Date.now() + 40000;
  let mcpReady;
  while (Date.now() < deadline && !aborted) {
    if (results.every(r=>r.exitCode !== 0)) break;
    const traces = fs.readdirSync(output).filter(f=>/^trace-.*jsonl$/.test(f)).flatMap(f=>fs.readFileSync(output+'/'+f,'utf8').trim().split('\n').flatMap(l=>{try{return [JSON.parse(l)]}catch{return []}}));
    const identities = traces.filter(t=>t.phase==='identity_ready');
    const debug = readDiagnostics();
    const pw = [...debug.matchAll(/^(\S+) .*MCP server "playwright": Successfully connected.* in (\d+)ms/gm)];
    if (identities.length >= expectedH2a && pw.length >= expectedPw) { mcpReady = Math.max(...identities.map(t=>t.at), ...pw.map(m=>Date.parse(m[1])), 0); break; }
    await delay(50);
  }
  const experimentStart = events.find(e=>e.name==='launch_begin')?.at;
  const cohortReady = mark('cohort_mcp_ready', { readyAt: mcpReady || null, expectedH2a, expectedPw });
  for (const row of results) {
    const begin = events.find(e=>e.name==='launch_begin' && e.id===row.id)?.at;
    row.mcpReadyMs = mcpReady ? Math.max(0,mcpReady-begin) : (expectedH2a || expectedPw ? null : 0);
    row.usableMs = row.mcpReadyMs !== null ? Math.max(row.receiptMs || 0,row.answerMs || 0,row.mcpReadyMs) : null;
  }
  const traces = fs.readdirSync(output).filter(f=>/^trace-.*jsonl$/.test(f)).flatMap(f=>fs.readFileSync(output+'/'+f,'utf8').trim().split('\n').flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}}));
  for (const row of results) {
    const begin = events.find(e=>e.name==='launch_begin'&&e.id===row.id)?.at;
    const descendant = pid => { const seen=new Set();for(let i=0;i<32&&pid&&!seen.has(pid);i++){if(pid===row.ptyPid)return true;seen.add(pid);pid=known.get(pid)?.ppid;}return false; };
    const identities = traces.filter(t=>t.phase==='identity_ready'&&descendant(t.pid));
    const debugPath = workspace+'/.h2a/runs/'+row.name+'/claude-debug.log';
    const baselineDebug = output+'/claude-debug-'+row.ptyPid+'.log';
    const debug = fs.existsSync(debugPath)?fs.readFileSync(debugPath,'utf8'):fs.existsSync(baselineDebug)?fs.readFileSync(baselineDebug,'utf8'):'';
    const pw=[...debug.matchAll(/^(\S+) .*MCP server "playwright": Successfully connected.* in (\d+)ms/gm)].map(m=>Date.parse(m[1]));
    row.individualMcpReadyMs = identities.length && pw.length ? Math.max(...identities.map(t=>t.at),...pw)-begin : null;
    row.nativeOperations = traces.filter(t=>t.name==='node_preload'&&t.entry==='op.js'&&t.session===row.id).map(t=>({operation:t.operation,at:t.at-begin}));
    const receiptPath=workspace+'/.h2a/runs/'+row.name+'/launch.json';
    if(fs.existsSync(receiptPath))row.receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
    const mainDispatch=[...debug.matchAll(/^(\S+) .*\[API REQUEST\] \/v1\/messages source=repl_main_thread/gm)].map(m=>Date.parse(m[1]));
    row.dispatchMs=mainDispatch.length?Math.min(...mainDispatch)-begin:null;
    row.lastProofToResultMs=row.receipt?.timings?.lastRequiredProofMs!==undefined?row.receiptMs-(row.receipt.requestedAt-begin)-row.receipt.timings.lastRequiredProofMs:null;
    row.dispatchToResultMs=row.dispatchMs!==null?row.receiptMs-row.dispatchMs:null;
    if (opts.repeat && row.exitCode === 0) {
      const args=[binJs,'run','claude',workspace,'--name',row.name,'--no-gw','--no-attach','--background','--json','--prompt-stdin','--no-h2a'];
      const count=stubRequests.length;
      const repeated=startChild(process.execPath,args,'repeat-'+row.name,'Return the word READY_WITNESS.');
      await new Promise(resolve=>repeated.once('close',resolve));
      const conflicting=startChild(process.execPath,args,'conflict-'+row.name,'A different brief must never be submitted.');
      await new Promise(resolve=>conflicting.once('close',resolve));
      row.repeat={exitCode:repeated.exitCode,conflictCode:conflicting.exitCode,additionalRequests:stubRequests.length-count};
      if(repeated.exitCode!==0||conflicting.exitCode===0||stubRequests.length!==count)throw new Error('durable repeat/conflict witness failed');
    }
    if (opts.resumePrompt && row.exitCode === 0) {
      const state=await client.state(row.id);
      await client.stopIfIncarnation(row.id,state.generation,state.incarnation,'SIGTERM');
      const name=row.name+'-resume'; sessions.push('h2a-'+name);
      const conversation=row.receipt.conversationId;
      const c=startChild(process.execPath,[binJs,'run','claude',workspace,'--name',name,'--resume',conversation,'--no-gw','--no-attach','--background','--json','--prompt-stdin','--no-h2a'],'resume-'+row.name,'Continue with exactly READY_CONTINUATION.');
      await new Promise(resolve=>c.once('close',resolve));
      const result=JSON.parse(fs.readFileSync(output+'/resume-'+row.name+'-'+c.pid+'.stdout','utf8'));
      row.resume={exitCode:c.exitCode,result};
      if(c.exitCode!==0||result.session?.conversationId!==conversation)throw new Error('exact conversation continuation witness failed');
    }
  }
  if (opts.relaunch) {
    if(opts.seedRelaunch){
      const at=new Date().toISOString();
      const entries=results.map(row=>({id:row.name,tool:'claude',kind:'local-native',cwd:workspace,source:'run',enrolledAt:at,lastSeenAt:at,label:row.name,tmuxSession:row.id,pid:row.ptyPid,sessionClass:'background',gatewayMode:'direct',bare:false,restorePinned:false,convId:row.convId}));
      fs.writeFileSync(home+'/.config/sentropic/h2a/registry.json',JSON.stringify({version:1,entries}));
      mark('bulk_resume_fixture',{count:entries.length});
    }
    for (const row of results) {
      const registry=home+'/.config/sentropic/h2a/registry.json';
      const records=JSON.parse(fs.readFileSync(registry));
      const entry=records.entries.find(x=>x.id===row.name);
      if (!entry) throw new Error('private relaunch entry unavailable');
      if (!entry.convId) {
        const hook=records.entries.find(x=>x.source==='hook'&&x.cwd===workspace&&x.convId);
        if(hook){
          // Preserve the private pre-fixture state. Consolidate only this lab
          // session's duplicate hook record so resume has a single owner row.
          fs.copyFileSync(registry,output+'/registry-before-resume-fixture.json');
          entry.convId=hook.convId;records.entries=records.entries.filter(x=>x!==hook);
          fs.writeFileSync(registry,JSON.stringify(records));
          mark('resume_fixture_link',{id:row.id});
        }
      }
      // Hook-backed conversation capture is supplied by opts.hooks, if present.
      const begin=mark('relaunch_begin',{id:row.id,hasConversation:!!entry.convId});
      const c=startChild(process.execPath,[lab+'/installed/dist/bin.js','relaunch',row.name,'--apply','--yes'],'relauncher', '');
      await new Promise(r=>c.once('close',r));
      row.relaunchReceiptMs=mark('relaunch_exit',{id:row.id,code:c.exitCode})-begin;
      const state=await client.state(row.id);
      let seq=0,text='',ready;
      const deadline=Date.now()+15000;
      while(Date.now()<deadline){const replay=await client.readOutput(row.id,seq);for(const chunk of replay.chunks){text+=chunk.data;seq=Math.max(seq,chunk.seq);}const plain=cleanText(text);if(/❯/.test(plain)&&/ClaudeCode|Claude Code/.test(plain)&&/shortcuts|Sonnet|Opus|sonnet|opus/.test(plain)){ready=mark('relaunch_prompt',{id:row.id})-begin;break;}await delay(50);}
      row.relaunchPromptMs=ready;row.relaunchCode=c.exitCode;
      fs.writeFileSync(output+'/relaunch-'+row.id+'.terminal',text);
    }
    const batchBegin=events.find(e=>e.name==='relaunch_begin')?.at;
    mark('relaunch_batch_composers',{elapsedMs:now()-batchBegin});
    const deadline=Date.now()+30000;let ready=false;
    while(Date.now()<deadline){
      const rows=fs.readdirSync(output).filter(f=>/^trace-.*jsonl$/.test(f)).flatMap(f=>fs.readFileSync(output+'/'+f,'utf8').trim().split('\n').flatMap(l=>{try{return[JSON.parse(l)]}catch{return[]}}));
      const identities=rows.filter(r=>r.phase==='identity_ready').length;
      const debug=fs.existsSync(output+'/claude-debug.log')?fs.readFileSync(output+'/claude-debug.log','utf8'):'';
      const pw=(debug.match(/MCP server "playwright": Successfully connected/g)||[]).length;
      if(identities>=expectedH2a*2&&pw>=expectedPw*2){ready=true;break;}await delay(50);
    }
    mark('relaunch_batch_end',{elapsedMs:now()-batchBegin,mcpReady:ready});
  }
  if(opts.upgradeSlow){const deadline=Date.now()+17000;while(!upgradeRegistryDone&&Date.now()<deadline)await delay(50);mark('upgrade_background_observed',{completed:!!upgradeRegistryDone});}
  if (opts.holdMs) {
    const begin = Date.now();
    while (Date.now() - begin < opts.holdMs && !aborted) {
      const diagnosticFiles = fs.existsSync(workspace+'/.h2a/runs') ? fs.readdirSync(workspace+'/.h2a/runs').map(name=>workspace+'/.h2a/runs/'+name+'/claude-debug.log') : [];
      mark('long_diagnostic_sample', { elapsedMs: Date.now()-begin, files: diagnosticFiles.filter(f=>fs.existsSync(f)).map(f=>({file:f,bytes:fs.statSync(f).size,mode:fs.statSync(f).mode&0o777})) });
      await delay(Math.min(15000,opts.holdMs-(Date.now()-begin)));
    }
  }
} catch(e) { failure = e.stack; }
finally {
  sample();
  if (client) for (const id of sessions) { try { const s = await client.state(id); await client.stopIfIncarnation(id, s.generation, s.incarnation, 'SIGKILL'); } catch {} }
  client?.close();
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  await delay(750); sample();
  for (const s of known.values()) { try { const live = snapshot(s.pid); if (live.start === s.start && !['Z','X'].includes(live.state)) process.kill(s.pid, 'SIGKILL'); } catch {} }
  await delay(200); clearInterval(timer); await new Promise(r => stub.close(r));if(slowRegistry)await new Promise(r=>slowRegistry.close(r));
  const survivors = [...known.values()].filter(s => {try {const x = snapshot(s.pid); return x.start === s.start && !['Z','X'].includes(x.state);} catch{return false;}});
  if(fs.existsSync(workspace+'/.h2a')) fs.cpSync(workspace+'/.h2a',output+'/runtime-receipts',{recursive:true,filter:p=>!p.endsWith('.pipe')});
  if(fs.existsSync(home+'/.claude/projects')) fs.cpSync(home+'/.claude/projects',output+'/transcripts',{recursive:true});
  fs.rmSync(runtime, { recursive: true, force: true });
  const record = { sourceSha: opts.sourceSha, protocol: 'study-r2-direct-pw-private-state-v1', label, opts, results, failure, aborted, memory: { limit, peakBytes: peak, treePeakKiB: peakTree, processes: [...known.values()] }, survivors, stubRequests, pressureEnd: pressure() };
  fs.writeFileSync(output + '/result.json', JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ label, results, failure, aborted, peakMiB: Math.round(peak/1024**2), survivors: survivors.length }));
  if (failure || aborted || survivors.length || results.some(r => r.error || r.exitCode)) process.exitCode = 1;
}
