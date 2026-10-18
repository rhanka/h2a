import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runVulnFixCli, timerUnits } from '../src/vuln-fix/cli.mjs';
import { command } from '../src/vuln-fix/process.mjs';
import { fileURLToPath } from 'node:url';

function capture() {
  let out = '', err = '';
  return { stdout: { write: text => { out += text; } }, stderr: { write: text => { err += text; } },
    get out() { return out; }, get err() { return err; } };
}

test('should expose strict run/timer usage without loading seats or owner state', async () => {
  const stream = capture();
  assert.equal(await runVulnFixCli(['vuln-fix', '--help'], stream), 0);
  assert.match(stream.out, /run --config/);
  for (const args of [[], ['run'], ['run', '--config'], ['run', '--config', 'relative'],
    ['run', '--config', '/a', '--typo'], ['timer', '--config', '/a'], ['unknown']]) {
    const output = capture();
    assert.equal(await runVulnFixCli(['vuln-fix', ...args], output), 1);
    assert.ok(output.err);
  }
});

test('should render persistent daily systemd units with escaped absolute paths and restrictive permissions', async t => {
  const root = mkdtempSync(join(tmpdir(), 'vuln-timer-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, 'config %$.json');
  writeFileSync(config, '{}');
  const stream = capture();
  assert.equal(await runVulnFixCli(['vuln-fix', 'timer', '--config', config, '--directory', join(root, 'units')], stream), 0);
  const service = readFileSync(join(root, 'units/h2a-vuln-fix.service'), 'utf8');
  const timer = readFileSync(join(root, 'units/h2a-vuln-fix.timer'), 'utf8');
  assert.match(service, /UMask=0077/);
  assert.match(service, /vuln-fix run --config/);
  assert.match(service, /config %%\$\$\.json/);
  assert.match(timer, /OnCalendar=\*-\*-\* 03:00:00/);
  assert.match(timer, /Persistent=true/);
  assert.match(stream.out, /not activated/);
  assert.throws(() => timerUnits({ config: '/bad\npath', cli: '/cli', node: '/node' }));
});

test('should emit one-line dry-run summary and propagate a failed report exit code', async t => {
  const root = mkdtempSync(join(tmpdir(), 'vuln-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, 'config.json'); writeFileSync(config, '{}');
  const stream = capture();
  let observed;
  const code = await runVulnFixCli(['vuln-fix', 'run', '--config', config, '--dry-run'], stream, {
    run: async (_config, options) => { observed = options; return { ok: false, summary: 'vuln-fix: failures=1 dry-run' }; },
  });
  assert.equal(code, 2); assert.equal(observed.dryRun, true);
  assert.equal(stream.out, 'vuln-fix: failures=1 dry-run\n');
});

test('should expose the compiled h2a command as native and render runnable units without installed h2a', async t => {
  const root = mkdtempSync(join(tmpdir(), 'vuln-built-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { shouldDispatchRuntime } = await import('../dist/bin-routing.js');
  assert.equal(shouldDispatchRuntime(['vuln-fix', 'run']), false);
  const cli = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
  const config = join(root, 'config.json'); writeFileSync(config, '{}');
  const output = await command(process.execPath, [cli, 'vuln-fix', 'timer', '--config', config, '--directory', join(root, 'units')], {
    cwd: root, env: { ...process.env, XDG_RUNTIME_DIR: root, XDG_CONFIG_HOME: join(root, 'config'),
      XDG_STATE_HOME: join(root, 'state'), H2A_ROOT: join(root, 'h2a') },
  });
  assert.equal(output.code, 0, output.stderr);
  assert.match(readFileSync(join(root, 'units/h2a-vuln-fix.service'), 'utf8'), /packages\/h2a\/dist\/bin\.js/);
  assert.match(output.stdout, /not activated/);
});
