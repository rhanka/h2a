#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname, resolve, relative } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { CLIS, PROBE, REPLY, repo, environment, sourceBuild, copyLogin, copyLoginReport, PINNED_CLI_ARGS,
  cliPath, privateExecutable, pythonEntrypoint, classify, matrix, inside,
  rehydrateEventRecord, cellSecretPaths, wipeSecrets, loginCopyPath, vibeCellKey,
  recordExec, readExecJournal, classifyExecJournal, vendorRuntimeLabel,
  compliantQualificationRoot } from './xcli-lab.mjs';
import { loadSeatManifest, resolveCampaignPair, createCampaignLedger, loadCampaignLedger,
  debitSession, fitsSessions, noteWallClock, wallClockFits, renderSeatLedger, persistLedger,
  runSeatPreflight, applyPreflightDebit } from './xcli-seats.mjs';
import { assertCyberManifest, assertNoAuthHome } from './xcli-seat-custody.mjs';
import { startupTerminal } from './xcli-terminal.mjs';
import { verifyWakeBatch } from './xcli-ci-check.mjs';
import { correlateWakeInput } from './xcli-wake-host.mjs';
import { buildSupervisor, supervisedCommand, supervisorResult } from './xcli-process-supervisor.mjs';
import { scanEvidenceText } from './xcli-evidence-scan.mjs';
import { parseScenario, expectedScenarioBlocker, UNKNOWN_INSTANCE, validateScriptSteps,
  loopScripts, loopTwinScripts, negotiationScripts, negotiationTwinScripts,
  inventoryScripts, LARGE_TEXT, classifyScenarioRow } from './xcli-scenarios.mjs';

const self = fileURLToPath(import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};
// Lot L3 wake protocol (§3.3): closed flag grammar. Timings are PROPOSITION
// values (ratified under D2); relations and refusals are normative.
const SIM_WAKE_DEFAULTS = { w0Ms: 13000, w1Ms: 13000, dMs: 3000 };
const REAL_WAKE_DEFAULTS = { w0Ms: 15000, w1Ms: 15000, dMs: 3000 };
export function parseWakeWindows(raw, simulated) {
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
// Lot L4: on-disk records are canonical {at, event, transcript} envelopes;
// rehydrate the evidence-shaped flat fields from the transcript so every
// consumer keeps its established access (shared helper in xcli-lab.mjs).
export const readEvents = path => {
  try {
    // Writers append JSONL while the worker polls. A snapshot may end in
    // a partial record; its newline commits it for the next read. Complete
    // malformed records still throw, rather than silently losing evidence.
    return fs.readFileSync(path, 'utf8').split('\n').slice(0, -1).filter(Boolean)
      .map(line => rehydrateEventRecord(JSON.parse(line)));
  }
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
  // R17 (P2-2): every approval form — tool, permission or shell command —
  // blocks, except the one MCP server approval that is a startup action.
  if (startupKey(screen) !== 'mcp-approval-allow' &&
    /permission.{0,20}(?:required|denied)|allow.{0,30}(?:this\s+shell\s+command|shell\s+command|tool|MCP)|approve.{0,25}(?:shell\s+command|tool|MCP)/i.test(screen)) return 'tool-approval-required';
  return undefined;
}

function argsFor(cli, prompt) {
  return [...(PINNED_CLI_ARGS[cli] ?? []), prompt];
}

// R21 (bench round 21, codex diagonal): the isolated codex cell shows the
// MCP/tool approval until its presses exhaust
// (codex-mcp-approval-unresolved). The cell HOME config therefore pre-seeds
// the documented per-server approval (`default_tools_approval_mode` takes
// `auto | prompt | writes | approve`; `approve` pre-approves) for our own
// h2a server only — cell HOME only, never the real HOME, and no permission
// is disabled. Every other family renders its previous bytes unchanged.
export function cellMcpConfigText(cli, endpoint) {
  if (cli === 'codex') {
    return `[mcp_servers.h2a]\ncommand = ${JSON.stringify(endpoint.command)}\n` +
      `args = ${JSON.stringify(endpoint.args)}\ndefault_tools_approval_mode = "approve"\n`;
  }
  return `[[mcp_servers]]\nname = "h2a"\ntransport = "stdio"\n` +
    `command = ${JSON.stringify(endpoint.command)}\nargs = ${JSON.stringify(endpoint.args)}\n`;
}

// R18: deterministic MCP-approval exhaustion. Claude >=2.1.314 shows an
// interactive MCP/tool-approval Allow screen after the trust dialog. The cell
// auto-confirms that one approval form inside its isolated HOME (bounded
// presses, startupKey 'mcp-approval-allow'); when the presses are exhausted
// and MCP never loads, the cell fails with this typed reason instead of the
// bare mcp-not-loaded-before-deadline. No trust or approval is pre-seeded
// outside the cell HOME, and no permission is disabled.
export const MCP_APPROVAL_PRESS_LIMIT = 5;

export function classifyApprovalExhaustion({ cli, presses, limit, mcpLoaded }) {
  if (mcpLoaded) return undefined;
  if (Number.isSafeInteger(presses) && Number.isSafeInteger(limit) && presses > limit) {
    return `${cli}-mcp-approval-unresolved`;
  }
  return undefined;
}

// R21 (bench round 21, muse diagonal): `muse config status` reports the
// enterprise plane with exit 0 whether or not a login exists, so a
// config-status contrast can never prove auth. The `usage` oracle shows the
// subscription allowance with no model turn: exit 1 with `not logged in`
// without (or with invalid) auth — measured on 1.4.14-R7309.1 — and a
// zero-exit allowance report with valid auth. A non-zero exit, empty output,
// or any measured login-negative marker reads non-authed, fail closed.
export const MUSE_NOAUTH_PATTERN = /not.*(logged|signed).?in|no .*auth|unauthenticated|missing.*(login|credential)|no_allowance|server_sent_no_usage|no subscription allowance|subscription allowance unavailable/i;

export function classifyMuseUsageProbe({ status, text }) {
  const body = `${text ?? ''}`;
  const authed = status === 0 && body.trim().length > 0 && !MUSE_NOAUTH_PATTERN.test(body);
  return { authed };
}

// Only normal startup UI interactions in our empty temporary workspace.
// No bypass flags, persisted trust edits, or inputs after the idle barrier.
export function startupKey(screen, cli) {
  // Claude >=2.1.314 shows an MCP/tool-approval Allow screen after the trust
  // dialog (captured: Enter+confirm+trust+Allow vocabulary with a permission
  // signal). Without a key the cell idles to mcp-not-loaded-before-deadline.
  // R17 (P2-2): only an MCP server approval is auto-confirmed; any other
  // tool, permission or shell-command approval stays undefined and fails
  // closed through the tool-approval blocker.
  if (/allow/i.test(screen) && /\bmcp\b/i.test(screen) &&
    /(server|\btools?\b|permission|approv|h2a)/i.test(screen) &&
    !/shell command/i.test(screen)) return 'mcp-approval-allow';
  // R21 (bench round 21, claude diagonal 01/11): Claude 2.1.316 shows the
  // same post-trust Allow dialog (Enter+confirm+trust+Allow with a permission
  // signal, composer ready, no MCP loaded) in a variant that names no
  // literal MCP token, so the worded key above misses it and the cell idles
  // the whole deadline. The variant is the same single startup action —
  // claude-scoped, bounded presses, exhaustion-typed — never a shell or
  // tool approval, which stay undefined and fail closed.
  if (cli === 'claude' && /allow/i.test(screen) && /trust/i.test(screen) &&
    /(confirm|press\s+enter)/i.test(screen) &&
    !/shell command/i.test(screen) && !/\btools?\b/i.test(screen) &&
    !/permission.{0,20}(?:required|denied)/i.test(screen)) return 'mcp-approval-allow';
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
  const { sender, receiver, root, build, executables, timeoutMs, simulated, dropWake,
    wake, poll, simPop, withholdForever, replayWake, releaseOffsetMs } = request;
  // Lot L12: scripted scenario mode. Probe is the default; unavailability
  // states fault the peer, refusal twins inject a faulty wake after a live
  // phase A. Unknown specs never reach the worker (parsed in main).
  const scenario = parseScenario(request.scenario ?? 'probe');
  // Lot L8: per-role auth sources from the seat manifest, seat attribution,
  // and the per-session MCP-call cap. R18: requests without them carry no
  // credential paths at all.
  const authHomes = request.authHomes ?? {};
  const mcpCallCap = Number(request.mcpCallCap ?? 0);
  // Lot L5: the parent pre-creates the cell and passes it in the request so a
  // lost worker's secrets stay attributable and wipable. A provided cell must
  // stay inside the campaign root; otherwise the worker mints its own.
  let cell = null;
  try { if (typeof request.cell === 'string') cell = inside(root, request.cell); } catch { cell = null; }
  cell ??= fs.mkdtempSync(join(root, 'c-'));
  // Direct-worker instrumentation is partial. The parent owns the kernel
  // exec observer and replaces this view before any campaign publication.
  const execJournal = join(cell, 'exec-journal.jsonl');
  recordExec(execJournal, { pid: process.pid, path: resolve(process.argv[1] ?? process.execPath), tag: 'harness' });
  const inputJournal = join(cell, 'native-input.jsonl');
  const hostEnv = { ...environment(cell), H2A_TEST_QUALIFICATION_ROOT: root,
    XCLI_CELL: cell, XCLI_BUILD: build, XCLI_INPUT_JOURNAL: inputJournal };
  Object.assign(process.env, hostEnv);
  const isolation = await import(pathToFileURL(join(build, 'packages/h2a/test/helpers/native-isolation.js')));
  const { NativeTerminalClient } = await import(pathToFileURL(join(build, 'packages/h2a-runtime/dist/native-terminal/client.js')));
  const { enroll } = await import(pathToFileURL(join(build, 'packages/h2a-runtime/dist/registry.js')));
  const product = await import(pathToFileURL(join(build, 'packages/h2a/dist/index.js')));
  const { createLocalStore, H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS } = product;
  const notifyIntervalMs = simulated ? 100 : H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS;
  const { paneIsReady } = await import(pathToFileURL(join(build, 'packages/h2a-runtime/dist/prompt-delivery.js')));
  const { stripAnsi } = await import(pathToFileURL(join(build, 'packages/h2a-runtime/dist/native-terminal/op.js')));
  const row = { sender, receiver, scenario: scenario.key, status: 'blocked', senderMcp: null, receiverMcp: null,
    sent: null, delivered: null, received: null, woke: null, replied: null, replyDelivered: null,
    evidence: [], startedAt: new Date().toISOString(), credentialsCopied: {}, cell,
    seats: request.seats ?? { sender: null, receiver: null },
    sharedSeat: request.seats ? request.seats.sender === request.seats.receiver : null,
    seatMode: request.seatMode ?? 'no-seats',
    noPostSendHarnessInput: true };
  let host, client;
  let withholdLease = null;
  const targets = [];
  const registry = join(hostEnv.HOME, '.config/sentropic/remote-cli/registry.json');
  const store = createLocalStore({ root: hostEnv.H2A_ROOT });
  const bin = join(build, 'packages/h2a/dist/bin.js');
  const proxy = join(repo, 'scripts/xcli-proxy.mjs');
  const started = Date.parse(row.startedAt);
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
  // Lot L14: per-cell throwaway signing keys for negotiation scenarios.
  // Generated per cell, passed via process env only, never retained.
  const scriptKeyVars = () => {
    const pair = () => generateKeyPairSync('ed25519');
    const pem = (key, type) => key.export({ type, format: 'pem' });
    const a = pair(), b = pair();
    return { pubKeyA: pem(a.publicKey, 'spki'), privKeyA: pem(a.privateKey, 'pkcs8'),
      pubKeyB: pem(b.publicKey, 'spki'), privKeyB: pem(b.privateKey, 'pkcs8') };
  };
  async function launch(cli, role, prompt, scriptJson, scriptVars, scriptEnv) {
    const dir = join(cell, role);
    fs.mkdirSync(dir, { mode: 0o700 });
    const env = { ...environment(dir), H2A_TEST_QUALIFICATION_ROOT: root,
      H2A_ROOT: hostEnv.H2A_ROOT, H2A_NATIVE_SOCKET: hostEnv.H2A_NATIVE_SOCKET,
      REMOTE_CLI_CONFIG_HOME: hostEnv.HOME,
      H2A_NATIVE_TARGET_SESSION: `h2a-${role}`, H2A_NATIVE_PTY_SESSION: `h2a-${role}`,
      XCLI_CELL: cell, XCLI_EVENTS: join(dir, 'events.jsonl'), XCLI_BIN: bin,
      XCLI_BUILD: build, XCLI_EXEC_JOURNAL: execJournal, ...(simulated ? { XCLI_SIMULATED: '1' } : {}),
      ...(scriptJson ? { XCLI_SCRIPT: scriptJson } : {}),
      ...(scriptVars ? { XCLI_SCRIPT_VARS: JSON.stringify(scriptVars) } : {}),
      ...(scriptEnv ?? {}),
      ...(mcpCallCap > 0 ? { XCLI_MCP_CALL_CAP: String(mcpCallCap) } : {}),
      ...(poll && role === 'receiver' ? { XCLI_POLL: poll } : {}),
      // V3 §3.2 models a receiver that consumes the probe (read then pop)
      // before replying. Simulated cells only; the wake proof must survive
      // this authorized consumption via the delivery witness.
      ...(simPop && simulated && role === 'receiver' ? { XCLI_SIM_POP: '1' } : {}),
      // Lot L12: the never-ready fault idles the receiver's identity gate.
      ...(scenario.kind === 'unavailability' && scenario.state === 'identity-never-ready' && role === 'receiver'
        ? { XCLI_SCENARIO_FAULT: 'never-ready' } : {}),
      // Both peers belong to this one experiment. Their lock liveness checks
      // must see the same owned-process view, never unrelated owner processes.
      H2A_TEST_PROC_ROOT: process.env.H2A_TEST_PROC_ROOT,
      H2A_TEST_OWNED_PROC_ROOT: process.env.H2A_TEST_OWNED_PROC_ROOT,
      H2A_NOTIFY_INTERVAL_MS: String(notifyIntervalMs),
      H2A_MCP_TRACE: '1',
      ...(dropWake ? { XCLI_DROP_WAKE: '1' } : {}),
    };
    // The auth-only family allowlist is enforced by copyLogin. The mapping is witnessed
    // (role, allowlisted name, sha256 — never content) in the row evidence.
    // R15 (class-c): every skipped allowlisted file is witnessed too, with
    // its reason — a missing source no longer copies silently.
    const roleAuthHome = simulated ? null : authHomes[role];
    const report = roleAuthHome ? copyLoginReport(cli, roleAuthHome, cell, env) : { copied: [], skipped: [] };
    row.credentialsCopied[role] = report.copied;
    for (const skip of report.skipped) {
      row.evidence.push({ event: 'login-skipped', role, cli, file: skip.file, reason: skip.reason });
    }
    for (const name of row.credentialsCopied[role]) {
      const mapped = loginCopyPath(env, cli, name);
      row.evidence.push({ event: 'login-mapped', role, cli, file: name,
        sha256: createHash('sha256').update(fs.readFileSync(mapped)).digest('hex') });
    }
    // R19: the vendor Vibe product reads its key from MISTRAL_API_KEY (env
    // wins, else the OS keyring — no auth file). The seated value crosses
    // into the cell only through the allowlisted seat file above (see
    // vibeCellKey); the parent wipe erases both afterwards.
    const vibeWitness = vibeCellKey(env, cli, row.credentialsCopied[role]);
    if (vibeWitness) row.evidence.push({ event: 'vibe-key-exported', role, cli, ...vibeWitness });
    // Every nested h2a invocation resolves to this witnessed checkout build.
    fs.writeFileSync(join(dir, 'bin/h2a'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(proxy)} "$@"\n`, { mode: 0o700 });
    const workspace = join(dir, 'workspace');
    fs.mkdirSync(workspace);
    const rendered = spawnSync(process.execPath, [bin, 'host', 'setup', '--host', cli, '--print', '--root', env.H2A_ROOT],
      { env, cwd: workspace, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
    if (Number.isSafeInteger(rendered.pid)) recordExec(execJournal, { pid: rendered.pid, path: bin, tag: 'harness' });
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
      fs.writeFileSync(path, cellMcpConfigText(cli, endpoint));
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
    await enforceMcpCallCaps();
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
  // Repeatable startup actions (R15, class-c): an MCP-approval Allow screen
  // may recur (one dialog per server), and a trust dialog may ask for a
  // second confirmation (Muse 1.4.14). A repeat needs fresh output since the
  // last press of the same action — never key spam on a static screen — and
  // stays bounded per target. Anything else remains single-shot.
  const STARTUP_REPEAT_LIMIT = Object.freeze({ 'mcp-approval-allow': MCP_APPROVAL_PRESS_LIMIT, 'trust-empty-workspace': 1 });
  async function startup(target, screen) {
    target.startupActions ??= new Set();
    target.startupPresses ??= {};
    target.startupPressAt ??= {};
    const action = startupKey(screen, target.cli);
    if (!action) return false;
    const presses = target.startupPresses[action] ?? 0;
    // Rendering a choice does not mean the CLI has installed its key handler.
    // Use the same quiet interval as readiness, within the existing deadline.
    if (Date.now() - (target.lastOutputAt ?? Date.now()) < 2000) { await sleep(100); return true; }
    if (target.startupActions.has(action)) {
      const fresh = (target.lastOutputAt ?? 0) > (target.startupPressAt[action] ?? 0);
      // R17 (P3-1): a screen that outlives its repeat budget is no longer a
      // startup action — return false so the blocker classification below
      // runs instead of spinning until the deadline.
      if (presses > (STARTUP_REPEAT_LIMIT[action] ?? 0)) return false;
      if (!fresh) { await sleep(100); return true; }
    }
    target.startupActions.add(action);
    target.startupPresses[action] = presses + 1;
    target.startupPressAt[action] = Date.now();
    const lease = await client.acquireController(target.state.id, 'xcli-startup', 'automation');
    try {
      // Claude 2.1.301 hides indexes and focuses Cancel in this exact dialog.
      // Navigate its normal UI to the explicit trust choice in our empty workspace.
      const cancelFirst = action === 'trust-empty-workspace' && presses === 0 && target.cli === 'claude' &&
        screen.includes('Quick safety check') && screen.includes('No, exit') && screen.includes('Yes, I trust this folder');
      await client.write(lease, cancelFirst ? '\x1b[B\r' : '\r');
    } finally { await client.releaseController(lease); }
    // A repeated trust press is a second confirmation of the same empty-
    // workspace decision, labelled as such in evidence.
    const labelled = presses === 0 ? action :
      (action === 'trust-empty-workspace' ? 'trust-confirm-second' : action);
    row.evidence.push({ event: 'startup-ui', role: target.role, action: labelled, facts: startupFacts(screen),
      choiceStyles: target.terminal.choiceStyles(['Trust and continue', 'Quit']), at: Date.now() });
    target.screen = '';
    await sleep(500);
    return true;
  }
  function events(target) { return readEvents(target.env.XCLI_EVENTS); }
  function observedBlocker(target, screen) {
    const blocker = blockingScreen(screen);
    if (blocker === 'provider-quota') row.evidence.push({ event: 'provider-quota-observed', role: target.role });
    return blocker;
  }
  async function stopTarget(target) {
    const current = await client.state(target.state.id);
    assert.equal(current.generation, target.state.generation, 'private host generation changed');
    assert.equal(current.incarnation, target.state.incarnation, 'private session incarnation changed');
    if (current.status === 'exited') return;
    try { await client.stopIfIncarnation(target.state.id, target.state.generation, target.state.incarnation, 'SIGKILL'); }
    catch (error) {
      // Only accept a concurrent exit of this same owned incarnation.
      const after = await client.state(target.state.id);
      if (after.status !== 'exited' || after.generation !== target.state.generation || after.incarnation !== target.state.incarnation) throw error;
    }
  }
  async function enforceMcpCallCaps() {
    let capped = false;
    for (const target of targets) {
      if (!events(target).some(e => e.event === 'mcp-call-cap-exceeded')) continue;
      capped = true;
      await stopTarget(target);
      row.evidence.push({ event: 'mcp-cap-session-stopped', role: target.role, at: Date.now() });
    }
    if (capped) throw new Error('mcp-call-cap-exceeded');
  }
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
      // R17 (P3-1): classify a dead process before any startup handling. A
      // CLI that exits after a startup press leaves its last screen on the
      // terminal; that stale screen must never mask the exit or burn the
      // whole deadline as mcp-not-loaded-before-deadline.
      const state = await client.state(target.state.id);
      if (state.status === 'exited') {
        row.evidence.push({ event: 'cli-exit', role: target.role, exit: state.exit,
          facts: startupFacts(screen), rawFacts: startupFacts(stripAnsi(target.screen)) });
        return { blocker: observedBlocker(target, screen) ?? 'cli-exited-before-ready' };
      }
      if (await startup(target, screen)) continue;
      const blocker = observedBlocker(target, screen);
      if (blocker) { row.evidence.push({ event: 'startup-screen-facts', role: target.role, facts: startupFacts(screen) }); return { blocker }; }
      const identity = events(target).find(e => e.event === 'identity' && e.ok && e.ready);
      const armed = events(target).some(e => e.event === 'wake-armed');
      if (identity && loaded(target) && armed && paneIsReady(screen, target.cli) && Date.now() - (target.lastOutputAt ?? Date.now()) >= 2000) {
        quietSince ??= Date.now();
        if (Date.now() - quietSince >= 2000) return { instance: identity.instance };
      } else quietSince = undefined;
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
    // R18: an exhausted MCP-approval Allow screen is a typed blocker, never
    // a bare deadline. The presses happened inside the isolated cell HOME;
    // nothing outside the cell was trusted or disabled.
    const exhaustion = classifyApprovalExhaustion({ cli: target.cli,
      presses: target.startupPresses?.['mcp-approval-allow'] ?? 0,
      limit: MCP_APPROVAL_PRESS_LIMIT, mcpLoaded: loaded(target) });
    if (exhaustion) {
      row.evidence.push({ event: 'approval-exhausted', role: target.role,
        action: 'mcp-approval-allow', presses: target.startupPresses?.['mcp-approval-allow'] ?? 0 });
      return { blocker: exhaustion };
    }
    return loaded(target) ? { blocker: 'initial-model-tool-turn-not-observed' } : { failure: 'mcp-not-loaded-before-deadline' };
  }
  try {
    row.vendorRuntime = {};
    for (const cli of new Set([receiver, sender])) {
      if (!executables[cli]) { row.blocker = `cli-not-found:${cli}`; return row; }
      // Lot L7 (QO4, section 8.2): the vendor vibe product runs as installed,
      // vendor Python runtime included. Its runtime is labelled in evidence,
      // never blocked: Vibe cells fail on seat/auth grounds, not on Python.
      const vendorLabel = vendorRuntimeLabel(cli, executables[cli]);
      if (vendorLabel) {
        row.vendorRuntime[cli] = vendorLabel;
        row.evidence.push({ event: 'vendor-runtime', cli, runtime: vendorLabel });
        continue;
      }
      if (pythonEntrypoint(executables[cli])) { row.blocker = `python-entrypoint-forbidden:${cli}`; return row; }
    }
    host = isolation.spawnIsolatedNative(process.execPath,
      ['--import', join(repo, 'scripts/xcli-wake-host.mjs'),
        join(build, 'packages/h2a-runtime/dist/native-terminal/process.js'), '--socket', hostEnv.H2A_NATIVE_SOCKET,
        '--generation', 'xcli-private', '--registry-path', registry],
      { env: hostEnv, stdio: ['ignore', 'ignore', 'pipe'] });
    host.stderr.resume(); // discard, never persist raw errors
    for (let i = 0; i < 100; i++) {
      try { client = await NativeTerminalClient.connect(hostEnv.H2A_NATIVE_SOCKET); break; } catch { await sleep(50); }
    }
    if (!client) { row.blocker = 'private-host-unavailable'; return row; }
    const receiverPrompt = `Qualification h2a. Use only h2a MCP tools. First call h2a_identity_status until state identity_ready (stop if identity_failed), then finish your turn and wait. After readiness do not poll. On an automatic h2a inbox wake, read your own inbox using h2a_inbox action read and your identity. For the exact message ${PROBE}, reply with h2a_send to that envelope's actor.instance, message exactly ${REPLY}. Never use shell, files, other agents or any non-h2a tool.`;
    // Lot L13+: scripted scenarios launch their own scripted peers below —
    // the probe receiver launch is skipped, never duplicated.
    const scriptedKind = ['loop', 'negotiation', 'inventory'].includes(scenario.kind);
    const r = scriptedKind ? null : await launch(receiver, 'receiver', receiverPrompt);
    const readiness = scriptedKind ? { instance: null } : await ready(r);
    if (!scriptedKind) {
      row.receiverMcp = loaded(r);
      if (!readiness.instance) {
        // Only an exercised identity gate at its deadline earns the expected
        // refusal. Startup exits, missing MCP and unrelated blockers survive.
        if (scenario.kind === 'unavailability' && scenario.state === 'identity-never-ready' &&
            readiness.blocker === 'initial-model-tool-turn-not-observed' &&
            classifyScenarioRow(scenario.key, { ...row, blocker: 'identity-never-ready',
              evidence: [...row.evidence, ...events(r).map(e => ({ role: 'receiver', ...e }))] }).ok) {
          row.blocker = 'identity-never-ready';
          return row;
        }
        row.blocker = readiness.blocker;
        row.failure = readiness.failure;
        return row;
      }
    }
    // Lot L13+: scripted scenarios (loop, negotiation, inventory) replace
    // the probe flow: both peers run deterministic tool scripts, the worker
    // waits for their done markers and derives booleans from witnessed
    // tool-call events. No wake is ever claimed on a scripted cell.
    if (scriptedKind) {
      const twinDone = [{ writeFile: 'twin-done' }];
      const twinWait = [{ waitForFile: 'twin-done' }];
      let receiverSteps, senderSteps;
      if (scenario.kind === 'loop') {
        if (scenario.twin) {
          receiverSteps = [...loopTwinScripts(scenario.twin), ...twinDone];
          senderSteps = twinWait;
        } else {
          const { creator, participant } = loopScripts();
          receiverSteps = participant;
          senderSteps = creator;
        }
      } else if (scenario.kind === 'negotiation') {
        if (scenario.twin) {
          receiverSteps = [...negotiationTwinScripts(scenario.twin), ...twinDone];
          senderSteps = twinWait;
        } else {
          const { initiator, responder } = negotiationScripts();
          receiverSteps = responder;
          senderSteps = initiator;
        }
      } else {
        const built = inventoryScripts(scenario.group);
        receiverSteps = built.receiver;
        senderSteps = built.sender;
      }
      validateScriptSteps(receiverSteps);
      validateScriptSteps(senderSteps);
      const keyVars = ['negotiation', 'inventory'].includes(scenario.kind) ? scriptKeyVars() : undefined;
      const rScripted = await launch(receiver, 'receiver', `Scripted ${scenario.key} participant.`, JSON.stringify(receiverSteps), keyVars);
      const receiverReady = await ready(rScripted);
      row.receiverMcp = loaded(rScripted);
      if (!receiverReady.instance) {
        row.blocker = receiverReady.blocker ?? 'scripted-receiver-not-ready';
        row.failure = receiverReady.failure;
        return row;
      }
      const s = await launch(sender, 'sender', `Scripted ${scenario.key} creator.`, JSON.stringify(senderSteps), keyVars);
      const senderReady = await ready(s);
      row.senderMcp = loaded(s);
      if (!senderReady.instance) {
        row.blocker = senderReady.blocker ?? 'scripted-sender-not-ready';
        row.failure = senderReady.failure;
        return row;
      }
      // Publish data before readiness: peers read it as soon as their marker exists.
      if (scenario.key === 'inventory:read-paths') {
        fs.writeFileSync(join(cell, 'large-text'), LARGE_TEXT, { mode: 0o600 });
      }
      // Peer crossing for read-paths and conductor-paths: the worker owns
      // both enrolled ids only once both peers are ready.
      if (['inventory:read-paths', 'inventory:conductor-paths'].includes(scenario.key)) {
        fs.writeFileSync(join(cell, 'peer-for-sender'), receiverReady.instance + '\n', { mode: 0o600 });
        fs.writeFileSync(join(cell, 'peer-for-receiver'), senderReady.instance + '\n', { mode: 0o600 });
      }
      const markerOk = name => {
        try { return JSON.parse(fs.readFileSync(join(cell, name), 'utf8')).ok === true; }
        catch { return false; }
      };
      const markerDeadline = Date.now() + timeoutMs * 2;
      while (Date.now() < markerDeadline) {
        await enforceMcpCallCaps();
        if (cancelled) { row.blocker = 'qualification-cancelled'; return row; }
        if (markerOk('receiver-script-done') && markerOk('sender-script-done')) break;
        await sleep(500);
      }
      const toolOk = (target, tool) => readEvents(target.env.XCLI_EVENTS)
        .some(e => e.event === 'tool-call' && e.tool === tool && e.ok);
      const refusalSeen = (target, tool) => readEvents(target.env.XCLI_EVENTS)
        .some(e => e.event === 'refusal' && e.tool === tool);
      row.receiverScriptOk = markerOk('receiver-script-done');
      row.senderScriptOk = markerOk('sender-script-done');
      const TWIN_KEY_TOOL = {
        'join-unknown': 'h2a_loop_join', 'report-without-join': 'h2a_loop_report', 'report-after-done': 'h2a_loop_report',
        'offer-unknown': 'h2a_offer', 'stabilize-without-offer': 'h2a_stabilize', 'replayed-stabilization': 'h2a_stabilize',
      };
      if (scenario.kind === 'loop' && !scenario.twin) {
        row.loopTerminal =
          ['h2a_loop_create', 'h2a_loop_status', 'h2a_loop_list', 'h2a_loop_done', 'h2a_loop_stop'].every(t => toolOk(s, t)) &&
          ['h2a_loop_join', 'h2a_loop_report', 'h2a_loop_status', 'h2a_loop_list'].every(t => toolOk(rScripted, t)) &&
          row.receiverScriptOk && row.senderScriptOk;
      } else if (scenario.kind === 'negotiation' && !scenario.twin) {
        const initiatorOk = ['h2a_open_negotiation', 'h2a_offer', 'h2a_append_journal', 'h2a_sign', 'h2a_stabilize']
          .every(t => toolOk(s, t));
        const responderOk = ['h2a_counteroffer', 'h2a_append_journal', 'h2a_sign']
          .every(t => toolOk(rScripted, t));
        row.stabilized = initiatorOk && responderOk && row.receiverScriptOk && row.senderScriptOk;
        row.journalGrown = toolOk(s, 'h2a_append_journal') && toolOk(rScripted, 'h2a_append_journal');
      } else if (scenario.twin) {
        row.twinRefused = row.receiverScriptOk && row.senderScriptOk &&
          refusalSeen(rScripted, TWIN_KEY_TOOL[scenario.twin]);
      } else {
        // Lot L15: per-group, per-side witnessed conjunctions, including
        // the embedded contested-claim refusal for conductor-paths.
        // h2a_inbox is witnessed through inbox events (the proxy never
        // emits generic tool-call for send/inbox), everything else
        // through tool-call.
        const witnessed = (target, tool) => tool === 'h2a_inbox'
          ? readEvents(target.env.XCLI_EVENTS).some(e => e.event === 'inbox' && e.ok === true)
          : toolOk(target, tool);
        const readPaths = ['h2a_identity_status', 'h2a_discover_instances', 'h2a_discover_sessions',
          'h2a_inbox', 'h2a_read_payload'];
        const govPaths = ['h2a_escalate', 'h2a_conflict_posture', 'h2a_declare_conflit_interet',
          'h2a_blockage_raise', 'h2a_blockage_list', 'h2a_blockage_resolve',
          'h2a_nhi_inventory', 'h2a_nhi_report', 'h2a_nhi_attest', 'h2a_nhi_export', 'h2a_nhi_offboard',
          'h2a_attest_comprehension'];
        const required = {
          'read-paths': { sender: readPaths, receiver: readPaths },
          'session-paths': {
            sender: ['h2a_register_instance', 'h2a_open_negotiation', 'h2a_session_open',
              'h2a_offer', 'h2a_sign', 'h2a_stabilize', 'h2a_session_close'],
            receiver: ['h2a_session_open', 'h2a_sign', 'h2a_session_close'],
          },
          'conductor-paths': {
            sender: ['h2a_conductor', 'h2a_conductor_claim', 'h2a_conductor_launch_check',
              'h2a_conductor_launch', 'h2a_conductor_release'],
            receiver: ['h2a_conductor', 'h2a_conductor_claim', 'h2a_conductor_release'],
          },
          'governance-paths': {
            sender: ['h2a_open_negotiation', ...govPaths],
            receiver: govPaths,
          },
        }[scenario.group];
        row.inventoryOk = required.sender.every(t => witnessed(s, t)) &&
          required.receiver.every(t => witnessed(rScripted, t)) &&
          row.receiverScriptOk && row.senderScriptOk;
      }
      row.wakeClaim = 'no wake claimed (scripted scenario)';
      row.blocker = expectedScenarioBlocker(scenario);
      row.evidence.push({ event: 'scripted-outcome', scenario: scenario.key,
        receiverScriptOk: row.receiverScriptOk, senderScriptOk: row.senderScriptOk,
        loopTerminal: row.loopTerminal ?? null, stabilized: row.stabilized ?? null,
        journalGrown: row.journalGrown ?? null, twinRefused: row.twinRefused ?? null,
        inventoryOk: row.inventoryOk ?? null });
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
    // Unavailability rows claim no wake. Keep their fault observation budget
    // separate from the three-phase experiment required by probe/refusal.
    const claimsWake = scenario.kind !== 'unavailability';
    const { w0Ms, w1Ms, dMs } = claimsWake ? wake : { w0Ms: 0, w1Ms: 0, dMs: 0 };
    row.budgetMs = timeoutMs;
    row.wakeWindows = { w0Ms, w1Ms, dMs, barrierAt, releaseOffsetMs, notifyIntervalMs, timestampUncertaintyMs: 1,
      deliveryAt: null, withholdAt: null, releaseAt: null, wakeAt: null, firstReadAt: null,
      baselineReads: 0, preBarrierReads: 0, withheldReads: 0 };
    row.wakeClaim = 'no wake claimed (no durable delivery)';
    if (claimsWake && timeoutMs - (barrierAt - started) < w0Ms + w1Ms + releaseOffsetMs + notifyIntervalMs + 100 + dMs) {
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
    // Lot L12: stop the live receiver before the sender runs. Its instance
    // stays enrolled, so a durable-only delivery may still land — recorded
    // as durable-only, never as delivery.
    if (scenario.kind === 'unavailability' && scenario.state === 'stopped-receiver') {
      try {
        await client.stopIfIncarnation(r.state.id, r.state.generation, r.state.incarnation, 'SIGKILL');
        row.evidence.push({ event: 'scenario-peer-stopped', at: Date.now() });
      } catch { row.blocker = 'scenario-peer-stop-failed'; return row; }
    }
    const receiverReads = (from = 0, to = Infinity) => readEvents(r.env.XCLI_EVENTS)
      .filter(e => e.event === 'inbox' && e.ok && e.instance === readiness.instance && e.at >= from && e.at < to);
    const cancellableSleep = async ms => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        await enforceMcpCallCaps();
        if (cancelled) return false;
        await sleep(Math.min(100, until - Date.now()));
      }
      return !cancelled;
    };
    await cancellableSleep(w0Ms); // Phase 1: silent baseline, sender launch delayed
    // Lot L12: the unknown-instance state addresses a reserved unenrolled id.
    const sendTarget = scenario.kind === 'unavailability' && scenario.state === 'unknown-instance'
      ? UNKNOWN_INSTANCE : readiness.instance;
    const senderPrompt = `Qualification h2a. Use only h2a MCP tools. Call h2a_identity_status until identity_ready (stop if identity_failed), then h2a_send once, to exactly ${sendTarget}, message exactly ${PROBE}. Finish your turn. Never use shell, files, other agents or any non-h2a tool.`;
    const s = await launch(sender, 'sender', senderPrompt);
    const deadline = started + timeoutMs;
    // Phase 2a: wait for the signed send and durable delivery. No reply break
    // here: the withheld-window observation must run its full course.
    let send = null, deliveryAt = 0, deliveryWitness = null;
    while (Date.now() < deadline) {
      if (cancelled) { row.blocker = 'qualification-cancelled'; break; }
      const se = events(s);
      row.senderMcp = loaded(s);
      send = se.find(e => e.event === 'send' && e.ok && e.kind === 'probe' && e.to === readiness.instance) ?? null;
      row.sent = Boolean(send);
      if (send) s.terminal.freeze();
      // V3 §3.2 authorizes consumption: the receiver may pop the envelope
      // after reading it. Keep the exact delivery-time witness so the later
      // wake correlation never depends on the envelope still being present.
      const witnessed = send ? store.readInbox(readiness.instance)
        .find(e => e.id === send.envelopeId && e.body?.text === PROBE && e.actor?.instance === send.from) ?? null : null;
      if (witnessed) {
        deliveryAt = Date.now(); deliveryWitness = witnessed; break;
      }
      const senderScreen = await capture(s);
      if (!row.sent && await startup(s, senderScreen)) continue;
      const blocker = observedBlocker(s, senderScreen) ?? observedBlocker(r, await capture(r));
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
      let releaseAt = deliveryAt + w1Ms + releaseOffsetMs;
      if (claimsWake && releaseAt + notifyIntervalMs + 100 + dMs > deadline) {
        row.blocker = 'wake-window-unfunded'; return row;
      }
      row.wakeWindows.plannedReleaseAt = releaseAt;
      // Phase 2b: withheld window. The probe is already readable in the
      // inbox; any receiver read before release proves polling.
      while (Date.now() < Math.min(releaseAt, deadline)) {
        if (cancelled) { row.blocker = 'qualification-cancelled'; break; }
        const blocker = observedBlocker(s, await capture(s)) ?? observedBlocker(r, await capture(r));
        if (blocker) { row.blocker = blocker; break; }
        await sleep(200);
      }
      const preBarrierReads = receiverReads(0, barrierAt);
      const baselineReads = receiverReads(barrierAt, deliveryAt);
      row.wakeWindows.preBarrierReads = preBarrierReads.length;
      row.wakeWindows.baselineReads = baselineReads.length;
      if (!withholdForever && !row.blocker) {
        try {
          const lease = withholdLease;
          await client.releaseController(lease); withholdLease = null;
          const released = readEvents(inputJournal).find(e => e.event === 'release' && e.id === lease.id &&
            e.incarnation === lease.incarnation && e.epoch === lease.epoch);
          if (!released) throw new Error('wake release not witnessed');
          releaseAt = released.at;
          row.wakeWindows.releaseAt = releaseAt;
          row.evidence.push({ event: 'wake-release', at: releaseAt });
        }
        catch { row.blocker = 'wake-withhold-unavailable'; }
      }
      const withheldReads = receiverReads(deliveryAt, withholdForever ? Infinity : releaseAt);
      row.wakeWindows.withheldReads = withheldReads.length;
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
        const blocker = observedBlocker(s, senderScreen) ?? observedBlocker(r, await capture(r));
        if (blocker) { row.blocker = blocker; break; }
        await sleep(100);
      }
      if (withholdForever) {
        row.wakeFailure = 'wake-withheld-forever';
        row.wakeClaim = 'no wake claimed (wake never released)';
        row.woke = false;
      } else {
        row.wakeClaim = `withheld-protocol, periods ≤ ${w1Ms}ms excluded, single replication (no batch separation); varying-phase polling not excluded`;
        // The witness is the envelope as delivered, not a re-read: a
        // receiver that consumed it (§3.2 read-then-pop) still verifies.
        const probe = deliveryWitness;
        const journal = correlateWakeInput(readEvents(inputJournal), { target: r.state, barrierAt, releaseAt,
          send, receiver: readiness.instance, probe, product, store });
        row.wakeWindows.inputJournal = journal;
        row.evidence.push({ event: 'wake-input-proof', at: Date.now(), ...journal });
        row.wakeWindows.wakeAt = journal.correlated ? journal.submitAt : null;
        row.wakeWindows.firstReadAt = firstRead?.at ?? null;
        const firstReadHasProbe = Boolean(firstRead?.envelopes?.some(v => v.id === send.envelopeId &&
          v.from === send.from && v.to === readiness.instance && v.kind === 'probe'));
        if (preBarrierReads.length || baselineReads.length || withheldReads.length) row.wakeFailure = 'wake-polling-detected';
        else if (!firstWakeOk) row.wakeFailure = 'wake-no-qualifying-read';
        else if (!journal.correlated || !journal.onlyWakeInput) row.wakeFailure = 'wake-input-unproven';
        else if (!firstRead || !firstReadHasProbe) row.wakeFailure = 'wake-no-qualifying-read';
        else if (firstRead.at < journal.submitAt || firstRead.at - journal.submitAt > dMs) row.wakeFailure = 'wake-delay-exceeded';
        else if (journal.submitAt + dMs > deadline || releaseAt + notifyIntervalMs + 100 + dMs > deadline) {
          row.blocker = 'wake-window-unfunded';
        }
        row.woke = Boolean(row.received && firstReadHasProbe && !row.blocker && !row.wakeFailure && row.noPostSendHarnessInput);
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
    // Lot L12: scenario overrides. Unavailability states fail closed with
    // their classified code once no live stage was reached; a durable-only
    // landing is marked as such, never as delivery.
    if (scenario.kind === 'unavailability' && !row.blocker && !row.received && !row.woke && !row.replyDelivered) {
      row.durableOnly = scenario.state === 'stopped-receiver' && row.delivered === true;
      const blocker = expectedScenarioBlocker(scenario);
      const verdict = classifyScenarioRow(scenario.key, { ...row, blocker,
        evidence: [...row.evidence, ...events(s).map(e => ({ role: 'sender', ...e })),
          ...events(r).map(e => ({ role: 'receiver', ...e }))] });
      if (verdict.ok) {
        row.blocker = blocker;
        delete row.failure;
        row.wakeClaim = 'no wake claimed (unavailable peer)';
      }
    }
    // Lot L12: refusal twins. Phase A proved the runner live (reply
    // delivered); phase B injects the faulty wake and requires rejection —
    // no second reply, and no second qualifying read for the replayed twin.
    if (scenario.kind === 'refusal' && !row.blocker && row.replyDelivered && row.received && row.woke) {
      row.phaseAReplyDelivered = true;
      const replySends = () => readEvents(r.env.XCLI_EVENTS).filter(e => e.event === 'send' && e.ok && e.kind === 'reply').length;
      const probeReads = () => receiverReads(0, Infinity).filter(e => e.envelopes?.some(v => v.kind === 'probe')).length;
      const replySendsBefore = replySends(), probeReadsBefore = probeReads();
      let faultLine = null;
      if (scenario.twin === 'unsigned-wake') {
        faultLine = '[h2a-wake reason=inbox xcli-fault] faulty wake without signature';
      } else if (scenario.twin === 'misaddressed-wake') {
        const { formatSignedDriveInstruction } = await import(pathToFileURL(join(build, 'packages/h2a/dist/index.js')));
        const { privateKey } = generateKeyPairSync('ed25519');
        faultLine = formatSignedDriveInstruction({ from: readiness.instance, to: 'xcli-someone-else',
          instruction: '[h2a-wake reason=inbox xcli-fault] faulty misaddressed wake',
          privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
      } else {
        try {
          const logged = fs.readFileSync(join(cell, 'wake-lines', 'receiver.log'), 'utf8').split('\n').filter(Boolean);
          faultLine = logged.at(-1) ?? null;
        } catch { faultLine = null; }
      }
      if (!faultLine) {
        row.blocker = 'scenario-fault-unavailable';
      } else {
        row.evidence.push({ event: 'wake-fault-injected', twin: scenario.twin, at: Date.now() });
        const lease = await client.acquireController(r.state.id, 'xcli-fault', 'automation');
        try { await client.write(lease, faultLine); await sleep(100); await client.write(lease, '\r'); }
        finally { await client.releaseController(lease).catch(() => {}); }
        await cancellableSleep(3000);
        row.secondReply = replySends() > replySendsBefore;
        let rejectionVia = 'no-second-reply';
        try {
          if ((await client.state(r.state.id)).status === 'exited') rejectionVia = 'model-guard-exit';
        } catch { rejectionVia = 'model-guard-exit'; }
        row.refusalRejected = !row.secondReply && (scenario.twin === 'replayed-wake'
          ? probeReads() === probeReadsBefore : true);
        row.evidence.push({ event: 'wake-rejection-observed', twin: scenario.twin, via: rejectionVia, at: Date.now() });
        row.blocker = expectedScenarioBlocker(scenario);
      }
    }
    if (!row.replyDelivered) for (const target of targets)
      row.evidence.push({ event: 'final-screen-facts', role: target.role, facts: startupFacts(await capture(target)) });
    if (!row.blocker && !row.replyDelivered && !row.wakeFailure) row.failure = row.sent ? (row.received ? 'reply-not-observed' : 'live-receive-not-observed') : 'sender-send-not-observed';
    return row;
  } catch (error) {
    if (error.message === 'mcp-call-cap-exceeded') {
      row.failure = 'mcp-call-cap-exceeded';
      return row;
    }
    const known = ['host-setup-no-config', 'login-not-confined:gemini', 'login-not-confined:agy', 'login-not-confined:claude', 'login-not-confined:muse'];
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
      try { await stopTarget(t); }
      catch (error) { cleanupError('native-stop', error); }
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
    // Lot L5 (§6.6): process recovery and secret wipe are independent
    // obligations. The wipe is unconditional — recorded login copies plus
    // harness transcripts, removed and re-checked file by file — even when
    // process recovery failed, and « preserve the root for diagnosis » is
    // gone: a root survives only with a proven wipe, which leaves no
    // credentials in it by construction.
    row.processRecovery = !row.cleanupFailed;
    let surviving = null;
    try {
      surviving = wipeSecrets(cellSecretPaths(cell, {
        sender: { cli: sender, files: row.credentialsCopied.sender ?? [] },
        receiver: { cli: receiver, files: row.credentialsCopied.receiver ?? [] },
      }));
    } catch { surviving = null; }
    row.secretWipe = Array.isArray(surviving) && surviving.length === 0;
    if (!row.secretWipe) {
      row.cleanupFailed = true;
      row.survivingSecrets = Array.isArray(surviving) ? surviving.map(p => relative(root, p)) : ['wipe-unproven'];
    }
    // Lot L6 (§8.3): classify the cell execution journal at cleanup. A Python
    // interpreter executed anywhere in our chain blocks the cell. The verdict
    // (with its stated scope) joins the row evidence either way.
    row.execJournal = classifyExecJournal(readExecJournal(execJournal));
    row.evidence.push({ event: 'exec-journal', ...row.execJournal });
    if (row.execJournal.pythonDescendants.length && !row.blocker) row.blocker = 'python-descendant-detected';
    // A cap witnessed in any phase survives every early return and exception.
    // Cleanup and interpreter violations retain their blocking precedence.
    const mcpCapped = row.evidence.some(e => e.event === 'mcp-call-cap-exceeded');
    if (mcpCapped && !row.cleanupFailed && !row.execJournal.pythonDescendants.length) {
      delete row.blocker;
      delete row.wakeFailure;
      row.failure = 'mcp-call-cap-exceeded';
      row.status = 'measured-KO';
    } else row.status = row.cleanupFailed ? 'blocked' : classify(row);
    if (simulated) row.status = row.status.replace('measured-', 'simulated-');
    if (!row.secretWipe) row.blocker = 'secret-wipe-unproven';
    else if (row.cleanupFailed) row.blocker = 'owned-process-cleanup-failed';
    if (row.secretWipe) {
      fs.rmSync(cell, { recursive: true, force: true });
      row.evidence.push({ event: 'cleanup-complete', processRecovery: row.processRecovery,
        secretWipe: row.secretWipe, privateStateRemoved: !fs.existsSync(cell) });
    }
    else row.privateCleanupRoot = cell;
    process.off('SIGTERM', cancel);
    process.off('SIGINT', cancel);
  }
}

// Lot L8 (§5.5): seat-campaign table — one row per cell with seat IDs (never
// secrets), status, blocker/failure, and versions. No tier aggregation.
function seatMarkdown(result) {
  const lines = ['| Siège émetteur | Siège destinataire | Statut | Motif |',
    '|---|---|---|---|'];
  for (const c of result.cells) {
    lines.push(`| ${c.seats?.sender ?? c.sender} | ${c.seats?.receiver ?? c.receiver} | ${c.status} | ${c.blocker ?? c.failure ?? '—'} |`);
  }
  return lines.join('\n');
}

function markdown(result) {
  // Lot L8 (§5.5): seat campaigns print seat IDs and the cap-ledger totals;
  // the 36-family matrix only covers the family full product.
  const seatTable = result.seatMode !== 'no-seats' || result.cells.length !== 36;
  const lines = ['# Qualification live cross-CLI — phase 1', '', seatTable ? seatMarkdown(result) : matrix(result.cells), '',
    `Commande : \`${result.command}\``, '',
    `Base : \`${result.sha}\` ; Node : \`${result.node}\` ; mode : **CLI réelles**.`, '',
    'M = MCP initialize + outils ; D = enveloppe durable ; R = lecture inbox par la CLI ; W = réaction après barrière inactive, sans entrée du harness ; A = réponse signée livrée au sender.', '',
    'Les cellules bloquées ne prouvent aucune fonctionnalité. Les tests MCP simulés ne qualifient pas les CLI réelles.', '',
    'Isolation : sources compilées dans mkdtemp ; HOME/XDG/store/socket/registre privés par cellule ; aucun host existant. Garde produit `H2A_UPGRADE_REEXECED=1` ; shim h2a vers les sources. Seuls les fichiers d’auth explicitement listés sont copiés, puis effacés avec les états des CLI. Aucun texte de modèle ni secret dans les preuves.', '',
    'Écart : un point d’entrée Python de notre chaîne de lancement est refusé avant exécution, conformément à l’interdiction du propriétaire ; le produit vendeur Vibe tourne tel qu’installé, runtime labellisé `vendor-runtime` (QO4, jamais bloqué sur Python). Les écrans de démarrage reconnus sont validés normalement dans le workspace vide temporaire ; aucune désactivation de permission ni modification persistante du trust.', '',
    '| Émetteur | Destinataire | Statut | M émetteur / récepteur | D | R | W | A | Motif | Preuve |',
    '|---|---|---|---|---|---|---|---|---|---|'];
  const flag = v => v === true ? 'oui' : v === false ? 'non' : 'non mesuré';
  lines.push('', '## Sièges et plafonds', '', '```', result.ledgerTotals ?? 'no ledger', '```');
  if (result.preflights?.length) {
    lines.push('', '| Siège | Pré-vol | Motif | Version |', '|---|---|---|---|');
    for (const p of result.preflights) lines.push(`| ${p.seatId} | ${p.ok ? 'oui' : 'non'} | ${p.reason ?? '—'} | ${p.version ?? '—'} |`);
  }
  for (const c of result.cells) lines.push(`| ${c.sender} | ${c.receiver} | ${c.status} | ${flag(c.senderMcp)} / ${flag(c.receiverMcp)} | ${flag(c.delivered)} | ${flag(c.received)} | ${flag(c.woke)} | ${flag(c.replyDelivered)} | ${c.blocker ?? c.failure ?? '—'} | [JSON](2026-10-15-cross-cli-phase1.json#${c.sender}-${c.receiver}) |`);
  for (const c of result.cells) lines.push('', `## ${c.sender}-${c.receiver}`, '',
    `Statut : **${c.status}** ; motif : \`${c.blocker ?? c.failure ?? 'complete-round-trip'}\` ; durée : ${c.elapsedMs} ms.`, '',
    '```json', JSON.stringify(c.evidence), '```');
  return lines.join('\n') + '\n';
}

async function main() {
  assert.ok([22, 24].includes(Number(process.versions.node.split('.')[0])), 'Node 22/24 required');
  // R18 (owner D1): refuse the removed copy-from-home path before minting
  // any campaign state.
  assertNoAuthHome(process.argv);
  // R18: real runs require a seat manifest from the protected environment.
  // Refuse before minting a campaign root, a ledger, or a build.
  if (!process.argv.includes('--simulated') && option('--seat-manifest') === undefined) {
    throw new Error('seat-manifest-required');
  }
  // Lot L8 (§6.1/§6.4): campaign root (fresh, or resumed from --campaign-root
  // with its persisted ledger) and composite caps. Cap numbers are
  // PROPOSITION until the owner ratifies D2; counting, stop rules, and
  // persistence are normative.
  const campaignRoot = option('--campaign-root');
  const root = campaignRoot ? resolve(campaignRoot) : compliantQualificationRoot();
  if (campaignRoot) fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  process.stdout.write(`Private qualification root: ${root}\n`);
  const caps = {
    launchedSessions: Number(option('--session-cap', '500')),
    mcpCallsPerSession: Number(option('--mcp-call-cap', '100')),
    wallClockMs: Number(option('--campaign-wall-clock-ms', '7200000')),
  };
  for (const [key, value] of Object.entries(caps)) assert.ok(Number.isSafeInteger(value) && value > 0, `invalid campaign cap ${key}`);
  let ledger;
  if (campaignRoot && fs.existsSync(join(root, 'campaign-ledger.json'))) {
    ledger = loadCampaignLedger(root);
    assert.deepEqual(ledger.caps, caps, 'campaign-ledger-mismatch: resume with the caps the ledger states');
  } else {
    ledger = createCampaignLedger(root, caps);
  }
  ledger.refusals ??= [];
  const built = sourceBuild(root);
  const supervisor = buildSupervisor(root);
  const sourcePath = process.env.PATH ?? '/usr/bin:/bin';
  const simulated = process.argv.includes('--simulated');
  const executables = Object.fromEntries(CLIS.map(cli => [cli, cliPath(cli, sourcePath)]));
  if (simulated) {
    fs.mkdirSync(join(root, 'sim-bin'), { recursive: true });
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
  // R18 (owner D1): cyber-seat custody only. Manifest pairs name seats (or
  // the manifest's explicit pairs field); the default scope is the full
  // ordered seat product, stated in evidence. The 16-profile R1 default
  // stays a proposition until D2 ratifies the roster — no silent scope
  // trimming here. Real runs require the cyber seat mode; the login-free
  // simulated mode is unchanged.
  const manifestFile = option('--seat-manifest');
  const manifest = manifestFile ? loadSeatManifest(resolve(manifestFile), { simulated }) : null;
  if (manifest && !simulated) assertCyberManifest(manifest);
  if (!simulated && !manifest) throw new Error('seat-manifest-required');
  const seatMode = manifest ? manifest.seatMode : 'no-seats';
  const selected = option('--pair');
  const selectedSender = option('--sender');
  assert.ok(!selectedSender || (simulated && CLIS.includes(selectedSender) && !selected && !manifest), '--sender selects a simulated family shard');
  const seatRuns = [];
  if (manifest) {
    const seatPairs = selected ? [selected]
      : manifest.pairs ?? manifest.seats.flatMap(a => manifest.seats.map(b => `${a.seatId}:${b.seatId}`));
    for (const seatPair of seatPairs) {
      const resolved = resolveCampaignPair(manifest, seatPair);
      seatRuns.push({ sender: resolved.sender, receiver: resolved.receiver,
        senderSeat: resolved.senderSeat, receiverSeat: resolved.receiverSeat,
        sharedSeat: resolved.sharedSeat, authHomes: resolved.authHomes });
    }
  }
  const pairs = manifest
    ? seatRuns.map(({ sender, receiver }) => ({ sender, receiver }))
    : CLIS.flatMap(sender => CLIS.map(receiver => ({ sender, receiver })))
      .filter(p => (!selected || `${p.sender}:${p.receiver}` === selected) && (!selectedSender || p.sender === selectedSender));
  assert.ok(pairs.length, 'unknown --pair');
  const timeoutMs = Number(option('--timeout-ms', '60000'));
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 180000, 'invalid bounded timeout');
  // Lot L12: scripted scenario dispatch. Unknown specs fail fast here —
  // the worker never sees them.
  const scenarioSpec = option('--scenario', 'probe');
  parseScenario(scenarioSpec);
  const wakeWindows = parseWakeWindows(option('--wake-windows'), simulated);
  const poll = parsePollSpec(option('--poll'));
  const withholdForever = process.argv.includes('--withhold-forever');
  const replayWake = process.argv.includes('--replay-wake');
  const releaseOffsets = parseOffsets(option('--wake-release-offsets-ms'));
  assert.ok(!withholdForever || releaseOffsets.length === 1, '--withhold-forever runs a single cell');
  const runs = [];
  const baseRuns = manifest ? seatRuns : pairs;
  for (const base of baseRuns) for (const releaseOffsetMs of releaseOffsets) {
    const { sender, receiver } = base;
    runs.push({ sender, receiver, releaseOffsetMs,
      senderSeat: base.senderSeat ?? null, receiverSeat: base.receiverSeat ?? null,
      sharedSeat: base.sharedSeat ?? (sender === receiver),
      authHomes: base.authHomes ?? {} });
  }
  // Cheapest discriminating cells first: diagonals, then the rest. Ordering
  // never drops a mandatory cell; unrun cells stay blocked in the report.
  runs.sort((a, b) => Number(!(a.sharedSeat ?? a.sender === a.receiver)) - Number(!(b.sharedSeat ?? b.sender === b.receiver)));
  // Lot L8 (§6.4/§6.5): per-seat quota stops, one preflight per seat, and the
  // pre-spawn cap gates. Nothing spawns and no seat is touched on refusal.
  // R18: manifest seats only (§6.5 has no un-preflighted real-seat path).
  const preflightSeats = !simulated && manifest ? manifest.seats : null;
  const quotaSeats = new Set(ledger.quotaSeats ?? []);
  const preflighted = new Map();
  const runAuthPrecheck = async (seat, { executable }) => {
    // Muse usage contrast: the control HOME (no logins) must not read
    // authed while the seat HOME (seat files only) reads accepted.
    // Closed-vocabulary match only; outputs discarded; both HOMEs deleted.
    // No model turn is spent (`usage` shows the subscription allowance only).
    // XCLI_AUTH_PRECHECK_MODEL_CALLS is a test seam: it lets a campaign test
    // drive a model-reaching precheck (§6.4) without a real vendor call,
    // proving the cap accounting end to end. Any value outside a positive
    // integer stays 0 (fail closed).
    const raw = Number(process.env.XCLI_AUTH_PRECHECK_MODEL_CALLS ?? '0');
    const spent = Number.isSafeInteger(raw) && raw > 0 ? raw : 0;
    const probe = async withFiles => {
      const home = fs.mkdtempSync(join(root, 'pre-'));
      try {
        const env = environment(home);
        if (withFiles) copyLogin(seat.family, seat.authSource, home, env);
        const out = spawnSync(executable, ['usage'],
          { env, cwd: home, encoding: 'utf8', timeout: 30000, maxBuffer: 256 * 1024 });
        return { status: out.status, text: `${out.stdout ?? ''}\n${out.stderr ?? ''}` };
      } finally { fs.rmSync(home, { recursive: true, force: true }); }
    };
    const control = classifyMuseUsageProbe(await probe(false));
    if (control.authed) return { ok: false, reason: 'preflight-control-untrusted', modelCalls: spent };
    const seated = classifyMuseUsageProbe(await probe(true));
    if (seated.authed) return { ok: true, modelCalls: spent, detail: 'usage-accepted' };
    return { ok: false, reason: 'preflight-auth-unproven', modelCalls: spent };
  };
  const seatKey = (run, role) => run[role === 'sender' ? 'senderSeat' : 'receiverSeat'] ?? (role === 'sender' ? run.sender : run.receiver);
  const blockedRow = (run, releaseOffsetMs, blocker, evidence = []) => ({ sender: run.sender, receiver: run.receiver,
    scenario: scenarioSpec, seats: { sender: run.senderSeat, receiver: run.receiverSeat }, sharedSeat: run.sharedSeat, seatMode,
    status: 'blocked', blocker, evidence, elapsedMs: 0, cleanupFailed: false, parentSecretWipe: true,
    releaseOffsetMs });
  const cellBoundMs = timeoutMs * 2 + 45000;
  for (const run of runs) {
    const { sender, receiver, releaseOffsetMs } = run;
    if (stopping) {
      cells.push(blockedRow(run, releaseOffsetMs, 'qualification-cancelled'));
      continue;
    }
    if (quotaSeats.has(seatKey(run, 'sender')) || quotaSeats.has(seatKey(run, 'receiver'))) {
      cells.push(blockedRow(run, releaseOffsetMs, 'provider-quota-seat-exhausted',
        [{ event: 'seat-quota-stop', seats: [seatKey(run, 'sender'), seatKey(run, 'receiver')] }]));
      continue;
    }
    // V3 §6.4 pre-launch check: the composite caps are verified before every
    // launch — preflight included. On refusal nothing is spawned and no seat
    // is touched; the refusal is witnessed in the ledger. A witnessed MCP
    // runaway brake also stops the campaign: the breached cell keeps its
    // measured failure, later cells are refused here, and the persisted flag
    // keeps refusing on resume of the same ledger.
    const mcpStopped = ledger.mcpCapBreached === true;
    if (!fitsSessions(ledger, 2) || !wallClockFits(ledger, cellBoundMs) || mcpStopped) {
      const cap = mcpStopped ? 'mcp-call-cap' : (!fitsSessions(ledger, 2) ? 'launched-sessions' : 'wall-clock');
      ledger.refusals.push({ run: `${sender}>${receiver}`, code: 'campaign-cap-exhausted', cap });
      persistLedger(ledger);
      // No stopping flag: every later cell re-hits the same pre-spawn gate
      // and records the same reason. Launches stop campaign-wide because no
      // refused launch ever spawns.
      cells.push(blockedRow(run, releaseOffsetMs, 'campaign-cap-exhausted', [{ event: 'cap-refused', cap }]));
      continue;
    }
    // Preflights gate real seats only: simulated cells spend no model turns
    // and read no logins, so there is nothing a preflight could protect.
    // R18: manifest seats only — no real-seat path is un-preflighted.
    if (preflightSeats) {
      let preflightBlocker = null;
      let preflightCap = null;
      for (const role of ['sender', 'receiver']) {
        const seatId = seatKey(run, role);
        if (!preflighted.has(seatId)) {
          // V3 §6.4 (R15/P2-3): the preflight's own unit must fit before it
          // runs. Today's precheck is model-free and debits nothing, but the
          // first model-reaching precheck debits exactly like a first
          // attempt — there is no un-debited path to a model.
          if (!fitsSessions(ledger, 1)) { preflightCap = 'launched-sessions'; break; }
          const seat = preflightSeats.find(s => s.seatId === seatId);
          const verdict = await runSeatPreflight(seat, { executables, runAuthPrecheck });
          preflighted.set(seatId, verdict);
          // The debit persists in the campaign ledger: that write is the
          // witness, reloaded on resume like every other debit.
          const debit = applyPreflightDebit(ledger, seatId, verdict);
          assert.ok(debit.ok, 'fit-checked preflight debit cannot refuse');
          // R17 (P2-1): a model-reaching preflight debits real units after
          // the pre-spawn gate. The moment the cell's two units no longer
          // fit, stop preflighting the second seat and refuse below.
          if (!fitsSessions(ledger, 2)) { preflightCap = 'launched-sessions'; break; }
        }
        const verdict = preflighted.get(seatId);
        if (!verdict.ok && !preflightBlocker) preflightBlocker = verdict.reason;
      }
      if (preflightCap) {
        ledger.refusals.push({ run: `${sender}>${receiver}`, code: 'campaign-cap-exhausted', cap: preflightCap });
        persistLedger(ledger);
        cells.push(blockedRow(run, releaseOffsetMs, 'campaign-cap-exhausted', [{ event: 'cap-refused', cap: preflightCap }]));
        continue;
      }
      if (preflightBlocker) {
        cells.push(blockedRow(run, releaseOffsetMs, preflightBlocker));
        continue;
      }
    }
    // R17 (P2-1): preflights may have debited units after the pre-spawn
    // gate — re-verify the cell's two units at the point of use, so a
    // refused launch is witnessed instead of crashing on the pre-checked
    // debits with an orphan debit on disk.
    if (!fitsSessions(ledger, 2)) {
      ledger.refusals.push({ run: `${sender}>${receiver}`, code: 'campaign-cap-exhausted', cap: 'launched-sessions' });
      persistLedger(ledger);
      cells.push(blockedRow(run, releaseOffsetMs, 'campaign-cap-exhausted', [{ event: 'cap-refused', cap: 'launched-sessions' }]));
      continue;
    }
    const senderDebit = debitSession(ledger, seatKey(run, 'sender'));
    const receiverDebit = debitSession(ledger, seatKey(run, 'receiver'));
    assert.ok(senderDebit.ok && receiverDebit.ok, 'pre-checked debits cannot refuse');
    ledger.attempts[`${sender}>${receiver}`] = (ledger.attempts[`${sender}>${receiver}`] ?? 0) + 1;
    noteWallClock(ledger, cellBoundMs);
    const cellStarted = performance.now();
    // Lot L5: the cell is pre-created by the parent and passed in the request,
    // so a lost worker's secrets stay attributable and wipable by the parent.
    // XCLI_WORKER_STUB (test seam) runs a stub worker instead of --worker.
    const cell = fs.mkdtempSync(join(root, 'c-'));
    const stub = process.env.XCLI_WORKER_STUB;
    const observation = fs.mkdtempSync(join(root, 'p-'));
    const command = supervisedCommand(supervisor, observation, [process.execPath, ...(stub ? [stub] : [self, '--worker'])]);
    const child = spawn(command[0], command.slice(1), {
        env: { ...environment(join(root, 'worker')), H2A_TEST_QUALIFICATION_ROOT: root,
          XCLI_VENDOR_PATHS: simulated ? '' : [...Object.values(executables).filter(Boolean),
            ...['sender', 'receiver'].filter(role => run[role] === 'muse').map(role => join(cell, role, 'muse-program/muse'))].join('\n'),
          XCLI_HARNESS_ENTRYPOINTS: [join(repo, 'scripts/xcli-proxy.mjs'), join(built.path, 'packages/h2a/dist/bin.js')].join('\n') },
        cwd: root, stdio: ['pipe', 'pipe', 'ignore'],
      });
    active = child;
    const watchdog = setTimeout(() => child.kill('SIGTERM'), timeoutMs * 2 + 45000);
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stdin.end(JSON.stringify({ sender, receiver, root, build: built.path, executables, timeoutMs, cell,
      scenario: scenarioSpec,
      authHomes: run.authHomes,
      seats: { sender: run.senderSeat, receiver: run.receiverSeat }, seatMode,
      mcpCallCap: caps.mcpCallsPerSession,
      simulated, dropWake: process.argv.includes('--drop-simulated-wake'),
      wake: wakeWindows, poll: pollEnvValue(poll), simPop: process.env.XCLI_SIM_POP === '1',
      withholdForever, replayWake, releaseOffsetMs }));
    await new Promise((r, reject) => { child.once('close', r); child.once('error', reject); });
    clearTimeout(watchdog);
    active = undefined;
    let row;
    try {
      row = JSON.parse(output);
      assert.ok(row && typeof row === 'object', 'worker row must be an object');
    } catch { row = { sender, receiver, status: 'blocked', cleanupFailed: true,
      blocker: 'qualification-worker-failed-cleanup-unproven', evidence: [], elapsedMs: 0, cell }; }
    // Quota stops belong to the campaign, including its later resumes.
    // Persist the worker's observation before recovery can change its blocker.
    const quotaRoles = ['sender', 'receiver'].filter(role =>
      row.evidence?.some(e => e.event === 'provider-quota-observed' && e.role === role));
    if (quotaRoles.length) {
      for (const role of quotaRoles) quotaSeats.add(seatKey(run, role));
      ledger.quotaSeats = [...quotaSeats];
      persistLedger(ledger);
    }
    try {
      const observed = supervisorResult(observation);
      row.parentProcessRecovery = observed.processRecovery === true;
      row.execJournal = { ...classifyExecJournal(observed.records), scope: 'ptrace-exec-owned-subtree; vendor-subtree-allowance' };
      if (!observed.observed || !row.parentProcessRecovery) {
        row.cleanupFailed = true; row.status = 'blocked'; row.blocker = 'owned-process-recovery-unproven';
      }
      if (row.execJournal.pythonDescendants.length) {
        row.status = 'blocked'; row.blocker = 'python-descendant-detected';
      }
    } catch {
      row.parentProcessRecovery = false; row.cleanupFailed = true;
      row.status = 'blocked'; row.blocker = 'owned-process-recovery-unproven';
    } finally { fs.rmSync(observation, { recursive: true, force: true }); }
    // Lot L8: seat attribution is parent-authoritative — a worker (or stub)
    // can never forge which seats served the cell.
    row.seats = { sender: run.senderSeat, receiver: run.receiverSeat };
    row.sharedSeat = run.sharedSeat;
    row.seatMode = seatMode;
    // Lot L5 parent-side wipe enforcement (§6.6): never trust the worker's
    // word. Wipe the parent-owned cell and re-check its absence. A
    // wipe the parent cannot prove classifies secret-wipe-unproven with
    // confinement-recovery reporting; the campaign stops either way.
    let surviving = null;
    try {
      // The parent owns this exact path. Never accept a worker-supplied
      // cleanup target. Remove ALL private state after bounded recovery.
      surviving = wipeSecrets([cell]);
    } catch { surviving = null; }
    row.parentSecretWipe = Array.isArray(surviving) && surviving.length === 0;
    if (!row.parentSecretWipe) {
      row.cleanupFailed = true;
      row.status = 'blocked';
      row.blocker = 'secret-wipe-unproven';
      row.confinementRecovery = { root, surviving: Array.isArray(surviving) ? surviving.map(p => relative(root, p)) : ['wipe-unproven'] };
      stopping = true;
    }
    row.releaseOffsetMs = releaseOffsetMs;
    cells.push(row);
    // Lot L8 (§6.4): quota safety net per seat, and wall-clock accounting for
    // the silent-session bound. Per-cell files are seat-qualified under a
    // manifest so seat pairs sharing a family never overwrite each other.
    row.parentElapsedMs = Math.ceil(performance.now() - cellStarted);
    noteWallClock(ledger, row.parentElapsedMs, { reservedMs: cellBoundMs });
    if (row.cleanupFailed) stopping = true;
    // Lot L8 (§6.4): the per-session MCP brake is campaign-wide. The first
    // breached cell keeps its measured mcp-call-cap-exceeded failure; the
    // persisted flag refuses every later launch, in this run and on resume.
    if (row.failure === 'mcp-call-cap-exceeded' && !row.cleanupFailed && ledger.mcpCapBreached !== true) {
      ledger.mcpCapBreached = true;
      persistLedger(ledger);
    }
    process.stdout.write(`${sender} -> ${receiver}: ${row.status} (${row.blocker ?? row.failure ?? 'round-trip'})\n`);
  }
  // Lot L3 batch separation (§3.3): NO cell earns stage-7 credit until its
  // full batch — at least 3 separated replications of the same probe pair —
  // passes the containment check on actual witnessed times. The check runs
  // for every poll mode and every offset count, single offset included: a
  // lone cell can never satisfy the 3-replication rule, so a single-offset
  // run (or any short batch) earns no wake credit. A failing batch
  // downgrades credited cells; cells already KO keep their own mechanism.
  // Scripted scenarios never claim a wake and stay out of the batch.
  {
    const seen = new Set();
    for (const cell of cells) {
      if ((cell.scenario ?? 'probe') !== 'probe') continue;
      const key = `${cell.seats?.sender ?? cell.sender}:${cell.seats?.receiver ?? cell.receiver}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const group = cells.filter(c => c.sender === cell.sender && c.receiver === cell.receiver &&
        c.seats?.sender === cell.seats?.sender && c.seats?.receiver === cell.seats?.receiver &&
        (c.scenario ?? 'probe') === 'probe');
      if (!group.length) continue;
      const verdict = verifyWakeBatch(group);
      if (verdict.pass) {
        for (const cell of group) {
          cell.wakeClaim = `withheld-protocol, periods ≤ ${cell.wakeWindows.w1Ms}ms excluded, ${group.length} separated replications; varying-phase polling not excluded`;
        }
      } else {
        for (const cell of group) {
          if (cell.wakeFailure !== 'wake-withheld-forever') cell.wakeClaim = 'no wake claimed (wake-phase-separation-unproven)';
          if (cell.woke === true) {
            cell.woke = false;
            cell.wakeFailure = 'wake-phase-separation-unproven';
            cell.wakeClaim = 'no wake claimed (wake-phase-separation-unproven)';
            cell.status = classify(cell).replace(/^measured-/, simulated ? 'simulated-' : 'measured-');
          }
        }
      }
      process.stdout.write(`wake batch ${key}: ${verdict.pass ? 'separated' : 'NOT separated'} (${verdict.failures.join('; ')})\n`);
    }
  }
  // Persist only final batch verdicts; no earlier per-cell file may keep
  // stage-7 credit that the separation check subsequently withdrew.
  for (const [index, row] of cells.entries()) {
    scanEvidenceText(JSON.stringify(row));
    const name = `${row.seats?.sender ?? row.sender}-${row.seats?.receiver ?? row.receiver}-${index}.json`;
    fs.writeFileSync(join(root, name), JSON.stringify(row, null, 2) + '\n', { mode: 0o600 });
  }
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  // Lot L4 receipt hygiene: the retained command never carries owner-side
  // paths (--seat-manifest, --campaign-root name directories outside the
  // campaign root).
  const redactable = new Set(['--seat-manifest', '--campaign-root']);
  const redactedArgs = process.argv.slice(2).map((arg, index, args) =>
    redactable.has(args[index - 1]) ? `<${args[index - 1].slice(2)}>` : arg);
  // Lot L8 (§5.5/§6.4): the receipt carries the seat mode, the composite
  // caps (PROPOSITION numbers until D2), the per-seat ledger totals, the
  // refused-launch registry, and one preflight verdict per seat.
  const preflights = [...preflighted.entries()].map(([seatId, verdict]) => ({ seatId, ...verdict }));
  const result = { version: 1, mode: simulated ? 'simulated-model' : 'real-cli', sha, node: process.version,
    command: ['node', 'scripts/qualify-cross-cli.mjs', ...redactedArgs].join(' '),
    root, build: built,
    harnessDigests: Object.fromEntries(['qualify-cross-cli.mjs', 'xcli-lab.mjs', 'xcli-proxy.mjs', 'xcli-terminal.mjs',
      'xcli-simulated-model.mjs', 'xcli-wake-host.mjs', 'xcli-ci-check.mjs'].map(name =>
      [name, createHash('sha256').update(fs.readFileSync(join(repo, 'scripts', name))).digest('hex')])),
    seatMode, caps, capsStatus: 'proposition-pending-D2',
    ledgerTotals: renderSeatLedger(ledger), ledgerRefusals: ledger.refusals, preflights,
    cells, counts: Object.fromEntries([simulated ? 'simulated-OK' : 'measured-OK', simulated ? 'simulated-KO' : 'measured-KO', 'blocked'].map(s => [s, cells.filter(c => c.status === s).length])) };
  const output = resolve(option('--output', join(root, 'qualification.json')));
  scanEvidenceText(JSON.stringify(result));
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  if (!selected && !simulated) {
    const doc = resolve(option('--markdown', join(root, 'qualification.md')));
    scanEvidenceText(markdown(result));
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
