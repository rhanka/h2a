// Lot L8 campaign-engine tests (SPEC v3 §6.1/§6.4/§6.5, §5.5). Drive the
// campaign parent with worker stubs (XCLI_WORKER_STUB) and dummy seat dirs in
// mkdtemp; no real login, no model. RED on code without the L8 wiring.
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { repo, removeCampaignRoot } from './xcli-lab.mjs';

const QUALIFY = join(repo, 'scripts/qualify-cross-cli.mjs');

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
  receiver: request.receiver, status: 'blocked', blocker: ${JSON.stringify(blocker)}, evidence: [], elapsedMs: 1,
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

test('L8: a seat-qualified pair selects distinct auth sources per role', () => {
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
      assert.notEqual(routing.authHomes.sender, routing.authHomes.receiver);
      assert.ok(routing.authHomes.sender.endsWith('seat-a'), 'sender copies only its own seat entry');
      assert.ok(routing.authHomes.receiver.endsWith('seat-b'), 'receiver copies only its own seat entry');
      assert.deepEqual(run.receipt.cells[0].seats, { sender: 'claude-a', receiver: 'claude-b' });
      assert.equal(run.receipt.cells[0].sharedSeat, false);
      assert.equal(run.receipt.seatMode, 'interim-file-copy');
    } finally { removeCampaignRoot(run.root); fs.rmSync(run.dir, { recursive: true, force: true }); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
