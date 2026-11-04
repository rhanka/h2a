#!/usr/bin/env node
// CI node-shard executor: run exactly one duration-balanced partition of the
// Node suite and seal its evidence envelope.
//
// WHY THIS EXISTS. The aggregate build-and-test job cannot execute ~470 Node
// files in one process without stacking three sequential buckets (~781 s on
// Node 22). Each node-shard matrix job runs this script with its shard index;
// the aggregate job imports the sealed envelopes instead of re-executing.
// Partition and verification live in scripts/ci-node-shards.mjs; the fixture
// environment is shared with scripts/run-tests.mjs via scripts/node-suite-env.mjs.
//
// CONTRACT.
//   - The executed file set is exactly partitionNodeFilesByDuration(local)[index],
//     where local is discovery minus the M17/bulk proof-covered files — the same
//     inputs the aggregate consumer recomputes. No flag reselects files.
//   - The sealed envelope binds the same-run context (workflow, run, attempt,
//     checkout SHA, node version) plus the partition inputs. A stale, foreign
//     or partial envelope fails the aggregate consumer, never the shard alone.
//   - Exit 0 only if the runner exited 0 AND the self-verification proves every
//     partition file executed exactly once.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { TEST_DIRS, MINIMUM_TEST_FILES, REPO_ROOT, discoverTestFiles, prioritizeNodeTestFiles, verifyNodeTrackExecution } from './run-tests.mjs';
import { loadM17Partition } from './m17-ci-evidence.mjs';
import { loadBulkPartition } from './bulk-ci-evidence.mjs';
import { SHARD_COUNT, loadShardDurations, partitionNodeFilesByDuration, shardContext } from './ci-node-shards.mjs';
import { setupNodeSuiteEnv, teardownNodeSuiteEnv } from './node-suite-env.mjs';
import { reportSuiteDurations } from './report-test-durations.mjs';

const ROOT = REPO_ROOT;

function usage() {
  process.stderr.write(`run-node-shard: execute one duration-balanced Node shard\nusage: node scripts/run-node-shard.mjs --shard=<index> (0..${SHARD_COUNT - 1})\n`);
}

async function main() {
  process.umask(0o022);
  const shardArg = process.argv.find((arg) => arg.startsWith('--shard='));
  const index = shardArg ? Number(shardArg.slice('--shard='.length)) : NaN;
  if (!shardArg || !Number.isSafeInteger(index) || index < 0 || index >= SHARD_COUNT) {
    usage();
    process.exit(2);
  }

  for (const rel of TEST_DIRS) {
    const abs = join(ROOT, rel);
    let entries;
    try {
      entries = readdirSync(abs);
    } catch (err) {
      process.stderr.write(`run-node-shard: required Node test directory is unavailable: ${abs} (${(err && err.message) || err})\n`);
      process.exit(1);
    }
    if (!entries.some((entry) => entry.endsWith('.test.js'))) {
      process.stderr.write(`run-node-shard: required Node test directory has no .test.js files: ${abs}\n`);
      process.exit(1);
    }
  }

  let nodeTestFiles;
  try {
    nodeTestFiles = discoverTestFiles();
    prioritizeNodeTestFiles(nodeTestFiles);
  } catch (err) {
    process.stderr.write(`${(err && err.message) || err}\n`);
    process.exit(1);
  }
  if (nodeTestFiles.length < MINIMUM_TEST_FILES) {
    process.stderr.write(`run-node-shard: DISCOVERY COLLAPSE — found ${nodeTestFiles.length} test files, expected at least ${MINIMUM_TEST_FILES}.\n`);
    process.exit(1);
  }

  // Same exclusions as the aggregate runner: the M17 campaign and the bulk
  // suites run in their qualification jobs (same-run imported proofs).
  const m17Partition = loadM17Partition(nodeTestFiles, ROOT);
  const bulkPartition = loadBulkPartition(m17Partition.local, ROOT);
  const shards = partitionNodeFilesByDuration(bulkPartition.local, loadShardDurations(ROOT), SHARD_COUNT);
  const shard = shards[index];
  if (!shard.files.length) {
    process.stderr.write(`run-node-shard: shard ${index} is empty; refusing an vacuous pass\n`);
    process.exit(1);
  }
  prioritizeNodeTestFiles(shard.files);
  process.stdout.write(`run-node-shard: shard ${index}/${SHARD_COUNT}: ${shard.files.length} file(s), ~${shard.seconds.toFixed(0)}s estimated file time\n`);

  const ctx = await setupNodeSuiteEnv(ROOT);
  // Single Node invocation keeps the existing backstop and both reporters.
  // The evidence path is invocation-scoped so a stale report can never be
  // graded as this run's evidence.
  const reportPath = join(ctx.testRoot, `node-shard-${index}.json`);
  try { rmSync(reportPath, { force: true }); } catch {
    process.stderr.write(`run-node-shard: shard ${index}: report cleanup failed; stale evidence rejected\n`);
    process.exit(1);
  }
  const NODE_TIMEOUT_MS = Number(process.env.H2A_TEST_TIMEOUT_MS) || 1200000;
  let exitCode = 0;
  try {
    const started = performance.now();
    const run = spawnSync(process.execPath,
      [join(ROOT, 'scripts/run-node-tests.mjs'), '--test', '--test-reporter=spec',
        `--test-reporter=${join(ROOT, 'scripts/node-evidence-reporter.mjs')}`,
        '--test-reporter-destination=stdout', `--test-reporter-destination=${reportPath}`, ...shard.files],
      { cwd: ROOT, stdio: 'inherit', timeout: NODE_TIMEOUT_MS, killSignal: 'SIGKILL', env: ctx.trackFixtureEnv });
    process.stdout.write(`run-node-shard: shard ${index}: ${shard.files.length} file(s), ${((performance.now() - started) / 1000).toFixed(3)}s, exit ${run.status ?? 1}\n`);
    if (run.error || (run.status ?? 1) !== 0) {
      if (run.error) process.stderr.write(`run-node-shard: shard ${index}: ${run.error.message}\n`);
      exitCode = 1;
    } else {
      let report = null;
      try {
        report = JSON.parse(readFileSync(reportPath, 'utf8'));
      } catch {
        report = null;
      }
      try {
        reportSuiteDurations(report, { label: `node-shard-${index}` });
      } catch {
        process.stderr.write(`WARNING: node-shard-${index}: suite timing unavailable (missing or malformed report).\n`);
      }
      // Self-verification: prove exactly-once execution before sealing. The
      // aggregate consumer re-verifies over the merged reports; a hole here
      // fails fast with the shard's own logs attached.
      const holes = verifyNodeTrackExecution(report, shard.files.map((file) => resolve(ROOT, file)));
      if (holes.length) {
        process.stderr.write(holes.join('\n') + '\n');
        exitCode = 1;
      } else {
        process.stdout.write(`run-node-shard: shard ${index} inventory verified: ${shard.files.length} files exactly once.\n`);
        const artifactDir = join(ROOT, 'tmp', 'node-shard');
        mkdirSync(artifactDir, { recursive: true });
        const envelope = process.env.GITHUB_ACTIONS === 'true'
          ? { schema: 1, context: shardContext(ROOT, process.env, index), report }
          : { schema: 1, context: null, report };
        if (!envelope.context) {
          process.stdout.write('run-node-shard: non-CI run: sealing the raw report without a same-run context envelope\n');
        }
        writeFileSync(join(artifactDir, `node-shard-${index}.json`), JSON.stringify(envelope));
      }
    }
  } finally {
    await teardownNodeSuiteEnv(ctx);
  }
  process.exit(exitCode);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}
