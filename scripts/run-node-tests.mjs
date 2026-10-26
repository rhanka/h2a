// Node's CLI glob expansion sorts explicit filenames lexically. Use its public
// runner API to retain the production scheduler's priority order, with the same
// process isolation, concurrency, spec output and execution-evidence reporter.
import assert from 'node:assert/strict';
import { ChildProcess } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';
import { Duplex, Readable, PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { inspect } from 'node:util';
import evidenceReporter from './node-evidence-reporter.mjs';

const args = process.argv.slice(2);
const evidence = fileURLToPath(new URL('./node-evidence-reporter.mjs', import.meta.url));
const fixed = new Set(['--test', '--test-reporter=spec', `--test-reporter=${evidence}`, '--test-reporter-destination=stdout']);
const destinations = args.filter(arg => arg.startsWith('--test-reporter-destination=') && arg !== '--test-reporter-destination=stdout');
const concurrencyArgs = args.filter(arg => /^--test-concurrency=[1-9]\d*$/.test(arg));
const files = args.filter(arg => !arg.startsWith('-'));
assert.ok([...fixed].every(arg => args.filter(value => value === arg).length === 1), 'both production reporters are mandatory');
assert.equal(destinations.length, 1, 'one private evidence destination is mandatory');
assert.ok(concurrencyArgs.length <= 1);
assert.ok(files.length > 0 && files.every(file => file.endsWith('.test.js')), 'explicit test files are mandatory');
assert.equal(new Set(files).size, files.length, 'duplicate test files');
assert.equal(args.length, fixed.size + destinations.length + concurrencyArgs.length + files.length, 'unsupported runner option');
const reportPath = destinations[0].slice('--test-reporter-destination='.length);
const concurrency = concurrencyArgs.length ? Number(concurrencyArgs[0].split('=')[1]) : availableParallelism();
// Package files spawn npm installers and compilers themselves. Bound that
// nested work without throttling the hundreds of ordinary protocol files.
// An explicit test-runner override still governs both phases.
const bulkConcurrency = concurrencyArgs.length ? concurrency : Math.min(2, concurrency);
const interval = Number(process.env.H2A_TEST_NODE_PROGRESS_MS ?? 30_000);
assert.ok(Number.isFinite(interval) && interval > 0, 'positive progress interval required');
const pending = new Map(), fileSet = new Set(files);
const originalSpawn = ChildProcess.prototype.spawn;
let completed = 0;
// Observe only children created by this runner. Close, rather than exit, also
// exposes a descendant retaining a test child's stdout after that child exits.
ChildProcess.prototype.spawn = function (options) {
  const result = Reflect.apply(originalSpawn, this, [options]);
  const file = options.args?.find(arg => fileSet.has(arg));
  if (file) {
    const started = performance.now();
    pending.set(this, { file, started });
    this.once('close', () => { pending.delete(this); completed++; });
  }
  return result;
};
const progress = setInterval(() => process.stderr.write(`[node-test-progress] ${JSON.stringify({ concurrency, bulkConcurrency, completed,
  active: [...pending].map(([child, row]) => ({ file: row.file, pid: child.pid, elapsedMs: Math.round(performance.now() - row.started),
    exitCode: child.exitCode, signalCode: child.signalCode })) })}\n`), interval).unref();
// These fixtures qualify bounded cold startup and authenticated handover.
// Give each its own phase before npm installs and the 32-process campaign;
// their internal concurrent admissions and every deadline remain unchanged.
const standalone = ['mcp-central-attachments.test.js', 'mh-l3-transfer.test.js', 'mh-l4-central.test.js', 'mcp-identity-burst.test.js', 'mh-l5-compensation.test.js']
  .flatMap(name => files.filter(file => basename(file) === name));
// Bulk filesystem installs must not consume the bounded protocol fixtures'
// startup budgets. The long backend has a separate reserved worker after the
// standalone cold qualifications, rather than waiting for every protocol file.
const backend = files.filter(file => basename(file) === 'mh-l5-concurrency.test.js');
const bulkNames = ['mh-l6-package.test.js', 'mh-l6-runtime-package.test.js',
  'drive-consent-index.test.js', 'candidate-artifacts.test.js', 'mh-l1-package.test.js',
  'mh-l6-components.test.js', 'mh-l6-entry.test.js', 'mh-l6-native.test.js', 'mh-l6-native-copy.test.js'];
const bulk = bulkNames.flatMap(name => files.filter(file => basename(file) === name));
// The native inventory and packaging seam take several minutes on CI. Start
// them with the protocol pool, so their tail cannot postpone every bulk file.
// Preserve the cold-start and bulk barriers, worker count and complete scope.
const longProtocols = ['native-inventory-absence.test.js', 'succession-lock-seam-guard.test.js']
  .flatMap(name => files.filter(file => basename(file) === name));
const remaining = [...longProtocols, ...files.filter(file => !standalone.includes(file) && !bulk.includes(file)
  && !backend.includes(file) && !longProtocols.includes(file))];
async function* execute(group, workers = concurrency) {
  if (!group.length) return;
  yield* run({ files: group, isolation: 'process', concurrency: workers,
    execArgv: ['--import', fileURLToPath(new URL('../packages/h2a/test/helpers/native-isolation.js', import.meta.url))] });
}
async function* merge(sources) {
  const output = new PassThrough({ objectMode: true });
  let pendingSources = sources.length;
  for (const source of sources) {
    source.once('error', error => output.destroy(error));
    source.once('end', () => { if (--pendingSources === 0) output.end(); });
    source.pipe(output, { end: false });
  }
  try { yield* output; }
  finally { for (const source of sources) source.destroy(); }
}
async function* schedule() {
  for (const file of standalone) yield* execute([file]);
  if (!backend.length || concurrency === 1) {
    yield* execute(backend); yield* execute(remaining); yield* execute(bulk, bulkConcurrency);
    return;
  }
  // M17's shared lock serializes its eight actors. Reserve one file worker
  // for that long campaign while the other CPUs qualify remaining protocols.
  // Bulk installs still wait for those protocols. Both streams keep the exact
  // original filenames/cases and flow through both production reporters.
  let backendDone = false;
  const campaign = Readable.from((async function* () {
    try { yield* execute(backend, 1); }
    finally { backendDone = true; }
  })());
  const other = Readable.from((async function* () {
    yield* execute(remaining, backendDone ? concurrency : concurrency - 1);
    yield* execute(bulk, backendDone ? bulkConcurrency : Math.min(bulkConcurrency, concurrency - 1));
  })());
  yield* merge([campaign, other]);
}
const events = Readable.from((async function* () {
    for await (const event of schedule()) {
      const { type, data } = event;
      if (type === 'test:summary' && !data.success) process.exitCode = 1;
      // Ordered spec output may buffer failures behind another file.
      if (type === 'test:fail' && !data.todo && !data.skip) {
        process.stderr.write(`[node-test-failure] ${data.file}: ${data.name}\n${inspect(data.details?.error, { depth: 6 })}\n`);
      }
      yield event;
    }
})());
try {
  await Promise.all([
    pipeline(events, new spec(), process.stdout),
    pipeline(events, Duplex.from(evidenceReporter), createWriteStream(reportPath)),
  ]);
} finally {
  clearInterval(progress);
  ChildProcess.prototype.spawn = originalSpawn;
}
