import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, chmodSync, lstatSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { CLIS, classify, matrix, environment, inside, pythonEntrypoint, privateExecutable, compliantQualificationRoot, repo } from './xcli-lab.mjs';

test('large native Muse programs link only to read-only sources and wipes leave the source intact', () => {
  const root = mkdtempSync(join(tmpdir(), 'xcli-muse-budget-'));
  const install = join(root, 'install'), cell = join(root, 'cell');
  mkdirSync(install); mkdirSync(cell);
  const version = '1.2.3-R1';
  const launcher = join(install, 'muse'), binary = join(install, `muse-bin-${version}`);
  writeFileSync(join(install, '.muse-version'), version);
  writeFileSync(launcher, '#!/bin/sh\nexit 0\n');
  writeFileSync(binary, Buffer.from('7f454c4600000000', 'hex'));
  try {
    assert.throws(() => privateExecutable('muse', launcher, cell, { maxProgramCopyBytes: 1 }), /muse-program-source-writable/);
    rmSync(join(cell, 'muse-program'), { recursive: true, force: true });
    chmodSync(binary, 0o500);
    const program = privateExecutable('muse', launcher, cell, { maxProgramCopyBytes: 1 });
    const projected = join(dirname(program.path), `muse-bin-${version}`);
    assert.equal(lstatSync(projected).isSymbolicLink(), true);
    assert.equal(program.linkedProgram, true);
    assert.equal(readFileSync(projected).toString('hex'), '7f454c4600000000');
    rmSync(cell, { recursive: true, force: true });
    assert.equal(readFileSync(binary).toString('hex'), '7f454c4600000000');
    assert.equal(statSync(binary).mode & 0o777, 0o500);
  } finally { chmodSync(binary, 0o700); rmSync(root, { recursive: true, force: true }); }
});
import { startupKey, blockingScreen } from './qualify-cross-cli.mjs';
import { spawnSync } from 'node:child_process';

test('private CLI shebangs use the selected Node version without inheriting the host PATH', () => {
  const root = mkdtempSync(join(tmpdir(), 'xcli-node-path-'));
  try {
    const result = spawnSync('/usr/bin/env', ['node', '--version'], { env: environment(root), encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), process.version, 'env node must preserve the selected Node 22/24 toolchain');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a private Muse program leaves installation-side notice and binary untouched', () => {
  const root = mkdtempSync(join(tmpdir(), 'xcli-muse-program-'));
  try {
    const install = join(root, 'installed'), cell = join(root, 'cell');
    fs.mkdirSync(install); fs.mkdirSync(cell);
    const version = '1.4.9-R1';
    const launcher = join(install, 'muse'), binary = join(install, `muse-bin-${version}`);
    const source = join(root, 'program.cc');
    writeFileSync(source, '#include <unistd.h>\n#include <cstdio>\nint main(){char p[4096];auto n=readlink("/proc/self/exe",p,sizeof(p));if(n<0)return 1;fwrite(p,1,n,stdout);puts("");}\n');
    const compiled = spawnSync('/usr/bin/g++', [source, '-o', binary], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr);
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

// R15 (class-c): the post-trust MCP-approval Allow screen (captured 2.1.314
// vocabulary) is a normal startup action; a shell-command approval stays
// undefined and fails closed through the tool-approval blocker.
test('R15: startup handles the MCP-approval Allow screen, never a shell approval', () => {
  const allow = 'MCP servers need permission to run in this workspace\nOnly allow tools from sources you trust\n[Allow] [Deny]\nPress Enter to confirm your choice';
  assert.equal(startupKey(allow), 'mcp-approval-allow');
  assert.equal(startupKey('Allow this shell command? Press Enter to confirm'), undefined);
  assert.equal(startupKey('Allow "h2a" MCP tool usage?\nPress Enter to confirm'), 'mcp-approval-allow');
});

// R21 (bench round 21, claude diagonal): the 2.1.316 post-trust Allow dialog
// carries the captured Enter+confirm+trust+Allow vocabulary with a permission
// signal but no literal MCP token, so the MCP-worded key misses it and the
// cell idles to mcp-not-loaded-before-deadline. The server-named variant is
// the same single startup action; unscoped screens stay closed.
test('R21: startup handles the server-named approval variant without its MCP word', () => {
  const variant = '[Allow] [Deny]\nPress Enter to confirm your choice\nOnly continue in directories you trust';
  assert.equal(startupKey(variant), undefined, 'unscoped screens never auto-press');
  assert.equal(startupKey(variant, 'claude'), 'mcp-approval-allow');
  assert.equal(startupKey('Allow this shell command? Press Enter to confirm', 'claude'), undefined);
  assert.equal(blockingScreen(variant), undefined, 'the variant stays a startup action, never a blocker');
});

// R22 (bench round 22, codex diagonal): the codex composer prose ("choose
// what Codex is allowed to do" + "No h2a MCP tools are available") matched
// the MCP-worded approval key through the "allowed" substring, so the cell
// pressed Enter into the composer until the presses exhausted and blamed a
// phantom approval (codex-mcp-approval-unresolved) while the server never
// started. Prose is not a dialog: the key needs the whole approval word.
test('R22: codex composer prose never reads as an MCP approval', () => {
  const composer = '/permissions - choose what Codex is allowed to do\n' +
    '/model - choose what model and reasoning effort to use\n' +
    '› Qualification h2a. Use only h2a MCP tools.\n' +
    '• No h2a MCP tools are available in this session, so I can’t check identity status.';
  assert.equal(startupKey(composer), undefined, 'prose "allowed" is not an approval');
  assert.equal(startupKey(composer, 'codex'), undefined, 'scoped prose is not an approval either');
  assert.equal(startupKey('MCP servers need permission to run in this workspace\n' +
    'Only allow tools from sources you trust\n[Allow] [Deny]\nPress Enter to confirm your choice'),
  'mcp-approval-allow', 'a real approval dialog still auto-confirms');
});

// R22 (bench round 22, agy + muse diagonals): two startup gates need their
// own typed blocker instead of a generic one. The agy first-run Terms/Data-Use
// dialog is unresolved native completion. Existing evidence can be replayed
// during custody; its account-setting checkbox is not a startup key.
// The muse runtime host refuses a TMPDIR-derived tool-output
// root inside a workspace or repository.
test('R22: consent and tmpdir-guard screens block with typed reasons', () => {
  const consent = 'Terms of Service & Data Use\n' +
    '> [x] Yes, I agree to help improve Antigravity CLI by allowing\n' +
    'Google to collect and use my Interactions data,\n' +
    'choose to opt out later whenever I want';
  assert.equal(blockingScreen(consent), 'tos-consent-required');
  assert.equal(startupKey(consent), undefined, 'consent is never auto-pressed');
  assert.equal(startupKey(consent, 'agy'), undefined, 'consent is never auto-pressed when scoped either');
  const guard = "runtime host failed to start: TMPDIR '/c/tmp' produced " +
    "process-lifetime tool-output root '/c/tmp/x' inside the configured workspace or repository";
  assert.equal(blockingScreen(guard), 'tmpdir-guard-refusal');
});

// R17 (P2-2): only an MCP server approval at startup is a startup action.
// Any other tool, permission or shell-command approval must stay undefined
// and fail closed through the tool-approval blocker — never an auto-\r.
test('R17: only an MCP server approval is a startup action, every other approval blocks', () => {
  for (const screen of ['Allow tool "bash" to run? [y/n]',
    'Approve tool execution: rm -rf /? Press Enter to allow',
    'Permission required: Allow tool write_file?',
    'Allow this shell command? Press Enter to confirm']) {
    assert.equal(startupKey(screen), undefined, JSON.stringify(screen));
    assert.equal(blockingScreen(screen), 'tool-approval-required', JSON.stringify(screen));
  }
  const allow = 'MCP servers need permission to run in this workspace\nOnly allow tools from sources you trust\n[Allow] [Deny]\nPress Enter to confirm your choice';
  assert.equal(startupKey(allow), 'mcp-approval-allow');
  assert.equal(blockingScreen(allow), undefined, 'the MCP startup approval stays a startup action, never a blocker');
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
  const root = mkdtempSync(join(tmpdir(), 'xcli-env-'));
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
  const root = mkdtempSync(join(tmpdir(), 'xcli-login-'));
  try {
    const authHome = join(root, 'auth');
    const ambient = join(root, 'ambient-home');
    fs.mkdirSync(join(authHome, '.codex'), { recursive: true });
    fs.mkdirSync(join(authHome, '.claude'), { recursive: true });
    fs.mkdirSync(join(authHome, '.gemini'), { recursive: true });
    fs.mkdirSync(join(authHome, '.gemini/antigravity-cli'), { recursive: true });
    fs.mkdirSync(join(authHome, '.config/muse'), { recursive: true });
    fs.mkdirSync(join(authHome, '.vibe'), { recursive: true });
    fs.mkdirSync(join(ambient, '.codex'), { recursive: true });
    writeFileSync(join(authHome, '.codex/auth.json'), JSON.stringify({ token: CANARY_TOKEN }));
    writeFileSync(join(authHome, '.claude/.credentials.json'), JSON.stringify({ token: CANARY_TOKEN }));
    writeFileSync(join(authHome, '.gemini/oauth_creds.json'), JSON.stringify({ token: CANARY_TOKEN }));
    writeFileSync(join(authHome, '.gemini/antigravity-cli/antigravity-oauth-token'),
      `${CANARY_TOKEN}\n`);
    writeFileSync(join(authHome, '.config/muse/auth.json'), JSON.stringify({ token: CANARY_TOKEN }));
    writeFileSync(join(authHome, '.vibe/MISTRAL_API_KEY'), `${CANARY_TOKEN}\n`);
    // Decoys the copier must never touch: extra files, ambient owner-style
    // config, and a planted instance-shaped name. The stale gemini-CLI
    // oauth file is a decoy too: only the agy CLI token crosses.
    writeFileSync(join(authHome, '.codex/config.toml'), `instance = "${CANARY_INSTANCE}"\n`);
    writeFileSync(join(ambient, '.codex/auth.json'), JSON.stringify({ token: 'ambient-canary-zz9' }));
    // Gemini maps no login files and stays refused. Agy carries its OAuth
    // token (R22) like the other seated families.
    {
      const cell = join(root, 'cell-gemini');
      const env = environment(join(cell, 'role'));
      assert.throws(() => copyLogin('gemini', authHome, cell, env), /login-not-confined/,
        'gemini logins must be refused');
    }
    // Allowed roles copy exactly their allowlisted files, byte-identical,
    // with no ambient read and no planted names or paths received.
    for (const cli of ['codex', 'claude', 'muse', 'agy']) {
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
    // R19: 'vibe' seats its auth-only custody projection — exactly the
    // MISTRAL_API_KEY value file, byte-identical, nothing else.
    {
      const cell = join(root, 'cell-vibe');
      const env = environment(join(cell, 'role'));
      const copied = copyLogin('vibe', authHome, cell, env);
      assert.deepEqual(copied, ['.vibe/MISTRAL_API_KEY']);
      assert.equal(fs.readFileSync(join(cell, 'role/home/.vibe/MISTRAL_API_KEY'), 'utf8'), `${CANARY_TOKEN}\n`);
      assert.equal(fs.statSync(join(cell, 'role/home/.vibe/MISTRAL_API_KEY')).mode & 0o777, 0o600);
      const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
      const content = walk(cell).map(f => fs.readFileSync(f, 'utf8')).join('\n');
      assert.ok(!content.includes('ambient-canary-zz9'), 'no ambient credential material received');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// R15 (class-c RED): a missing login source is witnessed as login-skipped
// with its reason instead of copying silently. Red on pre-fix code:
// copyLoginReport does not exist.
test('R15: a missing login source reports login-skipped with its reason', async () => {
  const { copyLoginReport, environment } = await import('./xcli-lab.mjs');
  const root = mkdtempSync(join(tmpdir(), 'xcli-login-skipped-'));
  try {
    const authHome = join(root, 'auth');
    fs.mkdirSync(join(authHome, '.codex'), { recursive: true });
    const cell = join(root, 'cell');
    const env = environment(join(cell, 'role'));
    // No .codex/auth.json present: the allowlisted file is skipped, named.
    const missing = copyLoginReport('codex', authHome, cell, env);
    assert.deepEqual(missing.copied, []);
    assert.deepEqual(missing.skipped, [{ file: '.codex/auth.json', reason: 'login-source-enoent' }]);
    // Present files still copy and report no skip.
    writeFileSync(join(authHome, '.codex/auth.json'), JSON.stringify({ token: 'dummy-zz9' }));
    const present = copyLoginReport('codex', authHome, cell, env);
    assert.deepEqual(present.copied, ['.codex/auth.json']);
    assert.deepEqual(present.skipped, []);
    // The vibe seat file copies when present, witnessed like the others.
    fs.mkdirSync(join(authHome, '.vibe'), { recursive: true });
    writeFileSync(join(authHome, '.vibe/MISTRAL_API_KEY'), 'vibe-key-zz9\n');
    const vibe = copyLoginReport('vibe', authHome, cell, env);
    assert.deepEqual(vibe.copied, ['.vibe/MISTRAL_API_KEY']);
    assert.deepEqual(vibe.skipped, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// R19: the vibe seat value crosses into the cell only as MISTRAL_API_KEY,
// from the allowlisted seat file, with a names-only witness. Anything else
// leaves the environment untouched.
test('R19: vibe cells export the seat key, other cells gain nothing', async () => {
  const { copyLoginReport, environment, loginCopyPath, vibeCellKey } = await import('./xcli-lab.mjs');
  const root = mkdtempSync(join(tmpdir(), 'xcli-vibe-key-'));
  try {
    const authHome = join(root, 'auth');
    fs.mkdirSync(join(authHome, '.vibe'), { recursive: true });
    writeFileSync(join(authHome, '.vibe/MISTRAL_API_KEY'), 'vibe-key-zz9\n');
    const cell = join(root, 'cell');
    const env = environment(join(cell, 'role'));
    const report = copyLoginReport('vibe', authHome, cell, env);
    const witness = vibeCellKey(env, 'vibe', report.copied);
    assert.equal(env.MISTRAL_API_KEY, 'vibe-key-zz9');
    assert.deepEqual(witness, { file: '.vibe/MISTRAL_API_KEY',
      sha256: createHash('sha256').update('vibe-key-zz9').digest('hex') });
    assert.equal(loginCopyPath(env, 'vibe', '.vibe/MISTRAL_API_KEY'),
      join(env.HOME, '.vibe/MISTRAL_API_KEY'));
    const plain = environment(join(root, 'other'));
    assert.equal(vibeCellKey(plain, 'vibe', []), null);
    assert.equal(plain.MISTRAL_API_KEY, undefined);
    assert.equal(vibeCellKey(plain, 'codex', ['.codex/auth.json']), null);
    assert.equal(plain.MISTRAL_API_KEY, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Lot L6 RED: the entrypoint guard recognises versioned interpreters, env -S
// forms (including VAR=val assignments before the interpreter), absolute
// interpreter paths and one-level shell wrappers that exec Python (dummy
// files, never executed). Red on current code for the versioned,
// absolute-path and wrapper cases; R15 adds the assignment forms.
test('L6: the entrypoint guard rejects versioned, env-form, absolute and wrapper Python', () => {
  const root = mkdtempSync(join(tmpdir(), 'xcli-guard-'));
  try {
    const cases = [
      ['#!/usr/bin/env python3\n', true],
      ['#!/usr/bin/env python3.14\n', true],
      ['#!/usr/bin/env -S python3 -u\n', true],
      ['#!/opt/tools/python3.12\n', true],
      ['#!/bin/sh\nexec /usr/bin/python3 "$@"\n', true],
      ['#!/bin/sh\n/usr/bin/env python3.14 "$@"\n', true],
      ['#!/usr/bin/env FOO=bar python3.14\n', true],
      ['#!/usr/bin/env FOO=bar BAR=baz python3\n', true],
      ['#!/usr/bin/env -S FOO=bar python3 -u\n', true],
      ['#!/bin/sh\nexec env FOO=bar python3 "$@"\n', true],
      ['#!/bin/sh\nexec env -i FOO=bar python3 "$@"\n', true],
      ['#!/bin/sh\nFOO=bar exec python3.12 "$@"\n', true],
      ['#!/usr/bin/env FOO=bar node\n', false],
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
  const root = mkdtempSync(join(tmpdir(), 'xcli-journal-'));
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

// Lot L7 RED (QO4, §8.2): the installed vendor vibe entrypoint classifies as
// vendor-runtime python (not shipped) and is never blocked. Other families
// keep the refusal: a Python entrypoint outside the vendor allowance stays
// forbidden. Red on current code: no such classification exists and every
// Vibe cell blocks pre-execution on python-entrypoint-forbidden.
test('L7: the vendor vibe entrypoint classifies as vendor-runtime, never forbidden', async () => {
  const { vendorRuntimeLabel } = await import('./xcli-lab.mjs');
  const root = mkdtempSync(join(tmpdir(), 'xcli-vibe-'));
  try {
    const launcher = join(root, 'vibe');
    writeFileSync(launcher, '#!/home/owner/.local/share/uv/tools/mistral-vibe/bin/python3\n');
    assert.equal(vendorRuntimeLabel('vibe', launcher), 'python (not shipped)');
    assert.equal(vendorRuntimeLabel('vibe', join(root, 'missing')), null);
    assert.equal(vendorRuntimeLabel('codex', launcher), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Rebase R10 (PR #390): the native-isolation admission guard only accepts
// $HOME/.cache-tmp/h2a-test/run-* (/tmp is forbidden). Every campaign and
// worker root must be admitted, or the worker dies at import with
// REFUSING invalid short qualification root and the cell blocks.
test('campaign roots are admitted by the native-isolation qualification guard', () => {
  const root = compliantQualificationRoot();
  try {
    assert.equal(fs.statSync(root).mode & 0o777, 0o700, 'admitted roots are private');
    const helper = pathToFileURL(join(repo, 'packages/h2a/test/helpers/native-isolation.js')).href;
    const probe = `const h = await import(${JSON.stringify(helper)});
      h.assertPrivateQualificationPath(${JSON.stringify(join(root, 'child'))}, ${JSON.stringify(root)});`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
      env: { ...process.env, H2A_TEST_QUALIFICATION_ROOT: root }, encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
