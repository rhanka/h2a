// Deterministic duration-balanced partition of the Node suite across CI shard jobs.
//
// WHY THIS EXISTS. The Node suite (~470 files after the M17/bulk proof import)
// ran as three sequential buckets inside ONE job: corpus, then native, then
// rest (~781 s serial on Node 22, run 41304247550). In-job file concurrency was
// already at the safe max (run-node-tests.mjs uses availableParallelism();
// the long poles are CPU-bound single files with 150-235 s solo tails, so more
// workers cannot shorten them). The only real parallelism is across jobs: each
// shard below runs on its own 4-vCPU runner with the same concurrency.
//
// CONTRACT.
//   - partitionNodeFilesByDuration() is pure and deterministic: longest-
//     processing-time greedy over the measured durations, ties broken by file
//     name, shards filled by lightest-load-first with lowest-index wins. The
//     same discovery on the same checkout always yields the same shards, so
//     shard producers and the aggregate consumer agree without exchanging lists.
//   - Every input file lands in exactly one shard; shards are pairwise
//     disjoint. Proven by the aggregate inventory (verifyExecutionReport over
//     the merged shard reports) and pinned by ci-node-shards.test.js.
//   - A shard envelope binds the exact same-run context as the M17/bulk proofs
//     (workflow, run, attempt <= consumer, checkout SHA, node version) plus the
//     partition inputs. A stale, foreign or partial shard report fails closed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { m17Context, verifyProofContext } from './m17-ci-evidence.mjs';

// Number of parallel Node shard jobs per Node version. The CI matrix
// (node-shard job, shard: [0..SHARD_COUNT-1]) must match; a unit test parses
// ci.yml and fails on drift.
export const SHARD_COUNT = 4;

// The aggregate consumer sets this to the directory holding the per-shard
// envelope files node-shard-<index>.json. Unset: every file runs locally.
export const SHARD_DIR_ENV = 'H2A_TEST_NODE_SHARD_DIR';

export const SHARD_DURATIONS_FILE = 'scripts/ci-node-shard-durations.json';

// Files whose execution evidence must agree for a shard proof to be valid.
const SHARD_INPUTS = ['package-lock.json', 'scripts/run-node-tests.mjs',
  'scripts/node-evidence-reporter.mjs', 'scripts/test-execution-evidence.mjs',
  'scripts/test-inventory.mjs', 'scripts/cleanse-contract-ledger.mjs',
  'scripts/ci-node-shards.mjs', 'scripts/ci-node-shard-durations.json',
  'scripts/node-suite-env.mjs', 'scripts/run-node-shard.mjs',
  'scripts/prepare-mh-test-fixtures.mjs',
  'packages/h2a/test/helpers/native-isolation.js', '.github/workflows/ci.yml'];

export function loadShardDurations(root) {
  const raw = JSON.parse(fs.readFileSync(join(root, SHARD_DURATIONS_FILE), 'utf8'));
  assert.ok(raw && typeof raw === 'object', 'shard durations must be an object');
  assert.ok(Number.isFinite(raw.defaultSeconds) && raw.defaultSeconds > 0, 'shard durations need a positive defaultSeconds');
  assert.ok(raw.files && typeof raw.files === 'object', 'shard durations need a files map');
  for (const [file, seconds] of Object.entries(raw.files)) {
    assert.equal(typeof file, 'string');
    assert.ok(Number.isFinite(seconds) && seconds > 0, `shard duration must be positive: ${file}`);
  }
  return { defaultSeconds: raw.defaultSeconds, seconds: new Map(Object.entries(raw.files)) };
}

/**
 * Greedy longest-processing-time partition. Pure: no filesystem access, no
 * environment reads. Sort by duration descending (filename breaks ties), then
 * deal each file to the currently lightest shard (lowest index breaks ties).
 */
export function partitionNodeFilesByDuration(files, durations, total = SHARD_COUNT) {
  assert.ok(Array.isArray(files) && files.length > 0, 'shard partition needs a non-empty file list');
  assert.ok(Number.isSafeInteger(total) && total >= 1, 'shard partition needs a positive shard count');
  assert.equal(new Set(files).size, files.length, 'duplicate file identity in shard partition input');
  const weight = (file) => durations.seconds.get(file) ?? durations.defaultSeconds;
  const ordered = [...files].sort((a, b) => (weight(b) - weight(a)) || (a < b ? -1 : a > b ? 1 : 0));
  const shards = Array.from({ length: total }, (_, index) => ({ index, files: [], seconds: 0 }));
  for (const file of ordered) {
    let lightest = shards[0];
    for (const shard of shards) {
      if (shard.seconds < lightest.seconds) lightest = shard;
    }
    lightest.files.push(file);
    lightest.seconds += weight(file);
  }
  return shards;
}

export function shardContext(root, env, index) {
  const base = m17Context(root, env);
  const files = [...SHARD_INPUTS];
  const inputs = Object.fromEntries(files.map((file) => [file,
    createHash('sha256').update(fs.readFileSync(join(root, file))).digest('hex')]));
  assert.ok(Number.isSafeInteger(index) && index >= 0 && index < SHARD_COUNT, 'shard index out of range');
  return { ...base, inputs: { ...base.inputs, ...inputs }, shard: index, shards: SHARD_COUNT };
}

export function verifyShardEnvelope(envelope, expected) {
  assert.deepEqual(Object.keys(envelope).sort(), ['schema', 'context', 'report'].sort());
  assert.equal(envelope.schema, 1);
  assert.equal(envelope.context.shard, expected.index, 'shard report landed under the wrong index');
  assert.equal(envelope.context.shards, SHARD_COUNT, 'shard report disagrees on the shard count');
  verifyProofContext(envelope.context, { ...expected.context, shard: expected.index, shards: SHARD_COUNT },
    'node shard proof provenance/source inputs differ');
  const report = envelope.report;
  assert.equal(report.success, true, 'shard report records failure');
  assert.ok(Array.isArray(report.testResults) && report.testResults.length > 0, 'shard report is empty');
  const names = report.testResults.map((row) => row.name);
  assert.deepEqual([...names].sort(), [...expected.files].sort(), 'shard report must cover exactly its partition files');
  return report;
}

/**
 * Aggregate side. Without SHARD_DIR_ENV every file runs locally (trust-root,
 * maintainer boxes). With it, all local files must arrive as verified shard
 * envelopes; nothing runs locally. Missing, malformed, stale or partial shard
 * evidence throws: the consumer fails instead of passing over a hole.
 */
export function loadNodeShardReports(localFiles, root, env = process.env) {
  const dir = env[SHARD_DIR_ENV];
  if (dir === undefined) return { local: localFiles, reports: [] };
  assert.ok(dir, 'explicit empty node shard directory configuration');
  const durations = loadShardDurations(root);
  const shards = partitionNodeFilesByDuration(localFiles, durations, SHARD_COUNT);
  const info = fs.lstatSync(dir);
  assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'node shard directory must be a real directory');
  const reports = shards.map((shard) => {
    const path = join(dir, `node-shard-${shard.index}.json`);
    let stat = null;
    try {
      stat = fs.lstatSync(path);
    } catch {
      stat = null;
    }
    assert.ok(stat && stat.isFile() && !stat.isSymbolicLink(), `node shard report missing or not a regular file: ${path}`);
    const envelope = JSON.parse(fs.readFileSync(path, 'utf8'));
    return verifyShardEnvelope(envelope, { context: shardContext(root, env, shard.index), index: shard.index, files: shard.files });
  });
  return { local: [], reports };
}
