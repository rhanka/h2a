import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';

const test = (name, body) => {
  if (!process.env.MH_L6_CASE || process.env.MH_L6_CASE === name) nodeTest(name, body);
};
async function api() {
  const module = await import('../dist/runtime/upgrade/upgrade-cli.js').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {};
  });
  assert.equal(typeof module?.parseUpgradeCommand, 'function', 'upgrade CLI parser required');
  assert.equal(typeof module?.upgradeExitCode, 'function', 'upgrade CLI exit codes required');
  return module;
}

test('F should parse the run and check forms', async () => {
  const { parseUpgradeCommand } = await api();
  assert.deepEqual(parseUpgradeCommand([]),
    { action: 'run', upgradeId: null, component: null, to: null, dryRun: false, json: false, strict: false });
  assert.deepEqual(parseUpgradeCommand(['--to', '0.98.7', '--dry-run', '--json', '--strict']).to, '0.98.7');
  assert.equal(parseUpgradeCommand(['--to', '0.98.7', '--dry-run', '--json', '--strict']).strict, true);
  assert.deepEqual(parseUpgradeCommand(['--check', '--json']).action, 'check');
  assert.deepEqual(parseUpgradeCommand(['status']).action, 'status');
  assert.deepEqual(parseUpgradeCommand(['status', '--json']).json, true);
  assert.deepEqual(parseUpgradeCommand(['unmanage', '--dry-run']).dryRun, true);
  assert.equal(Object.isFrozen(parseUpgradeCommand([])), true);
});

test('F should parse resume abort and compensate with their required arguments', async () => {
  const { parseUpgradeCommand } = await api();
  assert.deepEqual(parseUpgradeCommand(['resume', 'up-1']), { action: 'resume', upgradeId: 'up-1',
    component: null, to: null, dryRun: false, json: false, strict: false });
  assert.equal(parseUpgradeCommand(['resume', 'up-1', '--strict', '--json']).strict, true);
  assert.equal(parseUpgradeCommand(['abort', 'up-1', '--json']).action, 'abort');
  assert.deepEqual(parseUpgradeCommand(['compensate', 'up-1', '--component', 'mcp']).component, 'mcp');
  assert.deepEqual(parseUpgradeCommand(['compensate', 'up-1', '--component', 'gateway']).component, 'gateway');
});

test('F should show help for the help forms', async () => {
  const { parseUpgradeCommand } = await api();
  for (const argv of [['help'], ['-h'], ['--help']]) {
    assert.deepEqual(parseUpgradeCommand(argv).action, 'help');
  }
});

test('F should refuse unknown flags and misplaced options instead of guessing', async () => {
  const { parseUpgradeCommand } = await api();
  for (const argv of [['--bogus'], ['run'], ['status', '--strict'], ['status', '--to', '0.98.7'], ['run', '--component', 'mcp'],
    ['--check', '--strict'], ['--check', '--to', '0.98.7'], ['resume', 'up-1', '--dry-run'], ['abort', 'up-1', '--strict'],
    ['--json', '--json'], ['--', 'status'], ['help', 'status']]) {
    assert.throws(() => parseUpgradeCommand(argv), /upgrade_cli_usage/, JSON.stringify(argv));
  }
});

test('F should require the transaction identity for resume abort and compensate', async () => {
  const { parseUpgradeCommand } = await api();
  for (const argv of [['resume'], ['abort'], ['compensate', '--component', 'mcp'], ['resume', 'up-1', 'up-2'],
    ['status', 'up-1'], ['--check', 'up-1']]) {
    assert.throws(() => parseUpgradeCommand(argv), /upgrade_cli_usage/, JSON.stringify(argv));
  }
});

test('F should require a known component for compensation', async () => {
  const { parseUpgradeCommand } = await api();
  for (const argv of [['compensate', 'up-1'], ['compensate', 'up-1', '--component', 'central'],
    ['compensate', 'up-1', '--component', '--json'], ['compensate', 'up-1', '--component']]) {
    assert.throws(() => parseUpgradeCommand(argv), /upgrade_cli_usage/, JSON.stringify(argv));
  }
});

test('F should refuse an invalid CLI envelope instead of guessing', async () => {
  const { parseUpgradeCommand, upgradeExitCode } = await api();
  for (const argv of [null, 42, 'status', {}, ['status', 42], ['status', '--json', null]]) {
    assert.throws(() => parseUpgradeCommand(argv), /upgrade_cli_invalid/);
  }
  for (const outcome of [null, 42, 'done', [], { completed: 1 }, { failed: 'yes' }, { deferred: 0 }]) {
    assert.throws(() => upgradeExitCode(outcome), /upgrade_cli_invalid/);
  }
  for (const options of [null, 42, 'strict', [], { strict: 1 }]) {
    assert.throws(() => upgradeExitCode({ completed: true }, options), /upgrade_cli_invalid/);
  }
});

test('F should map success failure and deferral to exit codes', async () => {
  const { upgradeExitCode } = await api();
  assert.equal(upgradeExitCode({ completed: true }), 0);
  assert.equal(upgradeExitCode({ completed: true, deferred: true }), 0);
  assert.equal(upgradeExitCode({ failed: true }), 1);
  assert.equal(upgradeExitCode({ completed: true, failed: true }), 1);
  assert.equal(upgradeExitCode({ deferred: true }), 0);
  assert.equal(upgradeExitCode({}), 2);
});

test('F should make deferral blocking under strict', async () => {
  const { upgradeExitCode } = await api();
  assert.equal(upgradeExitCode({ deferred: true }, { strict: true }), 2);
  assert.equal(upgradeExitCode({ completed: true }, { strict: true }), 0);
  assert.equal(upgradeExitCode({ failed: true }, { strict: true }), 1);
  assert.equal(upgradeExitCode({}, { strict: true }), 2);
});
