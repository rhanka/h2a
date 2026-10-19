import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CLIS, classify, matrix, environment, inside, pythonEntrypoint, privateExecutable } from './xcli-lab.mjs';
import { startupKey, blockingScreen } from './qualify-cross-cli.mjs';
import { spawnSync } from 'node:child_process';

test('private CLI shebangs use the selected Node version without inheriting the host PATH', () => {
  const root = mkdtempSync('/tmp/xcli-node-path-');
  try {
    const result = spawnSync('/usr/bin/env', ['node', '--version'], { env: environment(root), encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), process.version, 'env node must preserve the selected Node 22/24 toolchain');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a private Muse program leaves installation-side notice and binary untouched', () => {
  const root = mkdtempSync('/tmp/xcli-muse-program-');
  try {
    const install = join(root, 'installed'), cell = join(root, 'cell');
    fs.mkdirSync(install); fs.mkdirSync(cell);
    const version = '1.4.9-R1';
    const launcher = join(install, 'muse'), binary = join(install, `muse-bin-${version}`);
    fs.copyFileSync(process.execPath, binary);
    writeFileSync(join(install, '.muse-version'), version + '\n');
    writeFileSync(join(install, '.muse-update-notice'), 'must remain in the installation');
    writeFileSync(launcher, `#!/bin/sh
dir="$(dirname -- "$0")"
if [ -f "$dir/.muse-update-notice" ]; then rm -- "$dir/.muse-update-notice"; fi
exec "$dir/muse-bin-${version}" -p 'process.execPath'
`, { mode: 0o700 });
    const program = process.env.XCLI_MUSE_BASELINE ? { path: launcher } : privateExecutable('muse', launcher, cell);
    const result = spawnSync(program.path, [], { cwd: cell, env: environment(cell), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(join(install, '.muse-update-notice')), true, 'launch must never consume installation-side state');
    assert.ok(result.stdout.trim().startsWith(cell + '/'), 'the executing binary must be private too');
    assert.notEqual(fs.statSync(binary).ino, fs.statSync(result.stdout.trim()).ino, 'do not hardlink the installed binary');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('startup can keep the normal default permissions without auto-approving a tool', () => {
  assert.equal(startupKey('Default permissions\nPress ↵ to continue'), 'permissions-keep-default');
  assert.equal(startupKey('Choose your permissions\nDefault (current)\nPress ↵ to continue'), 'permissions-keep-default');
  assert.equal(startupKey('Do you trust this workspace?\nTrust and continue'), 'trust-empty-workspace');
  assert.equal(startupKey('Allow this shell command? Press Enter to confirm'), undefined);
});

test('AGY login selection blocks authentication before messaging can be measured', () => {
  assert.equal(blockingScreen('Select login method: Other sign-in options'), 'authentication-required');
  assert.equal(blockingScreen('Ready · /tmp/private-workspace'), undefined);
});

test('durable delivery without live receive and reply never qualifies a real CLI', () => {
  const row = { senderMcp: true, receiverMcp: true, sent: true, delivered: true,
    received: false, woke: false, replied: false, replyDelivered: false };
  assert.equal(classify(row), 'measured-KO');
  for (const key of Object.keys(row)) row[key] = true;
  assert.equal(classify(row), 'measured-OK');
  row.blocker = 'authentication-required';
  assert.equal(classify(row), 'blocked');
});

test('the qualification table requires all 36 distinct ordered pairs including same CLI', () => {
  const cells = CLIS.flatMap(sender => CLIS.map(receiver => ({ sender, receiver, status: 'blocked' })));
  assert.equal((matrix(cells).match(/\[blocked\]/g) ?? []).length, 36);
  assert.throws(() => matrix(cells.slice(1)), /36/);
  assert.throws(() => matrix([...cells.slice(1), cells[1]]), /duplicate/);
});

test('the private environment drops ambient sockets, hooks, daemon and provider configuration', () => {
  const root = mkdtempSync('/tmp/xcli-env-');
  try {
    const env = environment(root);
    for (const key of ['HOME', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR',
      'H2A_ROOT', 'H2A_NATIVE_SOCKET', 'REMOTE_CLI_CONFIG_HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR']) {
      assert.ok(env[key].startsWith(root + '/'), key);
    }
    assert.equal(env.H2A_UPGRADE_REEXECED, '1');
    assert.equal(env.MUSE_NO_AUTO_UPDATE, '1', 'the installed Muse launcher must not update its binary or fork an updater');
    for (const key of ['NODE_OPTIONS', 'BASH_ENV', 'TMUX', 'ANTHROPIC_BASE_URL', 'OPENAI_API_KEY', 'H2A_MCP_CENTRAL_ENDPOINT']) assert.equal(env[key], undefined);
    assert.throws(() => inside(root, join(root, '../owner')), /outside/);
    const entry = join(root, 'vibe');
    writeFileSync(entry, '#!/usr/bin/env python3\n');
    assert.equal(pythonEntrypoint(entry), true);
    writeFileSync(entry, '#!/usr/bin/env node\n');
    assert.equal(pythonEntrypoint(entry), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('L4: login copies accept only the codex and Muse login roles, never ambient material', async () => {
  const { copyLogin, environment } = await import('./xcli-lab.mjs');
  const CANARY_TOKEN = 'canary-owner-token-zz9';
  const CANARY_INSTANCE = 'canary-owner-instance-zz9';
  const root = mkdtempSync('/tmp/xcli-login-');
  try {
    const authHome = join(root, 'auth');
    const ambient = join(root, 'ambient-home');
    fs.mkdirSync(join(authHome, '.codex'), { recursive: true });
    fs.mkdirSync(join(authHome, '.claude'), { recursive: true });
    fs.mkdirSync(join(authHome, '.gemini'), { recursive: true });
    fs.mkdirSync(join(authHome, '.config/muse'), { recursive: true });
    fs.mkdirSync(join(ambient, '.codex'), { recursive: true });
    writeFileSync(join(authHome, '.codex/auth.json'), JSON.stringify({ token: CANARY_TOKEN }));
    writeFileSync(join(authHome, '.claude/.credentials.json'), JSON.stringify({ token: CANARY_TOKEN }));
    writeFileSync(join(authHome, '.gemini/oauth_creds.json'), JSON.stringify({ token: CANARY_TOKEN }));
    writeFileSync(join(authHome, '.config/muse/auth.json'), JSON.stringify({ token: CANARY_TOKEN }));
    // Decoys the copier must never touch: extra files, ambient owner-style
    // config, and a planted instance-shaped name.
    writeFileSync(join(authHome, '.codex/config.toml'), `instance = "${CANARY_INSTANCE}"\n`);
    writeFileSync(join(ambient, '.codex/auth.json'), JSON.stringify({ token: 'ambient-canary-zz9' }));
    // Roles beyond 'codex'|'claude' are refused, even with material present.
    for (const cli of ['gemini', 'agy', 'muse', 'vibe']) {
      const cell = join(root, 'cell-' + cli);
      const env = environment(join(cell, 'role'));
      assert.throws(() => copyLogin(cli, authHome, cell, env), /login-not-confined/,
        `${cli} logins must be refused`);
    }
    // Allowed roles copy exactly their allowlisted files, byte-identical,
    // with no ambient read and no planted names or paths received.
    for (const cli of ['codex', 'claude']) {
      const cell = join(root, 'cell-' + cli);
      const env = environment(join(cell, 'role'));
      const copied = copyLogin(cli, authHome, cell, env);
      assert.ok(copied.length > 0, `${cli} copies its login`);
      const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
      const content = walk(cell).map(f => fs.readFileSync(f, 'utf8')).join('\n');
      assert.ok(!content.includes('ambient-canary-zz9'), 'no ambient credential material received');
      assert.ok(!content.includes(CANARY_INSTANCE), 'no planted instance name received');
      assert.ok(!content.includes(ambient), 'no ambient path received');
      assert.ok(!content.includes(join(authHome, '.codex/config.toml')), 'decoy files never copied');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Lot L6 RED: the entrypoint guard recognises versioned interpreters, env -S
// forms, absolute interpreter paths and one-level shell wrappers that exec
// Python (dummy files, never executed). Red on current code for the
// versioned, absolute-path and wrapper cases.
test('L6: the entrypoint guard rejects versioned, env-form, absolute and wrapper Python', () => {
  const root = mkdtempSync('/tmp/xcli-guard-');
  try {
    const cases = [
      ['#!/usr/bin/env python3\n', true],
      ['#!/usr/bin/env python3.14\n', true],
      ['#!/usr/bin/env -S python3 -u\n', true],
      ['#!/opt/tools/python3.12\n', true],
      ['#!/bin/sh\nexec /usr/bin/python3 "$@"\n', true],
      ['#!/bin/sh\n/usr/bin/env python3.14 "$@"\n', true],
      ['#!/usr/bin/env node\n', false],
      ['#!/bin/sh\necho hi\n', false],
    ];
    for (const [body, expected] of cases) {
      const entry = join(root, `entry-${cases.indexOf(cases.find(c => c[0] === body))}`);
      writeFileSync(entry, body);
      assert.equal(pythonEntrypoint(entry), expected, JSON.stringify(body.slice(0, 40)));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Lot L6 RED: the cell execution journal records transient descendants at
// ~1 ms, ~10 ms and ~100 ms lifetimes. The dummy carries a Python
// interpreter name but is a trivial native binary copy (nothing Python ever
// runs). Red on any cleanup-snapshot-only design by construction: only an
// event-grade (spawn-time) record can catch the shortest lifetime.
test('L6: the execution journal records transient descendants at every lifetime', async () => {
  const { spawn } = await import('node:child_process');
  const { recordExec, readExecJournal, classifyExecJournal, isPythonInterpreterPath } = await import('./xcli-lab.mjs');
  const root = mkdtempSync('/tmp/xcli-journal-');
  try {
    // A trivial native binary copy carrying an interpreter name (/bin/bash
    // runs under any argv[0]; nothing Python ever runs). Lifetimes come from
    // the shell builtin read -t, so the dummy itself lives ~1/10/100 ms.
    const dummy = join(root, 'python3.14');
    fs.copyFileSync('/bin/bash', dummy);
    fs.chmodSync(dummy, 0o700);
    const journal = join(root, 'exec-journal.jsonl');
    for (const script of ['exit 0', 'read -t 0.01 < /dev/null; exit 0', 'read -t 0.1 < /dev/null; exit 0']) {
      const child = spawn(dummy, ['-c', script]);
      recordExec(journal, { pid: child.pid, path: dummy, tag: 'harness' });
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', code => code === 0 ? resolve() : reject(new Error(`dummy exited ${code}`)));
      });
    }
    const records = readExecJournal(journal);
    assert.equal(records.length, 3, 'all three transient descendants recorded');
    for (const record of records) {
      assert.ok(Number.isSafeInteger(record.pid), 'spawn-time pid recorded');
      assert.ok(record.path.endsWith('/python3.14'), 'resolved executable path recorded');
      assert.equal(record.tag, 'harness');
    }
    const verdict = classifyExecJournal(records);
    assert.equal(verdict.observed, 3);
    assert.equal(verdict.pythonDescendants.length, 3, 'interpreter-named harness execs classify as Python');
    assert.ok(isPythonInterpreterPath('/opt/x/python3.14'));
    assert.ok(!isPythonInterpreterPath('/usr/bin/node'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
