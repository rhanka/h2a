import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLocalStore } from '../dist/index.js';
import { MCP_IDENTITY_TIMEOUT_MS } from '../dist/runtime/mcp/identity-state.js';

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
