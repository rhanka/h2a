import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createLocalStore, findBinding, reclaimOrMint, listBindings, runCli } from '../dist/index.js';
import { buildLaunchIndex, lookupLaunchRows, launchLookupKey, appendLaunchRow } from '../dist/runtime/local-files/launch-index.js';
import { listIdentityAliases, legacyAliasAlreadyAdopted, legacyAliasOwner, recordIdentityAlias } from '../dist/runtime/identity/migration.js';

const key = { host: 'claude', providerSessionId: 'conversation', workspaceId: 'workspace-a' };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'h2a-launch-index-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const sub of ['identity', 'registry']) mkdirSync(join(root, sub));
  const file = join(root, 'identity/bindings.jsonl');
  return { root, file };
}
const binding = (instance, workspaceId = key.workspaceId) => ({ ...key, instance, workspaceId, agentUuid: instance, at: '2026-01-01T00:00:00.000Z' });
const rows = (file, items) => writeFileSync(file, items.map(row => JSON.stringify(row) + '\n').join(''));
const indexPath = file => file + '.launch-index-v1';

test('indexed bindings preserve latest conversation binding, proof gating and append-only audit', t => {
  const { root, file } = fixture(t);
  rows(file, [binding('first'), binding('second', 'workspace-b')]);
  const original = readFileSync(file);
  buildLaunchIndex(file, 'bindings');
  const manifest = readFileSync(join(indexPath(file), 'current.json'));
  buildLaunchIndex(file, 'bindings');
  assert.deepEqual(readFileSync(join(indexPath(file), 'current.json')), manifest, 'idempotent publication');
  assert.deepEqual(readFileSync(file), original, 'original is the retained backup / authority');
  assert.equal(findBinding(root, key).instance, 'second', 'workspace is metadata, not the match key');
  const deps = proof => ({ verifyProof: () => proof, mint: () => ({ instance: 'third', agentUuid: 'third' }), now: Date.now });
  assert.equal(reclaimOrMint(root, key, deps(true)).action, 'reclaim');
  assert.equal(listBindings(root).length, 2);
  assert.equal(reclaimOrMint(root, key, deps(false)).action, 'mint');
  assert.equal(findBinding(root, key).instance, 'third');
  assert.equal(listBindings(root).length, 3);
  assert.deepEqual(readFileSync(file).subarray(0, original.length), original);
});

test('explicit maintenance requires an absolute root and retains original bytes', t => {
  const { root, file } = fixture(t);
  rows(file, [binding('first')]);
  const original = readFileSync(file);
  let stdout = '';
  const streams = { stdout: { write: text => { stdout += text; } }, stderr: { write() {} }, cwd: () => root };
  assert.equal(runCli(['store', 'index-launch'], streams), 1);
  assert.equal(runCli(['store', 'index-launch', '--root', 'relative'], streams), 1);
  assert.equal(runCli(['store', 'index-launch', '--root', root], streams), 0);
  assert.deepEqual(JSON.parse(stdout), { ok: true, originalsRetained: true, indexed: ['bindings'] });
  assert.deepEqual(readFileSync(file), original);
});

test('an old writer or a failed derived-index update remains visible through tail replay', t => {
  const { root, file } = fixture(t);
  rows(file, [binding('first')]);
  buildLaunchIndex(file, 'bindings');
  appendFileSync(file, JSON.stringify(binding('old-writer')) + '\n');
  assert.equal(findBinding(root, key).instance, 'old-writer');
  // Maintenance must not make a launch wait while holding the identity lock.
  writeFileSync(join(indexPath(file), '.lock'), JSON.stringify({ pid: process.pid, hostname: 'synthetic' }));
  appendLaunchRow(file, 'bindings', binding('new-writer'));
  assert.equal(findBinding(root, key).instance, 'new-writer');
  rmSync(join(indexPath(file), '.lock'));
  buildLaunchIndex(file, 'bindings');
  assert.equal(findBinding(root, key).instance, 'new-writer');
});

for (const damage of ['manifest', 'bucket', 'replace', 'truncate', 'rewrite', 'partial']) {
  test(`derived index ${damage} falls back to the authoritative binding reader`, t => {
    const { root, file } = fixture(t);
    rows(file, [binding('first')]);
    buildLaunchIndex(file, 'bindings');
    const manifestFile = join(indexPath(file), 'current.json');
    if (damage === 'manifest') writeFileSync(manifestFile, '{}');
    if (damage === 'bucket') {
      const manifest = JSON.parse(readFileSync(manifestFile)).data;
      const shard = createHash('sha256').update(launchLookupKey(key.host, key.providerSessionId)).digest('hex').slice(0, 2);
      writeFileSync(join(indexPath(file), manifest.buckets[shard].file), '{}');
    }
    if (damage === 'replace') { renameSync(file, file + '.backup'); rows(file, [binding('other')]); }
    if (damage === 'truncate') rows(file, []);
    if (damage === 'rewrite') rows(file, [binding('other')]);
    if (damage === 'partial') appendFileSync(file, JSON.stringify(binding('partial')));
    assert.equal(lookupLaunchRows(file, 'bindings', launchLookupKey(key.host, key.providerSessionId)), undefined);
    assert.deepEqual(findBinding(root, key), listBindings(root).at(-1));
    buildLaunchIndex(file, 'bindings');
    assert.deepEqual(findBinding(root, key), listBindings(root).at(-1));
    if (damage === 'partial') {
      const manifest = readFileSync(manifestFile);
      buildLaunchIndex(file, 'bindings');
      assert.deepEqual(readFileSync(manifestFile), manifest, 'partial tail maintenance is idempotent');
    }
  });
}

test('indexed registry keeps first registration, role normalization and key revocations', t => {
  const { root } = fixture(t);
  const file = join(root, 'registry/instances.jsonl');
  rows(file, [{ id: 'agent', publicKeys: ['original'], roles: 'AGENTS' }, { id: 'agent', publicKeys: ['duplicate'] }]);
  rows(join(root, 'registry/keys.jsonl'), []);
  for (const kind of ['instances', 'keys']) buildLaunchIndex(join(root, `registry/${kind}.jsonl`), kind);
  const store = createLocalStore({ root });
  assert.deepEqual(store.findInstance('agent').roles, ['AGENTS']);
  assert.deepEqual(store.listInstanceKeys('agent'), ['original']);
  store.addInstanceKey('agent', 'added');
  store.revokeInstanceKey('agent', 'original');
  assert.deepEqual(store.listInstanceKeys('agent'), ['added']);
  store.registerInstance({ id: 'agent', publicKeys: ['ignored'] });
  assert.equal(store.listInstances().length, 2);
});

test('indexed aliases preserve adoption, duplicate suppression and malformed-row tolerance', t => {
  const { root } = fixture(t);
  const file = join(root, 'identity/aliases.jsonl');
  const alias = { instance: 'current', legacyInstance: 'legacy', adoptedKeyring: true, at: '2026-01-01' };
  rows(file, [alias]);
  appendFileSync(file, 'malformed\n');
  buildLaunchIndex(file, 'aliases');
  assert.equal(legacyAliasAlreadyAdopted(root, 'legacy'), true);
  recordIdentityAlias(root, alias);
  recordIdentityAlias(root, { ...alias, instance: 'new', adoptedKeyring: false });
  assert.deepEqual(listIdentityAliases(root, 'current'), [alias]);
  assert.equal(listIdentityAliases(root).length, 2);
});

test('concurrent index publication and legacy appends never turn a known binding into absence', async t => {
  const { root, file } = fixture(t);
  rows(file, [binding('known')]);
  buildLaunchIndex(file, 'bindings');
  const module = new URL('../dist/runtime/local-files/launch-index.js', import.meta.url).href;
  const source = `import { appendFileSync } from 'node:fs';
    import { buildLaunchIndex } from ${JSON.stringify(module)};
    for (let i = 0; i < 40; i++) {
      appendFileSync(${JSON.stringify(file)}, JSON.stringify({host:'other',providerSessionId:String(i),instance:String(i)})+'\\n');
      buildLaunchIndex(${JSON.stringify(file)}, 'bindings');
    }`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: 'ignore' });
  const completed = new Promise(resolve => child.once('close', resolve));
  try {
    while (child.exitCode === null && child.signalCode === null) {
      assert.equal(findBinding(root, key).instance, 'known');
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    assert.equal(await completed, 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await completed;
  }
});

test('indexed point lookups do not read a complete historical journal', async t => {
  const { root, file } = fixture(t);
  rows(file, Array.from({ length: 4000 }, (_, i) => ({ ...binding(String(i)), providerSessionId: String(i) })));
  buildLaunchIndex(file, 'bindings');
  const fs = await import('node:fs');
  const { syncBuiltinESMExports } = await import('node:module');
  const original = fs.default.readFileSync;
  fs.default.readFileSync = function(path, ...args) {
    assert.notEqual(path, file, 'history must be read by offsets, never loaded in full');
    return original.call(this, path, ...args);
  };
  syncBuiltinESMExports();
  try {
    assert.equal(findBinding(root, { ...key, providerSessionId: '3999' }).instance, '3999');
    assert.equal(findBinding(root, { ...key, providerSessionId: 'absent' }), undefined);
  } finally { fs.default.readFileSync = original; syncBuiltinESMExports(); }
  assert.ok(statSync(file).size > 500_000);
  assert.ok(existsSync(file));
});

test('unrelated index publications cannot force a point lookup into a historical scan', async t => {
  const { file } = fixture(t);
  rows(file, [binding('known')]);
  buildLaunchIndex(file, 'bindings');
  const fs = await import('node:fs');
  const { syncBuiltinESMExports } = await import('node:module');
  const original = fs.default.readFileSync;
  let publishing = false, seq = 0;
  fs.default.readFileSync = function(path, ...args) {
    const result = original.call(this, path, ...args);
    if (path === join(indexPath(file), 'current.json') && !publishing) {
      publishing = true;
      try {
        appendFileSync(file, JSON.stringify({ ...binding('unrelated'), providerSessionId: String(++seq) }) + '\n');
        buildLaunchIndex(file, 'bindings');
      } finally { publishing = false; }
    }
    return result;
  };
  syncBuiltinESMExports();
  try {
    assert.deepEqual(lookupLaunchRows(file, 'bindings', launchLookupKey(key.host, key.providerSessionId)), [binding('known')]);
  } finally { fs.default.readFileSync = original; syncBuiltinESMExports(); }
});

test('a poisoned row cannot be silently removed by a derived index', t => {
  const { file } = fixture(t);
  rows(file, [binding('known')]);
  buildLaunchIndex(file, 'bindings');
  appendFileSync(file, 'null\n');
  assert.equal(lookupLaunchRows(file, 'bindings', launchLookupKey(key.host, key.providerSessionId)), undefined);
  assert.throws(() => buildLaunchIndex(file, 'bindings'), /invalid launch row shape/);
});

test('a long history on one conversation needs only its latest binding row', async t => {
  const { root, file } = fixture(t);
  rows(file, Array.from({ length: 4000 }, (_, i) => binding(String(i))));
  buildLaunchIndex(file, 'bindings');
  const fs = await import('node:fs');
  const { syncBuiltinESMExports } = await import('node:module');
  const original = fs.default.readSync;
  let bytes = 0;
  fs.default.readSync = function(...args) { const n = original.apply(this, args); bytes += n; return n; };
  syncBuiltinESMExports();
  try { assert.equal(findBinding(root, key).instance, '3999'); }
  finally { fs.default.readSync = original; syncBuiltinESMExports(); }
  assert.ok(bytes <= 4096, `historical duplicates must not be replayed (${bytes} bytes)`);
});

test('legacy inbox ownership keeps earliest claimant and log-order ties without scanning aliases', async t => {
  const { root } = fixture(t);
  const file = join(root, 'identity/aliases.jsonl');
  const alias = (instance, at) => ({ instance, legacyInstance: 'shared', adoptedKeyring: false, at });
  rows(file, [alias('later', '2026-02-01'), alias('owner', '2026-01-01'), alias('tie', '2026-01-01')]);
  buildLaunchIndex(file, 'aliases');
  appendFileSync(file, JSON.stringify(alias('old-writer', '2026-03-01')) + '\n');
  assert.equal(legacyAliasOwner(root, 'shared').instance, 'owner');
  appendFileSync(file, JSON.stringify(alias('earlier-tail', '2025-12-01')) + '\n');
  assert.equal(legacyAliasOwner(root, 'shared').instance, 'earlier-tail');
  buildLaunchIndex(file, 'aliases');
  const fs = await import('node:fs');
  const { syncBuiltinESMExports } = await import('node:module');
  const original = fs.default.readFileSync;
  fs.default.readFileSync = function(path, ...args) {
    assert.notEqual(path, file, 'inbox ownership must not scan the alias journal');
    return original.call(this, path, ...args);
  };
  syncBuiltinESMExports();
  try {
    assert.equal(legacyAliasOwner(root, 'shared').instance, 'earlier-tail');
    const store = createLocalStore({ root });
    const message = { protocol: 'sentropic.h2a', version: '0.1', id: 'env:legacy', type: 'event',
      actor: { instance: 'conductor:ci', role: 'CONDUCTOR', scope: 'scope:default' },
      body: { kind: 'message', text: 'synthetic legacy inbox' }, createdAt: '2026-01-01T00:00:00.000Z' };
    store.putInboxMessage('shared', message);
    assert.deepEqual(store.readInbox('tie'), []);
    assert.deepEqual(store.readInbox('earlier-tail'), [message]);
    assert.deepEqual(store.popInboxMessage('earlier-tail', message.id), message);
    assert.deepEqual(store.readInbox('earlier-tail'), []);
  } finally { fs.default.readFileSync = original; syncBuiltinESMExports(); }
  // A prior manifest without ownership coverage cannot assert absence.
  const manifestFile = join(indexPath(file), 'current.json');
  const envelope = JSON.parse(readFileSync(manifestFile));
  delete envelope.data.aliasOwner;
  envelope.hash = createHash('sha256').update(JSON.stringify(envelope.data)).digest('hex');
  writeFileSync(manifestFile, JSON.stringify(envelope));
  assert.equal(lookupLaunchRows(file, 'aliases', launchLookupKey('owner', 'shared')), undefined);
  assert.equal(legacyAliasOwner(root, 'shared').instance, 'earlier-tail');
  buildLaunchIndex(file, 'aliases');
  assert.equal(legacyAliasOwner(root, 'shared').instance, 'earlier-tail');
});
