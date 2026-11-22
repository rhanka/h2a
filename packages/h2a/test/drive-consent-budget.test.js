import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import test from 'node:test';
import { appendJournalEntry, createJournalEntry, createLocalStore, signCanonical } from '../dist/index.js';
import { consentPairId } from '../dist/runtime/drive/consent.js';
import { negotiationJournalFile } from '../dist/runtime/local-files/paths.js';
import { MCP_IDENTITY_TIMEOUT_MS } from '../dist/runtime/mcp/identity-state.js';
import { startCentralMcpServer } from '../dist/runtime/mcp-central.js';

function setup(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'consent-budget-'));
  t.after(() => { fs.chmodSync(root, 0o755); fs.rmSync(root, {recursive:true,force:true}); });
  const lines = [];
  t.mock.method(console, 'error', line => lines.push(JSON.parse(line)));
  let duration = 0, tick = 0;
  t.mock.method(performance, 'now', () => (tick++ % 2) * duration);
  return {root, lines, marker:join(root,'drive-consent-budget.json'),
    measure(ms) { duration = ms; tick = 0; lines.length = 0; },
    open(extra = {}) { return createLocalStore({root,initialize:false,...extra}); }};
}

test('CLI stays silent below alert; server always emits, including absent negotiations', t => {
  const f = setup(t);
  f.measure(999); f.open(); assert.deepEqual(f.lines, []);
  f.measure(0); f.open({alwaysEmitConsentBudget:true});
  assert.equal(f.lines.length, 1);
  assert.equal(f.lines[0].durationMs, 0);
  f.measure(1000); f.open();
  assert.equal(f.lines.length, 1);
  assert.equal(f.lines[0].alertThresholdMs, MCP_IDENTITY_TIMEOUT_MS * 0.05);
  assert.equal(f.lines[0].due, false);
  assert.equal(fs.existsSync(f.marker), false);
});

test('escalation persists, replays on next creation, then clears only below escalation', t => {
  const f = setup(t);
  f.measure(2000); f.open();
  const marker = JSON.parse(fs.readFileSync(f.marker, 'utf8'));
  assert.equal(marker.durationMs, 2000);
  assert.equal(marker.thresholdMs, MCP_IDENTITY_TIMEOUT_MS * 0.1);
  assert.equal(marker.identityDeadlineMs, MCP_IDENTITY_TIMEOUT_MS);
  assert.equal(marker.track, '01M39VC11XBNSE8W2ASMQRRKZV');
  assert.equal(new Date(marker.crossedAt).toISOString(), marker.crossedAt);
  f.measure(2000); f.open();
  assert.deepEqual(f.lines[0], {...marker,event:'drive-consent.full-verification',due:true,
    replayed:true,action:'ESCALATE debt -> due'});
  assert.equal(f.lines.length, 2);
  assert.equal(fs.existsSync(f.marker), true);
  f.measure(0); f.open();
  assert.equal(f.lines.length, 1); assert.equal(f.lines[0].replayed, true);
  assert.equal(fs.existsSync(f.marker), false);
  f.open(); assert.equal(f.lines.length, 1);
});

for (const code of ['EACCES', 'EROFS']) test(`marker ${code} writes/removals never block a read-only store`, t => {
  const f = setup(t);
  f.measure(2000); f.open(); // seed outstanding evidence before making I/O fail
  const realWrite = fs.writeFileSync, realUnlink = fs.unlinkSync;
  let writes = 0, removals = 0;
  t.mock.method(fs, 'writeFileSync', (path, ...args) => {
    if (path === f.marker) { writes++; throw Object.assign(new Error(code), {code}); }
    return realWrite(path, ...args);
  });
  t.mock.method(fs, 'unlinkSync', (path, ...args) => {
    if (path === f.marker) { removals++; throw Object.assign(new Error(code), {code}); }
    return realUnlink(path, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  f.measure(2000);
  assert.doesNotThrow(() => f.open({readOnly:true}));
  assert.equal(writes, 1); assert.equal(f.lines.at(-1).due, true);
  f.measure(0);
  assert.doesNotThrow(() => f.open({readOnly:true}));
  assert.equal(removals, 1); assert.equal(fs.existsSync(f.marker), true);
  assert.equal(f.lines[0].replayed, true);
});

test('actual non-writable root still opens and emits a crossing', t => {
  const f = setup(t);
  fs.chmodSync(f.root, 0o555);
  // Verify this environment really denies writes (including when run as root).
  assert.throws(() => fs.writeFileSync(f.marker, ''), {code:'EACCES'});
  f.measure(2000);
  assert.doesNotThrow(() => f.open({readOnly:true}));
  assert.equal(f.lines[0].due, true);
  assert.equal(fs.existsSync(f.marker), false);
});

test('T1.4: central and deferred store reach readiness with 0 consent journal reads at startup', { timeout: 30_000 }, async t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'consent-t14-'));
  const root = join(dir, 'store');
  const runtimeBase = join(dir, 'run');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.mkdirSync(runtimeBase, { recursive: true, mode: 0o700 });

  const pairDir = join(root, 'negotiations', 'drive-consent__sha256__fixture');
  fs.mkdirSync(pairDir, { recursive: true, mode: 0o700 });
  const journalPath = join(pairDir, 'journal.jsonl');
  fs.writeFileSync(journalPath, 'corrupt fixture\n', 'utf8');

  let syncJournalReads = 0;
  let streamJournalOpens = 0;
  const origReadFileSync = fs.readFileSync;
  const origCreateReadStream = fs.createReadStream;
  t.mock.method(fs, 'readFileSync', (p, ...args) => {
    if (p === journalPath) syncJournalReads++;
    return origReadFileSync(p, ...args);
  });
  t.mock.method(fs, 'createReadStream', (p, ...args) => {
    if (p === journalPath) streamJournalOpens++;
    return origCreateReadStream(p, ...args);
  });
  syncBuiltinESMExports();

  let central;
  t.after(async () => {
    try { await central?.stop(); } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // 1. Direct createLocalStore with deferConsentHistoryVerification: true reads 0 journals at open.
  createLocalStore({ root, initialize: false, deferConsentHistoryVerification: true });
  assert.equal(syncJournalReads, 0, 'deferConsentHistoryVerification must do 0 sync journal reads at open');
  assert.equal(streamJournalOpens, 0, 'deferConsentHistoryVerification must do 0 stream opens at open');

  // 2. Central MCP server also starts with 0 consent journal reads.
  central = await startCentralMcpServer({
    root,
    runtimeBase,
    physicalPrefix: dir,
    env: {},
    idleTimeoutMs: 60_000
  });
  assert.equal(central.kind, 'started');
  assert.equal(syncJournalReads, 0, 'central readiness must not read historical consent journals synchronously');
  assert.equal(streamJournalOpens, 0, 'central readiness must not stream historical consent journals before first tick');
});

test('T1.5: streaming verifyAsync handles 80 pairs (6000 entries, 300 expired, 2000 keys) and a single 20,000-entry pair with 0 readFileSync, <=1 keys read, lag p99 < 75ms, and tamper detection at index 19999', { timeout: 120_000 }, async t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'consent-t15-'));
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const makeKey = () => {
    const k = generateKeyPairSync('ed25519');
    return {
      privateKeyPem: k.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      publicKeyPem: k.publicKey.export({ format: 'pem', type: 'spki' }).toString()
    };
  };
  const scope = { action: 'drive.instruction', direction: 'from->to' };
  const baseNow = Date.UTC(2026, 0, 1);

  // --- Case (a): 80 pairs, 6,000 entries total, 300 expired requests, 2,000 keys ---
  {
    const rootA = join(dir, 'case-a');
    fs.mkdirSync(join(rootA, 'registry'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(join(rootA, 'negotiations'), { recursive: true, mode: 0o700 });
    const seedStore = createLocalStore({ root: rootA, deferConsentHistoryVerification: true });

    const senderKey = makeKey();
    const targetKey = makeKey();
    seedStore.registerInstance({
      id: 'inst:sender', instance: 'inst:sender', roles: ['AGENTS'], scopes: ['s'],
      capabilities: [], endpoints: [], publicKeys: [senderKey.publicKeyPem],
      acceptedPolicies: [], createdAt: new Date(baseNow).toISOString()
    });
    seedStore.registerInstance({
      id: 'inst:target', instance: 'inst:target', roles: ['AGENTS'], scopes: ['s'],
      capabilities: [], endpoints: [], publicKeys: [targetKey.publicKeyPem],
      acceptedPolicies: [], createdAt: new Date(baseNow).toISOString()
    });
    for (let p = 0; p < 60; p++) {
      seedStore.registerInstance({
        id: `inst:target-${p}`, instance: `inst:target-${p}`, roles: ['AGENTS'], scopes: ['s'],
        capabilities: [], endpoints: [], publicKeys: [targetKey.publicKeyPem],
        acceptedPolicies: [], createdAt: new Date(baseNow).toISOString()
      });
    }

    // Write 2,000 key events directly to keys.jsonl
    const keyLines = [];
    for (let i = 0; i < 2_000; i++) {
      keyLines.push(JSON.stringify({
        instance: i % 2 === 0 ? 'inst:sender' : `inst:extra-${i}`,
        publicKey: senderKey.publicKeyPem,
        type: 'added',
        at: new Date(baseNow + i).toISOString()
      }));
    }
    fs.writeFileSync(seedStore.paths.keys, keyLines.join('\n') + '\n', 'utf8');

    // Write 80 pairs totaling 6,000 entries (75 entries/pair; first 60 pairs have 5 expired requests each = 300 expired)
    let expiredWritten = 0;
    for (let p = 0; p < 80; p++) {
      const from = p < 60 ? 'inst:sender' : `inst:sender-${p}`;
      const to = p < 60 ? `inst:target-${p}` : 'inst:target';
      const pairId = consentPairId(from, to);
      const jFile = negotiationJournalFile(seedStore.paths, pairId);
      fs.mkdirSync(join(jFile, '..'), { recursive: true, mode: 0o700 });
      const lines = [];
      let prev;
      for (let e = 0; e < 75; e++) {
        let body;
        if (p < 60 && e < 5) {
          const created = baseNow + e * 1000;
          const payload = {
            kind: 'h2a.drive.consent.request',
            v: 1,
            requestId: randomUUID(),
            from,
            to,
            scope,
            createdAt: new Date(created).toISOString(),
            answerBy: new Date(created + 60_000).toISOString(),
            requestedNotAfter: new Date(created + 120_000).toISOString()
          };
          body = {
            kind: payload.kind,
            payload,
            signature: signCanonical(payload, { by: from, privateKeyPem: senderKey.privateKeyPem })
          };
          expiredWritten++;
        } else {
          body = { kind: 'drive-consent.audit', observedAt: baseNow + 10_000_000 + e * 1000, admissionId: `adm-${p}-${e}` };
        }
        const ev = {
          id: `e-${p}-${e}`,
          type: 'event',
          actor: { instance: to, role: 'AGENTS', scope: 'drive-consent' },
          negotiationId: pairId,
          createdAt: new Date(baseNow + e * 1000).toISOString(),
          body
        };
        const entry = prev ? appendJournalEntry(prev, ev) : createJournalEntry(ev);
        prev = entry;
        lines.push(JSON.stringify(entry));
      }
      fs.writeFileSync(jFile, lines.join('\n') + '\n', 'utf8');
    }
    assert.equal(expiredWritten, 300);

    let syncJournalReads = 0;
    let keysReads = 0;
    let streamOpens = 0;
    const origReadFileSync = fs.readFileSync;
    const origCreateReadStream = fs.createReadStream;
    t.mock.method(fs, 'readFileSync', (p, ...args) => {
      if (typeof p === 'string' && p.endsWith('journal.jsonl')) syncJournalReads++;
      if (typeof p === 'string' && p.endsWith('keys.jsonl')) keysReads++;
      return origReadFileSync(p, ...args);
    });
    t.mock.method(fs, 'createReadStream', (p, ...args) => {
      if (typeof p === 'string' && p.endsWith('journal.jsonl')) streamOpens++;
      return origCreateReadStream(p, ...args);
    });
    syncBuiltinESMExports();

    let onVerifyDone;
    const nextVerify = () => new Promise(resolve => { onVerifyDone = resolve; });
    t.mock.method(console, 'error', line => {
      try {
        const parsed = JSON.parse(line);
        if (parsed.event === 'drive-consent.full-verification' && !parsed.replayed) onVerifyDone?.(parsed);
      } catch { /* ignore */ }
    });
    t.mock.timers.enable({ apis: ['setInterval'] });

    const lag = monitorEventLoopDelay({ resolution: 10 });
    lag.enable();
    const storeA = createLocalStore({ root: rootA, initialize: false, alwaysEmitConsentBudget: true, deferConsentHistoryVerification: true });
    assert.equal(syncJournalReads, 0);

    const pass1Done = nextVerify();
    t.mock.timers.tick(60_000);
    await pass1Done;
    const p99A = lag.percentile(99) / 1e6;
    lag.disable();
    t.diagnostic(`T1.5(a) 80 pairs: syncJournalReads=${syncJournalReads}, keysReads=${keysReads}, streamOpens=${streamOpens}, lag p99=${p99A.toFixed(2)}ms`);

    assert.equal(syncJournalReads, 0, 'pass 1 must perform 0 readFileSync on journal.jsonl');
    assert.ok(keysReads <= 1, `keys.jsonl must be read at most 1 time, got ${keysReads}`);
    assert.equal(streamOpens, 80, 'pass 1 must stream all 80 pairs');
    assert.ok(p99A < 75, `case (a) eventLoopLagMs.p99=${p99A.toFixed(2)}ms exceeded 75ms`);

    // Pass 2 on unchanged files -> 0 reads!
    streamOpens = 0;
    syncJournalReads = 0;
    const pass2Done = nextVerify();
    t.mock.timers.tick(60_000);
    await pass2Done;
    assert.equal(streamOpens, 0, 'pass 2 on unchanged pairs must skip all 80 pairs');
    assert.equal(syncJournalReads, 0);
    t.mock.timers.reset();
    t.mock.restoreAll();
    syncBuiltinESMExports();
    void storeA;
  }

  // --- Case (b): single pair with 20,000 entries + tamper at index 19,999 ---
  {
    const rootB = join(dir, 'case-b');
    fs.mkdirSync(join(rootB, 'registry'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(join(rootB, 'negotiations'), { recursive: true, mode: 0o700 });
    const seedStore = createLocalStore({ root: rootB, deferConsentHistoryVerification: true });
    const pairId = consentPairId('inst:big-a', 'inst:big-b');
    const jFile = negotiationJournalFile(seedStore.paths, pairId);
    fs.mkdirSync(join(jFile, '..'), { recursive: true, mode: 0o700 });

    const pad = 'x'.repeat(1_500);
    const fd = fs.openSync(jFile, 'w', 0o600);
    let prev;
    let lastEntry;
    try {
      let chunk = '';
      for (let i = 0; i < 20_000; i++) {
        const ev = {
          id: `big-${i}`,
          type: 'event',
          actor: { instance: 'inst:big-b', role: 'AGENTS', scope: 'drive-consent' },
          negotiationId: pairId,
          createdAt: new Date(baseNow + i * 1000).toISOString(),
          body: { kind: 'drive-consent.audit', observedAt: baseNow + i * 1000, admissionId: `a-${i}`, pad }
        };
        const entry = prev ? appendJournalEntry(prev, ev) : createJournalEntry(ev);
        prev = entry;
        lastEntry = entry;
        chunk += JSON.stringify(entry) + '\n';
        if (chunk.length >= 256 * 1024) {
          fs.writeSync(fd, chunk);
          chunk = '';
        }
      }
      if (chunk.length > 0) fs.writeSync(fd, chunk);
    } finally {
      fs.closeSync(fd);
    }

    let syncJournalReads = 0;
    let streamOpens = 0;
    const origReadFileSync = fs.readFileSync;
    const origCreateReadStream = fs.createReadStream;
    t.mock.method(fs, 'readFileSync', (p, ...args) => {
      if (p === jFile) syncJournalReads++;
      return origReadFileSync(p, ...args);
    });
    t.mock.method(fs, 'createReadStream', (p, ...args) => {
      if (p === jFile) streamOpens++;
      return origCreateReadStream(p, ...args);
    });
    syncBuiltinESMExports();

    let onVerifyDone;
    const nextVerify = () => new Promise(resolve => { onVerifyDone = resolve; });
    t.mock.method(console, 'error', line => {
      try {
        const parsed = JSON.parse(line);
        if (parsed.event === 'drive-consent.full-verification' && !parsed.replayed) onVerifyDone?.(parsed);
      } catch { /* ignore */ }
    });
    t.mock.timers.enable({ apis: ['setInterval'] });

    const lag = monitorEventLoopDelay({ resolution: 10 });
    lag.enable();
    const storeB = createLocalStore({ root: rootB, initialize: false, alwaysEmitConsentBudget: true, deferConsentHistoryVerification: true });

    const pass1Done = nextVerify();
    t.mock.timers.tick(60_000);
    await pass1Done;
    const p99B = lag.percentile(99) / 1e6;
    lag.disable();
    t.diagnostic(`T1.5(b) 20k single pair: syncJournalReads=${syncJournalReads}, streamOpens=${streamOpens}, lag p99=${p99B.toFixed(2)}ms`);

    assert.equal(syncJournalReads, 0, '20k-entry pass 1 must perform 0 readFileSync on journal.jsonl');
    assert.equal(streamOpens, 1, '20k-entry pass 1 must open exactly 1 stream');
    assert.ok(p99B < 75, `case (b) eventLoopLagMs.p99=${p99B.toFixed(2)}ms exceeded 75ms`);

    // Pass 2 unchanged -> 0 reads
    streamOpens = 0;
    const pass2Done = nextVerify();
    t.mock.timers.tick(60_000);
    await pass2Done;
    assert.equal(streamOpens, 0, 'pass 2 on unchanged 20k-entry pair must skip');

    // Tamper entry at index 19,999 (corrupt contentHash on the final line)
    const stat = fs.statSync(jFile);
    const lastLine = JSON.stringify(lastEntry) + '\n';
    const tampered = JSON.stringify({ ...lastEntry, contentHash: 'sha256:' + '0'.repeat(64) }) + '\n';
    const wfd = fs.openSync(jFile, 'r+');
    try {
      const offset = stat.size - Buffer.byteLength(lastLine);
      fs.writeSync(wfd, Buffer.from(tampered, 'utf8'), 0, Buffer.byteLength(tampered), offset);
      fs.ftruncateSync(wfd, offset + Buffer.byteLength(tampered));
    } finally {
      fs.closeSync(wfd);
    }

    const pass3Done = nextVerify();
    t.mock.timers.tick(60_000);
    await pass3Done;
    assert.equal(streamOpens, 1, 'tampered file must trigger re-verification');
    assert.equal(syncJournalReads, 0, 're-verification after tamper must stay streaming');

    const verdict = storeB.findDriveConsent('inst:big-a', 'inst:big-b', baseNow + 30_000_000);
    assert.equal(verdict.decision.ok, false);
    assert.equal(verdict.decision.reason, 'consent-invalid');
    assert.match(verdict.anomalies.join(' '), /corrupt journal chain at index 19999/);
  }
});
