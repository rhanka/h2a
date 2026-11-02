// Lot L8 (SPEC v3 §6.1/§6.4/§6.5, §5.5): seat manifest and campaign engine.
// Seats are named per-role auth sources; pairs name seats, not families.
// Dummy seat dirs in mkdtemp; no real login, no model. R18 (owner D1):
// the campaign lane uses cyber-seat custody only (see
// scripts/xcli-seat-custody.mjs): seatMode cyber-seat-custody, envelopes
// validated by the vendored llm-mesh adapters, no copy from a home
// directory. The interim-file-copy mode is superseded and refused by the
// lane gate; loadSeatManifest itself stays mode-agnostic.
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { CLIS, pythonEntrypoint, vendorRuntimeLabel, LOGIN_ALLOWLIST, PINNED_CLI_ARGS, environment, copyLogin, privateExecutable } from './xcli-lab.mjs';

const GEMINI_SHAPED = ['oauth_creds.json', 'google_accounts.json'];

// Manifest shape: { version: 1, seatMode, seats: [{ seatId, family,
// authSource, cliVersion?, binaryDigest? }] }. Load validates shape and the
// AGY/Gemini separation; file existence is checked at use, never here.
export function loadSeatManifest(file, { simulated = false } = {}) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(manifest.version, 1, 'seat manifest version must be 1');
  assert.ok(typeof manifest.seatMode === 'string' && manifest.seatMode.length > 0, 'seat manifest needs a seatMode');
  assert.ok(Array.isArray(manifest.seats) && manifest.seats.length > 0, 'seat manifest needs seats');
  const seen = new Set();
  for (const seat of manifest.seats) {
    assert.ok(seat && typeof seat.seatId === 'string' && seat.seatId.length > 0, 'each seat needs a seatId');
    assert.ok(!seen.has(seat.seatId), `duplicate seatId: ${seat.seatId}`);
    seen.add(seat.seatId);
    assert.ok(CLIS.includes(seat.family), `unknown family for seat ${seat.seatId}: ${seat.family}`);
    assert.ok(typeof seat.authSource === 'string' && seat.authSource.length > 0, `seat ${seat.seatId} needs an authSource`);
  }
  // Tier S keeps seat identities and pair selection, never credential paths
  // or filesystem inspection of their sources (including AGY directory reads).
  if (simulated) {
    for (const seat of manifest.seats) delete seat.authSource;
    return manifest;
  }
  // Resolve auth sources against the manifest directory at load, so every
  // later byte read is already fully resolved inside an authorised root.
  const base = dirname(file);
  for (const seat of manifest.seats) seat.authSource = resolve(base, seat.authSource);
  // AGY must not silently reuse Gemini auth paths as proof (F9): an AGY seat
  // sharing its source dir with a Gemini seat, or holding Gemini-shaped
  // files, is refused at load.
  const geminiSources = new Set(manifest.seats.filter(s => s.family === 'gemini').map(s => s.authSource));
  for (const seat of manifest.seats) {
    if (seat.family !== 'agy') continue;
    if (geminiSources.has(seat.authSource)) {
      throw new Error(`agy-gemini-reuse: seat ${seat.seatId} shares its auth source with a Gemini seat`);
    }
    let names = [];
    try { names = fs.readdirSync(seat.authSource); } catch { /* checked at use */ }
    if (names.some(name => GEMINI_SHAPED.includes(name))) {
      throw new Error(`agy-gemini-reuse: seat ${seat.seatId} holds Gemini-shaped login files`);
    }
  }
  return manifest;
}

// Resolve 'seat-a:seat-b' to per-role { seatId, family, authSource } plus the
// diagonal sharedSeat flag. Unknown seats throw seat-unknown.
export function resolveSeatPair(manifest, pair) {
  const [senderId, receiverId] = String(pair).split(':');
  const byId = Object.fromEntries(manifest.seats.map(seat => [seat.seatId, seat]));
  assert.ok(byId[senderId], `seat-unknown:${senderId}`);
  assert.ok(byId[receiverId], `seat-unknown:${receiverId}`);
  const role = seat => ({ seatId: seat.seatId, family: seat.family, authSource: seat.authSource });
  return { sender: role(byId[senderId]), receiver: role(byId[receiverId]),
    sharedSeat: senderId === receiverId };
}

// Campaign pair resolution: each side names a seatId, or a family with
// exactly one seat (otherwise seat-ambiguous — never a silent pick).
// Returns families, seatIds, the diagonal sharedSeat flag, and per-role
// auth sources for the worker request.
export function resolveCampaignPair(manifest, pair) {
  const byId = Object.fromEntries(manifest.seats.map(seat => [seat.seatId, seat]));
  const byFamily = {};
  for (const seat of manifest.seats) (byFamily[seat.family] ??= []).push(seat);
  const pick = id => {
    if (byId[id]) return byId[id];
    if ((byFamily[id] ?? []).length === 1) return byFamily[id][0];
    if (!(byFamily[id] ?? []).length) throw new Error(`seat-unknown:${id}`);
    throw new Error(`seat-ambiguous:${id}`);
  };
  const senderSeat = pick(String(pair).split(':')[0]);
  const receiverSeat = pick(String(pair).split(':')[1]);
  return { sender: senderSeat.family, receiver: receiverSeat.family,
    senderSeat: senderSeat.seatId, receiverSeat: receiverSeat.seatId,
    sharedSeat: senderSeat.seatId === receiverSeat.seatId,
    authHomes: { sender: senderSeat.authSource, receiver: receiverSeat.authSource } };
}

// Ready state of a seat's auth source: 'ready' or 'missing-auth-source'.
// A missing source blocks the cell; it never falls back anywhere.
export function seatFilesStatus(manifest, seatId) {
  const seat = manifest.seats.find(s => s.seatId === seatId);
  assert.ok(seat, `seat-unknown:${seatId}`);
  try {
    if (!fs.statSync(seat.authSource).isDirectory()) return 'missing-auth-source';
  } catch { return 'missing-auth-source'; }
  return 'ready';
}

// Campaign ledger (§6.4): persistent, 0600, filtered fields only. Written
// before each spawn and reloaded on resume — resuming never resets a
// counter. Caps are PROPOSITION numbers until the owner ratifies D2; the
// counting, stop rules, and persistence are normative.
export function createCampaignLedger(dir, caps) {
  assert.ok(Number.isSafeInteger(caps.launchedSessions) && caps.launchedSessions > 0, 'launchedSessions cap required');
  assert.ok(Number.isSafeInteger(caps.mcpCallsPerSession) && caps.mcpCallsPerSession > 0, 'mcpCallsPerSession cap required');
  assert.ok(Number.isSafeInteger(caps.wallClockMs) && caps.wallClockMs > 0, 'wallClockMs cap required');
  const ledger = { version: 1, caps, sessionsDebited: 0, perSeatDebited: {},
    wallClockSpentMs: 0, attempts: {}, mcpRefusals: [], quotaSeats: [], mcpCapBreached: false };
  writeLedger(dir, ledger);
  return loadCampaignLedger(dir);
}

function ledgerFile(dir) { return join(dir, 'campaign-ledger.json'); }

function writeLedger(dir, ledger) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { __dir, ...persisted } = ledger;
  const next = join(dir, 'campaign-ledger.next');
  fs.writeFileSync(next, JSON.stringify(persisted, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(next, ledgerFile(dir));
}

function readLedger(dir) {
  const ledger = JSON.parse(fs.readFileSync(ledgerFile(dir), 'utf8'));
  assert.equal(ledger.version, 1, 'campaign ledger version must be 1');
  return ledger;
}

export function loadCampaignLedger(dir) {
  const ledger = readLedger(dir);
  ledger.__dir = dir;
  return ledger;
}

// Pre-spawn debit (normative): the unit is debited BEFORE spawn. A launch
// whose debit would exceed the cap is refused with no process record and no
// seat touched. Preflights, retries, and re-runs debit exactly like first
// attempts — there is no un-debited path to a model.
export function debitSession(ledger, seatId, { kind = 'cell' } = {}) {
  assert.ok(['cell', 'preflight', 'retry', 'rerun'].includes(kind), 'known debit kind');
  if (ledger.sessionsDebited + 1 > ledger.caps.launchedSessions) {
    return { ok: false, code: 'campaign-cap-exhausted', spawned: false, kind };
  }
  ledger.sessionsDebited += 1;
  ledger.perSeatDebited[seatId] = (ledger.perSeatDebited[seatId] ?? 0) + 1;
  assert.ok(ledger.__dir, 'ledger dir unknown; reload it first');
  writeLedger(ledger.__dir, ledger);
  return { ok: true, kind };
}

// Preflight debit wiring (SPEC v3 §6.4, R15/P2-3): one §6.5 preflight that
// reaches a model is one launched-session unit, debited exactly like a first
// attempt. The unit is the session, not the turn count: any modelCalls > 0
// debits one preflight unit. A model-free preflight (today's config-status
// precheck) debits nothing. A refused preflight debit must block the cell
// before any spawn, like any other cap refusal.
export function applyPreflightDebit(ledger, seatId, verdict) {
  if ((verdict?.modelCalls ?? 0) <= 0) return { ok: true, debited: false, kind: 'preflight' };
  if (!fitsSessions(ledger, 1)) return { ok: false, code: 'campaign-cap-exhausted', kind: 'preflight', debited: false };
  debitSession(ledger, seatId, { kind: 'preflight' });
  return { ok: true, debited: true, kind: 'preflight' };
}

// Pre-launch fit check (normative): the pending units must fit all caps
// before any spawn. Pure; the debit persists separately.
export function fitsSessions(ledger, count) {
  assert.ok(Number.isSafeInteger(count) && count > 0, 'unit count required');
  return ledger.sessionsDebited + count <= ledger.caps.launchedSessions;
}

// Status emitter (§5.5): per-seat debit totals plus the campaign total.
// Display is in addition to enforcement, never instead of it.
export function renderSeatLedger(ledger) {
  const lines = [`sessionsDebited: ${ledger.sessionsDebited}/${ledger.caps.launchedSessions}`,
    `wallClockSpentMs: ${ledger.wallClockSpentMs}/${ledger.caps.wallClockMs}`];
  for (const [seatId, count] of Object.entries(ledger.perSeatDebited).sort(([a], [b]) => a < b ? -1 : 1)) {
    lines.push(`seat ${seatId}: ${count} session${count === 1 ? '' : 's'} debited`);
  }
  if (!Object.keys(ledger.perSeatDebited).length) lines.push('no sessions debited');
  return lines.join('\n');
}

// Wall-clock accounting (§6.4): a silent session is bounded by its session
// unit plus the watchdog; the bound is stated, not hidden. Pre-launch checks
// refuse when the campaign wall-clock cap would be exceeded.
// Reserve the full watchdog bound before spawn. A completed attempt replaces
// its reservation with parent-measured time; an interrupted parent leaves the
// reservation charged across resume, rather than losing the attempt's cost.
export function noteWallClock(ledger, ms, { reservedMs = 0 } = {}) {
  assert.ok(Number.isSafeInteger(ms) && ms >= 0, 'wall-clock slice required');
  assert.ok(Number.isSafeInteger(reservedMs) && reservedMs >= 0 && reservedMs <= ledger.wallClockSpentMs,
    'wall-clock reservation required');
  ledger.wallClockSpentMs += ms - reservedMs;
  assert.ok(ledger.__dir, 'ledger dir unknown; reload it first');
  writeLedger(ledger.__dir, ledger);
}

export function wallClockFits(ledger, additionalMs) {
  return ledger.wallClockSpentMs + additionalMs <= ledger.caps.wallClockMs;
}

// Persist in-memory ledger mutations (attempt counters) without a debit.
export function persistLedger(ledger) {
  assert.ok(ledger.__dir, 'ledger dir unknown; reload it first');
  writeLedger(ledger.__dir, ledger);
}

// Per-session MCP-call counts (runaway brake input). Crossing the cap
// terminates that owned session and classifies mcp-call-cap-exceeded. The
// count is exact at the witness; it does not bound silent reasoning, and
// evidence must say so.
export function createMcpCallCounts() { return {}; }

export function noteMcpCall(counts, sessionId, cap) {
  assert.ok(typeof sessionId === 'string' && sessionId.length > 0, 'session id required');
  assert.ok(Number.isSafeInteger(cap) && cap > 0, 'per-session MCP-call cap required');
  counts[sessionId] = (counts[sessionId] ?? 0) + 1;
  if (counts[sessionId] > cap) return { exceeded: true, code: 'mcp-call-cap-exceeded', count: counts[sessionId] };
  return { exceeded: false, count: counts[sessionId] };
}

// Per-family usage-signal inventory (§6.4 correction V2-4): whether a
// structured turn/usage signal is obtainable without reading transcripts.
// Absence is a named source-gap, never papered over by renaming MCP calls.
export function usageSignalInventory() {
  return Object.fromEntries(CLIS.map(family => [family,
    { obtainable: false, status: 'source-gap', reason: 'not-demonstrated' }]));
}

// Pinned-flags check (R15, class-c): the exact flags the harness launches
// a family with (PINNED_CLI_ARGS) must still be accepted by the installed
// binary, verified through `<executable> --help` — no login, no model. A
// version drift that drops a flag (codex 0.163.0 vs pin 0.162.1 suspect)
// fails closed here as preflight-args-unproven instead of an unexplained
// cli-exited-before-ready in the cell.
export function checkPinnedArgs(cli, executable, options = {}) {
  const pinned = PINNED_CLI_ARGS[cli] ?? [];
  if (!pinned.length) return { ok: true, args: [] };
  let text = '';
  try {
    const probed = spawnSync(executable, ['--help'], { ...options, timeout: 15000, maxBuffer: 256 * 1024 });
    if (probed.status !== 0) return { ok: false, reason: 'preflight-args-unproven' };
    // R21: usage text lives on either stream — agy prints its help to
    // stderr, never stdout. A stdout-only read mis-refuses a present flag.
    text = `${probed.stdout ?? ''}\n${probed.stderr ?? ''}`;
  } catch { return { ok: false, reason: 'preflight-args-unproven' }; }
  const escaped = flag => flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Usage lines bracket flags ([--no-daemon]); option rows follow them with
  // spaces, = or punctuation. Only a longer flag name must not match.
  const missing = pinned.filter(flag => !new RegExp(`(?:^|[^\\w-])${escaped(flag)}(?:$|[^\\w-])`).test(text));
  if (missing.length) return { ok: false, reason: 'preflight-args-unproven', missing };
  return { ok: true, args: [...pinned] };
}

// Seat preflight (§6.5): per seat, before its first cell. Binary resolves on
// the campaign PATH with version and digest recorded; the entrypoint guard
// passes for our chain with vendor runtimes labelled; the tier-C oracle for
// the family passes where a read-only oracle exists; an isolated auth
// precheck proves the login is accepted without spending a messaging cell.
// No step spends a model turn except the injected auth precheck, whose calls
// the caller debits. Every failure carries a classified reason.
export async function runSeatPreflight(seat, { executables = {}, runAuthPrecheck } = {}) {
  const fail = reason => ({ ok: false, reason, modelCalls: 0 });
  let executable = executables[seat.family];
  if (!executable) return fail(`cli-not-found:${seat.family}`);
  const root = fs.mkdtempSync(join(tmpdir(), 'h2a-preflight-'));
  try {
  const env = environment(root);
  executable = privateExecutable(seat.family, executable, root).path;
  const vendorLabel = vendorRuntimeLabel(seat.family, executable);
  if (!vendorLabel && pythonEntrypoint(executable)) {
    return fail(`python-entrypoint-forbidden:${seat.family}`);
  }
  const options = { env, cwd: root, encoding: 'utf8' };
  let version = null;
  try {
    const probed = spawnSync(executable, ['--version'], { ...options, timeout: 15000, maxBuffer: 65536 });
    version = probed.status === 0 ? probed.stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null : null;
  } catch { version = null; }
  if (!version) return fail('preflight-version-unproven');
  let digest = null;
  try { digest = createHash('sha256').update(fs.readFileSync(executable)).digest('hex'); }
  catch { return fail('preflight-digest-unproven'); }
  const facts = { seatId: seat.seatId, family: seat.family, version, digest, modelCalls: 0 };
  if (vendorLabel) {
    facts.vendorRuntime = vendorLabel;
  }
  const pinned = checkPinnedArgs(seat.family, executable, options);
  if (!pinned.ok) return { ...fail(pinned.reason), ...facts };
  facts.pinnedArgs = pinned.args;
  facts.tierC = tierCOracle(seat.family, executable, options);
  if (!facts.tierC.ok) return { ...fail(facts.tierC.reason), ...facts };
  const allowlisted = LOGIN_ALLOWLIST[seat.family] ?? null;
  if (allowlisted === null) return { ...fail(`login-not-confined:${seat.family}`), ...facts };
  let present = [];
  try {
    present = copyLogin(seat.family, seat.authSource, root, env);
  } catch { present = []; }
  if (!present.length) return { ...fail('preflight-auth-unproven'), ...facts };
  if (seat.family === 'muse') {
    assert.ok(typeof runAuthPrecheck === 'function', 'Muse auth precheck requires an injected runner');
    const checked = await runAuthPrecheck(seat, { executable, env, root });
    facts.modelCalls = checked.modelCalls ?? 1;
    if (!checked.ok) return { ...fail(checked.reason ?? 'preflight-auth-unproven'), ...facts };
    facts.authPrecheck = checked.detail ?? 'exec-preflight-accepted';
  } else {
    facts.authPrecheck = 'login-files-present';
  }
  return { ok: true, ...facts };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// Read-only tier-C step per family (real parser, no login, no model). Only
// families with a proven read-only list command are executed; the rest name
// their gap and pass the step without pretending.
function tierCOracle(family, executable, options) {
  const list = family === 'codex' ? ['mcp', 'list', '--json'] : null;
  if (!list) return { ok: true, oracle: 'source-gap', reason: 'no-read-only-oracle' };
  try {
    const probed = spawnSync(executable, list, { ...options, timeout: 20000, maxBuffer: 1024 * 1024 });
    if (probed.status !== 0) return { ok: false, reason: 'preflight-oracle-failed' };
    return { ok: true, oracle: list.join(' ') };
  } catch { return { ok: false, reason: 'preflight-oracle-failed' }; }
}
