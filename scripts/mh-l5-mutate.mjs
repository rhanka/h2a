// Mutants are confined to a private built source copy and always restored.
import fs from 'node:fs';
import { basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
if (!fs.realpathSync('.').startsWith('/tmp/mh-l3-qualification-')) throw new Error('private_qualification_copy_required');
const group = process.argv[2] ?? 'transport', major = process.versions.node.split('.')[0];
const v1 = 'packages/h2a/test/mh-l5-v1.test.js', cold = 'packages/h2a/test/mh-l5-cold.test.js';
const m21 = 'packages/h2a/test/mh-l3-transfer.test.js', compensation = 'packages/h2a/test/mh-l5-compensation.test.js';
const oracles = 'packages/h2a/test/mh-l5-concurrency-oracles.test.js';
const legacy = 'M19 T8 T9 0.98.5 live v1 refuses .7 takeover, routes fresh sessions to stdio and keeps an already chosen shim open';
const stem = 'packages/h2a/', module = name => stem + 'src/runtime/handover/' + name + '.js';
const compiled = name => stem + 'dist/runtime/' + name + '.js';
const cases = [
  ['transport', 'legacy-classification', module('shim-bridge'), "if (marker.schemaVersion !== 2 || marker.protocol !== 2) throw new Error('legacy_requires_cold_upgrade');", '', v1, legacy],
  ['transport', 'legacy-backoff', module('shim-bridge'), 'throw new Error(unavailableReason);', "throw new Error('central_unavailable');", v1, legacy],
  ['transport', 'legacy-code', module('shim-bridge'), "['deadline_exceeded', 'legacy_requires_cold_upgrade'].includes(e.message)", "['deadline_exceeded'].includes(e.message)", v1, legacy],
  ['transport', 'decoy-secret', compiled('mcp-central'), 'token: randomUUID(),', 'token: authority.rootKey.toString("hex"),', v1, 'M18c 0.98.5 bridge sends only the decoy to a foreign listener and .7 refuses it'],
  ['transport', 'v1-ping', module('authenticated-http'), '{ generation: auth.marker.generation }', "{ generation: 'wrong-fixture-generation' }", v1, 'M18b 0.98.5 starter must preserve fixed and discovered .7 markers and reclaim only the invalid control'],
  ['transport', 'typed-id', module('request-mappings'), '`${typeof id}:${JSON.stringify(id)}`', 'String(id)', m21],
  ['transport', 'g0-progress', module('request-mappings'), 'const entry = this.tokens.get(token);', 'return undefined; const entry = this.tokens.get(token);', m21],
  ['transport', 'g0-cancel-owner', module('shim-bridge'), 'track(post(entry.owner,', 'track(post(current,', m21],
  ['transport', 'g0-retained-stream', module('shim-bridge'), "owner !== current && ![...mappings.requests.values()].some(e => e.owner === owner)", 'owner !== current', m21],
  ['cold', 'stop-irreversible', module('administration'), "if (irrevocable.has(tx.state)) throw new Error('stop_irreversible');", '', cold, 'M23 M24 cold process crash at after-directory-sync must preserve the irreversible boundary'],
  ['cold', 'successor-unknown', module('successor'), "tx.state === 'STARTING' && options.candidateLiveness !== 'dead'", "false && tx.state === 'STARTING' && options.candidateLiveness !== 'dead'", cold, 'M24 M25 eight starters must share a crash-consumed three-attempt budget and refuse an unknown candidate'],
  ['cold', 'attempt-budget', module('successor'), 'attempts: reservation.attempts + 1', 'attempts: reservation.attempts', cold, 'M24 M25 eight starters must share a crash-consumed three-attempt budget and refuse an unknown candidate'],
  ['cold', 'compensation-epoch', module('compensation'), 'transactionEpoch: previous.transactionEpoch + 1', 'transactionEpoch: previous.transactionEpoch', compensation],
  ['cold', 'compensation-new-generation', compiled('mcp-central'), 'generation: randomUUID(), publicationEpoch,', 'generation: options.successor ? plan.reservation.source.generation : randomUUID(), publicationEpoch,', compensation],
  ['oracles', 'registry-loss', compiled('local-files/store'), '() => registerInstance(...args)', '() => undefined', oracles],
  ['oracles', 'inbox-loss', compiled('local-files/store'), '() => putInboxMessage(...args)', '() => undefined', oracles],
  ['oracles', 'negotiation-loss', compiled('local-files/store'), '() => appendNegotiationEvent(...args)', "() => ({ contentHash: 'sha256:' + '0'.repeat(64) })", oracles],
  ['oracles', 'presence-loss', compiled('local-files/presence'), '() => writePresenceUnfenced(...args)', '() => undefined', oracles],
  ['oracles', 'blockage-loss', compiled('blockage/registry'), '() => raiseBlockageUnfenced(...args)', '() => undefined', oracles],
  ['oracles', 'payload-loss', compiled('mcp/payload-store'), '() => persistOutput(bytes)', '() => ({ref: "0".repeat(64)})', oracles],
  ['oracles', 'launch-loss', module('launch-memo'), "state: complete && briefKnown ? 'completed' : 'unknown'", "state: 'unknown'", oracles],
];
const selected = cases.filter(row => row[0] === group && (!process.env.MH_L5_MUTATION || row[1] === process.env.MH_L5_MUTATION)); if (!selected.length) throw new Error('unknown_mutation_group');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const results = [];
for (const [, name, path, from, to, file, scenario] of selected) {
  const paths = path.includes('/src/') ? [path, path.replace('/src/', '/dist/')] : [path];
  const originals = paths.map(path => ({ path, bytes: fs.readFileSync(path) }));
  const run = color => {
    const label = `mutation-${name}-${color}`;
    const env = { ...process.env, ...(scenario ? { MH_L5_CASE: scenario } : {}) };
    const r = spawnSync(process.execPath, ['scripts/mh-l5-test.mjs', file, label], { env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const log = `docs/plan/mh-l5/evidence/${basename(file)}-node${major}-${label}.log`;
    const output = fs.readFileSync(log, 'utf8'), receipt = JSON.parse(output.split('\nreceipt: ').at(-1));
    if (r.status !== (color === 'red' ? 1 : 0) || receipt.invalid || receipt.signal || !receipt.tests || receipt.leftovers.length ||
      (color === 'red' && !output.includes('ERR_ASSERTION'))) throw new Error(`mutation_proof_invalid:${name}:${color}:${log}`);
    return log;
  };
  let red;
  try {
    for (const original of originals) {
      const text = original.bytes.toString();
      const pattern = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'g');
      if ([...text.matchAll(pattern)].length !== 1) throw new Error('mutation_not_unique:' + name + ':' + original.path);
      fs.writeFileSync(original.path, text.replace(pattern, () => to));
    }
    red = run('red');
  } finally { for (const original of originals) fs.writeFileSync(original.path, original.bytes); }
  const green = run('green');
  for (const original of originals) if (hash(fs.readFileSync(original.path)) !== hash(original.bytes)) throw new Error('mutation_restore_failed');
  results.push({ name, red, green, restored: true, files: originals.map(o => ({ path: o.path, sha256: hash(o.bytes) })) });
  fs.mkdirSync('docs/plan/mh-l5', { recursive: true });
  fs.writeFileSync(`docs/plan/mh-l5/mutations-${group}-node${major}.json`, JSON.stringify({ node: process.version, results }, null, 2) + '\n');
  process.stdout.write(`${name}: killed by assertion and restored\n`);
}
