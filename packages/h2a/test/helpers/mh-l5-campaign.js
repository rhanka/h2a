import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createLocalStore } from '../../dist/runtime/local-files/store.js';
import { readPresence } from '../../dist/runtime/local-files/presence.js';
import { readBlockage } from '../../dist/runtime/blockage/registry.js';
import { establishWriterControl } from '../../dist/runtime/handover/mutation.js';
import { verifyJournalChain } from '../../dist/journal.js';
import { readState } from '../../dist/runtime/handover/state.js';

export async function runCampaign(count) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l5-concurrency-')), root = join(dir, 'store'), directory = join(dir, 'state');
  for (const path of [root, directory]) fs.mkdirSync(path, { mode: 0o700 });
  const workers = [], roles = ['central', 'peer', 'stdio1', 'stdio2', 'stdio3', 'stdio4', 'janitor', 'cli'];
  // The same actors perform 1,250 updates in six domains and 2,500 in payloads.
  // No reduced CI count can satisfy this normative file.
  const total = count * roles.length;
  try {
    const store = createLocalStore({ root }); establishWriterControl(root, directory);
    for (let n = 0; n < 16; n++) store.openNegotiation({ id: 'stripe-' + n, status: 'draft', participants: [], scope: 'scope:default', createdAt: new Date().toISOString() });
    for (const role of roles) {
      const child = spawn(process.execPath, [fileURLToPath(new URL('./mh-l5-writer.mjs', import.meta.url)), root, directory, role, String(count)], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
      const closed = once(child, 'close'); let errors = '';
      child.stderr.on('data', bytes => { errors += bytes; });
      const ready = once(child.stdout, 'data'); child.stdout.on('data', () => {});
      workers.push({ child, closed, ready, errors: () => errors });
    }
    await Promise.all(workers.map(w => w.ready));
    for (const w of workers) w.child.stdin.write('go\n');
    for (const w of workers) { const [code, signal] = await w.closed; assert.equal(code, 0, w.errors()); assert.equal(signal, null); }
    const acknowledged = roles.flatMap(role => fs.readFileSync(join(dir, `ack-${role}.jsonl`), 'utf8').trim().split('\n').map(JSON.parse));
    const expected = roles.flatMap(role => Array.from({ length: count }, (_, n) => `${role}:${n}`)).sort();
    assert.equal(acknowledged.length, total); assert.deepEqual(acknowledged.map(r => r.id).sort(), expected);
    assert.deepEqual(store.listInstances().map(r => r.id).sort(), expected);
    assert.deepEqual(store.readInbox('shared-recipient').map(r => r.id).sort(), expected);
    const journals = Array.from({ length: 16 }, (_, n) => store.readNegotiationJournal('stripe-' + n));
    for (const journal of journals) assert.equal(verifyJournalChain(journal).ok, true);
    const events = journals.flat();
    assert.deepEqual(events.map(r => r.id).sort(), expected);
    for (const row of acknowledged) {
      assert.equal(events.find(e => e.id === row.id)?.contentHash, row.journalHash);
      assert.equal(row.payloadSha256, 'sha256:' + createHash('sha256').update(row.id).digest('hex'));
      const memo = readState(row.launchPath, 'launchMemo').value;
      assert.equal(memo.state, 'completed'); assert.equal(memo.terminalResult.id, row.id);
    }
    for (const role of roles) {
      assert.deepEqual(readPresence(root, role).interests.scopes, [`${role}:${count - 1}`]);
      assert.equal(readBlockage(root, role).reason, `${role}:${count - 1}`);
    }
    const counts = { presence: total, registry: total, inbox: total, negotiations: total, blockage: total,
      launches: acknowledged.length, payloads: acknowledged.reduce((sum, row) => sum + row.payloadMutations, 0) };
    assert.ok(Object.values(counts).every(n => n >= total));
    const result = { domains: counts, acknowledged: acknowledged.length, duplicates: 0, actors: roles };
    console.log(JSON.stringify(result)); return result;
  } finally {
    for (const w of workers) if (w.child.exitCode === null && w.child.signalCode === null) { w.child.kill('SIGTERM'); await w.closed; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
