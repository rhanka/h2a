/**
 * Tests for scripts/ci-node-shards.mjs — the duration-balanced Node shard
 * partition behind the CI node-shard matrix.
 *
 * WHY THIS FILE EXISTS. The Node suite ran as three sequential buckets inside
 * one job (~781 s serial on Node 22). Sharding it across jobs only saves wall
 * time if every file runs in exactly one shard: a dropped file is an unproved
 * suite reported as green, a duplicated file double-counts and can mask a
 * hole. The partition below is pure and deterministic so producers and the
 * aggregate consumer agree without exchanging lists; the aggregate inventory
 * (verifyExecutionReport over the merged shard reports) proves exactly-once.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { parse as parseYaml } from 'yaml'
import { discoverTestFiles } from '../../../scripts/run-tests.mjs'
import { SHARD_COUNT, SHARD_DIR_ENV, loadShardDurations, partitionNodeFilesByDuration, verifyShardEnvelope, loadNodeShardReports, shardContext } from '../../../scripts/ci-node-shards.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..', '..')
const CI_WORKFLOW = readFileSync(resolve(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')

test('shard partition covers every discovered file exactly once and is deterministic', () => {
  const files = discoverTestFiles()
  assert.ok(files.length > 0)
  const durations = loadShardDurations(REPO_ROOT)
  const first = partitionNodeFilesByDuration(files, durations)
  assert.equal(first.length, SHARD_COUNT)
  assert.deepEqual(first.map((shard) => shard.index), [0, 1, 2, 3])
  for (const shard of first) assert.ok(shard.files.length > 0, `shard ${shard.index} must not be empty`)
  const union = first.flatMap((shard) => shard.files).sort()
  assert.deepEqual(union, [...files].sort())
  assert.equal(new Set(union).size, files.length, 'a duplicated file would double-count its evidence')
  for (let i = 0; i < first.length; i++) {
    for (let j = i + 1; j < first.length; j++) {
      assert.ok(first[i].files.every((file) => !first[j].files.includes(file)), `shards ${i}/${j} must be disjoint`)
    }
  }
  const second = partitionNodeFilesByDuration([...files].reverse(), durations)
  assert.deepEqual(second, first, 'input order must not move files between shards')
})

test('shard partition balances by measured duration: spread within one heaviest file', () => {
  const files = discoverTestFiles()
  const durations = loadShardDurations(REPO_ROOT)
  const shards = partitionNodeFilesByDuration(files, durations)
  const totals = shards.map((shard) => shard.seconds)
  const heaviest = Math.max(...files.map((file) => durations.seconds.get(file) ?? durations.defaultSeconds))
  assert.ok(Math.max(...totals) - Math.min(...totals) <= heaviest,
    `shard load spread must stay within one heaviest file (${heaviest}s): ${totals.map((s) => s.toFixed(1)).join(', ')}`)
})

test('shard durations are fresh: every key exists in discovery, every weight positive', () => {
  const durations = loadShardDurations(REPO_ROOT)
  assert.ok(durations.defaultSeconds > 0)
  const discovered = new Set(discoverTestFiles())
  for (const file of durations.seconds.keys()) {
    assert.ok(discovered.has(file), `stale duration entry (file no longer discovered): ${file}`)
  }
})

function assertShardGraph(source) {
  const { jobs } = parseYaml(source)
  const producer = jobs['node-shard']
  assert.ok(producer, 'the Node suite must have an independently failing shard producer')
  assert.equal(producer['runs-on'], 'ubuntu-latest')
  assert.equal(producer['timeout-minutes'], 20)
  assert.equal(producer.strategy['fail-fast'], false)
  assert.deepEqual(producer.strategy.matrix.node, ['22', '24'])
  assert.deepEqual(producer.strategy.matrix.shard, [0, 1, 2, 3])
  assert.equal(producer.strategy.matrix.shard.length, SHARD_COUNT, 'matrix width and partition count must agree')
  assert.deepEqual(producer.needs, ['m17-qualification', 'bulk-qualification'])
  assert.equal(producer.if, '${{ always() }}')
  const runOf = (name) => producer.steps.find((step) => step.name === name)?.run
  assert.equal(runOf('Require both complete M17 qualifications'), 'test "$M17_RESULT" = success')
  assert.equal(runOf('Require both complete bulk qualifications'), 'test "$BULK_RESULT" = success')
  assert.ok(producer.steps.some((step) => step.run === 'npm run build'), 'shards execute compiled output')
  assert.ok(producer.steps.some((step) => String(step.run).includes('scripts/run-node-shard.mjs')),
    'shards execute the shard runner, never the full gate entrypoint')
  assert.ok(!producer.steps.some((step) => String(step.run ?? '').includes('run-test-gates.mjs')),
    'a shard running the full gate would duplicate every suite')
  for (const step of producer.steps) {
    if (step.name === 'Clean the disposable TMPDIR') continue
    assert.equal(step.if, undefined, 'producer preparation, run and upload use default success()');
    assert.equal(step['continue-on-error'], undefined)
  }
  const upload = producer.steps.find((step) => step.uses === 'actions/upload-artifact@v4')
  assert.deepEqual(upload.with, { name: 'node-shard-${{ github.run_id }}-node${{ matrix.node }}-shard${{ matrix.shard }}',
    path: 'tmp/node-shard/node-shard-${{ matrix.shard }}.json', 'if-no-files-found': 'error', overwrite: true, 'retention-days': 7 })
  const consumer = jobs['build-and-test']
  assert.deepEqual(consumer.needs, ['m17-qualification', 'bulk-qualification', 'node-shard'])
  assert.equal(consumer.if, '${{ always() }}')
  const gate = consumer.steps.find((step) => step.name === 'Require all node shards complete')
  assert.deepEqual(gate, { name: 'Require all node shards complete',
    env: { SHARDS_RESULT: '${{ needs.node-shard.result }}' }, run: 'test "$SHARDS_RESULT" = success' })
  for (let index = 0; index < SHARD_COUNT; index++) {
    assert.ok(consumer.steps.some((step) => step.uses === 'actions/download-artifact@v4' &&
      step.with.name === 'node-shard-${{ github.run_id }}-node${{ matrix.node }}-shard' + index &&
      step.with.path === 'tmp/node-shards'), `build-and-test must download shard ${index} (a missing shard fails the job)`)
  }
  assert.ok(consumer.steps.some((step) => step.env?.[SHARD_DIR_ENV] === '${{ github.workspace }}/tmp/node-shards'),
    'the aggregate must observe the shard evidence directory')
  const trust = jobs['npm-test-trust-root']
  assert.deepEqual(trust.needs, ['m17-qualification', 'bulk-qualification'],
    'the trust root proves the complete entrypoint standalone, never through shards')
}

test('CI shards the Node suite across a duration-balanced matrix with a fail-closed aggregate', () => {
  assertShardGraph(CI_WORKFLOW)
})

test('CI shard negative controls reject skipped-green producers and missing shard evidence', () => {
  for (const [before, after] of [
    ['needs: [m17-qualification, bulk-qualification, node-shard]', 'needs: [m17-qualification, bulk-qualification]'],
    ['run: node scripts/run-node-shard.mjs --shard=${{ matrix.shard }}', 'run: node scripts/run-test-gates.mjs'],
    ['run: test "$M17_RESULT" = success\n      - name: Require both complete bulk qualifications\n        env:\n          BULK_RESULT: ${{ needs.bulk-qualification.result }}\n        run: test "$BULK_RESULT" = success\n      - uses: actions/checkout@v4',
      'run: true\n      - name: Require both complete bulk qualifications\n        env:\n          BULK_RESULT: ${{ needs.bulk-qualification.result }}\n        run: test "$BULK_RESULT" = success\n      - uses: actions/checkout@v4'],
    ['run: test "$BULK_RESULT" = success\n      - uses: actions/checkout@v4', 'run: true\n      - uses: actions/checkout@v4'],
    ['run: test "$SHARDS_RESULT" = success', 'run: true'],
    ['needs.node-shard.result', 'needs.node-shard.outputs.optional'],
    ['shard: [0, 1, 2, 3]', 'shard: [0, 1, 2]'],
    ['name: node-shard-${{ github.run_id }}-node${{ matrix.node }}-shard${{ matrix.shard }}', 'name: node-shard-last-success'],
    ['tmp/node-shard/node-shard-${{ matrix.shard }}.json', 'tmp/node-shard/shard.json'],
    ['path: tmp/node-shard/node-shard-${{ matrix.shard }}.json\n          if-no-files-found: error', 'path: tmp/node-shard/node-shard-${{ matrix.shard }}.json\n          if-no-files-found: warn'],
    ['H2A_TEST_NODE_SHARD_DIR:', 'OPTIONAL_SHARD_DIR:'],
    ['      - name: Require all node shards complete\n', '      - name: Require all node shards complete\n        if: false\n'],
  ]) {
    assert.ok(CI_WORKFLOW.includes(before), before)
    assert.throws(() => assertShardGraph(CI_WORKFLOW.replaceAll(before, after)), before)
  }
})

function envelopeFor(context, index, files, report) {
  return { schema: 1, context: { ...context, shard: index, shards: SHARD_COUNT },
    report: report ?? { success: true, testResults: files.map((name) => ({ name })) } }
}

test('shard envelope admits the exact partition and rejects stale, foreign or partial evidence', () => {
  const context = { repository: 'rhanka/h2a', workflow: 'ci', runId: '1', attempt: '1', sha: 'a'.repeat(40), node: 'v22.23.4' }
  const files = ['packages/h2a/test/a.test.js', 'packages/h2a/test/b.test.js']
  const expected = { context, index: 0, files }
  assert.equal(verifyShardEnvelope(envelopeFor(context, 0, files), expected).success, true)
  const earlier = envelopeFor({ ...context, attempt: '0' }, 0, files)
  assert.throws(() => verifyShardEnvelope(earlier, expected), /attempt/)
  for (const [name, mutate] of Object.entries({
    'wrong index': (value) => { value.context.shard = 1 },
    'wrong shard count': (value) => { value.context.shards = 2 },
    'foreign run': (value) => { value.context.runId = '2' },
    'foreign checkout': (value) => { value.context.sha = 'b'.repeat(40) },
    'failed report': (value) => { value.report.success = false },
    'missing file': (value) => { value.report.testResults.pop() },
    'foreign file': (value) => { value.report.testResults.push({ name: 'packages/h2a/test/c.test.js' }) },
    'duplicate file': (value) => { value.report.testResults.push(structuredClone(value.report.testResults[0])) },
    'unknown envelope field': (value) => { value.optional = true },
  })) {
    const value = envelopeFor(context, 0, files)
    mutate(value)
    assert.throws(() => verifyShardEnvelope(value, expected), name)
  }
})

test('shard loader passes through locally and verifies same-run envelopes in aggregate mode', () => {
  const files = discoverTestFiles().slice(0, 12)
  assert.deepEqual(loadNodeShardReports(files, REPO_ROOT, {}), { local: files, reports: [] })
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'rhanka/h2a', GITHUB_WORKFLOW: 'ci',
    GITHUB_RUN_ID: '424242', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: head }
  const durations = loadShardDurations(REPO_ROOT)
  const expected = partitionNodeFilesByDuration(files, durations)
  const dir = mkdtempSync(join(tmpdir(), 'node-shard-reports-'))
  try {
    for (const shard of expected) {
      writeFileSync(join(dir, `node-shard-${shard.index}.json`),
        JSON.stringify(envelopeFor(shardContext(REPO_ROOT, env, shard.index), shard.index, shard.files)))
    }
    const loaded = loadNodeShardReports(files, REPO_ROOT, { ...env, [SHARD_DIR_ENV]: dir })
    assert.deepEqual(loaded.local, [])
    assert.equal(loaded.reports.length, SHARD_COUNT)
    assert.deepEqual(loaded.reports.flatMap((report) => report.testResults.map((row) => row.name)).sort(), [...files].sort())
    rmSync(join(dir, 'node-shard-0.json'))
    assert.throws(() => loadNodeShardReports(files, REPO_ROOT, { ...env, [SHARD_DIR_ENV]: dir }), /node-shard-0\.json/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
