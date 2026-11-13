import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { copyLogin, environment, cellSecretPaths, wipeSecrets } from './xcli-lab.mjs';
import { runSeatPreflight } from './xcli-seats.mjs';

test('L4 review: every source path component refuses symlinks', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-review-'));
  try {
    const source = join(root, 'source'), outside = join(root, 'outside');
    fs.mkdirSync(source); fs.mkdirSync(outside);
    fs.writeFileSync(join(outside, 'auth.json'), 'dummy');
    fs.symlinkSync(outside, join(source, '.codex'));
    const target = join(root, 'target'), env = environment(target);
    assert.deepEqual(copyLogin('codex', source, target, env), []);
    assert.equal(fs.existsSync(join(env.HOME, '.codex/auth.json')), false);
    fs.symlinkSync(source, join(root, 'alias'));
    assert.deepEqual(copyLogin('codex', join(root, 'alias'), target, env), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('L8/L9 review: Claude and Muse use their own login layouts', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-review-'));
  try {
    const source = join(root, 'source');
    fs.mkdirSync(join(source, '.claude'), { recursive: true });
    fs.mkdirSync(join(source, '.config/muse'), { recursive: true });
    fs.writeFileSync(join(source, '.claude/.credentials.json'), 'claude-dummy');
    fs.writeFileSync(join(source, '.config/muse/auth.json'), 'muse-dummy');
    fs.writeFileSync(join(source, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'fixture' }, hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.301', mcpServers: { leak: 'discard' } }));
    for (const [family, name, body] of [['claude', '.claude/.credentials.json', 'claude-dummy'], ['muse', '.config/muse/auth.json', 'muse-dummy']]) {
      const target = join(root, family), env = environment(target);
      assert.ok(copyLogin(family, source, target, env).includes(name));
      assert.equal(fs.readFileSync(join(env.HOME, name), 'utf8'), body);
      if (family === 'claude') {
        const metadata = join(env.CLAUDE_CONFIG_DIR, '.claude.json');
        assert.equal(fs.existsSync(metadata), true, 'Claude metadata follows its explicit config directory');
        const value = JSON.parse(fs.readFileSync(metadata));
        assert.equal(value.mcpServers, undefined);
        assert.equal(value.hasCompletedOnboarding, true);
      }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('L4 review: destination components cannot redirect a login write outside the cell', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-review-'));
  try {
    const source = join(root, 'source'), outside = join(root, 'outside');
    fs.mkdirSync(join(source, '.codex'), { recursive: true }); fs.mkdirSync(outside);
    fs.writeFileSync(join(source, '.codex/auth.json'), 'dummy');
    fs.writeFileSync(join(outside, 'auth.json'), 'preserve');
    const target = join(root, 'target'), env = environment(target);
    fs.rmdirSync(env.CODEX_HOME); fs.symlinkSync(outside, env.CODEX_HOME);
    assert.throws(() => copyLogin('codex', source, target, env));
    assert.equal(fs.readFileSync(join(outside, 'auth.json'), 'utf8'), 'preserve');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('L5 review: lost-worker wipe removes all CLI private state including transcripts', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-review-'));
  try {
    const transcript = join(root, 'sender/home/.codex/sessions/transcript.jsonl');
    fs.mkdirSync(join(transcript, '..'), { recursive: true }); fs.writeFileSync(transcript, 'dummy');
    assert.deepEqual(wipeSecrets(cellSecretPaths(root)), []);
    assert.equal(fs.existsSync(transcript), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('L8 review: versions and config oracles use private HOME/XDG/cwd and nested Codex auth', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-review-'));
  try {
    const source = join(root, 'source'); fs.mkdirSync(join(source, '.codex'), { recursive: true });
    fs.writeFileSync(join(source, '.codex/auth.json'), '{}');
    const cli = join(root, 'codex'), log = join(root, 'calls.jsonl');
    // R15: the fixture emulates a real codex --help (pinned flags listed),
    // so the preflight's three binary probes are version, --help, and the
    // tier-C oracle — all private.
    fs.writeFileSync(cli, `#!${process.execPath}\nimport fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(log)},JSON.stringify({home:process.env.HOME,xdg:process.env.XDG_CONFIG_HOME,runtime:process.env.XDG_RUNTIME_DIR,cwd:process.cwd()})+'\\n');\nconsole.log(process.argv.includes('--version')?'1.2.3':process.argv.includes('--help')?'Usage: codex [--no-daemon] [--no-alt-screen]':'[]');\n`, { mode: 0o700 });
    const result = await runSeatPreflight({ seatId: 'c', family: 'codex', authSource: source }, { executables: { codex: cli } });
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, 3);
    for (const call of calls) {
      assert.notEqual(call.home, process.env.HOME);
      assert.ok(call.runtime.startsWith(tmpdir() + '/'));
      assert.ok(call.xdg.startsWith(call.home + '/'));
      assert.notEqual(call.cwd, process.cwd());
      assert.equal(fs.existsSync(call.home), false, 'preflight private state is wiped');
    }
    assert.equal(result.ok, true, result.reason);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
