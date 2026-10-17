// Node's CLI glob expansion sorts explicit filenames lexically. Use its public
// runner API to retain the production scheduler's priority order, with the same
// process isolation, concurrency, spec output and execution-evidence reporter.
import assert from 'node:assert/strict';
import { ChildProcess } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';
import { Duplex, Readable } from 'node:stream';
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
const progress = setInterval(() => process.stderr.write(`[node-test-progress] ${JSON.stringify({ concurrency, completed,
  active: [...pending].map(([child, row]) => ({ file: row.file, pid: child.pid, elapsedMs: Math.round(performance.now() - row.started),
    exitCode: child.exitCode, signalCode: child.signalCode })) })}\n`), interval).unref();
// These fixtures qualify bounded cold startup and authenticated handover.
// Give each its own phase before npm installs and the 32-process campaign;
// their internal concurrent admissions and every deadline remain unchanged.
const standalone = ['mcp-central-attachments.test.js', 'mh-l3-transfer.test.js']
  .flatMap(name => files.filter(file => basename(file) === name));
const remaining = files.filter(file => !standalone.includes(file));
const phases = [...standalone.map(file => [file]), remaining].filter(group => group.length);
const events = Readable.from((async function* () {
  for (const group of phases) {
    const source = run({ files: group, isolation: 'process', concurrency,
      execArgv: ['--import', fileURLToPath(new URL('../packages/h2a/test/helpers/native-isolation.js', import.meta.url))] });
    for await (const event of source) {
      const { type, data } = event;
      if (type === 'test:summary' && !data.success) process.exitCode = 1;
      // Ordered spec output may buffer failures behind another file.
      if (type === 'test:fail' && !data.todo && !data.skip) {
        process.stderr.write(`[node-test-failure] ${data.file}: ${data.name}\n${inspect(data.details?.error, { depth: 6 })}\n`);
      }
      yield event;
    }
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
