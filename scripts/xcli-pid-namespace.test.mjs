import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { environment, repo } from './xcli-lab.mjs';
import { assertPrivatePidNamespace } from '../packages/h2a/test/helpers/private-pid-namespace.mjs';

test('cross-CLI scripts allocate temporary directories through the configured temporary parent', () => {
  for (const file of readdirSync(join(repo, 'scripts')).filter(name => /^(xcli-.*|qualify-cross-cli)\.mjs$/.test(name))) {
    assert.doesNotMatch(readFileSync(join(repo, 'scripts', file), 'utf8'), /mkdtempSync\([^\n]*['"]\/tmp\//, file);
  }
});

test('namespace launchers keep PID isolation and run tests as the invoking user', () => {
  const root = mkdtempSync(join(tmpdir(), 'xcli-pid-user-test-'));
  try {
    const capture = join(root, 'command.json');
    const githubEnv = join(root, 'github-env');
    const runnerTemp = join(root, 'runner-temp');
    mkdirSync(runnerTemp);
    const preload = join(root, 'capture.mjs');
    writeFileSync(preload, `
      import cp from 'node:child_process';
      import { EventEmitter } from 'node:events';
      import { writeFileSync } from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      cp.spawn = (command, args) => {
        writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ command, args }));
        const child = new EventEmitter();
        setImmediate(() => child.emit('close', 0));
        return child;
      };
      syncBuiltinESMExports();
    `);
    for (const args of [
      ['--gate', 'packages/h2a-runtime/vitest.config.ts', 'packages/h2a-runtime/src/gateway-host/daemon.test.ts'],
      ['scripts/xcli-source-tests.mjs', 'packages/h2a/test/native-isolation.test.js'],
    ]) {
      const out = spawnSync(process.execPath, ['--import', preload, join(repo, 'scripts/xcli-in-pid-namespace.mjs'), ...args], {
        env: { ...environment(join(root, 'env')), RUNNER_TEMP: runnerTemp, GITHUB_ENV: githubEnv,
          XCLI_NODE_HEADERS: root }, encoding: 'utf8', timeout: 30000,
      });
      assert.equal(out.status, 0, out.stderr);
      const launch = JSON.parse(readFileSync(capture, 'utf8'));
      assert.equal(launch.command, '/usr/bin/sudo');
      const unshare = launch.args.indexOf('/usr/bin/unshare');
      assert.ok(unshare > 0);
      assert.deepEqual(launch.args.slice(unshare, unshare + 5),
        ['/usr/bin/unshare', '--mount', '--pid', '--fork', '--mount-proc']);
      assert.ok(launch.args[unshare + 5].endsWith('/init'));
      assert.deepEqual(launch.args.slice(unshare + 6, unshare + 12),
        ['/usr/bin/setpriv', '--reuid', String(process.getuid()), '--regid', String(process.getgid()), '--clear-groups']);
      assert.equal(launch.args[unshare + 12], process.execPath);
      const forwarded = Object.fromEntries(launch.args.slice(2, unshare).map(value => {
        const split = value.indexOf('=');
        return [value.slice(0, split), value.slice(split + 1)];
      }));
      for (const key of ['HOME', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME',
        'XDG_DATA_HOME', 'XDG_RUNTIME_DIR', 'REMOTE_CLI_CONFIG_HOME', 'H2A_ROOT', 'H2A_NATIVE_SOCKET']) {
        assert.ok(forwarded[key]?.startsWith(runnerTemp + '/') || (key === 'TMPDIR' && forwarded[key] === runnerTemp),
          `${key} must survive sudo in a private directory`);
      }
      assert.equal(forwarded.H2A_UPGRADE_REEXECED, '1');
      if (args[0] !== '--gate') {
        assert.equal(forwarded.TMPDIR, runnerTemp);
        assert.match(forwarded.XCLI_EVIDENCE_EXPORT_DIR, new RegExp('^' + runnerTemp + '/xcli-evidence-[A-Za-z0-9]{6}$'));
        assert.equal(readFileSync(githubEnv, 'utf8'), `XCLI_EVIDENCE_EXPORT_DIR=${forwarded.XCLI_EVIDENCE_EXPORT_DIR}\n`);
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('historical producers refuse a missing or unchanged PID namespace', () => {
  const previous = process.env.XCLI_PARENT_PID_NS;
  try {
    delete process.env.XCLI_PARENT_PID_NS;
    assert.throws(assertPrivatePidNamespace, /private PID namespace launcher/);
    process.env.XCLI_PARENT_PID_NS = readlinkSync('/proc/self/ns/pid');
    assert.throws(assertPrivatePidNamespace, /different PID namespace/);
  } finally {
    if (previous === undefined) delete process.env.XCLI_PARENT_PID_NS;
    else process.env.XCLI_PARENT_PID_NS = previous;
  }
});

test('runtime gate preserves crash-log metadata and secret redaction in its private environment', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'xcli-gate-crashlog-'));
  try {
    const report = join(root, 'report.json');
    const preload = join(root, 'probe.mjs');
    writeFileSync(preload, `
      import cp from 'node:child_process';
      import { EventEmitter } from 'node:events';
      import { syncBuiltinESMExports } from 'node:module';
      // Exercise only the captured Vitest payload, without pretending this
      // local probe qualifies sudo/unshare. The launch-shape test above
      // independently requires the namespace, init and invoking UID/GID.
      cp.spawn = (command, args) => {
        if (command !== '/usr/bin/sudo') throw new Error('unexpected launch');
        const unshare = args.indexOf('/usr/bin/unshare');
        const node = args.indexOf('/usr/bin/setpriv') + 6;
        const env = Object.fromEntries(args.slice(2, unshare).map(value => {
          const split = value.indexOf('=');
          return [value.slice(0, split), value.slice(split + 1)];
        }));
        const result = cp.spawnSync(args[node], args.slice(node + 1), {
          env, stdio: 'inherit', timeout: 30000,
        });
        const child = new EventEmitter();
        setImmediate(() => child.emit('close', result.status ?? 1));
        return child;
      };
      syncBuiltinESMExports();
    `);
    const out = spawnSync(process.execPath, ['--import', preload, join(repo, 'scripts/xcli-in-pid-namespace.mjs'),
      '--gate', 'packages/h2a-runtime/vitest.config.ts', 'packages/h2a-runtime/src/crash-log.test.ts'], {
      cwd: repo, env: { ...environment(join(root, 'env')), RUNNER_TEMP: root,
        H2A_TEST_REPORT_PATH: report, XCLI_NODE_HEADERS: root }, encoding: 'utf8', timeout: 60000,
    });
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const observed = JSON.parse(readFileSync(report, 'utf8'));
    assert.equal(observed.numTotalTests, 20);
    assert.equal(observed.numPassedTests, 20);
    assert.equal(observed.numFailedTests, 0);
    assert.equal(observed.numPendingTests, 0);
    assert.equal(observed.numTodoTests, 0);
    t.diagnostic(`crash-log: ${observed.numPassedTests} passed, ${observed.numFailedTests} failed, ${observed.numPendingTests} pending, ${observed.numTodoTests} todo (${process.version})`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('namespace init refuses to adopt or signal processes outside its private PID namespace', () => {
  const root = mkdtempSync(join(tmpdir(), 'xcli-pid-init-test-'));
  try {
    const binary = join(root, 'init');
    assert.equal(spawnSync('/usr/bin/g++', ['-std=c++17', '-O2', join(repo, 'scripts/xcli-pid-init.cc'), '-o', binary]).status, 0);
    const refused = spawnSync(binary, ['/bin/true'], { encoding: 'utf8' });
    assert.equal(refused.status, 125);
    assert.match(refused.stderr, /must run as PID 1/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
