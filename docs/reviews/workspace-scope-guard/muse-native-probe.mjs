// Targeted native dispatcher oracle. Requires a disposable, publicly downloaded
// Muse binary, never the owner's installed CLI. Missing input is a failure.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('Muse native dispatch enforces generated scope hooks and exact owner grants', t => {
  const binary = process.env.MUSE_SCOPE_PROBE_BINARY;
  assert.ok(binary, 'MUSE_SCOPE_PROBE_BINARY must name the isolated public artifact');
  assert.equal(createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),
    'decefc0fb33c48ee43419c3e72ac2dbc781743868611074c7292807f5960dfcf');
  const root = fs.mkdtempSync(join(tmpdir(), 'muse-scope-oracle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const own = join(root, 'own'), home = join(root, 'home');
  fs.mkdirSync(own); fs.mkdirSync(home);
  const env = { ...process.env, HOME: home, XDG_RUNTIME_DIR: root,
    XDG_CONFIG_HOME: join(home, '.config'), XDG_STATE_HOME: join(home, '.local/state'),
    XDG_DATA_HOME: join(home, '.local/share'), MUSE_HOME: join(home, '.config/muse'),
    CONFIG_DIR: join(home, '.config/muse'), H2A_ROOT: join(root, 'bus') };
  for (const key of ['CLAUDE_PROJECT_DIR', 'CODEX_WORKSPACE_ROOT', 'H2A_SCOPE_SESSION', 'H2A_SCOPE_OWNER_KEY']) delete env[key];
  const run = (executable, args) => {
    const r = spawnSync(executable, args, { cwd: own, env, encoding: 'utf8', timeout: 20_000, maxBuffer: 2_000_000 });
    assert.equal(r.status, 0, `${args.join(' ')}\n${r.stderr}\n${r.stdout}`);
    return r.stdout;
  };
  const muse = args => run(binary, args);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicFile = join(root, 'owner.pub'), privateFile = join(root, 'owner.pem');
  fs.writeFileSync(publicFile, publicKey.export({ type: 'spki', format: 'pem' }));
  fs.writeFileSync(privateFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(join(own, 'package.json'), '{"name":"native-fixture","version":"1.0.0"}');
  const cli = resolve('packages/h2a/dist/index.js');
  run(process.execPath, ['--input-type=module', '-e', `import { runCli } from ${JSON.stringify(cli)};
    process.exitCode=runCli(['install-skills','--host','muse','--owner-key',${JSON.stringify(publicFile)}],
      {cwd:()=>process.cwd(),stdout:process.stdout,stderr:process.stderr});`]);
  const config = JSON.parse(fs.readFileSync(join(own, '.muse/hooks.json'), 'utf8'));
  muse(['exec', '--provider', 'echo', '--disable-shell', '--disable-write', '--disable-web-tools',
    '--disable-reminders', '--no-foreign-personal-context', '--trust-workspace', '--json', 'hello']);
  const bindings = fs.readFileSync(join(own, '.h2a/workspace-scope/sessions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(bindings.length, 1, 'SessionStart must actually run');
  const session = bindings[0].session;
  const plugin = join(own, 'scope-probe');
  fs.mkdirSync(join(plugin, '.muse-plugin'), { recursive: true }); fs.mkdirSync(join(plugin, 'hooks'));
  const command = config.hooks.PreToolUse.find(e => JSON.stringify(e).includes('workspace-scope-guard')).hooks[0].command;
  fs.writeFileSync(join(plugin, 'hooks/check.sh'), '#!/bin/sh\nexec ' + command + '\n');
  fs.writeFileSync(join(plugin, '.muse-plugin/plugin.json'), JSON.stringify({ schemaVersion: 1,
    name: 'scope-probe', version: '0.1.0', description: 'Disposable native scope oracle',
    compat: { source: 'native', manifestDir: '.muse-plugin' }, capabilities: { skills: [], commands: [],
      hooks: [{ id: 'scope', event: 'PreToolUse', command: ['sh', 'hooks/check.sh'], timeoutMs: 15000 }],
      mcpServers: [], reminders: [] } }));
  const validation = JSON.parse(muse(['plugins', 'validate', plugin, '--json']));
  assert.equal(validation.valid, true); assert.deepEqual(validation.diagnostics, []);
  muse(['plugins', 'install', plugin, '--scope', 'user', '--json']);
  muse(['plugins', 'approve', 'scope-probe:hook:scope', '--json']);
  const dispatch = (name, toolInput, block, code) => {
    const file = join(root, 'fixture.json');
    fs.writeFileSync(file, JSON.stringify({ event: 'PreToolUse', stdin: { hook_event_name: 'PreToolUse',
      cwd: own, session_id: session, tool_name: name, tool_input: toolInput } }));
    const result = JSON.parse(muse(['plugins', 'hook', 'test', 'scope-probe:scope', '--fixture', file, '--json']));
    assert.equal(result.decision.should_block, block, JSON.stringify(result));
    assert.equal(result.terminals.length, 1);
    assert.equal(result.terminals[0].error, null);
    if (code) assert.ok(result.decision.block_reason.includes(`[H2A_SCOPE:${code}]`), JSON.stringify(result));
    t.diagnostic(`muse plugins hook test: ${name} ${code ?? 'allow'}, exit 0, should_block=${block}, terminal=${result.terminals[0].status}`);
  };
  const grant = (repo, action, ref, expires = new Date(Date.now() + 60_000).toISOString()) =>
    run(process.execPath, [resolve('packages/h2a/hooks/workspace-scope-grant.mjs'), '--key', privateFile,
      '--owner', 'owner:fixture', '--workspace', own, '--session', session,
      '--repo', repo, '--action', action, '--ref', ref, '--expires', expires]);
  dispatch('exec_command', { cmd: 'git status' }, false);
  dispatch('exec_command', { cmd: 'gh pr close -R foreign/repo 3' }, true, 'FOREIGN_WORKSPACE');
  grant('Foreign/repo', 'gh.pr.close', '3');
  dispatch('exec_command', { cmd: 'gh pr close -R foreign/repo 3' }, false);
  const edit = { file_path: join(own, 'package.json'), old_string: '1.0.0', new_string: '1.0.1' };
  dispatch('Edit', edit, true, 'VERSION_BUMP');
  grant(own, 'release', edit.file_path);
  dispatch('Edit', edit, false);
  // An expired signed row is appended directly because the owner helper rightly
  // refuses creating it. The hook must independently enforce its expiry.
  const expired = { schema: 1, owner: 'owner:fixture', workspace: fs.realpathSync(own), session,
    repo: 'github.com/foreign/repo', action: 'gh.pr.close', ref: '4', expires: '2020-01-01T00:00:00Z' };
  fs.appendFileSync(join(own, '.h2a/workspace-scope/grants.jsonl'), JSON.stringify({ grant: expired,
    signature: sign(null, Buffer.from(JSON.stringify(expired)), privateKey).toString('base64') }) + '\n');
  dispatch('exec_command', { cmd: 'gh pr close -R foreign/repo 4' }, true, 'FOREIGN_WORKSPACE');
});
