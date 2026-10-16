import nodeTest from 'node:test';
const test = (name, fn) => { if (!process.env.MH_L3_CASE || process.env.MH_L3_CASE === name) nodeTest(name, fn); };
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { marker, identity } from './helpers/mh-l0-fixtures.js';
import { OwnershipRegistry, OperationLedger } from '../src/runtime/handover/ownership.js';
import { recordGenerationEnd, generationEnded, endedOwner } from '../src/runtime/handover/generation-end.js';
import { readState, replaceState } from '../src/runtime/handover/state.js';

test('new baseline should require a proved old generation end and fence its old owner without discarding admitted work', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l3-baseline-'));
  try {
    const m = { ...marker(), stateDirectory: dir }, key = Buffer.alloc(32, 4);
    const old = new OwnershipRegistry({ directory: dir, generation: m.generation, processIdentity: identity });
    const input = { attachmentId: 'a', presenceSessionId: 's', expectedInstance: 'i' };
    const token = old.claim(input), ledger = new OperationLedger(old), op = ledger.begin(token, 'retained', 'call');
    const nextMarker = { ...m, generation: '33333333-3333-4333-8333-333333333333' };
    const next = new OwnershipRegistry({ directory: dir, generation: nextMarker.generation, processIdentity: { ...identity, startTime: 457 } });
    const authorize = owner => endedOwner(owner, nextMarker, key);
    assert.throws(() => next.rebaseline(input, authorize), /ownership_exists/);
    assert.throws(() => old.rebaseline(input, () => true), /ownership_exists/);
    recordGenerationEnd(m, key); assert.equal(generationEnded(m, key), true);
    assert.equal(generationEnded({ ...m, root: '/another' }, key), false);
    const current = next.rebaseline(input, authorize);
    assert.equal(current.ownershipEpoch, 2);
    assert.throws(() => old.assertOwner(token), /ownership_fenced/);
    assert.equal(ledger.drain().calls, 1); assert.doesNotThrow(() => ledger.assertOperation(op));
    ledger.finish(op, { completed: true }); assert.equal(ledger.drain().complete, true);
    const path = join(dir, `generation-end-${m.generation}.json`), proof = readState(path, 'generationEnd');
    replaceState(path, { ...proof.value, mac: '0'.repeat(64) }, 'generationEnd', proof);
    assert.equal(generationEnded(m, key), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('embedded catalogue should equal the exact server definitions and carry individual normative digests', async () => {
  const { embeddedTools, embeddedPackageVersion } = await import('../src/runtime/mcp-central-descriptor.js');
  const { H2A_CLI_MCP_TOOL_DESCRIPTORS } = await import('../dist/runtime/mcp/tools.js');
  const { describeCatalogue } = await import('../src/runtime/handover/catalogue.js');
  assert.deepEqual(embeddedTools, JSON.parse(JSON.stringify(H2A_CLI_MCP_TOOL_DESCRIPTORS)));
  assert.equal(embeddedPackageVersion, JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version);
  const descriptor = describeCatalogue(embeddedTools);
  for (const tool of embeddedTools) {
    assert.match(descriptor.toolDigests[tool.name].contractDigest, /^sha256:/);
    assert.equal(descriptor.toolDigests[tool.name].behaviorVersion, '1');
  }
});
