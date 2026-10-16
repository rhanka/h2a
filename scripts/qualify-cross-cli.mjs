#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { CLIS, PROBE, REPLY, repo, environment, sourceBuild, copyLogin,
  cliPath, pythonEntrypoint, classify, matrix, inside } from './xcli-lab.mjs';

const self = fileURLToPath(import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const readEvents = path => {
  try { return fs.readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};

// Closed vocabulary only: provider text and errors never leave process memory.
function blockingScreen(screen) {
  if (/sign in|log in|login required|not logged in|authentication required|please authenticate|API key.{0,30}(?:missing|required)|Select authentication|How would you like to authenticate/i.test(screen)) return 'authentication-required';
  if (/quota exceeded|usage limit|rate.?limit|credits exhausted|insufficient credits|limit reached/i.test(screen)) return 'provider-quota';
  if (/trust (?:this|the) (?:folder|workspace)|Do you trust|trust this project|security notes|choose.{0,20}theme|select.{0,20}theme|Welcome to Claude/i.test(screen)) return 'onboarding-or-trust';
  if (/permission.{0,20}(?:required|denied)|allow.{0,30}(?:tool|MCP)|approve.{0,25}(?:tool|MCP)/i.test(screen)) return 'tool-approval-required';
  return undefined;
}

function argsFor(cli, prompt) {
  if (cli === 'codex') return ['--no-daemon', '--no-alt-screen', prompt];
  if (cli === 'agy' || cli === 'gemini') return ['--prompt-interactive', prompt];
  if (cli === 'muse') return ['--no-session-log', prompt];
  return [prompt];
}

// Only normal startup UI interactions in our empty temporary workspace.
// No bypass flags, persisted trust edits, or inputs after the idle barrier.
export function startupKey(screen) {
  const normalized = screen.replace(/\s+/g, ' ');
  if (/choose.{0,25}permissions/i.test(normalized) && /default/i.test(normalized) && /press.{0,35}continue/i.test(normalized)) return 'permissions-keep-default';
  if (/Default permissions/i.test(screen) && /press[^\n]{0,35}continue/i.test(screen)) return 'permissions-keep-default';
  if (/(?:Choose|Select) the text style|Select theme|Choose a theme/i.test(screen)) return 'theme-default';
  if (/Do you trust this workspace\?/.test(screen) && /Trust and continue/.test(screen)) return 'trust-empty-workspace';
  if (/Yes, I trust this folder|Yes, I trust this project|Trust folder|Trust this folder/i.test(screen)) return 'trust-empty-workspace';
  if (/Press Enter to continue/i.test(screen) && /security|safety|welcome|terminal setup/i.test(screen)) return 'startup-continue';
  return undefined;
}

async function worker() {
  const request = JSON.parse(fs.readFileSync(0, 'utf8'));
  const { sender, receiver, root, build, executables, timeoutMs, authHome, simulated, dropWake } = request;
  const cell = fs.mkdtempSync(join(root, 'c-'));
  const hostEnv = { ...environment(cell), H2A_TEST_QUALIFICATION_ROOT: root };
  Object.assign(process.env, hostEnv);
  const isolation = await import(pathToFileURL(join(build, 'packages/h2a/test/helpers/native-isolation.js')));
  const { NativeTerminalClient } = await import(pathToFileURL(join(build, 'packages/h2a-runtime/dist/native-terminal/client.js')));
  const { enroll } = await import(pathToFileURL(join(build, 'packages/h2a-runtime/dist/registry.js')));
  const { createLocalStore } = await import(pathToFileURL(join(build, 'packages/h2a/dist/index.js')));
  const { paneIsReady } = await import(pathToFileURL(join(build, 'packages/h2a-runtime/dist/prompt-delivery.js')));
  const { stripAnsi } = await import(pathToFileURL(join(build, 'packages/h2a-runtime/dist/native-terminal/op.js')));
  const row = { sender, receiver, status: 'blocked', senderMcp: null, receiverMcp: null,
    sent: null, delivered: null, received: null, woke: null, replied: null, replyDelivered: null,
    evidence: [], startedAt: new Date().toISOString(), credentialsCopied: {},
    noPostSendHarnessInput: true };
  let host, client;
  const targets = [];
  const registry = join(hostEnv.HOME, '.config/sentropic/remote-cli/registry.json');
  const store = createLocalStore({ root: hostEnv.H2A_ROOT });
  const bin = join(build, 'packages/h2a/dist/bin.js');
  const proxy = join(repo, 'scripts/xcli-proxy.mjs');
  const started = Date.now();
  let cancelled = false;
  const cancel = () => { cancelled = true; };
  process.on('SIGTERM', cancel);
  process.on('SIGINT', cancel);
  const cleanupError = (stage, error) => {
    row.cleanupFailed = true;
    row.cleanupErrors ??= [];
    row.cleanupErrors.push({ stage, code: error.code, name: error.name,
      locations: String(error.stack ?? '').split('\n').slice(1).filter(line => line.includes(build) || line.includes(repo)).map(line => line.trim()) });
  };
  async function launch(cli, role, prompt) {
    const dir = join(cell, role);
    fs.mkdirSync(dir, { mode: 0o700 });
    const env = { ...environment(dir), H2A_TEST_QUALIFICATION_ROOT: root,
      H2A_ROOT: hostEnv.H2A_ROOT, H2A_NATIVE_SOCKET: hostEnv.H2A_NATIVE_SOCKET,
      REMOTE_CLI_CONFIG_HOME: hostEnv.HOME,
      H2A_NATIVE_TARGET_SESSION: `h2a-${role}`, H2A_NATIVE_PTY_SESSION: `h2a-${role}`,
      XCLI_CELL: cell, XCLI_EVENTS: join(dir, 'events.jsonl'), XCLI_BIN: bin,
      XCLI_BUILD: build, ...(simulated ? { XCLI_SIMULATED: '1' } : {}),
      // Both peers belong to this one experiment. Their lock liveness checks
      // must see the same owned-process view, never unrelated owner processes.
      H2A_TEST_PROC_ROOT: process.env.H2A_TEST_PROC_ROOT,
      H2A_TEST_OWNED_PROC_ROOT: process.env.H2A_TEST_OWNED_PROC_ROOT,
      ...(simulated ? { H2A_NOTIFY_INTERVAL_MS: '100' } : {}),
      H2A_MCP_TRACE: '1',
      ...(dropWake ? { XCLI_DROP_WAKE: '1' } : {}),
    };
    row.credentialsCopied[role] = copyLogin(cli, authHome, cell, env);
    if ((cli === 'gemini' || cli === 'agy') && row.credentialsCopied[role].includes('.gemini/oauth_creds.json')) {
      // Select the existing copied OAuth login; never copy the owner's MCPs,
      // hooks, extensions or arbitrary configuration.
      fs.mkdirSync(join(env.HOME, '.gemini'), { recursive: true });
      fs.writeFileSync(join(env.HOME, '.gemini/settings.json'), JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }));
    }
    // Every nested h2a invocation resolves to this witnessed checkout build.
    fs.writeFileSync(join(dir, 'bin/h2a'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(proxy)} "$@"\n`, { mode: 0o700 });
    const workspace = join(dir, 'workspace');
    fs.mkdirSync(workspace);
    const rendered = spawnSync(process.execPath, [bin, 'host', 'setup', '--host', cli, '--print', '--root', env.H2A_ROOT],
      { env, cwd: workspace, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
    row.evidence.push({ event: 'host-setup', role, exitCode: rendered.status });
    let config;
    try { config = JSON.parse(rendered.stdout); } catch { throw new Error('host-setup-no-config'); }
    // Phase 1 deliberately uses the product descriptor's own default path.
    const descriptor = await import(pathToFileURL(join(build, `packages/h2a/dist/hosts/${cli}.js`)));
    const hint = descriptor.renderMcpConfig().path.example;
    const path = cli === 'claude' && hint === '~/.claude.json'
      ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : hint.replace(/^~(?=\/)/, env.HOME);
    inside(cell, path);
    fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (path.endsWith('.toml')) {
      const endpoint = config.mcpServers.h2a;
      const table = cli === 'codex' ? '[mcp_servers.h2a]\n' : '[[mcp_servers]]\nname = "h2a"\ntransport = "stdio"\n';
      fs.writeFileSync(path, `${table}command = ${JSON.stringify(endpoint.command)}\nargs = ${JSON.stringify(endpoint.args)}\n`);
    } else {
      let previous = {};
      if (fs.existsSync(path)) previous = JSON.parse(fs.readFileSync(path, 'utf8'));
      fs.writeFileSync(path, JSON.stringify({ ...previous, ...config }));
    }
    const state = await client.create({ id: `h2a-${role}`, command: executables[cli],
      args: argsFor(cli, prompt), cwd: workspace, env: isolation.isolatedNativeTestEnvironment(env), cols: 140, rows: 40 });
    isolation.pinPrivateNativeProcess(state.pid, env);
    enroll({ id: role, label: role, tool: cli, kind: 'local-native', cwd: workspace,
      tmuxSession: state.id, source: 'run', sessionClass: 'human' }, registry);
    const target = { cli, role, dir, env, state, seq: 0, screen: '', workspace };
    targets.push(target);
    row.evidence.push({ event: 'session-created', role, pid: state.pid, id: state.id });
    return target;
  }
  async function capture(target) {
    const output = await client.readOutput(target.state.id, target.seq);
    for (const chunk of output.chunks) {
      target.lastOutputAt = Date.now();
      target.seq = chunk.seq;
      target.screen = (target.screen + chunk.data).slice(-65536);
    }
    return stripAnsi(target.screen);
  }
  async function startup(target, screen) {
    target.startupActions ??= new Set();
    const action = startupKey(screen);
    if (!action || target.startupActions.has(action)) return false;
    target.startupActions.add(action);
    const lease = await client.acquireController(target.state.id, 'xcli-startup', 'automation');
    try { await client.write(lease, '\r'); } finally { await client.releaseController(lease); }
    row.evidence.push({ event: 'startup-ui', role: target.role, action, at: Date.now() });
    target.screen = '';
    await sleep(500);
    return true;
  }
  function events(target) { return readEvents(target.env.XCLI_EVENTS); }
  function loaded(target) {
    const e = events(target);
    return e.some(v => v.event === 'initialize' && v.ok) && e.some(v => v.event === 'tools' && v.ok && v.messaging);
  }
  async function ready(target) {
    const deadline = Date.now() + timeoutMs;
    let quietSince;
    while (Date.now() < deadline) {
      if (cancelled) return { blocker: 'qualification-cancelled' };
      const screen = await capture(target);
      if (await startup(target, screen)) continue;
      const blocker = blockingScreen(screen);
      if (blocker) return { blocker };
      const identity = events(target).find(e => e.event === 'identity' && e.ok && e.ready);
      const armed = events(target).some(e => e.event === 'wake-armed');
      if (identity && loaded(target) && armed && paneIsReady(screen, target.cli) && Date.now() - (target.lastOutputAt ?? Date.now()) >= 2000) {
        quietSince ??= Date.now();
        if (Date.now() - quietSince >= 2000) return { instance: identity.instance };
      } else quietSince = undefined;
      if ((await client.state(target.state.id)).status === 'exited') return { blocker: 'cli-exited-before-ready' };
      await sleep(100);
    }
    const e = events(target);
    row.evidence.push({ event: 'readiness-deadline', role: target.role,
      modelToolCallObserved: e.some(v => ['identity', 'send', 'inbox'].includes(v.event)),
      composerReady: paneIsReady(stripAnsi(target.screen), target.cli),
      mcpLoaded: loaded(target), wakeArmed: e.some(v => v.event === 'wake-armed') });
    const screen = stripAnsi(target.screen);
    row.evidence.push({ event: 'screen-signals', role: target.role, signals: Object.entries({
      error: /\berror\b/i, mcpFailure: /MCP.{0,80}(?:failed|error)|failed.{0,80}MCP/i,
      onboarding: /welcome|theme|onboard/i, login: /sign.?in|log.?in|authenticat/i,
      modelLoading: /model.{0,30}loading/i, modelUnavailable: /model.{0,60}(?:not found|unavailable|not supported)/i,
      permission: /permission|approval|trust/i, noTools: /no (?:MCP|tools)|tools.{0,30}unavailable/i,
      cursorQuery: /\x1b\[6n/.test(target.screen) ? /[\s\S]/ : /(?!) /,
    }).filter(([, pattern]) => pattern.test(screen)).map(([name]) => name) });
    return loaded(target) ? { blocker: 'initial-model-tool-turn-not-observed' } : { failure: 'mcp-not-loaded-before-deadline' };
  }
  try {
    for (const cli of new Set([receiver, sender])) {
      if (!executables[cli]) { row.blocker = `cli-not-found:${cli}`; return row; }
      if (pythonEntrypoint(executables[cli])) { row.blocker = `python-entrypoint-forbidden:${cli}`; return row; }
    }
    host = isolation.spawnIsolatedNative(process.execPath,
      [join(build, 'packages/h2a-runtime/dist/native-terminal/process.js'), '--socket', hostEnv.H2A_NATIVE_SOCKET,
        '--generation', 'xcli-private', '--registry-path', registry],
      { env: hostEnv, stdio: ['ignore', 'ignore', 'pipe'] });
    host.stderr.resume(); // discard, never persist raw errors
    for (let i = 0; i < 100; i++) {
      try { client = await NativeTerminalClient.connect(hostEnv.H2A_NATIVE_SOCKET); break; } catch { await sleep(50); }
    }
    if (!client) { row.blocker = 'private-host-unavailable'; return row; }
    const receiverPrompt = `Qualification h2a. Use only h2a MCP tools. First call h2a_identity_status until state identity_ready (stop if identity_failed), then finish your turn and wait. After readiness do not poll. On an automatic h2a inbox wake, read your own inbox using h2a_inbox action read and your identity. For the exact message ${PROBE}, reply with h2a_send to that envelope's actor.instance, message exactly ${REPLY}. Never use shell, files, other agents or any non-h2a tool.`;
    const r = await launch(receiver, 'receiver', receiverPrompt);
    const readiness = await ready(r);
    row.receiverMcp = loaded(r);
    if (!readiness.instance) {
      row.blocker = readiness.blocker;
      row.failure = readiness.failure;
      return row;
    }
    row.evidence.push({ event: 'receiver-idle-barrier', at: Date.now(), instance: readiness.instance });
    const senderPrompt = `Qualification h2a. Use only h2a MCP tools. Call h2a_identity_status until identity_ready (stop if identity_failed), then h2a_send once, to exactly ${readiness.instance}, message exactly ${PROBE}. Finish your turn. Never use shell, files, other agents or any non-h2a tool.`;
    const s = await launch(sender, 'sender', senderPrompt);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (cancelled) { row.blocker = 'qualification-cancelled'; break; }
      const se = events(s), re = events(r);
      row.senderMcp = loaded(s);
      const send = se.find(e => e.event === 'send' && e.ok && e.kind === 'probe' && e.to === readiness.instance);
      row.sent = Boolean(send);
      if (send) {
        row.delivered = store.readInbox(readiness.instance).some(e => e.id === send.envelopeId && e.body?.text === PROBE && e.actor?.instance === send.from);
        const receive = re.find(e => e.event === 'inbox' && e.ok && e.at >= send.at && e.instance === readiness.instance &&
          e.envelopes.some(v => v.id === send.envelopeId && v.from === send.from && v.to === readiness.instance && v.kind === 'probe'));
        row.received = Boolean(receive);
        row.woke = Boolean(receive) && row.noPostSendHarnessInput;
        const reply = re.find(e => e.event === 'send' && e.ok && e.kind === 'reply' && e.to === send.from && e.from === readiness.instance && e.at >= (receive?.at ?? Infinity));
        row.replied = Boolean(reply);
        row.replyDelivered = Boolean(reply) && store.readInbox(send.from).some(e => e.id === reply.envelopeId && e.body?.text === REPLY && e.actor?.instance === readiness.instance);
        if (row.replyDelivered && row.received) break;
      }
      const senderScreen = await capture(s);
      if (!row.sent && await startup(s, senderScreen)) continue;
      const blocker = blockingScreen(senderScreen) ?? blockingScreen(await capture(r));
      if (blocker) { row.blocker = blocker; break; }
      await sleep(100);
    }
    if (!row.blocker && !row.replyDelivered) row.failure = row.sent ? (row.received ? 'reply-not-observed' : 'live-receive-not-observed') : 'sender-send-not-observed';
    return row;
  } catch (error) {
    const known = ['host-setup-no-config'];
    row.blocker = known.includes(error.message) ? error.message : 'qualification-infrastructure-error';
    row.infrastructureCode = /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : undefined;
    row.infrastructureLocations = String(error.stack ?? '').split('\n').slice(1)
      .filter(line => line.includes(build) || line.includes(repo)).map(line => line.trim());
    return row;
  } finally {
    for (const t of targets) row.evidence.push(...events(t).map(e => ({ role: t.role, ...e })));
    for (const t of targets.reverse()) {
      try { isolation.pinPrivateNativeProcess(t.state.pid, t.env); }
      catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) cleanupError('pin', error); }
      try {
        const current = await client.state(t.state.id);
        assert.equal(current.generation, t.state.generation, 'private host generation changed');
        assert.equal(current.incarnation, t.state.incarnation, 'private session incarnation changed');
        if (current.status !== 'exited') {
          try { await client.stopIfIncarnation(t.state.id, t.state.generation, t.state.incarnation, 'SIGKILL'); }
          catch (error) {
            // The child may exit between state and the fenced stop. Accept
            // only the same observed generation/incarnation, now exited.
            const after = await client.state(t.state.id);
            if (after.status !== 'exited' || after.generation !== t.state.generation || after.incarnation !== t.state.incarnation) throw error;
          }
        }
      } catch (error) { cleanupError('native-stop', error); }
    }
    client?.close();
    if (host) {
      host.kill('SIGTERM');
      await Promise.race([new Promise(r => host.exitCode !== null || host.signalCode !== null ? r() : host.once('close', r)), sleep(3000)]);
      if (host.exitCode === null && host.signalCode === null) { host.kill('SIGKILL'); await new Promise(r => host.once('close', r)); }
    }
    try { await isolation.stopPrivateNativeProcesses(hostEnv); }
    catch (error) { cleanupError('owned-stop', error); }
    for (const t of targets) {
      try { await isolation.waitForPrivateNativeProcesses(t.env); }
      catch (error) { cleanupError('owned-wait', error); }
    }
    row.elapsedMs = Date.now() - started;
    row.status = row.cleanupFailed ? 'blocked' : classify(row);
    if (simulated) row.status = row.status.replace('measured-', 'simulated-');
    if (row.cleanupFailed) row.blocker = 'owned-process-cleanup-failed';
    // Remove copied logins and CLI-owned transcripts. Only allowlisted witness
    // records returned to the parent survive the cell.
    if (!row.cleanupFailed) fs.rmSync(cell, { recursive: true, force: true });
    else row.privateCleanupRoot = cell;
    process.off('SIGTERM', cancel);
    process.off('SIGINT', cancel);
  }
}

function markdown(result) {
  const lines = ['# Qualification live cross-CLI — phase 1', '', matrix(result.cells), '',
    `Commande : \`${result.command}\``, '',
    `Base : \`${result.sha}\` ; Node : \`${result.node}\` ; mode : **CLI réelles**.`, '',
    'M = MCP initialize + outils ; D = enveloppe durable ; R = lecture inbox par la CLI ; W = réaction après barrière inactive, sans entrée du harness ; A = réponse signée livrée au sender.', '',
    'Les cellules bloquées ne prouvent aucune fonctionnalité. Les tests MCP simulés ne qualifient pas les CLI réelles.', '',
    'Isolation : sources compilées dans mkdtemp ; HOME/XDG/store/socket/registre privés par cellule ; aucun host existant. Garde produit `H2A_UPGRADE_REEXECED=1` ; shim h2a vers les sources. Seuls les fichiers d’auth explicitement listés sont copiés, puis effacés avec les états des CLI. Aucun texte de modèle ni secret dans les preuves.', '',
    'Écart : un point d’entrée Python est bloqué, conformément à l’interdiction du propriétaire. Les écrans de démarrage reconnus sont validés normalement dans le workspace vide temporaire ; aucune désactivation de permission ni modification persistante du trust.', '',
    '| Émetteur | Destinataire | Statut | M émetteur / récepteur | D | R | W | A | Motif | Preuve |',
    '|---|---|---|---|---|---|---|---|---|---|'];
  const flag = v => v === true ? 'oui' : v === false ? 'non' : 'non mesuré';
  for (const c of result.cells) lines.push(`| ${c.sender} | ${c.receiver} | ${c.status} | ${flag(c.senderMcp)} / ${flag(c.receiverMcp)} | ${flag(c.delivered)} | ${flag(c.received)} | ${flag(c.woke)} | ${flag(c.replyDelivered)} | ${c.blocker ?? c.failure ?? '—'} | [JSON](2026-10-15-cross-cli-phase1.json#${c.sender}-${c.receiver}) |`);
  for (const c of result.cells) lines.push('', `## ${c.sender}-${c.receiver}`, '',
    `Statut : **${c.status}** ; motif : \`${c.blocker ?? c.failure ?? 'complete-round-trip'}\` ; durée : ${c.elapsedMs} ms.`, '',
    '```json', JSON.stringify(c.evidence), '```');
  return lines.join('\n') + '\n';
}

async function main() {
  assert.ok([22, 24].includes(Number(process.versions.node.split('.')[0])), 'Node 22/24 required');
  const root = fs.mkdtempSync('/tmp/h2a-qual-');
  process.stdout.write(`Private qualification root: ${root}\n`);
  const built = sourceBuild(root);
  const sourcePath = process.env.PATH ?? '/usr/bin:/bin';
  const simulated = process.argv.includes('--simulated');
  assert.ok(!simulated || !option('--auth-home'), 'simulated CI must never read login files');
  const executables = Object.fromEntries(CLIS.map(cli => [cli, cliPath(cli, sourcePath)]));
  if (simulated) {
    fs.mkdirSync(join(root, 'sim-bin'));
    for (const cli of CLIS) {
      const path = join(root, 'sim-bin', cli);
      fs.writeFileSync(path, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(repo, 'scripts/xcli-simulated-model.mjs'))} ${quote(cli)} "$@"\n`, { mode: 0o700 });
      executables[cli] = path;
    }
  }
  const cells = [];
  let active;
  let stopping = false;
  const stop = () => { stopping = true; active?.kill('SIGTERM'); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  const selected = option('--pair');
  const pairs = CLIS.flatMap(sender => CLIS.map(receiver => ({ sender, receiver })))
    .filter(p => !selected || `${p.sender}:${p.receiver}` === selected);
  assert.ok(pairs.length, 'unknown --pair');
  const timeoutMs = Number(option('--timeout-ms', '30000'));
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 180000, 'invalid bounded timeout');
  for (const { sender, receiver } of pairs) {
    if (stopping) {
      cells.push({ sender, receiver, status: 'blocked', blocker: 'qualification-cancelled', evidence: [], elapsedMs: 0 });
      continue;
    }
    const child = spawn(process.execPath, [self, '--worker'], {
      env: { ...environment(join(root, 'worker')), H2A_TEST_QUALIFICATION_ROOT: root },
      cwd: root, stdio: ['pipe', 'pipe', 'ignore'],
    });
    active = child;
    const watchdog = setTimeout(() => child.kill('SIGTERM'), timeoutMs * 2 + 45000);
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stdin.end(JSON.stringify({ sender, receiver, root, build: built.path, executables, timeoutMs,
      authHome: option('--auth-home'), simulated, dropWake: process.argv.includes('--drop-simulated-wake') }));
    await new Promise((r, reject) => { child.once('close', r); child.once('error', reject); });
    clearTimeout(watchdog);
    active = undefined;
    let row;
    try { row = JSON.parse(output); } catch { row = { sender, receiver, status: 'blocked', blocker: 'qualification-worker-failed', evidence: [], elapsedMs: 0 }; }
    cells.push(row);
    fs.writeFileSync(join(root, `${sender}-${receiver}.json`), JSON.stringify(row, null, 2) + '\n', { mode: 0o600 });
    if (row.cleanupFailed) stopping = true;
    process.stdout.write(`${sender} -> ${receiver}: ${row.status} (${row.blocker ?? row.failure ?? 'round-trip'})\n`);
  }
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const result = { version: 1, mode: simulated ? 'simulated-model' : 'real-cli', sha, node: process.version,
    command: ['node', 'scripts/qualify-cross-cli.mjs', ...process.argv.slice(2)].join(' '),
    root, build: built,
    harnessDigests: Object.fromEntries(['qualify-cross-cli.mjs', 'xcli-lab.mjs', 'xcli-proxy.mjs', 'xcli-simulated-model.mjs'].map(name =>
      [name, createHash('sha256').update(fs.readFileSync(join(repo, 'scripts', name))).digest('hex')])),
    cells, counts: Object.fromEntries([simulated ? 'simulated-OK' : 'measured-OK', simulated ? 'simulated-KO' : 'measured-KO', 'blocked'].map(s => [s, cells.filter(c => c.status === s).length])) };
  const output = resolve(option('--output', join(root, 'qualification.json')));
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  if (!selected && !simulated) {
    const doc = resolve(option('--markdown', join(root, 'qualification.md')));
    fs.writeFileSync(doc, markdown(result));
    process.stdout.write(`Table: ${doc}\n`);
  }
  process.stdout.write(`Evidence: ${output}\n${JSON.stringify(result.counts)}\n`);
  process.off('SIGTERM', stop);
  process.off('SIGINT', stop);
  process.exitCode = cells.every(c => c.status === (simulated ? 'simulated-OK' : 'measured-OK')) ? 0 : 2;
}

if (process.argv.includes('--worker')) {
  process.stdout.write(JSON.stringify(await worker()));
} else if (process.argv[1] && resolve(process.argv[1]) === self) await main();
