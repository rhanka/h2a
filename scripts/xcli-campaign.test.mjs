// Lot L8 campaign-engine tests (SPEC v3 §6.1/§6.4/§6.5, §5.5). Drive the
// campaign parent with worker stubs (XCLI_WORKER_STUB) and dummy seat dirs in
// mkdtemp; no real login, no model. RED on code without the L8 wiring.
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { classifyScenarioRow } from './xcli-scenarios.mjs';
import { repo, removeCampaignRoot, environment, sourceBuild, compliantQualificationRoot } from './xcli-lab.mjs';

const QUALIFY = join(repo, 'scripts/qualify-cross-cli.mjs');
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";

function writeManifest(dir, seats, pairs) {
  for (const seat of seats) fs.mkdirSync(join(dir, seat.authSource), { recursive: true });
  const file = join(dir, 'seats.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, seatMode: 'interim-file-copy', seats, ...(pairs ? { pairs } : {}) }, null, 2));
  return file;
}

// A stub worker records the request routing, then reports a classified row
// without running any model. Per-test blocker is baked into the stub body.
const stubHead = `import fs from 'node:fs';
import { join } from 'node:path';
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
fs.appendFileSync(join(request.root, 'stub-invocations.log'), 'run\\n');
fs.writeFileSync(join(request.root, 'stub-last-request.json'),
  JSON.stringify({ seats: request.seats, authHomes: request.authHomes, seatMode: request.seatMode }));
`;
const stubRow = blocker => `${stubHead}process.stdout.write(JSON.stringify({ sender: request.sender,
  receiver: request.receiver, status: 'blocked', blocker: ${JSON.stringify(blocker)},
  evidence: ${JSON.stringify(blocker === 'provider-quota' ? [{ event: 'provider-quota-observed', role: 'receiver' }] : [])}, elapsedMs: 1,
  cell: request.cell, seats: request.seats, credentialsCopied: { sender: [], receiver: [] } }));\n`;

function runCampaign(args, stubBody) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-camp-'));
  const stub = join(dir, 'stub.mjs');
  fs.writeFileSync(stub, stubBody);
  const output = join(dir, 'receipt.json');
  const result = spawnSync(process.execPath, [QUALIFY, ...args, '--output', output],
    { env: { ...process.env, XCLI_WORKER_STUB: stub }, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  const root = (result.stdout.match(/Private qualification root: (\S+)/) ?? [])[1];
  assert.ok(root, `parent reports its root\n${result.stdout}\n${result.stderr}`);
  const receipt = JSON.parse(fs.readFileSync(output, 'utf8'));
  const invocations = fs.existsSync(join(root, 'stub-invocations.log'))
    ? fs.readFileSync(join(root, 'stub-invocations.log'), 'utf8').trim().split('\n').length : 0;
  // A minted sibling root is removed by the caller (resume passes an
  // explicit --campaign-root owned by its own dir).
  return { dir, root, receipt, invocations, result };
}

test('L8 R3: a simulated seat-qualified pair keeps role attribution without auth sources', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-camp-'));
  try {
    const manifest = writeManifest(dir, [
      { seatId: 'claude-a', family: 'claude', authSource: 'seat-a' },
      { seatId: 'claude-b', family: 'claude', authSource: 'seat-b' },
    ]);
    fs.writeFileSync(join(dir, 'seat-a', 'auth.json'), '{"token":"a"}');
    fs.writeFileSync(join(dir, 'seat-b', 'auth.json'), '{"token":"b"}');
    const run = runCampaign(['--simulated', '--seat-manifest', manifest, '--pair', 'claude-a:claude-b',
      '--timeout-ms', '10000'], stubRow('stub-no-model'));
    try {
      const routing = JSON.parse(fs.readFileSync(join(run.root, 'stub-last-request.json'), 'utf8'));
      assert.deepEqual(routing.authHomes, {}, 'simulated workers receive no credential paths');
      assert.deepEqual(run.receipt.cells[0].seats, { sender: 'claude-a', receiver: 'claude-b' });
      assert.equal(run.receipt.cells[0].sharedSeat, false);
      assert.equal(run.receipt.seatMode, 'interim-file-copy');
    } finally { removeCampaignRoot(run.root); fs.rmSync(run.dir, { recursive: true, force: true }); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8 R3: a simulated worker never reads or copies supplied dummy logins', () => {
  const root = compliantQualificationRoot();
  try {
    const built = sourceBuild(root), auth = join(root, 'auth');
    fs.mkdirSync(join(auth, '.codex'), { recursive: true });
    fs.writeFileSync(join(auth, '.codex/auth.json'), '{"token":"dummy-only"}');
    const reads = join(root, 'auth-reads.jsonl'), observer = join(root, 'observe.mjs');
    fs.writeFileSync(observer, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const realpath = fs.realpathSync;
for (const method of ['openSync', 'readFileSync', 'readdirSync']) {
  const original = fs[method];
  fs[method] = function(path, ...args) {
    let target = typeof path === 'number' ? '/proc/self/fd/' + path : String(path);
    try { if (target.startsWith('/proc/self/fd/')) target = realpath(target); } catch { /* absent allowlist member */ }
    if (target === ${JSON.stringify(auth)} || target.startsWith(${JSON.stringify(auth + '/')}))
      fs.appendFileSync(${JSON.stringify(reads)}, JSON.stringify({ method, path: target }) + '\\n');
    return original.call(this, path, ...args);
  };
}
syncBuiltinESMExports();`);
    const result = spawnSync(process.execPath, ['--import', observer, QUALIFY, '--worker'], {
      env: { ...environment(join(root, 'worker')), H2A_TEST_QUALIFICATION_ROOT: root }, cwd: root,
      input: JSON.stringify({ sender: 'codex', receiver: 'codex', root, build: built.path,
        executables: { codex: '/bin/true' }, simulated: true, timeoutMs: 1000,
        authHome: auth, authHomes: { sender: auth, receiver: auth } }),
      encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    const row = JSON.parse(result.stdout);
    const observed = fs.existsSync(reads) ? fs.readFileSync(reads, 'utf8').trim().split('\n').map(JSON.parse) : [];
    console.log({ credentialsCopied: row.credentialsCopied, authReads: observed.length });
    assert.equal(row.cleanupFailed, undefined, JSON.stringify(row.cleanupErrors));
    assert.ok(Object.hasOwn(row.credentialsCopied, 'receiver'), 'the receiver reached login mapping');
    assert.deepEqual(observed, [], 'no auth file may even be opened in simulation');
    assert.ok(Object.values(row.credentialsCopied).every(names => names.length === 0));
    assert.ok(!row.evidence.some(e => e.event === 'login-mapped'));
  } finally { removeCampaignRoot(root); }
});

test('L8: a diagonal single-seat cell records sharedSeat', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-camp-'));
  try {
    const manifest = writeManifest(dir, [{ seatId: 'codex', family: 'codex', authSource: 'seat-codex' }]);
    const run = runCampaign(['--simulated', '--seat-manifest', manifest, '--pair', 'codex:codex',
      '--timeout-ms', '10000'], stubRow('stub-no-model'));
    try {
      assert.deepEqual(run.receipt.cells[0].seats, { sender: 'codex', receiver: 'codex' });
      assert.equal(run.receipt.cells[0].sharedSeat, true);
    } finally { removeCampaignRoot(run.root); fs.rmSync(run.dir, { recursive: true, force: true }); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8: provider-quota on a seat stops further cells on that seat', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-camp-'));
  try {
    const manifest = writeManifest(dir, [
      { seatId: 's1', family: 'codex', authSource: 'seat-1' },
      { seatId: 's2', family: 'codex', authSource: 'seat-2' },
    ], ['s1:s2', 's1:s2']);
    const run = runCampaign(['--simulated', '--seat-manifest', manifest,
      '--timeout-ms', '10000'], stubRow('provider-quota'));
    try {
      assert.equal(run.invocations, 1, 'the second cell never spawns');
      assert.equal(run.receipt.cells[0].blocker, 'provider-quota');
      assert.equal(run.receipt.cells[1].blocker, 'provider-quota-seat-exhausted');
    } finally { removeCampaignRoot(run.root); fs.rmSync(run.dir, { recursive: true, force: true }); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const namedSeats of [false, true]) {
  test(`L8 R4: quota stops survive resume (${namedSeats ? 'named seats' : 'family seats'})`, () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-quota-resume-'));
    const campaignRoot = join(dir, 'campaign');
    const manifest = namedSeats ? writeManifest(dir, [
      { seatId: 's1', family: 'codex', authSource: 'seat-1' },
      { seatId: 's2', family: 'codex', authSource: 'seat-2' },
      { seatId: 's3', family: 'codex', authSource: 'seat-3' },
    ]) : null;
    const args = ['--simulated', '--pair', namedSeats ? 's1:s2' : 'codex:codex',
      ...(manifest ? ['--seat-manifest', manifest] : []), '--wake-release-offsets-ms', '0,100',
      '--timeout-ms', '1000', '--session-cap', '20', '--campaign-root', campaignRoot];
    const runs = [];
    try {
      const first = runCampaign(args, stubRow('provider-quota')); runs.push(first);
      assert.equal(first.invocations, 1);
      assert.equal(first.receipt.cells[1].blocker, 'provider-quota-seat-exhausted');
      const second = runCampaign(args, stubRow('provider-quota')); runs.push(second);
      console.log({ namedSeats, firstInvocations: first.invocations, resumedInvocations: second.invocations,
        ledger: JSON.parse(fs.readFileSync(join(campaignRoot, 'campaign-ledger.json'))).sessionsDebited });
      assert.equal(second.invocations, 1, 'resume must never relaunch an exhausted seat');
      assert.ok(second.receipt.cells.every(c => c.blocker === 'provider-quota-seat-exhausted'));
      assert.equal(JSON.parse(fs.readFileSync(join(campaignRoot, 'campaign-ledger.json'))).sessionsDebited, 2);
      assert.deepEqual(JSON.parse(fs.readFileSync(join(campaignRoot, 'campaign-ledger.json'))).quotaSeats, [namedSeats ? 's2' : 'codex']);
      assert.deepEqual(second.receipt.preflights, []);
      if (namedSeats) {
        const otherArgs = [...args]; otherArgs[otherArgs.indexOf('--pair') + 1] = 's3:s3';
        const other = runCampaign(otherArgs, stubRow('stub-no-model')); runs.push(other);
        assert.equal(other.invocations, 3, 'unaffected seats still fund both cells');
        assert.ok(other.receipt.cells.every(c => c.blocker === 'stub-no-model'));
      }
    } finally {
      for (const run of runs) fs.rmSync(run.dir, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('L8 R4: the MCP cap stops a CLI that keeps running after its MCP server exits', () => {
  const root = compliantQualificationRoot();
  try {
    const built = sourceBuild(root), fake = join(root, 'looping-cli');
    const heartbeat = join(root, 'heartbeat.jsonl');
    const program = join(root, 'looping-cli.mjs');
    fs.writeFileSync(fake, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(program)} "$@"\n`, { mode: 0o700 });
    fs.writeFileSync(program, `import fs from 'node:fs';
import {spawn} from 'node:child_process';
const child=spawn('h2a',['mcp-serve'],{env:process.env,stdio:['pipe','ignore','ignore']});
child.on('close',()=>fs.appendFileSync(${JSON.stringify(heartbeat)},JSON.stringify({event:'server-exit',at:Date.now()})+'\\n'));
setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},JSON.stringify({event:'cli-alive',at:Date.now()})+'\\n'),50);
child.stdin.on('error',()=>{});
for(let id=1;id<=4;id++)child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name:'h2a_identity_status',arguments:{}}})+'\\n');
`);
    const result = spawnSync(process.execPath, [QUALIFY, '--worker'], {
      env: { ...environment(join(root, 'worker')), H2A_TEST_QUALIFICATION_ROOT: root }, cwd: root,
      input: JSON.stringify({ sender: 'codex', receiver: 'codex', root, build: built.path,
        executables: { codex: fake }, simulated: false, timeoutMs: 5000, mcpCallCap: 3 }),
      encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    const row = JSON.parse(result.stdout);
    const cap = row.evidence.find(e => e.event === 'mcp-call-cap-exceeded');
    assert.equal(cap?.count, 4);
    assert.equal(cap.cap, 3);
    const beats = fs.readFileSync(heartbeat, 'utf8').trim().split('\n').map(JSON.parse);
    const lastAlive = Math.max(...beats.filter(e => e.event === 'cli-alive').map(e => e.at));
    assert.ok(Number.isFinite(lastAlive), 'the fake CLI actually ran its heartbeat');
    console.log({ status: row.status, blocker: row.blocker, failure: row.failure, cliAliveAfterCapMs: lastAlive - cap.at });
    assert.ok(lastAlive - cap.at < 1000, 'the CLI must stop promptly even with proxy stdin open');
    assert.equal(row.status, 'measured-KO');
    assert.equal(row.failure, 'mcp-call-cap-exceeded');
    assert.equal(row.blocker, undefined);
    assert.equal(row.cleanupFailed, undefined, JSON.stringify(row.cleanupErrors));
    assert.equal(row.processRecovery, true);
    assert.equal(row.secretWipe, true);
  } finally { removeCampaignRoot(root); }
});

test('L8: the launched-session cap refuses pre-spawn and stops the campaign', () => {
  const run = runCampaign(['--simulated', '--pair', 'codex:codex', '--wake-release-offsets-ms', '0,100',
    '--timeout-ms', '10000', '--session-cap', '2'], stubRow('stub-no-model'));
  try {
    assert.equal(run.result.status, 2);
    assert.equal(run.invocations, 1, 'the refused launch spawns nothing');
    assert.equal(run.receipt.cells[1].blocker, 'campaign-cap-exhausted');
    assert.ok(run.receipt.ledgerTotals.includes('sessionsDebited: 2/2'), 'the ledger states its totals');
  } finally { removeCampaignRoot(run.root); fs.rmSync(run.dir, { recursive: true, force: true }); }
});

test('L8 R4: an MCP breach stops the campaign and persists its stop across resume', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-mcp-stop-'));
  const campaignRoot = join(dir, 'campaign');
  const stub = stubHead + 'process.stdout.write(JSON.stringify({ sender: request.sender,\n' +
    "    receiver: request.receiver, status: 'simulated-KO', failure: 'mcp-call-cap-exceeded',\n" +
    '    evidence: [{ event: ' + JSON.stringify('mcp-call-cap-exceeded') + ', count: 2, cap: 1 }], elapsedMs: 1,\n' +
    '    cell: request.cell, seats: request.seats, credentialsCopied: { sender: [], receiver: [] } }));\n';
  const args = ['--simulated', '--pair', 'codex:codex', '--wake-release-offsets-ms', '0,100',
    '--timeout-ms', '1000', '--campaign-root', campaignRoot];
  let first, second;
  try {
    first = runCampaign(args, stub);
    assert.equal(first.invocations, 1, 'the breached cell runs once');
    assert.equal(first.receipt.cells[0].failure, 'mcp-call-cap-exceeded');
    assert.equal(first.receipt.cells[0].blocker, undefined);
    assert.equal(first.receipt.cells[1].status, 'blocked');
    assert.equal(first.receipt.cells[1].blocker, 'campaign-cap-exhausted');
    assert.ok(first.receipt.ledgerRefusals.some(r => r.code === 'campaign-cap-exhausted' && r.cap === 'mcp-call-cap'));
    const ledger = JSON.parse(fs.readFileSync(join(campaignRoot, 'campaign-ledger.json')));
    assert.equal(ledger.mcpCapBreached, true);
    assert.equal(ledger.sessionsDebited, 2);
    second = runCampaign(args, stub);
    assert.equal(second.invocations, first.invocations, 'resume spawns nothing new after an MCP stop');
    assert.ok(second.receipt.cells.every(c => c.blocker === 'campaign-cap-exhausted'));
    assert.equal(JSON.parse(fs.readFileSync(join(campaignRoot, 'campaign-ledger.json'))).sessionsDebited, 2);
  } finally {
    for (const run of [first, second]) if (run) fs.rmSync(run.dir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R5: reconnecting MCP backends share the owning CLI session cap', () => {
  const root = compliantQualificationRoot();
  try {
    const built = sourceBuild(root), fake = join(root, 'reconnecting-cli');
    const program = join(root, 'reconnecting.mjs'), activity = join(root, 'activity.jsonl');
    fs.writeFileSync(fake, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(program)} "$@"\n`, { mode: 0o700 });
    fs.writeFileSync(program, `import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
setInterval(()=>fs.appendFileSync(${JSON.stringify(activity)},JSON.stringify({event:'alive',at:Date.now()})+'\\n'),50);
for(let run=0;run<2;run++) await new Promise(resolve=>{
  const p=spawn('h2a',['mcp-serve'],{env:process.env,stdio:['pipe','pipe','ignore']});let count=0;
  createInterface({input:p.stdout}).on('line',line=>{const msg=JSON.parse(line);
    if(msg.id===1||msg.id===2){if(++count===2)p.stdin.end();}});
  p.on('close',()=>{fs.appendFileSync(${JSON.stringify(activity)},JSON.stringify({event:'backend-complete',count})+'\\n');resolve();});
  p.stdin.on('error',()=>{});
  for(let id=1;id<=2;id++)p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name:'h2a_identity_status',arguments:{}}})+'\\n');
});`);
    const result = spawnSync(process.execPath, [QUALIFY, '--worker'], {
      cwd: root, env: { ...environment(join(root, 'worker')), H2A_TEST_QUALIFICATION_ROOT: root },
      input: JSON.stringify({ sender: 'codex', receiver: 'codex', root, build: built.path,
        executables: { codex: fake }, simulated: false, timeoutMs: 5000, mcpCallCap: 3 }),
      encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    const row = JSON.parse(result.stdout), cap = row.evidence.find(e => e.event === 'mcp-call-cap-exceeded');
    const activityRows = fs.readFileSync(activity, 'utf8').trim().split('\n').map(JSON.parse);
    console.log({ proxies: row.evidence.filter(e => e.event === 'proxy-start').length,
      completed: activityRows.filter(e => e.event === 'backend-complete'), cap, failure: row.failure });
    assert.equal(row.evidence.filter(e => e.event === 'proxy-start').length, 2);
    assert.equal(cap?.count, 4, 'the fourth call crosses the session cap after reconnection');
    assert.equal(cap.cap, 3);
    assert.ok(Math.max(...activityRows.filter(e => e.event === 'alive').map(e => e.at)) - cap.at < 1000);
    assert.equal(row.status, 'measured-KO');
    assert.equal(row.failure, 'mcp-call-cap-exceeded');
    assert.equal(row.processRecovery, true);
    assert.equal(row.secretWipe, true);
  } finally { removeCampaignRoot(root); }
});

test('R5: identity-never-ready rejects a receiver that exits before MCP startup', () => {
  const root = compliantQualificationRoot();
  try {
    const built = sourceBuild(root), fake = join(root, 'dead-cli'), program = join(root, 'dead.mjs');
    fs.writeFileSync(program, 'setTimeout(()=>process.exit(0),500);\n');
    fs.writeFileSync(fake, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(program)} "$@"\n`, { mode: 0o700 });
    for (const scenario of ['probe', 'unavailability:identity-never-ready']) {
      const result = spawnSync(process.execPath, [QUALIFY, '--worker'], {
        cwd: root, env: { ...environment(join(root, 'worker')), H2A_TEST_QUALIFICATION_ROOT: root },
        input: JSON.stringify({ sender: 'claude', receiver: 'codex', root, build: built.path,
          executables: { claude: fake, codex: fake }, simulated: true, timeoutMs: 2000, scenario }),
        encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
      assert.equal(result.status, 0, result.stderr);
      const row = JSON.parse(result.stdout);
      console.log({ scenario, blocker: row.blocker, receiverMcp: row.receiverMcp,
        verdict: scenario === 'probe' ? undefined : classifyScenarioRow(scenario, row) });
      assert.equal(row.receiverMcp, false);
      assert.equal(row.blocker, 'cli-exited-before-ready');
      if (scenario !== 'probe') assert.equal(classifyScenarioRow(scenario, row).ok, false);
      assert.equal(row.processRecovery, true);
      assert.equal(row.secretWipe, true);
    }
  } finally { removeCampaignRoot(root); }
});

test('R5: a receiver quota leaves the unlaunched sender usable on resume', () => {
  const root = compliantQualificationRoot();
  try {
    const env = environment(join(root, 'env')), launches = join(root, 'launches.jsonl');
    for (const [cli, body] of [
      ['codex', `process.stdout.write('quota exceeded\\r\\n');setInterval(()=>{},1000);`],
      ['claude', `process.argv.splice(2,0,'claude');await import(${JSON.stringify(new URL('./xcli-simulated-model.mjs', import.meta.url).href)});`],
    ]) {
      const program = join(root, cli + '.mjs');
      fs.writeFileSync(program, `import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(launches)},${JSON.stringify(cli + '\n')});\n` + body);
      fs.writeFileSync(join(root, 'env/bin', cli), `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(program)} "$@"\n`, { mode: 0o700 });
    }
    const campaign = compliantQualificationRoot();
    try {
      const rows = [];
      for (const pair of ['claude:codex', 'claude:claude']) {
        const output = join(root, pair.replace(':', '-') + '.json');
        const result = spawnSync(process.execPath, [QUALIFY, '--pair', pair, '--timeout-ms', pair.endsWith('codex') ? '1000' : '5000',
          '--campaign-root', campaign, '--output', output], { cwd: repo, env: { ...process.env, ...env },
          encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
        assert.equal(result.status, 2, result.stderr);
        rows.push(JSON.parse(fs.readFileSync(output)).cells[0]);
      }
      const ledger = JSON.parse(fs.readFileSync(join(campaign, 'campaign-ledger.json')));
      console.log({ quotaSeats: ledger.quotaSeats, blockers: rows.map(r => r.blocker), launches: fs.readFileSync(launches, 'utf8') });
      assert.equal(rows[0].blocker, 'provider-quota');
      assert.deepEqual(rows[0].evidence.filter(e => e.event === 'session-created').map(e => e.role), ['receiver']);
      assert.deepEqual(ledger.quotaSeats, ['codex']);
      assert.equal(rows[1].receiverMcp, true);
      assert.deepEqual(rows[1].evidence.filter(e => e.event === 'session-created').map(e => e.role), ['receiver']);
      assert.notEqual(rows[1].blocker, 'provider-quota-seat-exhausted');
      assert.equal(rows[1].parentProcessRecovery, true);
      assert.equal(rows[1].parentSecretWipe, true);
    } finally { removeCampaignRoot(campaign); }
  } finally { removeCampaignRoot(root); }
});

test('R5: identity-never-ready accepts only the witnessed live identity-gate fault', () => {
  const root = compliantQualificationRoot();
  try {
    const built = sourceBuild(root), fake = join(root, 'simulated-cli');
    fs.writeFileSync(fake, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(join(repo, 'scripts/xcli-simulated-model.mjs'))} codex "$@"\n`, { mode: 0o700 });
    const scenario = 'unavailability:identity-never-ready';
    const result = spawnSync(process.execPath, [QUALIFY, '--worker'], {
      cwd: root, env: { ...environment(join(root, 'worker')), H2A_TEST_QUALIFICATION_ROOT: root },
      input: JSON.stringify({ sender: 'codex', receiver: 'codex', root, build: built.path,
        executables: { codex: fake }, simulated: true, timeoutMs: 2000, scenario }),
      encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    const row = JSON.parse(result.stdout);
    console.log({ blocker: row.blocker, receiverMcp: row.receiverMcp, verdict: classifyScenarioRow(scenario, row),
      cleanupErrors: row.cleanupErrors });
    assert.equal(row.blocker, 'identity-never-ready', JSON.stringify({ cleanupErrors: row.cleanupErrors }));
    assert.equal(row.receiverMcp, true);
    assert.ok(row.evidence.some(e => e.event === 'scenario-identity-gate-held' && e.role === 'receiver'));
    assert.equal(classifyScenarioRow(scenario, row).ok, true);
    assert.equal(row.senderMcp, null);
    assert.equal(row.processRecovery, true);
    assert.equal(row.secretWipe, true);
  } finally { removeCampaignRoot(root); }
});

test('R5: quota role maps only to its named seat even after worker reclassification', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-quota-roles-'));
  try {
    const manifest = writeManifest(dir, [
      { seatId: 's1', family: 'codex', authSource: 'seat-1' },
      { seatId: 's2', family: 'codex', authSource: 'seat-2' },
    ]);
    for (const role of ['sender', 'receiver']) {
      const run = runCampaign(['--simulated', '--seat-manifest', manifest, '--pair', 's1:s2', '--timeout-ms', '1000'],
        `${stubHead}console.log(JSON.stringify({sender:request.sender,receiver:request.receiver,
          status:'blocked',blocker:'qualification-infrastructure-error',elapsedMs:1,
          evidence:[{event:'provider-quota-observed',role:${JSON.stringify(role)}}]}));`);
      try {
        const ledger = JSON.parse(fs.readFileSync(join(run.root, 'campaign-ledger.json')));
        assert.deepEqual(ledger.quotaSeats, [role === 'sender' ? 's1' : 's2']);
        assert.equal(run.receipt.cells[0].blocker, 'qualification-infrastructure-error');
      } finally { removeCampaignRoot(run.root); fs.rmSync(run.dir, { recursive: true, force: true }); }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8: killing and resuming continues from the persisted ledger', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-camp-'));
  const campaignRoot = join(dir, 'campaign');
  const args = ['--simulated', '--pair', 'codex:codex', '--wake-release-offsets-ms', '0,100',
    '--timeout-ms', '10000', '--session-cap', '4', '--campaign-root', campaignRoot];
  const first = runCampaign(args, stubRow('stub-no-model'));
  try {
    assert.equal(first.invocations, 2, 'cap 4 funds both cells at 2 debits each');
    assert.ok(first.receipt.cells.every(c => c.blocker === 'stub-no-model'));
    const second = runCampaign(args, stubRow('stub-no-model'));
    try {
      const total = fs.readFileSync(join(campaignRoot, 'stub-invocations.log'), 'utf8').trim().split('\n').length;
      assert.equal(total, 2, 'the resumed campaign spawns nothing new');
      assert.ok(second.receipt.cells.every(c => c.blocker === 'campaign-cap-exhausted'));
    } finally { fs.rmSync(second.dir, { recursive: true, force: true }); }
  } finally { fs.rmSync(first.dir, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const [kind, body, minimumMs] of [
  ['lost', `${stubHead}setTimeout(() => process.exit(9), 1000);`, 1000],
  ['silent', `${stubHead}setInterval(() => {}, 1000);`, 47000],
  ['reported-zero', `${stubHead}setTimeout(() => {
    process.stdout.write(JSON.stringify({ sender: request.sender, receiver: request.receiver,
      status: 'blocked', blocker: 'stub-no-model', evidence: [], elapsedMs: 0 }));
  }, 1000);`, 1000],
]) {
  test(`L8 review: ${kind} workers consume the persisted wall-clock budget before resume`, () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-wall-clock-'));
    const campaignRoot = join(dir, 'campaign');
    const args = ['--simulated', '--pair', 'codex:codex', '--timeout-ms', '1000',
      '--session-cap', '10', '--campaign-wall-clock-ms', '47000', '--campaign-root', campaignRoot];
    let first, second;
    try {
      first = runCampaign(args, body);
      const ledger = JSON.parse(fs.readFileSync(join(campaignRoot, 'campaign-ledger.json')));
      console.log({ kind, sessionsDebited: ledger.sessionsDebited, wallClockSpentMs: ledger.wallClockSpentMs });
      second = runCampaign(args, stubRow('stub-no-model'));
      const resumed = JSON.parse(fs.readFileSync(join(campaignRoot, 'campaign-ledger.json')));
      assert.ok(ledger.wallClockSpentMs >= minimumMs, 'the parent charges actual time even without a worker row');
      assert.equal(second.invocations, 1, 'resume never spawns an unfunded worker');
      assert.equal(resumed.sessionsDebited, 2, 'resume preserves the session debit');
      assert.equal(second.receipt.cells[0].blocker, 'campaign-cap-exhausted');
    } finally {
      for (const run of [first, second]) if (run) fs.rmSync(run.dir, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('L8 review: resuming the ledger captured during a worker keeps its time reservation', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-interrupted-ledger-'));
  const campaignRoot = join(dir, 'campaign');
  const args = ['--simulated', '--pair', 'codex:codex', '--timeout-ms', '1000',
    '--session-cap', '10', '--campaign-wall-clock-ms', '47000', '--campaign-root', campaignRoot];
  const stub = stubRow('stub-no-model').replace(stubHead, `${stubHead}
fs.copyFileSync(join(request.root, 'campaign-ledger.json'), join(request.root, 'in-flight-ledger.json'));
`);
  let first, resumed;
  try {
    first = runCampaign(args, stub);
    // Restore exactly the durable bytes available if the parent dies before
    // settling the worker. No worker-reported duration can erase this debit.
    fs.copyFileSync(join(campaignRoot, 'in-flight-ledger.json'), join(campaignRoot, 'campaign-ledger.json'));
    const inFlight = JSON.parse(fs.readFileSync(join(campaignRoot, 'campaign-ledger.json')));
    resumed = runCampaign(args, stubRow('stub-no-model'));
    assert.equal(inFlight.wallClockSpentMs, 47000);
    assert.equal(resumed.invocations, 1, 'an interrupted parent cannot refund the pending attempt');
    assert.equal(resumed.receipt.cells[0].blocker, 'campaign-cap-exhausted');
  } finally {
    for (const run of [first, resumed]) if (run) fs.rmSync(run.dir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('L8: diagonal cells run before cross cells', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-camp-'));
  try {
    const manifest = writeManifest(dir, [
      { seatId: 'a', family: 'codex', authSource: 'seat-a' },
      { seatId: 'b', family: 'codex', authSource: 'seat-b' },
    ], ['a:b', 'a:a']);
    const run = runCampaign(['--simulated', '--seat-manifest', manifest,
      '--timeout-ms', '10000'], stubRow('stub-no-model'));
    try {
      assert.equal(run.invocations, 2);
      assert.deepEqual(run.receipt.cells[0].seats, { sender: 'a', receiver: 'a' });
      assert.deepEqual(run.receipt.cells[1].seats, { sender: 'a', receiver: 'b' });
    } finally { removeCampaignRoot(run.root); fs.rmSync(run.dir, { recursive: true, force: true }); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8: a dummy-seat real-mode dry run blocks on preflight with no spawn', async () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-camp-'));
  try {
    const manifest = writeManifest(dir, [{ seatId: 'dummy', family: 'codex', authSource: 'seat-dummy' }]);
    const output = join(dir, 'receipt.json');
    const stub = join(dir, 'stub.mjs');
    fs.writeFileSync(stub, stubRow('stub-no-model'));
    const result = spawnSync(process.execPath, [QUALIFY, '--seat-manifest', manifest,
      '--pair', 'dummy:dummy', '--timeout-ms', '10000', '--output', output],
    { env: { ...process.env, XCLI_WORKER_STUB: stub }, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.status, 2);
    const root = (result.stdout.match(/Private qualification root: (\S+)/) ?? [])[1];
    assert.ok(root, `parent reports its root\n${result.stdout}\n${result.stderr}`);
    const receipt = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(receipt.cells[0].status, 'blocked');
    assert.ok(receipt.cells[0].blocker, 'a classified reason is reported');
    assert.equal(fs.existsSync(join(root, 'stub-invocations.log')), false, 'no worker ever spawns');
    assert.equal(receipt.preflights.length, 1, 'the seat preflight is witnessed');
    assert.equal(receipt.preflights[0].modelCalls, 0, 'the dry run spends no model turn');
    assert.equal(fs.readdirSync(root).filter(name => name.startsWith('c-')).length, 0, 'no cell state survives');
    assert.equal(fs.readdirSync(root).filter(name => name.startsWith('pre-')).length, 0, 'no preflight state survives');
    removeCampaignRoot(root);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L8: an exhausted session cap refuses before any seat preflight', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-cap-'));
  try {
    // A fake agy executable that witnesses its own --version probe. agy has
    // no login allowlist, so any preflight would report login-not-confined —
    // but §6.4 demands the cap check first, with no seat touched on refusal.
    const bindir = join(dir, 'bin');
    fs.mkdirSync(bindir);
    const spy = join(dir, 'agy-invocations.log');
    fs.writeFileSync(join(bindir, 'agy'),
      `#!/bin/sh\necho "$@" >> ${JSON.stringify(spy)}\nif [ "$1" = "--version" ]; then echo "agy 9.9.9"; exit 0; fi\nexit 0\n`,
      { mode: 0o700 });
    const manifest = writeManifest(dir, [{ seatId: 'agy-seat', family: 'agy', authSource: 'seat-agy' }]);
    const output = join(dir, 'receipt.json');
    const stub = join(dir, 'stub.mjs');
    fs.writeFileSync(stub, stubRow('stub-no-model'));
    const result = spawnSync(process.execPath, [QUALIFY, '--seat-manifest', manifest,
      '--pair', 'agy-seat:agy-seat', '--timeout-ms', '10000', '--session-cap', '1', '--output', output],
    { env: { ...process.env, PATH: `${bindir}:${process.env.PATH}`, XCLI_WORKER_STUB: stub },
      encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    const root = (result.stdout.match(/Private qualification root: (\S+)/) ?? [])[1];
    assert.ok(root, `parent reports its root\n${result.stdout}\n${result.stderr}`);
    const receipt = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(receipt.cells[0].status, 'blocked');
    assert.equal(receipt.cells[0].blocker, 'campaign-cap-exhausted',
      'an exhausted cap refuses before any seat is touched');
    assert.equal(fs.existsSync(spy), false, 'no preflight ever executed the seat binary');
    assert.deepEqual(receipt.preflights, [], 'no preflight ran under an exhausted cap');
    assert.ok(receipt.ledgerRefusals.some(r => r.code === 'campaign-cap-exhausted'),
      'the refusal is witnessed in the ledger');
    removeCampaignRoot(root);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
