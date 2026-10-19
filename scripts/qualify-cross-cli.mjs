#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { CLIS, PROBE, REPLY, repo, environment, sourceBuild, copyLogin,
  cliPath, privateExecutable, pythonEntrypoint, classify, matrix, inside } from './xcli-lab.mjs';
import { startupTerminal } from './xcli-terminal.mjs';
import { verifyWakeBatch } from './xcli-ci-check.mjs';

const self = fileURLToPath(import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};
// Lot L3 wake protocol (§3.3): closed flag grammar. Timings are PROPOSITION
// values (ratified under D2); relations and refusals are normative.
const SIM_WAKE_DEFAULTS = { w0Ms: 2000, w1Ms: 13000, dMs: 3000 };
const REAL_WAKE_DEFAULTS = { w0Ms: 5000, w1Ms: 15000, dMs: 20000 };
function parseWakeWindows(raw, simulated) {
  const fallback = simulated ? SIM_WAKE_DEFAULTS : REAL_WAKE_DEFAULTS;
  if (raw === undefined) return { ...fallback };
  const parts = raw.split(",").map(Number);
  assert.ok(parts.length === 3 && parts.every(n => Number.isSafeInteger(n) && n >= 0),
    "invalid --wake-windows (expected w0Ms,w1Ms,dMs non-negative integers)");
  return { w0Ms: parts[0], w1Ms: parts[1], dMs: parts[2] };
}
function parsePollSpec(raw) {
  if (raw === undefined) return undefined;
  const m = /^(periodic:(\d+):(\d+)|single:(\d+)|wakedelay:(\d+))$/.exec(raw);
  assert.ok(m, "invalid --poll (expected periodic:<periodMs>:<phaseMs>, single:<atMs> or wakedelay:<delayMs>)");
  if (m[2] !== undefined) { assert.ok(Number(m[2]) > 0, "poll period must be positive"); return { mode: "periodic", nums: [Number(m[2]), Number(m[3])] }; }
  return { mode: m[1].split(":")[0] === "single" ? "single" : "wakedelay", nums: [Number(m[4] ?? m[5])] };
}
function pollEnvValue(poll) {
  if (!poll) return undefined;
  return poll.mode === "periodic" ? `periodic:${poll.nums[0]}:${poll.nums[1]}`
    : poll.mode === "single" ? `single:${poll.nums[0]}` : `wakedelay:${poll.nums[0]}`;
}
function parseOffsets(raw) {
  if (raw === undefined) return [0];
  const parts = raw.split(",").map(Number);
  assert.ok(parts.length >= 1 && parts.every(n => Number.isSafeInteger(n) && n >= 0),
    "invalid --wake-release-offsets-ms (expected non-negative integers)");
  return parts;
}
const readEvents = path => {
  try { return fs.readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};

// Closed vocabulary only: provider text and errors never leave process memory.
function startupFacts(screen) {
  const vocabulary = ['Welcome to Claude', 'Quick safety check', 'Yes, I trust this folder',
    'Yes, I trust this project', 'No, exit', 'Choose the text style', 'Trust this folder?',
    'Default permissions', 'Choose your permissions', 'Choose how', 'Select',
    'permissions', 'Press', 'Enter', 'continue', 'confirm', 'trust', 'folder',
    "You're in control", 'Codex can make mistakes', 'Included with your ChatGPT plan',
    'Learn about permissions and approvals', 'security notes', 'MCP', 'Allow', 'Sign in', 'Select login method:',
    'Do you trust this workspace?', 'Trust and continue', 'Quit'];
  return { matched: vocabulary.filter(text => screen.includes(text)),
    trustChoices: screen.split('\n').filter(line => /Trust and continue|\bQuit\b/.test(line)).map(line => ({
      choice: line.includes('Trust and continue') ? 'trust' : 'quit',
      marked: /^\s*[❯›>●]/.test(line) })),
    errorSignals: Object.entries({ unknownArgument: /unknown (?:option|argument)|unexpected argument|unrecognized (?:option|argument)/i,
      cursorPosition: /cursor position could not be read/i, missingLibrary: /error while loading shared libraries/i,
      terminal: /terminal|tty/i, error: /\berror\b|panic/i }).filter(([, pattern]) => pattern.test(screen)).map(([name]) => name),
    choices: [...screen.matchAll(/(?:^|\n)\s*([›❯>]?)\s*([1-9])[.)]\s*(Yes|No)\b/g)].map(m => ({ selected: Boolean(m[1]), number: Number(m[2]), choice: m[3] })),
    qualificationDraft: /^\s*›\s*Qualification h2a\./m.test(screen),
    wakeDraft: /^\s*[❯›]\s*\[h2a from=/m.test(screen),
    emptyComposer: /^\s*[❯›]\s*$/m.test(screen), interruptVisible: /esc to interrupt/i.test(screen),
    signedWakeVisible: screen.includes('[h2a from='), inboxWakeVisible: screen.includes('[h2a-wake reason=inbox'),
    toolApproval: /permission.{0,20}(?:required|denied)|allow.{0,30}(?:tool|MCP)|approve.{0,25}(?:tool|MCP)/i.test(screen) };

}
export function blockingScreen(screen) {
  if (/sign in|log in|login required|not logged in|authentication required|please authenticate|API key.{0,30}(?:missing|required)|Select authentication|Select login method|How would you like to authenticate/i.test(screen)) return 'authentication-required';
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
  const { sender, receiver, root, build, executables, timeoutMs, authHome, simulated, dropWake,
    wake, poll, withholdForever, replayWake, releaseOffsetMs } = request;
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
  let withholdLease = null;
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
      ...(poll && role === 'receiver' ? { XCLI_POLL: poll } : {}),
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
    const executable = simulated ? { path: executables[cli] } : privateExecutable(cli, executables[cli], dir);
    if (executable.version) row.evidence.push({ event: 'private-program-copy', role, cli,
      version: executable.version, hashes: executable.hashes });
    const state = await client.create({ id: `h2a-${role}`, command: executable.path,
      args: argsFor(cli, prompt), cwd: workspace, env: isolation.isolatedNativeTestEnvironment(env), cols: 140, rows: 40 });
    isolation.pinPrivateNativeProcess(state.pid, env);
    enroll({ id: role, label: role, tool: cli, kind: 'local-native', cwd: workspace,
      tmuxSession: state.id, source: 'run', sessionClass: 'human' }, registry);
    const target = { cli, role, dir, env, state, seq: 0, screen: '', workspace, terminal: startupTerminal() };
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
      await target.terminal.write(chunk.data);
    }
    const replies = target.terminal.responses();
    if (replies.length) {
      const lease = await client.acquireController(target.state.id, 'xcli-terminal', 'automation');
      try { for (const reply of replies) await client.write(lease, reply); }
      finally { await client.releaseController(lease); }
      row.evidence.push({ event: 'startup-terminal-response', role: target.role, count: replies.length, at: Date.now() });
    }
    return target.terminal.screen();
  }
  async function startup(target, screen) {
    target.startupActions ??= new Set();
    const action = startupKey(screen);
    if (!action) return false;
    // Rendering a choice does not mean the CLI has installed its key handler.
    // Use the same quiet interval as readiness, within the existing deadline.
    if (target.startupActions.has(action) || Date.now() - (target.lastOutputAt ?? Date.now()) < 2000) { await sleep(100); return true; }
    target.startupActions.add(action);
    const lease = await client.acquireController(target.state.id, 'xcli-startup', 'automation');
    try {
      // Claude 2.1.301 hides indexes and focuses Cancel in this exact dialog.
      // Navigate its normal UI to the explicit trust choice in our empty workspace.
      const cancelFirst = action === 'trust-empty-workspace' && target.cli === 'claude' &&
        screen.includes('Quick safety check') && screen.includes('No, exit') && screen.includes('Yes, I trust this folder');
      await client.write(lease, cancelFirst ? '\x1b[B\r' : '\r');
    } finally { await client.releaseController(lease); }
    row.evidence.push({ event: 'startup-ui', role: target.role, action, facts: startupFacts(screen),
      choiceStyles: target.terminal.choiceStyles(['Trust and continue', 'Quit']), at: Date.now() });
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
      if (blocker) { row.evidence.push({ event: 'startup-screen-facts', role: target.role, facts: startupFacts(screen) }); return { blocker }; }
      const identity = events(target).find(e => e.event === 'identity' && e.ok && e.ready);
      const armed = events(target).some(e => e.event === 'wake-armed');
      if (identity && loaded(target) && armed && paneIsReady(screen, target.cli) && Date.now() - (target.lastOutputAt ?? Date.now()) >= 2000) {
        quietSince ??= Date.now();
        if (Date.now() - quietSince >= 2000) return { instance: identity.instance };
      } else quietSince = undefined;
      const state = await client.state(target.state.id);
      if (state.status === 'exited') {
        row.evidence.push({ event: 'cli-exit', role: target.role, exit: state.exit,
          facts: startupFacts(screen), rawFacts: startupFacts(stripAnsi(target.screen)) });
        return { blocker: 'cli-exited-before-ready' };
      }
      await sleep(100);
    }
    const e = events(target);
    row.evidence.push({ event: 'startup-screen-facts', role: target.role, facts: startupFacts(target.terminal.screen()) });
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
    const barrierAt = Date.now();
    row.evidence.push({ event: 'receiver-idle-barrier', at: barrierAt, instance: readiness.instance });
    row.barrierAt = barrierAt;
    try { fs.writeFileSync(join(cell, 'barrier-at'), String(barrierAt) + '\n', { mode: 0o600 }); }
    catch { row.blocker = 'barrier-file-unwritable'; return row; }
    r.terminal.freeze();
    // Lot L3 withheld-wake protocol (§3.3): W0 silent baseline, W1 withheld
    // drive, D released delay. Window sizes are PROPOSITION values (D2);
    // relations and refusals are normative. A cell that cannot fund W0+W1+D
    // inside its budget is blocked (wake-window-unfunded), never shortened.
    const { w0Ms, w1Ms, dMs } = wake;
    const notifyIntervalMs = simulated ? 100 : 0; // 0 = product default, recorded but unset
    row.budgetMs = timeoutMs;
    row.wakeWindows = { w0Ms, w1Ms, dMs, barrierAt, releaseOffsetMs, notifyIntervalMs,
      deliveryAt: null, withholdAt: null, releaseAt: null, wakeAt: null, firstReadAt: null,
      baselineReads: 0, preBarrierReads: 0 };
    row.wakeClaim = 'no wake claimed (no durable delivery)';
    if (timeoutMs - (barrierAt - started) < w0Ms + w1Ms + dMs) {
      row.blocker = 'wake-window-unfunded'; return row;
    }
    // Withhold the product drive at the harness-owned private host BEFORE any
    // envelope exists: while this worker lease is held, the product drive
    // request is deferred (session already has a controller) so the wake
    // handler sees drive → false and retries per tick; the signed line never
    // reaches the PTY. No product code changes, no model fault injected.
    withholdLease = null;
    try {
      withholdLease = await client.acquireController(r.state.id, 'xcli-withhold', 'automation');
    } catch { row.blocker = 'wake-withhold-unavailable'; return row; }
    const withholdAt = Date.now();
    row.wakeWindows.withholdAt = withholdAt;
    row.evidence.push({ event: 'wake-withhold', at: withholdAt });
    const receiverReads = (from = 0, to = Infinity) => readEvents(r.env.XCLI_EVENTS)
      .filter(e => e.event === 'inbox' && e.ok && e.instance === readiness.instance && e.at >= from && e.at < to);
    const cancellableSleep = async ms => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if (cancelled) return false;
        await sleep(Math.min(100, until - Date.now()));
      }
      return !cancelled;
    };
    await cancellableSleep(w0Ms); // Phase 1: silent baseline, sender launch delayed
    const senderPrompt = `Qualification h2a. Use only h2a MCP tools. Call h2a_identity_status until identity_ready (stop if identity_failed), then h2a_send once, to exactly ${readiness.instance}, message exactly ${PROBE}. Finish your turn. Never use shell, files, other agents or any non-h2a tool.`;
    const s = await launch(sender, 'sender', senderPrompt);
    const deadline = Date.now() + timeoutMs;
    // Phase 2a: wait for the signed send and durable delivery. No reply break
    // here: the withheld-window observation must run its full course.
    let send = null, deliveryAt = 0;
    while (Date.now() < deadline) {
      if (cancelled) { row.blocker = 'qualification-cancelled'; break; }
      const se = events(s);
      row.senderMcp = loaded(s);
      send = se.find(e => e.event === 'send' && e.ok && e.kind === 'probe' && e.to === readiness.instance) ?? null;
      row.sent = Boolean(send);
      if (send) s.terminal.freeze();
      if (send && store.readInbox(readiness.instance).some(e => e.id === send.envelopeId && e.body?.text === PROBE && e.actor?.instance === send.from)) {
        deliveryAt = Date.now(); break;
      }
      const senderScreen = await capture(s);
      if (!row.sent && await startup(s, senderScreen)) continue;
      const blocker = blockingScreen(senderScreen) ?? blockingScreen(await capture(r));
      if (blocker) { row.blocker = blocker; break; }
      await sleep(100);
    }
    row.delivered = Boolean(send && deliveryAt);
    if (!send || !deliveryAt) {
      if (withholdLease) await client.releaseController(withholdLease).catch(() => {});
      withholdLease = null;
      row.woke = false;
      if (!row.blocker) row.failure = row.sent ? 'live-receive-not-observed' : 'sender-send-not-observed';
    } else {
      row.wakeWindows.deliveryAt = deliveryAt;
      const releaseAt = deliveryAt + w1Ms + releaseOffsetMs;
      row.wakeWindows.releaseAt = withholdForever ? null : releaseAt;
      // Phase 2b: withheld window. The probe is already readable in the
      // inbox; any receiver read before release proves polling.
      while (Date.now() < Math.min(releaseAt, deadline)) {
        if (cancelled) { row.blocker = 'qualification-cancelled'; break; }
        const blocker = blockingScreen(await capture(s)) ?? blockingScreen(await capture(r));
        if (blocker) { row.blocker = blocker; break; }
        await sleep(200);
      }
      const preBarrierReads = receiverReads(0, barrierAt);
      const baselineReads = receiverReads(barrierAt, deliveryAt);
      const withheldReads = receiverReads(deliveryAt, withholdForever ? Infinity : releaseAt);
      row.wakeWindows.preBarrierReads = preBarrierReads.length;
      row.wakeWindows.baselineReads = baselineReads.length;
      if (!withholdForever && !row.blocker) {
        try {
          await client.releaseController(withholdLease); withholdLease = null;
          row.evidence.push({ event: 'wake-release', at: Date.now() });
        }
        catch { row.blocker = 'wake-withhold-unavailable'; }
      }
      // Phase 3: released window. Wait for the product wake, the qualifying
      // read and the signed reply — plus first-wake/read tracking.
      let firstWakeOk = null, firstRead = null;
      while (Date.now() < deadline && !withholdForever && !row.blocker) {
        if (cancelled) { row.blocker = 'qualification-cancelled'; break; }
        const se = events(s), re = events(r);
        row.senderMcp = loaded(s);
        const receive = re.find(e => e.event === 'inbox' && e.ok && e.at >= send.at && e.instance === readiness.instance &&
          e.envelopes.some(v => v.id === send.envelopeId && v.from === send.from && v.to === readiness.instance && v.kind === 'probe'));
        row.received = Boolean(receive);
        if (!firstWakeOk) firstWakeOk = re.find(e => e.event === 'inbox-wake' && e.ok && e.at >= releaseAt) ?? null;
        if (!firstRead) firstRead = re.find(e => e.event === 'inbox' && e.ok && e.instance === readiness.instance && e.at >= releaseAt) ?? null;
        if (row.noPostSendHarnessInput && row.evidence.some(e => e.role === 'receiver' &&
          ['startup-ui', 'startup-terminal-response'].includes(e.event) && e.at >= barrierAt)) {
          row.noPostSendHarnessInput = false;
        }
        const reply = receive ? re.find(e => e.event === 'send' && e.ok && e.kind === 'reply' && e.to === send.from && e.from === readiness.instance && e.at >= receive.at) : null;
        row.replied = Boolean(reply);
        row.replyDelivered = Boolean(reply) && store.readInbox(send.from).some(e => e.id === reply.envelopeId && e.body?.text === REPLY && e.actor?.instance === readiness.instance);
        if (row.replyDelivered && row.received) break;
        const senderScreen = await capture(s);
        if (!row.sent && await startup(s, senderScreen)) continue;
        const blocker = blockingScreen(senderScreen) ?? blockingScreen(await capture(r));
        if (blocker) { row.blocker = blocker; break; }
        await sleep(100);
      }
      if (withholdForever) {
        row.wakeFailure = 'wake-withheld-forever';
        row.wakeClaim = 'no wake claimed (wake never released)';
        row.woke = false;
      } else {
        row.wakeClaim = `withheld-protocol, periods ≤ ${w1Ms}ms excluded, single replication (no batch separation); varying-phase polling not excluded`;
        row.wakeWindows.wakeAt = firstWakeOk?.at ?? null;
        row.wakeWindows.firstReadAt = firstRead?.at ?? null;
        const firstReadHasProbe = Boolean(firstRead?.envelopes?.some(v => v.id === send.envelopeId &&
          v.from === send.from && v.to === readiness.instance && v.kind === 'probe'));
        if (preBarrierReads.length || baselineReads.length || withheldReads.length) row.wakeFailure = 'wake-polling-detected';
        else if (!firstWakeOk) row.wakeFailure = 'wake-no-qualifying-read';
        else if (!firstRead || !firstReadHasProbe) row.wakeFailure = 'wake-no-qualifying-read';
        else if (firstRead.at < firstWakeOk.at || firstRead.at - firstWakeOk.at > dMs) row.wakeFailure = 'wake-delay-exceeded';
        row.woke = Boolean(row.received && firstReadHasProbe && !row.wakeFailure && row.noPostSendHarnessInput);
      }
      // Control (d): replay the exact witnessed wake line after a pass. The
      // duplicate must produce no second qualifying read and no second reply.
      if (replayWake && !row.blocker && row.replyDelivered && row.received && row.woke) {
        let replayed = null;
        try {
          const logged = fs.readFileSync(join(cell, 'wake-lines', 'receiver.log'), 'utf8').split('\n').filter(Boolean);
          replayed = logged.at(-1) ?? null;
        } catch { /* no witnessed line: control cannot run */ }
        const probeReadsBefore = receiverReads(0, Infinity).filter(e => e.envelopes?.some(v => v.kind === 'probe')).length;
        const replySendsBefore = readEvents(r.env.XCLI_EVENTS).filter(e => e.event === 'send' && e.ok && e.kind === 'reply').length;
        if (replayed) {
          row.evidence.push({ event: 'wake-replay', at: Date.now() });
          row.postPassReplayInput = true;
          const lease = await client.acquireController(r.state.id, 'xcli-replay', 'automation');
          try { await client.write(lease, replayed); await sleep(100); await client.write(lease, '\r'); }
          finally { await client.releaseController(lease).catch(() => {}); }
          await cancellableSleep(3000);
        }
        const probeReadsAfter = receiverReads(0, Infinity).filter(e => e.envelopes?.some(v => v.kind === 'probe')).length;
        const replySendsAfter = readEvents(r.env.XCLI_EVENTS).filter(e => e.event === 'send' && e.ok && e.kind === 'reply').length;
        row.replayRejected = Boolean(replayed) && probeReadsAfter === probeReadsBefore && replySendsAfter === replySendsBefore;
      }
      if (!row.blocker && !row.replyDelivered) {
        row.failure = row.sent ? (row.received ? (row.wakeFailure ? 'wake-not-proven' : 'reply-not-observed') : 'live-receive-not-observed') : 'sender-send-not-observed';
      }
    }
    if (!row.replyDelivered) for (const target of targets)
      row.evidence.push({ event: 'final-screen-facts', role: target.role, facts: startupFacts(await capture(target)) });
    if (!row.blocker && !row.replyDelivered && !row.wakeFailure) row.failure = row.sent ? (row.received ? 'reply-not-observed' : 'live-receive-not-observed') : 'sender-send-not-observed';
    return row;
  } catch (error) {
    const known = ['host-setup-no-config'];
    row.blocker = known.includes(error.message) ? error.message : 'qualification-infrastructure-error';
    row.infrastructureCode = /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : undefined;
    row.infrastructureLocations = String(error.stack ?? '').split('\n').slice(1)
      .filter(line => line.includes(build) || line.includes(repo)).map(line => line.trim());
    return row;
  } finally {
    if (withholdLease && client) {
      try { await client.releaseController(withholdLease); } catch { /* cleanup path releases best-effort */ }
      withholdLease = null;
    }
    for (const t of targets) {
      row.evidence.push(...events(t).map(e => ({ role: t.role, ...e })));
      row.evidence.push({ event: 'terminal-queries', role: t.role, kinds: t.terminal.queries() });
    }
    for (const t of targets.reverse()) {
      try {
        const owned = isolation.pinPrivateNativeProcess(t.state.pid, t.env);
        row.evidence.push({ event: 'owned-process-states', role: t.role, states: owned.pids.flatMap(pid => {
          try {
            const stat = fs.readFileSync(join(t.env.H2A_TEST_OWNED_PROC_ROOT, pid + '.pin', 'stat'), 'utf8');
            return [{ pid, state: stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) }];
          } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return []; throw error; }
        }) });
      }
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
      t.terminal.dispose();
      try { await isolation.waitForPrivateNativeProcesses(t.env); }
      catch (error) { cleanupError('owned-wait', error); }
    }
    row.elapsedMs = Date.now() - started;
    row.status = row.cleanupFailed ? 'blocked' : classify(row);
    if (simulated) row.status = row.status.replace('measured-', 'simulated-');
    if (row.cleanupFailed) row.blocker = 'owned-process-cleanup-failed';
    // Remove copied logins and CLI-owned transcripts. Only allowlisted witness
    // records returned to the parent survive the cell.
    if (!row.cleanupFailed) {
      fs.rmSync(cell, { recursive: true, force: true });
      row.evidence.push({ event: 'cleanup-complete', ownedProcessesStopped: true, privateStateRemoved: !fs.existsSync(cell) });
    }
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
  const wakeWindows = parseWakeWindows(option('--wake-windows'), simulated);
  const poll = parsePollSpec(option('--poll'));
  const withholdForever = process.argv.includes('--withhold-forever');
  const replayWake = process.argv.includes('--replay-wake');
  const releaseOffsets = parseOffsets(option('--wake-release-offsets-ms'));
  assert.ok(!withholdForever || releaseOffsets.length === 1, '--withhold-forever runs a single cell');
  const notifyIntervalMs = simulated ? 100 : 0; // 0 = product default, recorded but not set
  const runs = [];
  for (const { sender, receiver } of pairs) for (const releaseOffsetMs of releaseOffsets) runs.push({ sender, receiver, releaseOffsetMs });
  for (const { sender, receiver, releaseOffsetMs } of runs) {
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
      authHome: option('--auth-home'), simulated, dropWake: process.argv.includes('--drop-simulated-wake'),
      wake: wakeWindows, poll: pollEnvValue(poll), withholdForever, replayWake, releaseOffsetMs }));
    await new Promise((r, reject) => { child.once('close', r); child.once('error', reject); });
    clearTimeout(watchdog);
    active = undefined;
    let row;
    try { row = JSON.parse(output); } catch { row = { sender, receiver, status: 'blocked', blocker: 'qualification-worker-failed', evidence: [], elapsedMs: 0 }; }
    row.releaseOffsetMs = releaseOffsetMs;
    cells.push(row);
    fs.writeFileSync(join(root, `${sender}-${receiver}.json`), JSON.stringify(row, null, 2) + '\n', { mode: 0o600 });
    if (row.cleanupFailed) stopping = true;
    process.stdout.write(`${sender} -> ${receiver}: ${row.status} (${row.blocker ?? row.failure ?? 'round-trip'})\n`);
  }
  // Lot L3 batch separation (§3.3): with several harness-chosen release
  // offsets for one pair, no cell earns stage-7 credit until the full batch
  // passes the containment check on actual witnessed times. A failing batch
  // downgrades credited cells; cells already KO keep their own mechanism.
  if (releaseOffsets.length > 1) {
    for (const { sender, receiver } of pairs) {
      const group = cells.filter(c => c.sender === sender && c.receiver === receiver);
      if (!group.length) continue;
      const verdict = verifyWakeBatch(group);
      if (verdict.pass) {
        for (const cell of group) {
          cell.wakeClaim = `withheld-protocol, periods ≤ ${cell.wakeWindows.w1Ms}ms excluded, ${group.length} separated replications; varying-phase polling not excluded`;
        }
      } else {
        for (const cell of group) {
          if (cell.woke === true) {
            cell.woke = false;
            cell.wakeFailure = 'wake-phase-separation-unproven';
            cell.status = classify(cell).replace(/^measured-/, simulated ? 'simulated-' : 'measured-');
          }
        }
      }
      process.stdout.write(`wake batch ${sender}->${receiver}: ${verdict.pass ? 'separated' : 'NOT separated'} (${verdict.failures.join('; ')})\n`);
    }
  }
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const result = { version: 1, mode: simulated ? 'simulated-model' : 'real-cli', sha, node: process.version,
    command: ['node', 'scripts/qualify-cross-cli.mjs', ...process.argv.slice(2)].join(' '),
    root, build: built,
    harnessDigests: Object.fromEntries(['qualify-cross-cli.mjs', 'xcli-lab.mjs', 'xcli-proxy.mjs', 'xcli-terminal.mjs', 'xcli-simulated-model.mjs'].map(name =>
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
