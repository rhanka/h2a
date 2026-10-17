// Node's CLI glob expansion sorts explicit filenames lexically. Use its public
// runner API to retain the production scheduler's priority order, with the same
// process isolation, concurrency, spec output and execution-evidence reporter.
import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Duplex } from 'node:stream';
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
const events = run({ files, isolation: 'process', concurrency: concurrencyArgs.length ? Number(concurrencyArgs[0].split('=')[1]) : true,
  execArgv: ['--import', fileURLToPath(new URL('../packages/h2a/test/helpers/native-isolation.js', import.meta.url))] });
events.on('test:summary', data => { if (!data.success) process.exitCode = 1; });
// Spec's final failure summary may never be reached when a different file
// hangs. Preserve the actual error immediately, before the outer backstop.
events.on('test:fail', data => {
  if (!data.todo && !data.skip) process.stderr.write(`[node-test-failure] ${data.file}: ${data.name}\n${inspect(data.details?.error, { depth: 6 })}\n`);
});
await Promise.all([
  pipeline(events, new spec(), process.stdout),
  pipeline(events, Duplex.from(evidenceReporter), createWriteStream(reportPath)),
]);
